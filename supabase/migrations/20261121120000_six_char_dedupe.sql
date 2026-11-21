-- ============================================================================
-- Six-character codes + duplicate prevention.
-- - Existing legacy non-6-character rows are left untouched.
-- - New inserts must be exactly 6 uppercase letters/digits.
-- - Canonical duplicate prevention strips non-alphanumerics and uppercases.
-- - A one-time cleanup removes existing canonical duplicates (currently none).
-- ============================================================================

with ranked as (
  select id,
         row_number() over (
           partition by regexp_replace(upper(btrim(code)), '[^A-Z0-9]', '', 'g')
           order by created_at asc, id asc
         ) as rn
  from public.invite_codes
)
delete from public.invite_codes
where id in (select id from ranked where rn > 1);

create unique index if not exists invite_codes_code_canonical_unique_idx
  on public.invite_codes (
    regexp_replace(upper(btrim(code)), '[^A-Z0-9]', '', 'g')
  );

create or replace function public.enforce_six_char_code()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.code is null or new.code !~ '^[A-Z0-9]{6}$' then
    raise exception 'invalid_code' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists invite_codes_six_char on public.invite_codes;
create trigger invite_codes_six_char
  before insert on public.invite_codes
  for each row execute function public.enforce_six_char_code();

revoke all on function public.enforce_six_char_code() from public, anon, authenticated;

-- Publish now accepts exactly six uppercase letters/digits and checks the
-- canonical form for duplicates. The return type no longer includes a
-- per-code management token (only the universal admin key is supported).
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

  v_code := upper(regexp_replace(coalesce(p_code, ''), '[[:space:]]+', '', 'g'));

  if v_code !~ '^[A-Z0-9]{6}$' then
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

  if exists (
    select 1
    from public.invite_codes ic
    where regexp_replace(upper(btrim(ic.code)), '[^A-Z0-9]', '', 'g') = v_code
  ) then
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

revoke all on function public.publish_invite_code(text, integer, text) from public;
grant execute on function public.publish_invite_code(text, integer, text) to anon, authenticated;