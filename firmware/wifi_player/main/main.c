#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/semphr.h"
#include "esp_log.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_partition.h"
#include "esp_http_server.h"
#include "nvs_flash.h"
#include "led_strip.h"

#define TAG                "wifi_player"
#define LED_FILE_MAGIC     0x4C45
#define LED_FILE_VERSION   0x01
#define LEDDATA_PARTITION  "leddata"

/* Kconfig で設定 */
#define WIFI_SSID          CONFIG_WIFI_SSID
#define WIFI_PASSWORD      CONFIG_WIFI_PASSWORD
#define LED_GPIO           CONFIG_LED_STRIP_GPIO
#define WS_PORT            CONFIG_WS_PORT

/* バイナリヘッダ構造体 */
typedef struct __attribute__((packed)) {
    uint16_t magic;
    uint8_t  version;
    uint8_t  flags;
    uint16_t led_count;
    uint16_t frame_count;
    uint8_t  fps;
    uint8_t  reserved[7];
} led_file_header_t;

/* ---- グローバル状態 ---- */

typedef enum { MODE_IDLE, MODE_PLAY_FLASH, MODE_REALTIME } player_mode_t;

static struct {
    player_mode_t   mode;
    uint8_t        *rt_frame;    /* リアルタイムフレームバッファ（GRB × led_count） */
    uint16_t        rt_led_count;
    SemaphoreHandle_t rt_mutex;
    bool            new_rt_frame;
    uint16_t        flash_led_count;
} g_state;

static led_strip_handle_t g_strip = NULL;
static uint16_t           g_strip_max = 0;

/* ---- LED ストリップ管理 ---- */

static esp_err_t init_strip(uint16_t led_count)
{
    if (g_strip && led_count == g_strip_max) return ESP_OK;
    if (g_strip) {
        led_strip_clear(g_strip);
        /* LED Stripのdeleteは API依存のため省略 */
    }

    led_strip_config_t strip_cfg = {
        .strip_gpio_num   = LED_GPIO,
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
    esp_err_t err = led_strip_new_rmt_device(&strip_cfg, &rmt_cfg, &g_strip);
    if (err == ESP_OK) g_strip_max = led_count;
    return err;
}

/* ---- 再生タスク ---- */

static void player_task(void *arg)
{
    const esp_partition_t *part = esp_partition_find_first(
        ESP_PARTITION_TYPE_DATA, ESP_PARTITION_SUBTYPE_ANY, LEDDATA_PARTITION);

    while (true) {
        switch (g_state.mode) {

        case MODE_PLAY_FLASH: {
            if (!part) { vTaskDelay(pdMS_TO_TICKS(500)); break; }

            led_file_header_t hdr;
            if (esp_partition_read(part, 0, &hdr, sizeof(hdr)) != ESP_OK) {
                ESP_LOGE(TAG, "ヘッダ読み込み失敗"); g_state.mode = MODE_IDLE; break;
            }
            if (hdr.magic != LED_FILE_MAGIC || hdr.version != LED_FILE_VERSION
                    || hdr.led_count == 0 || hdr.frame_count == 0 || hdr.fps == 0) {
                ESP_LOGW(TAG, "パターンデータが無効です"); g_state.mode = MODE_IDLE; break;
            }

            uint16_t lc = hdr.led_count, fc = hdr.frame_count, fps = hdr.fps;
            bool loop = hdr.flags & 0x01;
            if (init_strip(lc) != ESP_OK) { g_state.mode = MODE_IDLE; break; }

            size_t fsz = (size_t)lc * 3;
            uint8_t *buf = malloc(fsz);
            if (!buf) { g_state.mode = MODE_IDLE; break; }

            TickType_t fticks = pdMS_TO_TICKS(1000 / fps);
            ESP_LOGI(TAG, "フラッシュから再生: LED=%d, Frames=%d, FPS=%d", lc, fc, fps);

            do {
                for (uint16_t f = 0; f < fc && g_state.mode == MODE_PLAY_FLASH; f++) {
                    esp_partition_read(part, sizeof(hdr) + f * fsz, buf, fsz);
                    for (uint16_t i = 0; i < lc; i++) {
                        led_strip_set_pixel(g_strip, i, buf[i*3+1], buf[i*3+0], buf[i*3+2]);
                    }
                    led_strip_refresh(g_strip);
                    vTaskDelay(fticks);
                }
            } while (loop && g_state.mode == MODE_PLAY_FLASH);

            free(buf);
            if (g_state.mode == MODE_PLAY_FLASH) g_state.mode = MODE_IDLE;
            break;
        }

        case MODE_REALTIME: {
            if (!g_state.new_rt_frame) { vTaskDelay(pdMS_TO_TICKS(4)); break; }
            xSemaphoreTake(g_state.rt_mutex, portMAX_DELAY);
            uint16_t lc = g_state.rt_led_count;
            if (g_strip && lc > 0 && init_strip(lc) == ESP_OK) {
                for (uint16_t i = 0; i < lc; i++) {
                    led_strip_set_pixel(g_strip, i,
                        g_state.rt_frame[i*3+1], g_state.rt_frame[i*3+0], g_state.rt_frame[i*3+2]);
                }
                led_strip_refresh(g_strip);
            }
            g_state.new_rt_frame = false;
            xSemaphoreGive(g_state.rt_mutex);
            break;
        }

        default:
            vTaskDelay(pdMS_TO_TICKS(100));
        }
    }
}

/* ---- WebSocket ハンドラ ---- */

static esp_err_t ws_handler(httpd_req_t *req)
{
    if (req->method == HTTP_GET) {
        ESP_LOGI(TAG, "WebSocket接続: %s", req->uri);
        return ESP_OK;
    }

    httpd_ws_frame_t frame = { .type = HTTPD_WS_TYPE_BINARY };

    /* フレームサイズ確認 */
    esp_err_t ret = httpd_ws_recv_frame(req, &frame, 0);
    if (ret != ESP_OK) return ret;
    if (frame.len == 0) return ESP_OK;

    uint8_t *payload = malloc(frame.len);
    if (!payload) return ESP_ERR_NO_MEM;
    frame.payload = payload;

    ret = httpd_ws_recv_frame(req, &frame, frame.len);
    if (ret != ESP_OK) { free(payload); return ret; }

    const esp_partition_t *part = esp_partition_find_first(
        ESP_PARTITION_TYPE_DATA, ESP_PARTITION_SUBTYPE_ANY, LEDDATA_PARTITION);

    if (frame.len >= 2 && payload[0] == 0x4C && payload[1] == 0x45) {
        /* ---- フルパターン受信（.led フォーマット） ---- */
        if (!part) { ESP_LOGE(TAG, "パーティションが見つかりません"); free(payload); return ESP_FAIL; }
        if (frame.len < sizeof(led_file_header_t)) {
            ESP_LOGE(TAG, "データサイズが小さすぎます");
            free(payload); return ESP_FAIL;
        }

        g_state.mode = MODE_IDLE;
        vTaskDelay(pdMS_TO_TICKS(50));

        /* 必要セクタ数だけ消去して書き込む */
        size_t size = frame.len;
        size_t sectors = (size + 4095) / 4096;
        ESP_LOGI(TAG, "パターン受信: %u バイト, %u セクタ消去", (unsigned)size, (unsigned)sectors);

        ret = esp_partition_erase_range(part, 0, sectors * 4096);
        if (ret == ESP_OK) ret = esp_partition_write(part, 0, payload, size);

        if (ret == ESP_OK) {
            ESP_LOGI(TAG, "書き込み完了");
            /* 完了通知 "LEOK" */
            uint8_t ack[] = { 0x4C, 0x45, 0x4F, 0x4B };
            httpd_ws_frame_t ack_frame = {
                .type    = HTTPD_WS_TYPE_BINARY,
                .payload = ack,
                .len     = 4,
            };
            httpd_ws_send_frame(req, &ack_frame);
            g_state.mode = MODE_PLAY_FLASH;
        } else {
            ESP_LOGE(TAG, "書き込み失敗: %s", esp_err_to_name(ret));
        }

    } else if (frame.len >= 1 && payload[0] == 0xFF) {
        /* ---- リアルタイムフレーム受信 ---- */
        size_t data_len = frame.len - 1;
        uint16_t led_count = (uint16_t)(data_len / 3);
        if (led_count == 0) { free(payload); return ESP_OK; }

        xSemaphoreTake(g_state.rt_mutex, portMAX_DELAY);

        if (g_state.rt_led_count != led_count) {
            free(g_state.rt_frame);
            g_state.rt_frame = malloc(led_count * 3);
            g_state.rt_led_count = g_state.rt_frame ? led_count : 0;
        }

        if (g_state.rt_frame) {
            memcpy(g_state.rt_frame, payload + 1, led_count * 3);
            g_state.new_rt_frame = true;
            g_state.mode = MODE_REALTIME;
        }

        xSemaphoreGive(g_state.rt_mutex);
    }

    free(payload);
    return ESP_OK;
}

/* ---- WiFi 初期化 ---- */

static void wifi_init(void)
{
    esp_netif_init();
    esp_event_loop_create_default();
    esp_netif_create_default_wifi_sta();

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    esp_wifi_init(&cfg);
    esp_wifi_set_mode(WIFI_MODE_STA);

    wifi_config_t wcfg = {};
    strlcpy((char *)wcfg.sta.ssid,     WIFI_SSID,     sizeof(wcfg.sta.ssid));
    strlcpy((char *)wcfg.sta.password, WIFI_PASSWORD,  sizeof(wcfg.sta.password));
    esp_wifi_set_config(WIFI_IF_STA, &wcfg);
    esp_wifi_start();
    esp_wifi_connect();

    ESP_LOGI(TAG, "WiFi接続中: SSID=%s", WIFI_SSID);
    /* IPアドレスはログに出力される（idf_monitor で確認） */
}

/* ---- HTTP/WebSocket サーバー起動 ---- */

static httpd_handle_t start_server(void)
{
    httpd_config_t cfg = HTTPD_DEFAULT_CONFIG();
    cfg.server_port = WS_PORT;
    cfg.ctrl_port = 32768 + WS_PORT;

    httpd_handle_t server;
    if (httpd_start(&server, &cfg) != ESP_OK) {
        ESP_LOGE(TAG, "HTTPサーバー起動失敗");
        return NULL;
    }

    static const httpd_uri_t ws_uri = {
        .uri      = "/ws",
        .method   = HTTP_GET,
        .handler  = ws_handler,
        .is_websocket = true,
    };
    httpd_register_uri_handler(server, &ws_uri);

    ESP_LOGI(TAG, "WebSocketサーバー起動: ws://<IP>:%d/ws", WS_PORT);
    return server;
}

/* ---- エントリポイント ---- */

void app_main(void)
{
    nvs_flash_init();

    g_state.rt_mutex = xSemaphoreCreateMutex();
    g_state.mode     = MODE_PLAY_FLASH;

    /* 初回起動時はフラッシュのパターンを再生（データがあれば） */
    wifi_init();
    start_server();

    /* LEDストリップを仮初期化（デフォルト10個） */
    init_strip(10);

    xTaskCreate(player_task, "player", 4096, NULL, 5, NULL);

    /* メインタスクは終了しない */
    while (true) vTaskDelay(pdMS_TO_TICKS(10000));
}
