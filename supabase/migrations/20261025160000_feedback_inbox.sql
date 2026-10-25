-- ============================================================================
-- Developer feedback inbox.
-- Users submit a reason + optional note for a code; this no longer changes the
-- code's status automatically. Only the universal admin key can list feedback.
-- ============================================================================

create table if not exists public.invite_code_feedback (
  id            bigint generated always as identity primary key,
  code_id       uuid references public.invite_codes (id) on delete set null,
  code          text        not null,
  reason        text        not null check (reason in ('invalid', 'used', 'wrong_info', 'other')),
  note          text        not null default '' check (char_length(note) <= 300),
  reporter_hash text        not null,
  created_at    timestamptz not null default now(),
  resolved      boolean     not null default false,
  constraint invite_code_feedback_once unique (code_id, reporter_hash, reason)
);

create index if not exists invite_code_feedback_created_idx
  on public.invite_code_feedback (created_at desc);

create index if not exists invite_code_feedback_code_idx
  on public.invite_code_feedback (code_id);

create index if not exists invite_code_feedback_reporter_idx
  on public.invite_code_feedback (reporter_hash, created_at desc);

alter table public.invite_code_feedback enable row level security;
revoke all on public.invite_code_feedback from anon, authenticated, public;

create or replace function public.submit_invite_feedback(
  p_code_id        uuid,
  p_reason         text,
  p_note           text,
  p_reporter_token text
)
returns table (
  id         bigint,
  code       text,
  reason     text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_row    public.invite_codes%rowtype;
  v_hash   text;
  v_reason text;
  v_note   text;
  v_recent integer;
  v_id     bigint;
  v_created timestamptz;
begin
  if p_reporter_token is null
     or char_length(p_reporter_token) < 16
     or char_length(p_reporter_token) > 128 then
    raise exception 'invalid_token' using errcode = 'P0001';
  end if;

  v_hash := encode(digest(p_reporter_token, 'sha256'), 'hex');

  v_reason := lower(btrim(coalesce(p_reason, '')));
  if v_reason not in ('invalid', 'used', 'wrong_info', 'other') then
    raise exception 'invalid_reason' using errcode = 'P0001';
  end if;

  v_note := regexp_replace(coalesce(p_note, ''), '[[:cntrl:]]', ' ', 'g');
  v_note := btrim(regexp_replace(v_note, '[[:space:]]+', ' ', 'g'));
  if char_length(v_note) > 300 then
    raise exception 'note_too_long' using errcode = 'P0001';
  end if;

  select * into v_row
  from public.invite_codes ic
  where ic.id = p_code_id;

  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;

  select count(*) into v_recent
  from public.invite_code_feedback f
  where f.reporter_hash = v_hash
    and f.created_at > now() - interval '1 day';
  if v_recent >= 10 then
    raise exception 'feedback_rate_limited' using errcode = 'P0001';
  end if;

  insert into public.invite_code_feedback (code_id, code, reason, note, reporter_hash)
  values (p_code_id, v_row.code, v_reason, v_note, v_hash)
  returning public.invite_code_feedback.id, public.invite_code_feedback.created_at
  into v_id, v_created;

  return query select v_id, v_row.code, v_reason, v_created;
exception
  when unique_violation then
    raise exception 'feedback_duplicate' using errcode = 'P0001';
end;
$$;

create or replace function public.list_invite_feedback(
  p_admin_token text,
  p_limit       integer default 100
)
returns table (
  id         bigint,
  code       text,
  reason     text,
  note       text,
  created_at timestamptz,
  resolved   boolean
)
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_limit integer;
begin
  if p_admin_token is null
     or not exists (
       select 1 from public.app_settings s
       where s.admin_token_hash = encode(digest(p_admin_token, 'sha256'), 'hex')
     ) then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;

  v_limit := least(greatest(coalesce(p_limit, 100), 1), 500);

  return query
    select f.id, f.code, f.reason, f.note, f.created_at, f.resolved
    from public.invite_code_feedback f
    order by f.created_at desc
    limit v_limit;
end;
$$;

revoke all on function public.submit_invite_feedback(uuid, text, text, text) from public;
revoke all on function public.list_invite_feedback(text, integer) from public;
grant execute on function public.submit_invite_feedback(uuid, text, text, text) to anon, authenticated;
grant execute on function public.list_invite_feedback(text, integer) to anon, authenticated;
