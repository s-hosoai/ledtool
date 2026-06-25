# LED Pattern Editor - Project Memory

## プロジェクト概要
WS2812B等のフルカラーLED向けに、点灯パターンをブラウザ上で作成・シミュレーション・転送するGUIツール。
詳細は `docs/spec.md`、開発計画は `docs/milestone.md` を参照。

## 技術スタック
- ビルドツール：Vite
- UIフレームワーク：Vue 3
- 描画：Canvas 2D API（タイムライン・シミュレーター）
- スタイル：CSS
- マイコン：ESP32 / LED：WS2812B
- 転送：Phase 1はファイルダウンロード（バイナリ）
- デプロイ：静的サイト（GitHub Pages 等）、バックエンドサーバー不要

## ディレクトリ構成
```
led-pattern-editor/
├── CLAUDE.md          # このファイル（Claude Code用）
├── index.html         # エントリーポイント
├── src/               # Vue 3 ソースコード
│   ├── main.js
│   ├── App.vue
│   ├── components/    # UIコンポーネント
│   └── composables/   # ロジック（useTimeline等）
├── docs/
│   ├── spec.md        # 機能仕様書
│   └── milestone.md   # 開発マイルストーン
└── firmware/
    └── player/        # ESP32側ファームウェア（将来）
```

## コーディング規約
- 変数名・関数名：英語（キャメルケース）
- コメント：日本語
- インデント：スペース2つ
- 定数は `const` で大文字スネークケース（例：`MAX_LED_COUNT`）
- Vue コンポーネント名：パスカルケース（例：`TimelineEditor.vue`）
- ロジックは composables に分離（`use` プレフィックス、例：`useTimeline.js`）

## 重要な設計決定（変更時は spec.md も更新すること）
- LED番号は **0始まり** で統一
- 時間の内部表現は **フレーム番号**、秒換算はFPSから都度計算
- RGBバイト順：内部はRGB、**バイナリ出力時にGRB変換**（ESP32/WS2812B対応）
- プロジェクトファイル形式：JSON（拡張子 `.ledproj`）
- バイナリフォーマット：マジックナンバー `0x4C45`（"LE"）、バージョン `0x01`

## 禁止事項
- バックエンドサーバーへの依存（静的サイトとして完結させること）
- `localStorage` / `sessionStorage` の使用（ファイル保存・読み込みで代替）
- ガンマ補正の実装（v1.0スコープ外）

## 開発時の注意
- `docs/milestone.md` の現在フェーズを確認してから作業開始
- UIラベル・メッセージは**日本語**（将来的に小中学生も使用する想定）
- 機能追加時はまず `docs/spec.md` の「未決定事項」を確認
