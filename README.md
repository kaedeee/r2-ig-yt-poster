---
# R2 → Instagram / YouTube Auto Poster

Cloudflare R2 にアップロードした動画を、**毎時（JST 日中）に 1 本ずつ Instagram と YouTube に自動投稿し、投稿後は削除する** GitHub Actions Bot です。
複数アカウント対応：**Instagram 3 アカウント**、**YouTube 2 アカウント**をランダムに使い分けます。
---

## 機能概要

- **動画ソース**: Cloudflare R2（Public URL / r2.dev）
- **スケジュール**: GitHub Actions の cron（毎時、JST 10〜18 時）
- **Instagram**: Graph API を利用し投稿（キャプション＝ファイル名）
- **YouTube**: Data API v3 を利用し投稿（タイトル/説明＝ファイル名）
- **ファイル名 → メタデータ**

  - `_` → スペースに変換
  - 拡張子除去
  - **Instagram キャプション**: ファイル名全文
  - **YouTube タイトル**: 先頭 100 文字
  - **YouTube 説明**: ファイル名全文

- **削除ポリシー**: IG/YouTube 両方成功したら R2 から削除。片方失敗なら保持して再挑戦。

---

## 前提条件

- **Cloudflare アカウント**（R2 有効化）
- **Instagram プロアカウント**（ビジネス/クリエイター）
- **YouTube アカウント（2 つ）**

  - Google Cloud Console で OAuth クライアント作成
  - 各チャンネルごとに `refresh_token` を取得

---

## セットアップ

### 1. R2 の準備

1. Cloudflare ダッシュボード → **R2 → Create bucket**
   例: `ig-yt-media`
2. **Public access** をオンにする
   （今回は `https://<bucket>.r2.dev` を利用）
3. **API Token** を発行（Read/Write）

### 2. GitHub Secrets の設定

リポジトリ → Settings → Secrets and variables → Actions に以下を登録:

#### R2

- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET` = `ig-yt-media`
- `R2_PUBLIC_BASE_URL` = `https://ig-yt-media.r2.dev`

#### Instagram（3 アカ）

- `IG_ACCOUNTS`（JSON）

```json
[
  { "userId": "1789xxxxxxxxxxxx1", "accessToken": "EAAG...1" },
  { "userId": "1789xxxxxxxxxxxx2", "accessToken": "EAAG...2" },
  { "userId": "1789xxxxxxxxxxxx3", "accessToken": "EAAG...3" }
]
```

#### YouTube（2 アカ）

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `YT_ACCOUNTS`（JSON）

```json
[{ "refreshToken": "1//0g...Aa" }, { "refreshToken": "1//0h...Bb" }]
```

#### オプション

- `POST_WINDOW_JST` = `"10-18"`（投稿する時間帯）
- `YT_DAILY_LIMIT` = `"6"`（YouTube の 1 日上限）
- `DRY_RUN` = `"1"`（テスト時、投稿/削除を実行せずログのみ）

---

## ワークフロー

`.github/workflows/post-every-hour.yml`

```yaml
name: R2 → IG/YouTube hourly

on:
  schedule:
    # JST 10:00〜18:00 を毎時実行 (UTC換算: 1〜9時)
    - cron: "0 1-9 * * *"
  workflow_dispatch: {}

jobs:
  post:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - run: npm ci
      - run: npm run post
        env:
          R2_ACCOUNT_ID: ${{ secrets.R2_ACCOUNT_ID }}
          R2_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
          R2_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
          R2_BUCKET: ${{ secrets.R2_BUCKET }}
          R2_PUBLIC_BASE_URL: ${{ secrets.R2_PUBLIC_BASE_URL }}
          IG_ACCOUNTS: ${{ secrets.IG_ACCOUNTS }}
          GOOGLE_CLIENT_ID: ${{ secrets.GOOGLE_CLIENT_ID }}
          GOOGLE_CLIENT_SECRET: ${{ secrets.GOOGLE_CLIENT_SECRET }}
          YT_ACCOUNTS: ${{ secrets.YT_ACCOUNTS }}
          POST_WINDOW_JST: "10-18"
          YT_DAILY_LIMIT: "6"
```

---

## 動作の流れ

1. R2 バケット直下から動画を 1 本ピックアップ
2. ファイル名 → キャプション/タイトル/説明を生成
3. IG アカウント（3 つからランダム）、YT アカウント（2 つからランダム）に投稿
4. 両方成功したら R2 から削除。失敗したら残して次回再挑戦

---

## 制約

- **Instagram API**: 24 時間で最大 100 件まで
- **YouTube API**: 1 動画=1600 クォータ、1 日 1 万まで（安全圏は 6 本/日）
- **ファイル形式**: mp4 (H.264/AAC) 必須。`Content-Type: video/mp4` で保存されていること

---

## 開発メモ

- ファイル名に `_` を使うとスペースに変換されます
- DRY_RUN=1 でテスト実行可能（投稿せずログのみ）
- 将来的に「ハッシュタグ抽出」「アカウントごとの重み付き投稿」も簡単に追加できます

---
