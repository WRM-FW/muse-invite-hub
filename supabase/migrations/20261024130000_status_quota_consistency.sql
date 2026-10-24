-- Keep claimed_count consistent with the quota when a publisher forces a status.
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
        claimed_count = ic.total_spots - greatest(ic.remaining_spots, 1),
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
        remaining_spots = 0,
        claimed_count = ic.total_spots
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

revoke all on function public.set_invite_code_status(uuid, text, text) from public;
grant execute on function public.set_invite_code_status(uuid, text, text) to anon, authenticated;
