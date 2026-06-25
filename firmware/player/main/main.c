#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"
#include "esp_partition.h"
#include "esp_system.h"
#include "driver/uart.h"
#include "led_strip.h"

/* ---- ユーザー設定 ---- */
#define LED_STRIP_GPIO      GPIO_NUM_48   /* WS2812B データピン（環境に合わせて変更） */
#define UART_UPLOAD_TIMEOUT 3000          /* 起動後UARTアップロード待機時間(ms) */
/* ---------------------- */

#define TAG                 "led_player"
#define LED_FILE_MAGIC      0x4C45        /* "LE" */
#define LED_FILE_VERSION    0x01
#define LEDDATA_PARTITION   "leddata"

/* WebSerial UARTアップロードプロトコル */
#define UART_MAGIC_UP       "\x4C\x45\x55\x50"  /* "LEUP" */
#define UART_MAGIC_OK       "\x4C\x45\x4F\x4B"  /* "LEOK" */
#define UART_MAGIC_ERR      "\x4C\x45\x45\x52"  /* "LEER" */

/* バイナリファイルのヘッダ構造体（spec §7.2 準拠） */
typedef struct __attribute__((packed)) {
    uint16_t magic;
    uint8_t  version;
    uint8_t  flags;
    uint16_t led_count;
    uint16_t frame_count;
    uint8_t  fps;
    uint8_t  reserved[7];
} led_file_header_t;

/* ---- UART アップロード処理 ---- */

static bool uart_upload(const esp_partition_t *part)
{
    uart_config_t cfg = {
        .baud_rate  = 115200,
        .data_bits  = UART_DATA_8_BITS,
        .parity     = UART_PARITY_DISABLE,
        .stop_bits  = UART_STOP_BITS_1,
        .flow_ctrl  = UART_HW_FLOWCTRL_DISABLE,
    };
    uart_param_config(UART_NUM_0, &cfg);
    uart_driver_install(UART_NUM_0, 8192, 8192, 0, NULL, 0);

    /* ① "LEUP" マジック受信 */
    uint8_t hdr[8];
    int n = uart_read_bytes(UART_NUM_0, hdr, 8, pdMS_TO_TICKS(UART_UPLOAD_TIMEOUT));
    if (n < 8 || memcmp(hdr, UART_MAGIC_UP, 4) != 0) {
        uart_driver_delete(UART_NUM_0);
        return false;
    }

    uint32_t data_size;
    memcpy(&data_size, hdr + 4, 4);  /* リトルエンディアン */
    ESP_LOGI(TAG, "UARTアップロード開始: %lu バイト", (unsigned long)data_size);

    /* ② 受信準備完了を通知 */
    uart_write_bytes(UART_NUM_0, UART_MAGIC_OK, 4);

    /* ③ データ受信・フラッシュ書き込み */
    const size_t SECTOR = 4096;
    size_t erased = 0;
    size_t written = 0;
    uint8_t chunk[SECTOR];

    while (written < data_size) {
        size_t to_read = data_size - written;
        if (to_read > SECTOR) to_read = SECTOR;

        /* セクタ単位で事前消去 */
        if (written >= erased) {
            size_t erase_len = SECTOR;
            if (erased + erase_len > part->size) erase_len = part->size - erased;
            esp_err_t e = esp_partition_erase_range(part, erased, erase_len);
            if (e != ESP_OK) {
                ESP_LOGE(TAG, "消去失敗 @ %u: %s", (unsigned)erased, esp_err_to_name(e));
                uart_write_bytes(UART_NUM_0, UART_MAGIC_ERR, 4);
                uart_driver_delete(UART_NUM_0);
                return false;
            }
            erased += erase_len;
        }

        int got = uart_read_bytes(UART_NUM_0, chunk, to_read, pdMS_TO_TICKS(5000));
        if (got <= 0) {
            ESP_LOGE(TAG, "受信タイムアウト");
            uart_write_bytes(UART_NUM_0, UART_MAGIC_ERR, 4);
            uart_driver_delete(UART_NUM_0);
            return false;
        }

        esp_err_t e = esp_partition_write(part, written, chunk, got);
        if (e != ESP_OK) {
            ESP_LOGE(TAG, "書き込み失敗: %s", esp_err_to_name(e));
            uart_write_bytes(UART_NUM_0, UART_MAGIC_ERR, 4);
            uart_driver_delete(UART_NUM_0);
            return false;
        }
        written += got;
        ESP_LOGD(TAG, "書き込み進捗: %u / %lu", (unsigned)written, (unsigned long)data_size);
    }

    /* ④ 完了通知 */
    uart_write_bytes(UART_NUM_0, UART_MAGIC_OK, 4);
    uart_flush(UART_NUM_0);
    uart_driver_delete(UART_NUM_0);

    ESP_LOGI(TAG, "UARTアップロード完了 (%u バイト)", (unsigned)written);
    return true;
}

/* ---- LED パターン再生 ---- */

static void play_from_flash(const esp_partition_t *part)
{
    led_file_header_t header;
    esp_err_t err = esp_partition_read(part, 0, &header, sizeof(header));
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "ヘッダ読み込み失敗: %s", esp_err_to_name(err));
        return;
    }

    if (header.magic != LED_FILE_MAGIC) {
        ESP_LOGE(TAG, "マジックナンバー不正: 0x%04X", header.magic);
        return;
    }
    if (header.version != LED_FILE_VERSION) {
        ESP_LOGE(TAG, "未対応バージョン: %d", header.version);
        return;
    }
    if (header.led_count == 0 || header.frame_count == 0 || header.fps == 0) {
        ESP_LOGE(TAG, "ヘッダ値不正 (LED=%d, Frames=%d, FPS=%d)",
                 header.led_count, header.frame_count, header.fps);
        return;
    }

    bool     loop_en    = (header.flags & 0x01) != 0;
    uint16_t led_count  = header.led_count;
    uint16_t frame_count = header.frame_count;
    uint8_t  fps        = header.fps;

    ESP_LOGI(TAG, "再生開始: LED=%d  フレーム=%d  FPS=%d  ループ=%s",
             led_count, frame_count, fps, loop_en ? "ON" : "OFF");

    led_strip_handle_t strip;
    led_strip_config_t strip_cfg = {
        .strip_gpio_num   = LED_STRIP_GPIO,
        .max_leds         = led_count,
        .led_pixel_format = LED_PIXEL_FORMAT_GRB,
        .led_model        = LED_MODEL_WS2812,
        .flags.invert_out = false,
    };
    led_strip_rmt_config_t rmt_cfg = {
        .clk_src        = RMT_CLK_SRC_DEFAULT,
        .resolution_hz  = 10 * 1000 * 1000,
        .flags.with_dma = false,
    };
    err = led_strip_new_rmt_device(&strip_cfg, &rmt_cfg, &strip);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "LED ストリップ初期化失敗: %s", esp_err_to_name(err));
        return;
    }

    const size_t frame_size = (size_t)led_count * 3;
    uint8_t *frame_buf = malloc(frame_size);
    if (!frame_buf) {
        ESP_LOGE(TAG, "フレームバッファ確保失敗");
        return;
    }

    const TickType_t frame_ticks = pdMS_TO_TICKS(1000 / fps);

    while (true) {
        for (uint16_t f = 0; f < frame_count; f++) {
            size_t offset = sizeof(led_file_header_t) + (size_t)f * frame_size;
            err = esp_partition_read(part, offset, frame_buf, frame_size);
            if (err != ESP_OK) {
                ESP_LOGE(TAG, "フレーム %d 読み込み失敗", f);
                goto cleanup;
            }
            for (uint16_t i = 0; i < led_count; i++) {
                uint8_t g = frame_buf[i * 3 + 0];
                uint8_t r = frame_buf[i * 3 + 1];
                uint8_t b = frame_buf[i * 3 + 2];
                led_strip_set_pixel(strip, i, r, g, b);
            }
            led_strip_refresh(strip);
            vTaskDelay(frame_ticks);
        }
        if (!loop_en) break;
    }

cleanup:
    led_strip_clear(strip);
    free(frame_buf);
    ESP_LOGI(TAG, "再生終了");
}

/* ---- エントリポイント ---- */

void app_main(void)
{
    const esp_partition_t *part = esp_partition_find_first(
        ESP_PARTITION_TYPE_DATA, ESP_PARTITION_SUBTYPE_ANY, LEDDATA_PARTITION);
    if (!part) {
        ESP_LOGE(TAG, "パーティション '%s' が見つかりません", LEDDATA_PARTITION);
        return;
    }

    /* 起動時にUARTアップロードを待機し、受信したらリセット */
    ESP_LOGI(TAG, "UARTアップロード待機中（%d ms）...", UART_UPLOAD_TIMEOUT);
    if (uart_upload(part)) {
        ESP_LOGI(TAG, "アップロード完了。リセットします...");
        vTaskDelay(pdMS_TO_TICKS(200));
        esp_restart();
        return;
    }

    /* 通常再生 */
    play_from_flash(part);
}
