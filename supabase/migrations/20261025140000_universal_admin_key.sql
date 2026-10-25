-- ============================================================================
-- Universal management key.
-- The hash lives in a single-row, RLS-protected settings table. Only the
-- SECURITY DEFINER status function can read it; clients cannot select it.
-- Per-code publisher tokens remain valid as a fallback.
-- ============================================================================

create table if not exists public.app_settings (
  id               boolean primary key default true,
  admin_token_hash text        not null,
  updated_at       timestamptz not null default now(),
  constraint app_settings_single_row check (id)
);

alter table public.app_settings enable row level security;
revoke all on public.app_settings from anon, authenticated, public;

drop trigger if exists app_settings_set_updated_at on public.app_settings;
create trigger app_settings_set_updated_at
  before update on public.app_settings
  for each row execute function public.set_updated_at();

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
    select 1
    from public.app_settings s
    where s.admin_token_hash = v_token_hash
  ) into v_is_admin;

  select * into v_row
  from public.invite_codes ic
  where ic.id = p_id
  for update;

  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;

  if not v_is_admin and v_row.manage_token_hash <> v_token_hash then
    raise exception 'not_authorized' using errcode = 'P0001';
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

revoke all on function public.set_invite_code_status(uuid, text, text) from public;
grant execute on function public.set_invite_code_status(uuid, text, text) to anon, authenticated;
