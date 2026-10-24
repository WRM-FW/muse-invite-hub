-- ============================================================================
-- Muse Invite Code Hub — validated RPC surface
-- All writes go through these functions. Direct table INSERT/UPDATE/DELETE is
-- revoked from anon/authenticated and is not covered by any RLS policy.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Effective status: an "available" row whose expires_at has passed is expired.
-- ---------------------------------------------------------------------------
create or replace function public.invite_effective_status(
  p_status public.invite_status,
  p_expires_at timestamptz
)
returns text
language sql
stable
as $$
  select case
    when p_status = 'available' and p_expires_at is not null and p_expires_at <= now()
      then 'expired'
    else p_status::text
  end;
$$;

-- ---------------------------------------------------------------------------
-- Public listing with server-side filtering and search.
-- ---------------------------------------------------------------------------
create or replace function public.list_invite_codes(
  p_status text default 'all',
  p_query  text default '',
  p_limit  integer default 200
)
returns table (
  id              uuid,
  code            text,
  description     text,
  status          text,
  total_spots     integer,
  remaining_spots integer,
  claimed_count   integer,
  fail_reports    integer,
  created_at      timestamptz,
  expires_at      timestamptz
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_query text;
  v_limit integer;
begin
  v_limit := least(greatest(coalesce(p_limit, 200), 1), 500);
  v_query := left(btrim(coalesce(p_query, '')), 64);
  -- Escape ILIKE wildcards so user input is treated literally.
  v_query := regexp_replace(v_query, '([%_\\])', '\\\1', 'g');

  return query
  select ic.id,
         ic.code,
         ic.description,
         public.invite_effective_status(ic.status, ic.expires_at) as status,
         ic.total_spots,
         ic.remaining_spots,
         ic.claimed_count,
         ic.fail_reports,
         ic.created_at,
         ic.expires_at
  from public.invite_codes ic
  where (coalesce(p_status, 'all') = 'all'
         or public.invite_effective_status(ic.status, ic.expires_at) = p_status)
    and (v_query = ''
         or ic.code ilike '%' || v_query || '%' escape '\'
         or ic.description ilike '%' || v_query || '%' escape '\')
  order by ic.created_at asc
  limit v_limit;
end;
$$;

-- ---------------------------------------------------------------------------
-- Counts for the filter tabs (computed over the whole table, not just a page).
-- ---------------------------------------------------------------------------
create or replace function public.invite_stats()
returns table (
  available bigint,
  used      bigint,
  expired   bigint,
  total     bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    count(*) filter (where eff = 'available'),
    count(*) filter (where eff = 'used'),
    count(*) filter (where eff = 'expired'),
    count(*)
  from (
    select public.invite_effective_status(status, expires_at) as eff
    from public.invite_codes
  ) s;
$$;

-- ---------------------------------------------------------------------------
-- Publish a code. Validates on the server, enforces basic rate limits and
-- returns a one-time management token (only its hash is stored).
-- ---------------------------------------------------------------------------
create or replace function public.publish_invite_code(
  p_code         text,
  p_description  text,
  p_remaining    integer,
  p_expires_at   timestamptz,
  p_client_token text
)
returns table (
  id              uuid,
  code            text,
  description     text,
  status          text,
  total_spots     integer,
  remaining_spots integer,
  claimed_count   integer,
  fail_reports    integer,
  created_at      timestamptz,
  expires_at      timestamptz,
  manage_token    text
)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_code        text;
  v_desc        text;
  v_spots       integer;
  v_client_hash text;
  v_manage      text;
  v_id          uuid;
  v_created     timestamptz;
  v_recent      integer;
  v_global      integer;
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

  v_desc := regexp_replace(coalesce(p_description, ''), '[[:cntrl:]]', ' ', 'g');
  v_desc := btrim(regexp_replace(v_desc, '[[:space:]]+', ' ', 'g'));
  if char_length(v_desc) > 280 then
    raise exception 'description_too_long' using errcode = 'P0001';
  end if;

  v_spots := coalesce(p_remaining, 30);
  if v_spots < 1 or v_spots > 30 then
    raise exception 'invalid_spots' using errcode = 'P0001';
  end if;

  if p_expires_at is not null
     and (p_expires_at <= now() + interval '1 minute'
          or p_expires_at > now() + interval '90 days') then
    raise exception 'invalid_expiry' using errcode = 'P0001';
  end if;

  v_client_hash := encode(digest(p_client_token, 'sha256'), 'hex');

  select count(*) into v_recent
  from public.invite_codes ic
  where ic.creator_token_hash = v_client_hash
    and ic.created_at > now() - interval '24 hours';
  if v_recent >= 3 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  -- Global burst guard, independent of the per-visitor limit.
  select count(*) into v_global
  from public.invite_codes ic
  where ic.created_at > now() - interval '10 minutes';
  if v_global >= 30 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.invite_codes ic where upper(ic.code) = v_code) then
    raise exception 'duplicate_code' using errcode = 'P0001';
  end if;

  v_manage := encode(gen_random_bytes(24), 'hex');

  insert into public.invite_codes as ic
    (code, description, status, total_spots, remaining_spots, claimed_count,
     expires_at, manage_token_hash, creator_token_hash)
  values
    (v_code, v_desc, 'available', 30, v_spots, 30 - v_spots,
     p_expires_at, encode(digest(v_manage, 'sha256'), 'hex'), v_client_hash)
  returning ic.id, ic.created_at into v_id, v_created;

  return query
    select v_id, v_code, v_desc, 'available'::text, 30, v_spots, 30 - v_spots,
           0, v_created, p_expires_at, v_manage;
exception
  when unique_violation then
    raise exception 'duplicate_code' using errcode = 'P0001';
end;
$$;

-- ---------------------------------------------------------------------------
-- Community signal: "I used this code" — decrements the quota by one and
-- expires the code when the last use is consumed. One signal per visitor token
-- per code; re-clicking returns a clear error instead of draining the quota.
-- ---------------------------------------------------------------------------
create or replace function public.claim_invite_code_use(
  p_id             uuid,
  p_reporter_token text
)
returns table (
  id              uuid,
  code            text,
  description     text,
  status          text,
  total_spots     integer,
  remaining_spots integer,
  claimed_count   integer,
  fail_reports    integer,
  created_at      timestamptz,
  expires_at      timestamptz
)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_row  public.invite_codes%rowtype;
  v_hash text;
  v_eff  text;
begin
  if p_reporter_token is null
     or char_length(p_reporter_token) < 16
     or char_length(p_reporter_token) > 128 then
    raise exception 'invalid_token' using errcode = 'P0001';
  end if;

  v_hash := encode(digest(p_reporter_token, 'sha256'), 'hex');

  select * into v_row
  from public.invite_codes ic
  where ic.id = p_id
  for update;

  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;

  v_eff := public.invite_effective_status(v_row.status, v_row.expires_at);
  if v_eff <> 'available' or v_row.remaining_spots <= 0 then
    raise exception 'not_available' using errcode = 'P0001';
  end if;

  if (select count(*)
      from public.invite_code_reports r
      where r.reporter_hash = v_hash
        and r.created_at > now() - interval '1 hour') >= 60 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  insert into public.invite_code_reports (code_id, reporter_hash, action)
  values (p_id, v_hash, 'used')
  on conflict on constraint invite_code_reports_once do nothing;

  if not found then
    raise exception 'already_claimed' using errcode = 'P0001';
  end if;

  update public.invite_codes ic
  set remaining_spots = ic.remaining_spots - 1,
      claimed_count = ic.claimed_count + 1,
      status = case
        when ic.remaining_spots - 1 <= 0 then 'expired'::public.invite_status
        else ic.status
      end
  where ic.id = p_id
  returning * into v_row;

  return query
    select v_row.id, v_row.code, v_row.description,
           public.invite_effective_status(v_row.status, v_row.expires_at),
           v_row.total_spots, v_row.remaining_spots, v_row.claimed_count,
           v_row.fail_reports, v_row.created_at, v_row.expires_at;
end;
$$;

-- ---------------------------------------------------------------------------
-- Community signal: "this code did not work".
-- Three distinct visitor tokens auto-expire the code; the publisher can restore.
-- ---------------------------------------------------------------------------
create or replace function public.report_invite_code_invalid(
  p_id             uuid,
  p_reporter_token text
)
returns table (
  id              uuid,
  code            text,
  description     text,
  status          text,
  total_spots     integer,
  remaining_spots integer,
  claimed_count   integer,
  fail_reports    integer,
  created_at      timestamptz,
  expires_at      timestamptz
)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_row  public.invite_codes%rowtype;
  v_hash text;
  v_eff  text;
begin
  if p_reporter_token is null
     or char_length(p_reporter_token) < 16
     or char_length(p_reporter_token) > 128 then
    raise exception 'invalid_token' using errcode = 'P0001';
  end if;

  v_hash := encode(digest(p_reporter_token, 'sha256'), 'hex');

  select * into v_row
  from public.invite_codes ic
  where ic.id = p_id
  for update;

  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;

  v_eff := public.invite_effective_status(v_row.status, v_row.expires_at);
  if v_eff <> 'available' then
    raise exception 'not_reportable' using errcode = 'P0001';
  end if;

  if (select count(*)
      from public.invite_code_reports r
      where r.reporter_hash = v_hash
        and r.created_at > now() - interval '1 hour') >= 60 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  insert into public.invite_code_reports (code_id, reporter_hash, action)
  values (p_id, v_hash, 'invalid')
  on conflict on constraint invite_code_reports_once do nothing;

  if not found then
    raise exception 'already_reported' using errcode = 'P0001';
  end if;

  update public.invite_codes ic
  set fail_reports = ic.fail_reports + 1,
      status = case
        when ic.fail_reports + 1 >= 3 then 'expired'::public.invite_status
        else ic.status
      end
  where ic.id = p_id
  returning * into v_row;

  return query
    select v_row.id, v_row.code, v_row.description,
           public.invite_effective_status(v_row.status, v_row.expires_at),
           v_row.total_spots, v_row.remaining_spots, v_row.claimed_count,
           v_row.fail_reports, v_row.created_at, v_row.expires_at;
end;
$$;

-- ---------------------------------------------------------------------------
-- Publisher-only status control, authenticated by the one-time token returned
-- from publish_invite_code(). The status modal uses this path; other visitors
-- receive not_authorized. No delete action is exposed in the current product.
-- ---------------------------------------------------------------------------
create or replace function public.set_invite_code_status(
  p_id           uuid,
  p_manage_token text,
  p_next_status  text
)
returns table (
  id              uuid,
  code            text,
  description     text,
  status          text,
  total_spots     integer,
  remaining_spots integer,
  claimed_count   integer,
  fail_reports    integer,
  created_at      timestamptz,
  expires_at      timestamptz
)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_row public.invite_codes%rowtype;
begin
  if p_manage_token is null or char_length(p_manage_token) < 32 then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;

  if p_next_status not in ('available', 'used', 'expired') then
    raise exception 'invalid_status' using errcode = 'P0001';
  end if;

  select * into v_row
  from public.invite_codes ic
  where ic.id = p_id
  for update;

  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;

  if v_row.manage_token_hash <> encode(digest(p_manage_token, 'sha256'), 'hex') then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;

  if p_next_status = 'available' then
    update public.invite_codes ic
    set status = 'available',
        remaining_spots = greatest(ic.remaining_spots, 1),
        fail_reports = 0,
        -- A date-expired code cannot become available until the date is cleared.
        expires_at = case
          when ic.expires_at is not null and ic.expires_at <= now() then null
          else ic.expires_at
        end
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
        remaining_spots = 0
    where ic.id = p_id
    returning * into v_row;
  end if;

  return query
    select v_row.id, v_row.code, v_row.description,
           public.invite_effective_status(v_row.status, v_row.expires_at),
           v_row.total_spots, v_row.remaining_spots, v_row.claimed_count,
           v_row.fail_reports, v_row.created_at, v_row.expires_at;
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges: only the intended entry points are callable by clients.
-- ---------------------------------------------------------------------------
revoke all on function public.list_invite_codes(text, text, integer) from public;
revoke all on function public.invite_stats() from public;
revoke all on function public.publish_invite_code(text, text, integer, timestamptz, text) from public;
revoke all on function public.claim_invite_code_use(uuid, text) from public;
revoke all on function public.report_invite_code_invalid(uuid, text) from public;
revoke all on function public.set_invite_code_status(uuid, text, text) from public;

grant execute on function public.list_invite_codes(text, text, integer) to anon, authenticated;
grant execute on function public.invite_stats() to anon, authenticated;
grant execute on function public.publish_invite_code(text, text, integer, timestamptz, text) to anon, authenticated;
grant execute on function public.claim_invite_code_use(uuid, text) to anon, authenticated;
grant execute on function public.report_invite_code_invalid(uuid, text) to anon, authenticated;
grant execute on function public.set_invite_code_status(uuid, text, text) to anon, authenticated;
