-- ============================================================================
-- Queue rank + management-key edit of uses and rank.
-- - queue_rank is a global 1..N order (ties broken by created_at/id).
-- - New codes append to the end; admins can renumber a code atomically.
-- - A code with 0 uses becomes expired; an expired code set to >0 uses becomes
--   available again and clears fail_reports.
-- ============================================================================

alter table public.invite_codes
  add column if not exists queue_rank integer;

with ranked as (
  select id, row_number() over (order by created_at asc, id asc) as rn
  from public.invite_codes
)
update public.invite_codes c
set queue_rank = r.rn
from ranked r
where c.id = r.id;

alter table public.invite_codes
  alter column queue_rank set default 1000000;
alter table public.invite_codes
  alter column queue_rank set not null;

create index if not exists invite_codes_queue_rank_idx
  on public.invite_codes (queue_rank asc, created_at asc, id asc);

grant select (queue_rank) on public.invite_codes to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Listing now returns and orders by queue_rank.
-- ---------------------------------------------------------------------------
drop function if exists public.list_invite_codes(text, text, integer);

create or replace function public.list_invite_codes(
  p_status text default 'all',
  p_query  text default '',
  p_limit  integer default 200
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
  v_query := regexp_replace(v_query, '([%_\\])', '\\\1', 'g');

  return query
  select ic.id,
         ic.code,
         ic.status::text,
         ic.total_spots,
         ic.remaining_spots,
         ic.claimed_count,
         ic.fail_reports,
         ic.queue_rank,
         ic.created_at
  from public.invite_codes ic
  where (coalesce(p_status, 'all') = 'all' or ic.status::text = p_status)
    and (v_query = '' or ic.code ilike '%' || v_query || '%' escape '\')
  order by ic.queue_rank asc, ic.created_at asc, ic.id asc
  limit v_limit;
end;
$$;

-- ---------------------------------------------------------------------------
-- Publishing appends to the queue under the shared advisory lock.
-- ---------------------------------------------------------------------------
drop function if exists public.publish_invite_code(text, integer, text);

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
  created_at      timestamptz,
  manage_token    text
)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_code        text;
  v_spots       integer;
  v_client_hash text;
  v_manage      text;
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

  -- Serialize queue-rank allocation with admin reordering.
  perform pg_advisory_xact_lock(hashtext('invite_codes_queue_rank'));
  select coalesce(max(ic.queue_rank), 0) + 1 into v_rank
  from public.invite_codes ic;

  v_manage := encode(gen_random_bytes(24), 'hex');

  insert into public.invite_codes as ic
    (code, status, total_spots, remaining_spots, claimed_count, queue_rank,
     manage_token_hash, creator_token_hash)
  values
    (v_code, 'available', 30, v_spots, 30 - v_spots, v_rank,
     encode(digest(v_manage, 'sha256'), 'hex'), v_client_hash)
  returning ic.id, ic.created_at into v_id, v_created;

  return query
    select v_id, v_code, 'available'::text, 30, v_spots, 30 - v_spots,
           0, v_rank, v_created, v_manage;
exception
  when unique_violation then
    raise exception 'duplicate_code' using errcode = 'P0001';
end;
$$;

-- ---------------------------------------------------------------------------
-- Management-key edit: remaining uses and global queue position.
-- ---------------------------------------------------------------------------
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

  -- Take the queue lock before any row lock to avoid deadlocks with publish.
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

  if not v_is_admin and v_row.manage_token_hash <> v_token_hash then
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

  -- Renumber every code 1..N, placing the target at the requested position.
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

-- ---------------------------------------------------------------------------
-- Grants.
-- ---------------------------------------------------------------------------
revoke all on function public.list_invite_codes(text, text, integer) from public;
revoke all on function public.publish_invite_code(text, integer, text) from public;
revoke all on function public.update_invite_code_admin(uuid, text, integer, integer) from public;

grant execute on function public.list_invite_codes(text, text, integer) to anon, authenticated;
grant execute on function public.publish_invite_code(text, integer, text) to anon, authenticated;
grant execute on function public.update_invite_code_admin(uuid, text, integer, integer) to anon, authenticated;
