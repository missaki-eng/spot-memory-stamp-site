# stamp-rally-site

スタンプラリー専用サイト (Node.js 20+, 依存パッケージなし)。

## ページ
- `/` ラリー一覧
- `/rallies/:id` ラリー詳細 + 自分のスタンプ帳 (端末ごとに localStorage の ID で管理)
- `/c/:code` QR の読み取り先。写真発見 → スタンプ押印 → カード表示 → スポット概要・シェア・アプリ誘導の演出ページ。
  画像は `sr_spots.photo_url` (スポット写真) と `sr_spots.stamp_image_url` (スタンプ画像、未設定なら番号入りの仮スタンプ)。
  画像は https の URL で、シェア画像用に CORS を許可している必要がある (Supabase Storage の公開バケットは可)。
- `/healthz` ヘルスチェック

## セットアップ
1. Supabase の SQL Editor で `supabase/schema.sql` を実行 (再実行しても安全)。
   すでに実行済みの場合は、差分だけの `supabase/002_spot_images.sql` を実行 (スポットの写真・スタンプ画像の列を追加)。
2. ラリーとスポットを登録。`sr_spots.code` が QR の秘密文字列。
   QR には `https://<サイトのURL>/c/<code>` を埋め込む。
3. 環境変数: `SUPABASE_URL`, `SUPABASE_ANON_KEY` (必須。service_role は使わない)、
   任意で `APP_DEEPLINK_SCHEME`, `APP_STORE_URL`, `PLAY_STORE_URL`。
4. ローカル起動: `npm start` / 公開: Render に `render.yaml` で接続。
