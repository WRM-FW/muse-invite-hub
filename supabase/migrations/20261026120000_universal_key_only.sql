-- ============================================================================
-- Universal-only management keys.
-- - Drop the per-code manage token column and the token returned by publish.
-- - Status and uses/rank management now require the universal admin key only.
-- ============================================================================

-- The old publish function returns and writes a per-code token.
drop function if exists public.publish_invite_code(text, integer, text);

-- Status: universal key only.
create or replace function public.set_invite_code_status(
  p_id           uuid,
  p_manage_token text,
  p_next_status  text
)
returns table (
  id              uuid,
  code            text,
  status          text,
  total_spots     integer,
  remaining_spots integer,
  claimed_count   integer,
  fail_reports    integer,
  created_at      timestamptz
)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_row        public.invite_codes%rowtype;
  v_token_hash text;
  v_is_admin   boolean;
begin
  if p_manage_token is null or char_length(p_manage_token) < 32 then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;

  if p_next_status not in ('available', 'used', 'expired') then
    raise exception 'invalid_status' using errcode = 'P0001';
  end if;

  v_token_hash := encode(digest(p_manage_token, 'sha256'), 'hex');

  select exists (
    select 1 from public.app_settings s
    where s.admin_token_hash = v_token_hash
  ) into v_is_admin;

  if not v_is_admin then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;

  select * into v_row
  from public.invite_codes ic
  where ic.id = p_id
  for update;

  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;

  if p_next_status = 'available' then
    update public.invite_codes ic
    set status = 'available',
        remaining_spots = greatest(ic.remaining_spots, 1),
        claimed_count = ic.total_spots - greatest(ic.remaining_spots, 1),
        fail_reports = 0
    where ic.id = p_id
    returning * into v_row;
  elsif p_next_status = 'used' then
    update public.invite_codes ic
    set status = 'used'
    where ic.id = p_id
    returning * into v_row;
  else
    update public.invite_codes ic
    set status = 'expired',
        remaining_spots = 0,
        claimed_count = ic.total_spots
    where ic.id = p_id
    returning * into v_row;
  end if;

  return query
    select v_row.id, v_row.code, v_row.status::text,
           v_row.total_spots, v_row.remaining_spots, v_row.claimed_count,
           v_row.fail_reports, v_row.created_at;
end;
$$;

-- Uses + queue rank: universal key only.
create or replace function public.update_invite_code_admin(
  p_id           uuid,
  p_manage_token text,
  p_remaining    integer,
  p_position     integer
)
returns table (
  id              uuid,
  code            text,
  status          text,
  total_spots     integer,
  remaining_spots integer,
  claimed_count   integer,
  fail_reports    integer,
  queue_rank      integer,
  created_at      timestamptz
)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_row        public.invite_codes%rowtype;
  v_token_hash text;
  v_is_admin   boolean;
  v_total      integer;
  v_position   integer;
begin
  if p_manage_token is null or char_length(p_manage_token) < 32 then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;

  if p_remaining is null or p_remaining < 0 or p_remaining > 30 then
    raise exception 'invalid_remaining' using errcode = 'P0001';
  end if;

  if p_position is null or p_position < 1 then
    raise exception 'invalid_position' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtext('invite_codes_queue_rank'));

  select * into v_row
  from public.invite_codes ic
  where ic.id = p_id
  for update;

  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;

  v_token_hash := encode(digest(p_manage_token, 'sha256'), 'hex');

  select exists (
    select 1 from public.app_settings s
    where s.admin_token_hash = v_token_hash
  ) into v_is_admin;

  if not v_is_admin then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;

  select count(*) into v_total from public.invite_codes;
  v_position := least(greatest(p_position, 1), v_total);

  update public.invite_codes ic
  set remaining_spots = p_remaining,
      claimed_count = ic.total_spots - p_remaining,
      status = case
        when p_remaining <= 0 then 'expired'::public.invite_status
        when ic.status = 'expired' then 'available'::public.invite_status
        else ic.status
      end,
      fail_reports = case
        when p_remaining > 0 and ic.status = 'expired' then 0
        else ic.fail_reports
      end
  where ic.id = p_id
  returning * into v_row;

  with ordered as (
    select ic.id,
           row_number() over (
             order by ic.queue_rank asc, ic.created_at asc, ic.id asc
           ) as rn
    from public.invite_codes ic
    where ic.id <> p_id
  ), new_order as (
    select o.id,
           case when o.rn >= v_position then o.rn + 1 else o.rn end as new_rank
    from ordered o
    union all
    select p_id, v_position
  )
  update public.invite_codes c
  set queue_rank = n.new_rank
  from new_order n
  where c.id = n.id;

  select * into v_row
  from public.invite_codes ic
  where ic.id = p_id;

  return query
    select v_row.id, v_row.code, v_row.status::text,
           v_row.total_spots, v_row.remaining_spots, v_row.claimed_count,
           v_row.fail_reports, v_row.queue_rank, v_row.created_at;
end;
$$;

-- No per-code token column any more.
alter table public.invite_codes
  drop column if exists manage_token_hash;

-- Publish no longer generates or returns a per-code token.
create or replace function public.publish_invite_code(
  p_code         text,
  p_remaining    integer,
  p_client_token text
)
returns table (
  id              uuid,
  code            text,
  status          text,
  total_spots     integer,
  remaining_spots integer,
  claimed_count   integer,
  fail_reports    integer,
  queue_rank      integer,
  created_at      timestamptz
)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_code        text;
  v_spots       integer;
  v_client_hash text;
  v_id          uuid;
  v_created     timestamptz;
  v_owned       integer;
  v_global      integer;
  v_rank        integer;
begin
  if p_client_token is null
     or char_length(p_client_token) < 16
     or char_length(p_client_token) > 128 then
    raise exception 'invalid_token' using errcode = 'P0001';
  end if;

  v_code := regexp_replace(coalesce(p_code, ''), '[[:cntrl:]]', '', 'g');
  v_code := upper(regexp_replace(v_code, '[[:space:]]+', '-', 'g'));
  v_code := btrim(v_code, '-');

  if v_code !~ '^[A-Z0-9][A-Z0-9_-]{2,62}[A-Z0-9]$' then
    raise exception 'invalid_code' using errcode = 'P0001';
  end if;

  v_spots := coalesce(p_remaining, 30);
  if v_spots < 1 or v_spots > 30 then
    raise exception 'invalid_spots' using errcode = 'P0001';
  end if;

  v_client_hash := encode(digest(p_client_token, 'sha256'), 'hex');

  select count(*) into v_owned
  from public.invite_codes ic
  where ic.creator_token_hash = v_client_hash;
  if v_owned >= 1 then
    raise exception 'publish_limit_reached' using errcode = 'P0001';
  end if;

  select count(*) into v_global
  from public.invite_codes ic
  where ic.created_at > now() - interval '10 minutes';
  if v_global >= 30 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.invite_codes ic where upper(ic.code) = v_code) then
    raise exception 'duplicate_code' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtext('invite_codes_queue_rank'));
  select coalesce(max(ic.queue_rank), 0) + 1 into v_rank
  from public.invite_codes ic;

  insert into public.invite_codes as ic
    (code, status, total_spots, remaining_spots, claimed_count, queue_rank,
     creator_token_hash)
  values
    (v_code, 'available', 30, v_spots, 30 - v_spots, v_rank, v_client_hash)
  returning ic.id, ic.created_at into v_id, v_created;

  return query
    select v_id, v_code, 'available'::text, 30, v_spots, 30 - v_spots,
           0, v_rank, v_created;
exception
  when unique_violation then
    raise exception 'duplicate_code' using errcode = 'P0001';
end;
$$;

-- Grants.
revoke all on function public.publish_invite_code(text, integer, text) from public;
revoke all on function public.set_invite_code_status(uuid, text, text) from public;
revoke all on function public.update_invite_code_admin(uuid, text, integer, integer) from public;

grant execute on function public.publish_invite_code(text, integer, text) to anon, authenticated;
grant execute on function public.set_invite_code_status(uuid, text, text) to anon, authenticated;
grant execute on function public.update_invite_code_admin(uuid, text, integer, integer) to anon, authenticated;