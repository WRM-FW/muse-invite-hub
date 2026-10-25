-- ============================================================================
-- Security Advisor cleanup.
-- - Drop the leftover _qoder_probe test table.
-- - Drop the unused legacy auto-expire function.
-- - Drop the admin feedback listing RPC (read feedback in the Dashboard).
-- - Revoke PUBLIC execute from trigger/read helper functions.
-- - Re-assert the intended anonymous RPC grants only.
-- ============================================================================

drop table if exists public._qoder_probe;
drop function if exists public.report_invite_code_invalid(uuid, text);
drop function if exists public.list_invite_feedback(text, integer);

-- Trigger function: no client needs direct EXECUTE; triggers still fire.
revoke all on function public.set_updated_at() from public, anon, authenticated;

-- Read-only listing/stat RPCs (SECURITY INVOKER): anonymous clients need these.
revoke all on function public.list_invite_codes(text, text, integer) from public;
revoke all on function public.invite_stats() from public;
grant execute on function public.list_invite_codes(text, text, integer) to anon, authenticated;
grant execute on function public.invite_stats() to anon, authenticated;

-- Intended anonymous write RPCs (SECURITY DEFINER, validated internally).
revoke all on function public.publish_invite_code(text, integer, text) from public;
revoke all on function public.claim_invite_code_use(uuid, text) from public;
revoke all on function public.set_invite_code_status(uuid, text, text) from public;
revoke all on function public.submit_invite_feedback(uuid, text, text, text) from public;

grant execute on function public.publish_invite_code(text, integer, text) to anon, authenticated;
grant execute on function public.claim_invite_code_use(uuid, text) to anon, authenticated;
grant execute on function public.set_invite_code_status(uuid, text, text) to anon, authenticated;
grant execute on function public.submit_invite_feedback(uuid, text, text, text) to anon, authenticated;
