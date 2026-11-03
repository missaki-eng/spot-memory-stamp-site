-- スタンプラリー用スキーマ (新規)。再実行しても安全なように IF NOT EXISTS / OR REPLACE を使用。
-- 既存テーブルと衝突しないよう、すべて sr_ プレフィックス。

create extension if not exists pgcrypto;

create table if not exists public.sr_rallies (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  description text not null default '',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.sr_spots (
  id          uuid primary key default gen_random_uuid(),
  rally_id    uuid not null references public.sr_rallies(id) on delete cascade,
  name        text not null,
  description text not null default '',
  sort_order  int  not null default 0,
  photo_url        text,
  stamp_image_url  text,
  -- QR コードに埋め込む秘密の文字列。anon には公開しない (下の列権限を参照)
  code        text not null unique default encode(gen_random_bytes(9), 'hex'),
  created_at  timestamptz not null default now()
);
create index if not exists sr_spots_rally_idx on public.sr_spots(rally_id, sort_order);

create table if not exists public.sr_collections (
  id           uuid primary key default gen_random_uuid(),
  spot_id      uuid not null references public.sr_spots(id) on delete cascade,
  device_id    text not null check (length(device_id) between 8 and 64),
  collected_at timestamptz not null default now(),
  unique (spot_id, device_id)
);

alter table public.sr_rallies     enable row level security;
alter table public.sr_spots       enable row level security;
alter table public.sr_collections enable row level security;

-- 公開閲覧: ラリーとスポット (code 列を除く)
drop policy if exists sr_rallies_read on public.sr_rallies;
create policy sr_rallies_read on public.sr_rallies for select to anon using (is_active);

drop policy if exists sr_spots_read on public.sr_spots;
create policy sr_spots_read on public.sr_spots for select to anon
  using (exists (select 1 from public.sr_rallies r where r.id = rally_id and r.is_active));

revoke all on public.sr_rallies, public.sr_spots, public.sr_collections from anon, authenticated;
grant select (id, title, description, is_active, created_at) on public.sr_rallies to anon;
grant select (id, rally_id, name, description, sort_order, photo_url, stamp_image_url) on public.sr_spots to anon;
-- sr_collections は直接触らせない。RPC 経由のみ。

-- スタンプ獲得: QR の code と端末 ID を受け取る
create or replace function public.sr_collect_stamp(p_code text, p_device_id text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_spot  public.sr_spots%rowtype;
  v_rally public.sr_rallies%rowtype;
  v_rows  int;
begin
  select * into v_spot from public.sr_spots where code = p_code;
  if not found then
    return json_build_object('ok', false, 'error', 'invalid_code');
  end if;

  select * into v_rally from public.sr_rallies where id = v_spot.rally_id and is_active;
  if not found then
    return json_build_object('ok', false, 'error', 'rally_inactive');
  end if;

  insert into public.sr_collections(spot_id, device_id)
  values (v_spot.id, p_device_id)
  on conflict (spot_id, device_id) do nothing;
  get diagnostics v_rows = row_count;

  return json_build_object(
    'ok', true,
    'already', v_rows = 0,
    'rally_id', v_rally.id,
    'rally_title', v_rally.title,
    'spot_id', v_spot.id,
    'spot_name', v_spot.name
  );
end;
$$;

-- 自分のスタンプ帳: ラリー内で獲得済みのスポット ID 一覧
create or replace function public.sr_my_stamps(p_rally_id uuid, p_device_id text)
returns setof uuid
language sql
security definer
set search_path = public
stable
as $$
  select c.spot_id
  from public.sr_collections c
  join public.sr_spots s on s.id = c.spot_id
  where s.rally_id = p_rally_id and c.device_id = p_device_id;
$$;

revoke all on function public.sr_collect_stamp(text, text) from public;
revoke all on function public.sr_my_stamps(uuid, text)     from public;
grant execute on function public.sr_collect_stamp(text, text) to anon;
grant execute on function public.sr_my_stamps(uuid, text)     to anon;

-- ==== 思い出ガチャ (003_memories.sql と同じ内容) ====
-- 「スタンプ獲得済みの端末が、スポットごとに1つだけ」ランダムに引ける。

create table if not exists public.sr_memories (
  id         uuid primary key default gen_random_uuid(),
  spot_id    uuid not null references public.sr_spots(id) on delete cascade,
  body       text not null,
  author     text,
  created_at timestamptz not null default now()
);
create index if not exists sr_memories_spot_idx on public.sr_memories(spot_id);

create table if not exists public.sr_draws (
  spot_id   uuid not null references public.sr_spots(id) on delete cascade,
  device_id text not null check (length(device_id) between 8 and 64),
  memory_id uuid not null references public.sr_memories(id) on delete cascade,
  drawn_at  timestamptz not null default now(),
  primary key (spot_id, device_id)
);

alter table public.sr_memories enable row level security;
alter table public.sr_draws    enable row level security;
revoke all on public.sr_memories, public.sr_draws from anon, authenticated;

create or replace function public.sr_my_draw(p_spot_id uuid, p_device_id text)
returns json
language sql
security definer
set search_path = public
stable
as $$
  select json_build_object('id', m.id, 'body', m.body, 'author', m.author)
  from public.sr_draws d
  join public.sr_memories m on m.id = d.memory_id
  where d.spot_id = p_spot_id and d.device_id = p_device_id;
$$;

create or replace function public.sr_draw_memory(p_spot_id uuid, p_device_id text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mem      public.sr_memories%rowtype;
  v_existing json;
begin
  if not exists (
    select 1
    from public.sr_collections c
    join public.sr_spots s on s.id = c.spot_id
    join public.sr_rallies r on r.id = s.rally_id and r.is_active
    where c.spot_id = p_spot_id and c.device_id = p_device_id
  ) then
    return json_build_object('ok', false, 'error', 'not_collected');
  end if;

  -- 同じ端末の同時実行で2つ引かれないようにする
  perform pg_advisory_xact_lock(hashtext(p_spot_id::text || p_device_id));

  v_existing := public.sr_my_draw(p_spot_id, p_device_id);
  if v_existing is not null then
    return json_build_object('ok', true, 'already', true, 'memory', v_existing);
  end if;

  select * into v_mem from public.sr_memories where spot_id = p_spot_id order by random() limit 1;
  if not found then
    return json_build_object('ok', true, 'empty', true);
  end if;

  insert into public.sr_draws(spot_id, device_id, memory_id)
  values (p_spot_id, p_device_id, v_mem.id)
  on conflict do nothing;

  return json_build_object(
    'ok', true, 'already', false,
    'memory', json_build_object('id', v_mem.id, 'body', v_mem.body, 'author', v_mem.author)
  );
end;
$$;

revoke all on function public.sr_my_draw(uuid, text)     from public;
revoke all on function public.sr_draw_memory(uuid, text) from public;
grant execute on function public.sr_my_draw(uuid, text)     to anon;
grant execute on function public.sr_draw_memory(uuid, text) to anon;
