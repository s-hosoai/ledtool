# LED Pattern Editor

WS2812B などのフルカラー LED 向けに、点灯パターンをブラウザ上で作成・シミュレーション・転送できる GUI ツールです。

**公開ページ：[https://s-hosoai.github.io/ledtool/](https://s-hosoai.github.io/ledtool/)**

---

## 機能

### タイムラインエディタ
- LED × フレームのグリッド上で色を直感的に設定
- ドラッグによる範囲選択・一括塗り
- フレームのコピー／ペースト／挿入／削除

### キーフレームモード
- 各セル（LED × フレーム）を個別にキーフレームとして指定
- LED ごとに独立した補間（線形 / ステップ）
- KF セル間は自動で補間表示（◆マーカーで識別）

### シミュレーター
- レイアウト座標を反映した LED 配置でリアルタイムプレビュー
- 再生速度変更（0.25× 〜 4×）、ループ制御

### レイアウトエディタ
- ドラッグ＆ドロップで LED を自由配置
- プリセット：直線 / 蛇行 / 格子 / 円形

### ESP32 への転送
| 方法 | 説明 |
|------|------|
| バイナリダウンロード | `.led` ファイルを esptool で書き込み |
| WebSerial | USB ケーブルで直接転送（LEUP/LEOK プロトコル） |
| WiFi (WebSocket) | ワイヤレス転送・リアルタイムストリーミング |
| BLE | NimBLE GATT 経由でパターン転送 |

### その他
- ガンマ補正（エクスポート時適用）
- パターン変換（フレーム反転 / LED 反転 / 色反転）
- プロジェクト保存・読み込み（`.ledproj` JSON）

---

## 技術スタック

- **フロントエンド**：Vite + Vue 3 (Composition API)
- **描画**：Canvas 2D API
- **ファームウェア**：ESP-IDF v5.x（`firmware/` 以下）
- **デプロイ**：GitHub Pages（静的サイト、バックエンド不要）

---

## ローカルでの実行

```bash
pnpm install
pnpm run dev
```

## ビルド

```bash
pnpm run build
```

---

## ファームウェア

`firmware/` 以下に ESP32 向けファームウェアが含まれます。

| ディレクトリ | 内容 |
|---|---|
| `firmware/player/` | UART アップロード対応プレイヤー |
| `firmware/wifi_player/` | WiFi / WebSocket 対応プレイヤー |
| `firmware/ble_player/` | BLE（NimBLE）対応プレイヤー |

ビルドには [ESP-IDF v5.x](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/) が必要です。

---

## ドキュメント

- [機能仕様書](docs/spec.md)
- [開発マイルストーン](docs/milestone.md)
