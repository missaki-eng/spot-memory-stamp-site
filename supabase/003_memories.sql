-- 思い出ガチャ。再実行しても安全。
-- 思い出の本文は sr_memories に入れる。anon からは直接読めず、関数 sr_draw_memory 経由で
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
