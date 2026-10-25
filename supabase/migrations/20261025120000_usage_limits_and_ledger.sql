-- ============================================================================
-- Per-visitor usage limits + durable claim ledger.
-- - One published code per visitor token (deleted codes free the slot).
-- - At most two successful claims per visitor token.
-- - Claim reports survive code deletion (code_id becomes NULL) so the
--   two-claim limit cannot be reset by deleting a code.
-- ============================================================================

alter table public.invite_code_reports alter column code_id drop not null;

alter table public.invite_code_reports
  drop constraint if exists invite_code_reports_code_id_fkey;

alter table public.invite_code_reports
  add constraint invite_code_reports_code_id_fkey
  foreign key (code_id) references public.invite_codes (id) on delete set null;

create index if not exists invite_code_reports_reporter_action_idx
  on public.invite_code_reports (reporter_hash, action);

-- ---------------------------------------------------------------------------
-- Publish: one code per visitor token.
-- ---------------------------------------------------------------------------
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

  v_manage := encode(gen_random_bytes(24), 'hex');

  insert into public.invite_codes as ic
    (code, status, total_spots, remaining_spots, claimed_count,
     manage_token_hash, creator_token_hash)
  values
    (v_code, 'available', 30, v_spots, 30 - v_spots,
     encode(digest(v_manage, 'sha256'), 'hex'), v_client_hash)
  returning ic.id, ic.created_at into v_id, v_created;

  return query
    select v_id, v_code, 'available'::text, 30, v_spots, 30 - v_spots,
           0, v_created, v_manage;
exception
  when unique_violation then
    raise exception 'duplicate_code' using errcode = 'P0001';
end;
$$;

-- ---------------------------------------------------------------------------
-- Claim: at most two successful claims per visitor token.
-- ---------------------------------------------------------------------------
create or replace function public.claim_invite_code_use(
  p_id             uuid,
  p_reporter_token text
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
  v_hash       text;
  v_used_count integer;
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

  if v_row.status <> 'available' or v_row.remaining_spots <= 0 then
    raise exception 'not_available' using errcode = 'P0001';
  end if;

  if (select count(*)
      from public.invite_code_reports r
      where r.reporter_hash = v_hash
        and r.created_at > now() - interval '1 hour') >= 60 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  -- Durable across code deletion: reports keep their reporter hash and action
  -- even when code_id is set to NULL by ON DELETE SET NULL.
  select count(*) into v_used_count
  from public.invite_code_reports r
  where r.reporter_hash = v_hash
    and r.action = 'used';
  if v_used_count >= 2 then
    raise exception 'claim_limit_reached' using errcode = 'P0001';
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
    select v_row.id, v_row.code, v_row.status::text,
           v_row.total_spots, v_row.remaining_spots, v_row.claimed_count,
           v_row.fail_reports, v_row.created_at;
end;
$$;

revoke all on function public.publish_invite_code(text, integer, text) from public;
revoke all on function public.claim_invite_code_use(uuid, text) from public;
grant execute on function public.publish_invite_code(text, integer, text) to anon, authenticated;
grant execute on function public.claim_invite_code_use(uuid, text) to anon, authenticated;
