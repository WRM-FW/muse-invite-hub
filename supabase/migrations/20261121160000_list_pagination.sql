-- ============================================================================
-- Paginate the public list.
-- The old function capped every response at 500 rows, so the UI could only
-- show the first 500 records even when the stats counted more. Add an offset
-- and keep a 500-row page size; the client fetches successive pages.
-- ============================================================================

drop function if exists public.list_invite_codes(text, text, integer);

create or replace function public.list_invite_codes(
  p_status text default 'all',
  p_query  text default '',
  p_limit  integer default 500,
  p_offset integer default 0
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
  v_query  text;
  v_limit  integer;
  v_offset integer;
begin
  v_limit := least(greatest(coalesce(p_limit, 500), 1), 500);
  v_offset := greatest(coalesce(p_offset, 0), 0);
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
  limit v_limit
  offset v_offset;
end;
$$;

revoke all on function public.list_invite_codes(text, text, integer, integer) from public;
grant execute on function public.list_invite_codes(text, text, integer, integer) to anon, authenticated;