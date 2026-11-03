-- スポットの写真とスタンプ画像の列を追加 (再実行しても安全)
alter table public.sr_spots add column if not exists photo_url text;
alter table public.sr_spots add column if not exists stamp_image_url text;

grant select (photo_url, stamp_image_url) on public.sr_spots to anon;
