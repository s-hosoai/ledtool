#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"
#include "esp_partition.h"
#include "nvs_flash.h"
#include "nimble/nimble_port.h"
#include "nimble/nimble_port_freertos.h"
#include "host/ble_hs.h"
#include "host/ble_gap.h"
#include "host/util/util.h"
#include "services/gap/ble_svc_gap.h"
#include "services/gatt/ble_svc_gatt.h"
#include "led_strip.h"

#define TAG               "ble_player"
#define LED_FILE_MAGIC    0x4C45
#define LED_FILE_VERSION  0x01
#define LEDDATA_PARTITION "leddata"
#define LED_GPIO          48   /* 環境に合わせて変更 */

/*
 * BLE GATTサービス定義
 *
 * カスタムサービス UUID:  12345678-1234-1234-1234-123456789000
 *
 * キャラクタリスティック:
 *   UPLOAD_CTRL (Write): アップロード制御
 *     0x01 + uint32_t total_size → アップロード開始、受信バッファ確保
 *     0x02                       → アップロード完了、フラッシュ書き込み・再生開始
 *     0x03                       → キャンセル
 *   UPLOAD_DATA (Write): データチャンク（最大512バイト/MTU）
 *   STATUS (Notify): ステータス応答
 *     0x01 = 準備完了, 0x02 = 完了, 0x03 = エラー
 *
 * 転送フロー:
 *   1. ブラウザ: UPLOAD_CTRL に [0x01 + size(4バイト)] を書き込む
 *   2. ESP32: STATUS で 0x01 を通知（準備完了）
 *   3. ブラウザ: UPLOAD_DATA に 512バイトずつ書き込む
 *   4. ブラウザ: UPLOAD_CTRL に 0x02 を書き込む（完了）
 *   5. ESP32: フラッシュ書き込み → STATUS で 0x02 を通知
 */

/* サービス UUID */
static const ble_uuid128_t svc_uuid = BLE_UUID128_INIT(
    0x00, 0x90, 0x78, 0x56, 0x34, 0x12, 0x34, 0x12,
    0x34, 0x12, 0x34, 0x12, 0x78, 0x56, 0x34, 0x12);

/* キャラクタリスティック UUID */
static const ble_uuid128_t ctrl_uuid = BLE_UUID128_INIT(
    0x01, 0x90, 0x78, 0x56, 0x34, 0x12, 0x34, 0x12,
    0x34, 0x12, 0x34, 0x12, 0x78, 0x56, 0x34, 0x12);
static const ble_uuid128_t data_uuid = BLE_UUID128_INIT(
    0x02, 0x90, 0x78, 0x56, 0x34, 0x12, 0x34, 0x12,
    0x34, 0x12, 0x34, 0x12, 0x78, 0x56, 0x34, 0x12);
static const ble_uuid128_t status_uuid = BLE_UUID128_INIT(
    0x03, 0x90, 0x78, 0x56, 0x34, 0x12, 0x34, 0x12,
    0x34, 0x12, 0x34, 0x12, 0x78, 0x56, 0x34, 0x12);

static uint16_t g_status_handle;
static uint16_t g_conn_handle = BLE_HS_CONN_HANDLE_NONE;

static uint8_t  *g_upload_buf  = NULL;
static uint32_t  g_upload_total = 0;
static uint32_t  g_upload_rcvd  = 0;

/* バイナリヘッダ */
typedef struct __attribute__((packed)) {
    uint16_t magic; uint8_t version; uint8_t flags;
    uint16_t led_count; uint16_t frame_count; uint8_t fps; uint8_t reserved[7];
} led_file_header_t;

static led_strip_handle_t g_strip = NULL;

static void notify_status(uint8_t code)
{
    if (g_conn_handle == BLE_HS_CONN_HANDLE_NONE) return;
    struct os_mbuf *om = ble_hs_mbuf_from_flat(&code, 1);
    if (!om) return;
    ble_gattc_notify_custom(g_conn_handle, g_status_handle, om);
}

static void play_from_flash(void)
{
    const esp_partition_t *part = esp_partition_find_first(
        ESP_PARTITION_TYPE_DATA, ESP_PARTITION_SUBTYPE_ANY, LEDDATA_PARTITION);
    if (!part) return;

    led_file_header_t hdr;
    if (esp_partition_read(part, 0, &hdr, sizeof(hdr)) != ESP_OK) return;
    if (hdr.magic != LED_FILE_MAGIC || hdr.version != LED_FILE_VERSION) return;

    uint16_t lc = hdr.led_count, fc = hdr.frame_count;
    uint8_t  fps = hdr.fps; bool loop = hdr.flags & 0x01;

    led_strip_config_t strip_cfg = {
        .strip_gpio_num   = LED_GPIO, .max_leds = lc,
        .led_pixel_format = LED_PIXEL_FORMAT_GRB, .led_model = LED_MODEL_WS2812,
    };
    led_strip_rmt_config_t rmt_cfg = {
        .clk_src = RMT_CLK_SRC_DEFAULT, .resolution_hz = 10000000,
    };
    led_strip_new_rmt_device(&strip_cfg, &rmt_cfg, &g_strip);

    size_t fsz = (size_t)lc * 3;
    uint8_t *buf = malloc(fsz);
    if (!buf) return;

    do {
        for (uint16_t f = 0; f < fc; f++) {
            esp_partition_read(part, sizeof(hdr) + f * fsz, buf, fsz);
            for (uint16_t i = 0; i < lc; i++) {
                led_strip_set_pixel(g_strip, i, buf[i*3+1], buf[i*3+0], buf[i*3+2]);
            }
            led_strip_refresh(g_strip);
            vTaskDelay(pdMS_TO_TICKS(1000 / fps));
        }
    } while (loop);

    free(buf);
}

/* ---- GATT キャラクタリスティックコールバック ---- */

static int ctrl_write_cb(uint16_t conn_handle, uint16_t attr_handle,
                         struct ble_gatt_access_ctxt *ctxt, void *arg)
{
    uint8_t cmd = 0;
    os_mbuf_copydata(ctxt->om, 0, 1, &cmd);

    if (cmd == 0x01) {
        /* アップロード開始 */
        uint32_t total = 0;
        os_mbuf_copydata(ctxt->om, 1, 4, &total);
        free(g_upload_buf);
        g_upload_buf   = malloc(total);
        g_upload_total = total;
        g_upload_rcvd  = 0;
        ESP_LOGI(TAG, "BLEアップロード開始: %lu バイト", (unsigned long)total);
        notify_status(0x01);
    } else if (cmd == 0x02) {
        /* アップロード完了 → フラッシュ書き込み */
        const esp_partition_t *part = esp_partition_find_first(
            ESP_PARTITION_TYPE_DATA, ESP_PARTITION_SUBTYPE_ANY, LEDDATA_PARTITION);
        if (part && g_upload_buf && g_upload_rcvd > 0) {
            size_t sectors = (g_upload_rcvd + 4095) / 4096;
            esp_partition_erase_range(part, 0, sectors * 4096);
            esp_partition_write(part, 0, g_upload_buf, g_upload_rcvd);
            ESP_LOGI(TAG, "BLE書き込み完了: %lu バイト", (unsigned long)g_upload_rcvd);
            notify_status(0x02);
            free(g_upload_buf); g_upload_buf = NULL;
            /* 再生タスクを起動 */
            xTaskCreate((TaskFunction_t)play_from_flash, "ble_play", 4096, NULL, 5, NULL);
        } else {
            notify_status(0x03);
        }
    } else if (cmd == 0x03) {
        free(g_upload_buf); g_upload_buf = NULL;
        g_upload_total = 0; g_upload_rcvd = 0;
    }
    return 0;
}

static int data_write_cb(uint16_t conn_handle, uint16_t attr_handle,
                         struct ble_gatt_access_ctxt *ctxt, void *arg)
{
    if (!g_upload_buf) return BLE_ATT_ERR_INSUFFICIENT_RES;
    uint16_t len = OS_MBUF_PKTLEN(ctxt->om);
    if (g_upload_rcvd + len > g_upload_total) len = g_upload_total - g_upload_rcvd;
    os_mbuf_copydata(ctxt->om, 0, len, g_upload_buf + g_upload_rcvd);
    g_upload_rcvd += len;
    return 0;
}

static int status_access_cb(uint16_t conn_handle, uint16_t attr_handle,
                             struct ble_gatt_access_ctxt *ctxt, void *arg)
{
    return 0;
}

static const struct ble_gatt_svc_def gatt_svcs[] = {
    {
        .type     = BLE_GATT_SVC_TYPE_PRIMARY,
        .uuid     = &svc_uuid.u,
        .characteristics = (struct ble_gatt_chr_def[]) {
            {
                .uuid  = &ctrl_uuid.u,
                .flags = BLE_GATT_CHR_F_WRITE,
                .access_cb = ctrl_write_cb,
            },
            {
                .uuid  = &data_uuid.u,
                .flags = BLE_GATT_CHR_F_WRITE_NO_RSP,
                .access_cb = data_write_cb,
            },
            {
                .uuid      = &status_uuid.u,
                .flags     = BLE_GATT_CHR_F_NOTIFY,
                .access_cb = status_access_cb,
                .val_handle = &g_status_handle,
            },
            { 0 }
        },
    },
    { 0 }
};

/* ---- GAP イベント ---- */

static int gap_event_cb(struct ble_gap_event *event, void *arg)
{
    switch (event->type) {
    case BLE_GAP_EVENT_CONNECT:
        if (event->connect.status == 0) {
            g_conn_handle = event->connect.conn_handle;
            ESP_LOGI(TAG, "BLE接続");
        } else {
            g_conn_handle = BLE_HS_CONN_HANDLE_NONE;
            ble_gap_adv_start(BLE_OWN_ADDR_PUBLIC, NULL, BLE_HS_FOREVER,
                              NULL, gap_event_cb, NULL);
        }
        break;
    case BLE_GAP_EVENT_DISCONNECT:
        g_conn_handle = BLE_HS_CONN_HANDLE_NONE;
        ESP_LOGI(TAG, "BLE切断");
        ble_gap_adv_start(BLE_OWN_ADDR_PUBLIC, NULL, BLE_HS_FOREVER,
                          NULL, gap_event_cb, NULL);
        break;
    }
    return 0;
}

static void ble_host_task(void *arg) { nimble_port_run(); }

static void on_sync(void)
{
    ble_svc_gap_device_name_set("LED-Player");
    ble_svc_gap_init(); ble_svc_gatt_init();
    ble_gatts_count_cfg(gatt_svcs);
    ble_gatts_add_svcs(gatt_svcs);

    struct ble_gap_adv_params adv_params = {
        .conn_mode = BLE_GAP_CONN_MODE_UND,
        .disc_mode = BLE_GAP_DISC_MODE_GEN,
    };
    ble_gap_adv_start(BLE_OWN_ADDR_PUBLIC, NULL, BLE_HS_FOREVER,
                      &adv_params, gap_event_cb, NULL);
    ESP_LOGI(TAG, "BLEアドバタイズ開始");
}

void app_main(void)
{
    nvs_flash_init();
    nimble_port_init();
    ble_hs_cfg.sync_cb = on_sync;
    nimble_port_freertos_init(ble_host_task);

    /* BLE接続を待ちながらフラッシュのパターンを再生 */
    play_from_flash();
    while (true) vTaskDelay(pdMS_TO_TICKS(10000));
}
