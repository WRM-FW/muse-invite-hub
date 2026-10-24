-- ============================================================================
-- Muse Invite Code Hub — schema, indexes, RLS and column-level privileges
-- Model matches the existing front-end: FIFO queue + 30-use quota per code.
-- Apply with: supabase db push   (or paste into the Supabase SQL editor)
-- ============================================================================

create extension if not exists pg_trgm with schema extensions;

do $$
begin
  create type public.invite_status as enum ('available', 'used', 'expired');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.invite_codes (
  id                 uuid primary key default gen_random_uuid(),
  code               text        not null,
  description        text        not null default '',
  status             public.invite_status not null default 'available',
  total_spots        integer     not null default 30,
  remaining_spots    integer     not null default 30,
  claimed_count      integer     not null default 0,
  fail_reports       integer     not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  expires_at         timestamptz,
  -- Only SHA-256 hashes are stored. The plaintext management token is returned
  -- once to the publisher and kept in their browser.
  manage_token_hash  text        not null,
  -- Pseudonymous visitor token hash, used only for publish rate limiting.
  creator_token_hash text        not null,
  constraint invite_codes_code_format
    check (code ~ '^[A-Z0-9][A-Z0-9_-]{2,62}[A-Z0-9]$'),
  constraint invite_codes_description_length
    check (char_length(description) <= 280),
  constraint invite_codes_expiry_after_creation
    check (expires_at is null or expires_at > created_at),
  constraint invite_codes_spots_range
    check (total_spots between 1 and 30
           and remaining_spots >= 0
           and remaining_spots <= total_spots),
  constraint invite_codes_counts_nonnegative
    check (claimed_count >= 0 and fail_reports >= 0)
);

-- Case-insensitive uniqueness: codes are stored uppercase, this is belt and braces.
create unique index if not exists invite_codes_code_unique_idx
  on public.invite_codes (upper(code));

create index if not exists invite_codes_status_created_idx
  on public.invite_codes (status, created_at asc);

create index if not exists invite_codes_created_idx
  on public.invite_codes (created_at asc);

create index if not exists invite_codes_creator_rate_idx
  on public.invite_codes (creator_token_hash, created_at desc);

-- Trigram indexes keep ILIKE searches off a full sequential scan.
create index if not exists invite_codes_code_trgm_idx
  on public.invite_codes using gin (code extensions.gin_trgm_ops);

create index if not exists invite_codes_description_trgm_idx
  on public.invite_codes using gin (description extensions.gin_trgm_ops);

create table if not exists public.invite_code_reports (
  id            bigint generated always as identity primary key,
  code_id       uuid        not null references public.invite_codes (id) on delete cascade,
  reporter_hash text        not null,
  action        text        not null check (action in ('used', 'invalid')),
  created_at    timestamptz not null default now(),
  constraint invite_code_reports_once unique (code_id, reporter_hash, action)
);

create index if not exists invite_code_reports_rate_idx
  on public.invite_code_reports (reporter_hash, created_at desc);

create index if not exists invite_code_reports_code_idx
  on public.invite_code_reports (code_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists invite_codes_set_updated_at on public.invite_codes;
create trigger invite_codes_set_updated_at
  before update on public.invite_codes
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.invite_codes enable row level security;
alter table public.invite_code_reports enable row level security;

-- Public community directory: anyone may read the public fields.
drop policy if exists "Public can read invite codes" on public.invite_codes;
create policy "Public can read invite codes"
  on public.invite_codes
  for select
  to anon, authenticated
  using (true);

-- There is intentionally NO insert/update/delete policy. Every write must go
-- through the validated SECURITY DEFINER functions in the next migration.

-- ---------------------------------------------------------------------------
-- Privileges (Supabase grants broad privileges on public tables by default)
-- ---------------------------------------------------------------------------
revoke all on public.invite_codes from anon, authenticated;
grant select (id, code, description, status, total_spots, remaining_spots,
              claimed_count, fail_reports, created_at, updated_at, expires_at)
  on public.invite_codes to anon, authenticated;

-- Report rows are never readable by clients; they contain only pseudonymous
-- hashes and are used for de-duplication and rate limiting.
revoke all on public.invite_code_reports from anon, authenticated;

grant select on public.invite_codes to service_role;
