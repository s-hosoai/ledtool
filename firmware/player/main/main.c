#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"
#include "esp_partition.h"
#include "led_strip.h"

/* ---- ユーザー設定 ---- */
#define LED_STRIP_GPIO      GPIO_NUM_48  /* WS2812B データピン（環境に合わせて変更） */
/* ---------------------- */

#define TAG                 "led_player"
#define LED_FILE_MAGIC      0x4C45       /* "LE" */
#define LED_FILE_VERSION    0x01
#define LEDDATA_PARTITION   "leddata"

/* バイナリファイルのヘッダ構造体（spec §7.2 準拠） */
typedef struct __attribute__((packed)) {
    uint16_t magic;        /* 0x4C45 */
    uint8_t  version;      /* 0x01 */
    uint8_t  flags;        /* bit0: ループ再生 */
    uint16_t led_count;    /* LED数（リトルエンディアン） */
    uint16_t frame_count;  /* フレーム数（リトルエンディアン） */
    uint8_t  fps;          /* FPS（1〜60） */
    uint8_t  reserved[7];
} led_file_header_t;

void app_main(void)
{
    /* leddata パーティションを検索 */
    const esp_partition_t *part = esp_partition_find_first(
        ESP_PARTITION_TYPE_DATA, ESP_PARTITION_SUBTYPE_ANY, LEDDATA_PARTITION);
    if (!part) {
        ESP_LOGE(TAG, "パーティション '%s' が見つかりません", LEDDATA_PARTITION);
        return;
    }

    /* ヘッダ読み込み */
    led_file_header_t header;
    esp_err_t err = esp_partition_read(part, 0, &header, sizeof(header));
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "ヘッダ読み込み失敗: %s", esp_err_to_name(err));
        return;
    }

    /* バリデーション */
    if (header.magic != LED_FILE_MAGIC) {
        ESP_LOGE(TAG, "マジックナンバー不正: 0x%04X（期待値: 0x%04X）",
                 header.magic, LED_FILE_MAGIC);
        return;
    }
    if (header.version != LED_FILE_VERSION) {
        ESP_LOGE(TAG, "未対応バージョン: %d", header.version);
        return;
    }
    if (header.led_count == 0 || header.frame_count == 0 || header.fps == 0) {
        ESP_LOGE(TAG, "ヘッダ値が不正です（LED=%d, Frames=%d, FPS=%d）",
                 header.led_count, header.frame_count, header.fps);
        return;
    }

    bool     loop_en    = (header.flags & 0x01) != 0;
    uint16_t led_count  = header.led_count;
    uint16_t frame_count = header.frame_count;
    uint8_t  fps        = header.fps;

    ESP_LOGI(TAG, "LED数=%d  フレーム数=%d  FPS=%d  ループ=%s",
             led_count, frame_count, fps, loop_en ? "ON" : "OFF");

    /* LED ストリップ初期化（RMT経由） */
    led_strip_handle_t strip;
    led_strip_config_t strip_cfg = {
        .strip_gpio_num     = LED_STRIP_GPIO,
        .max_leds           = led_count,
        .led_pixel_format   = LED_PIXEL_FORMAT_GRB,
        .led_model          = LED_MODEL_WS2812,
        .flags.invert_out   = false,
    };
    led_strip_rmt_config_t rmt_cfg = {
        .clk_src        = RMT_CLK_SRC_DEFAULT,
        .resolution_hz  = 10 * 1000 * 1000,  /* 10 MHz */
        .flags.with_dma = false,
    };
    err = led_strip_new_rmt_device(&strip_cfg, &rmt_cfg, &strip);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "LED ストリップ初期化失敗: %s", esp_err_to_name(err));
        return;
    }

    /* フレームバッファ確保（フレーム1枚分、GRB × LED数） */
    const size_t frame_size = (size_t)led_count * 3;
    uint8_t *frame_buf = malloc(frame_size);
    if (!frame_buf) {
        ESP_LOGE(TAG, "フレームバッファ確保失敗");
        return;
    }

    const TickType_t frame_ticks = pdMS_TO_TICKS(1000 / fps);

    /* 再生ループ */
    while (true) {
        for (uint16_t f = 0; f < frame_count; f++) {
            /* フレームデータをフラッシュから読み込む */
            size_t offset = sizeof(led_file_header_t) + (size_t)f * frame_size;
            err = esp_partition_read(part, offset, frame_buf, frame_size);
            if (err != ESP_OK) {
                ESP_LOGE(TAG, "フレーム %d 読み込み失敗: %s", f, esp_err_to_name(err));
                goto cleanup;
            }

            /* GRB → LED ストリップへ出力（led_strip_set_pixel は RGB 引数） */
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
