-- ============================================================================
-- Leo Rising Stars Tournament — Schema (Phase 4 BACKEND_DESIGN.md)
-- Order of execution:
--   1. 01_schema.sql   ← THIS FILE (tables + indexes + enums)
--   2. 02_rls.sql      (Row Level Security policies)
--   3. 03_rpc.sql      (RPC functions for atomic multi-table writes)
-- ============================================================================

-- ── Extensions ──────────────────────────────────────────────────────────────
create extension if not exists pgcrypto;  -- gen_random_uuid()

-- ── Enums ───────────────────────────────────────────────────────────────────
-- Each in its own DO block so that re-running this file is idempotent even
-- when some types already exist.
do $$ begin create type age_group_t      as enum ('U11','U13','U15');                                       exception when duplicate_object then null; end $$;
do $$ begin create type age_group_mixed_t as enum ('U11','U13','U15','mixed');                              exception when duplicate_object then null; end $$;
do $$ begin create type gender_t          as enum ('M','F');                                                 exception when duplicate_object then null; end $$;
do $$ begin create type gender_mixed_t    as enum ('M','F','mixed');                                         exception when duplicate_object then null; end $$;
do $$ begin create type active_status_t   as enum ('active','withdrawn');                                    exception when duplicate_object then null; end $$;
do $$ begin create type entrant_type_t    as enum ('player','team');                                         exception when duplicate_object then null; end $$;
do $$ begin create type event_status_t    as enum ('pending','active','complete','published');              exception when duplicate_object then null; end $$;
do $$ begin create type event_format_t    as enum ('knockout','rr','hybrid');                                exception when duplicate_object then null; end $$;
do $$ begin create type court_pool_t      as enum ('boys','girls','any');                                    exception when duplicate_object then null; end $$;
do $$ begin create type match_status_t    as enum ('pending','ready','in_progress','complete','walkover','retired'); exception when duplicate_object then null; end $$;
do $$ begin create type match_format_t    as enum ('set21','set30','best_of_3x15');                          exception when duplicate_object then null; end $$;
do $$ begin create type podium_status_t   as enum ('draft','published');                                     exception when duplicate_object then null; end $$;
do $$ begin create type pool_label_t      as enum ('A','B','Main');                                          exception when duplicate_object then null; end $$;
do $$ begin create type trigger_type_t    as enum ('blp','consolation_pools','e8_draw','podium_publish');    exception when duplicate_object then null; end $$;

-- ── players ─────────────────────────────────────────────────────────────────
create table if not exists public.players (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique,
  full_name    text not null,
  first_name   text not null,
  middle_name  text,
  last_name    text,
  display_name text not null,
  age_group    age_group_t not null,
  gender       gender_t not null,
  status       active_status_t not null default 'active',
  created_at   timestamptz not null default now()
);

-- ── events ──────────────────────────────────────────────────────────────────
create table if not exists public.events (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  name          text not null,
  format_type   event_format_t not null,
  gender        gender_mixed_t not null,
  age_group     age_group_mixed_t not null,
  status        event_status_t not null default 'pending',
  depends_on    uuid[] not null default '{}',
  court_pool    court_pool_t not null default 'any',
  handicap_rule text,
  draw_locked   boolean not null default false,
  created_at    timestamptz not null default now()
);

-- ── teams ───────────────────────────────────────────────────────────────────
create table if not exists public.teams (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references public.events(id) on delete cascade,
  player1_id   uuid not null references public.players(id),
  player2_id   uuid not null references public.players(id),
  display_name text not null,
  status       active_status_t not null default 'active',
  created_at   timestamptz not null default now(),
  check (player1_id <> player2_id)
);
create index if not exists teams_event_idx on public.teams(event_id);

-- ── pools ───────────────────────────────────────────────────────────────────
create table if not exists public.pools (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events(id) on delete cascade,
  label      pool_label_t not null,
  created_at timestamptz not null default now(),
  unique (event_id, label)
);

-- ── pool_entrants ───────────────────────────────────────────────────────────
create table if not exists public.pool_entrants (
  id           uuid primary key default gen_random_uuid(),
  pool_id      uuid not null references public.pools(id) on delete cascade,
  entrant_id   uuid not null,
  entrant_type entrant_type_t not null,
  created_at   timestamptz not null default now(),
  unique (pool_id, entrant_id)
);
create index if not exists pool_entrants_pool_idx on public.pool_entrants(pool_id);

-- ── matches ─────────────────────────────────────────────────────────────────
create table if not exists public.matches (
  id               uuid primary key default gen_random_uuid(),
  event_id         uuid not null references public.events(id) on delete cascade,
  round            text not null,
  bracket_slot     text not null,
  pool_id          uuid references public.pools(id) on delete set null,
  court            text,
  p1_ref           text not null,
  p2_ref           text not null,
  p1_id            uuid,
  p2_id            uuid,
  p1_type          entrant_type_t,
  p2_type          entrant_type_t,
  score_sets       jsonb not null default '[]'::jsonb,
  winner_id        uuid,
  winner_type      entrant_type_t,
  match_format     match_format_t not null,
  handicap_applied boolean not null default false,
  status           match_status_t not null default 'pending',
  inconsistent     boolean not null default false,
  started_at       timestamptz,
  completed_at     timestamptz,
  started_by       text,
  entered_by       text,
  edit_history     jsonb not null default '[]'::jsonb,
  created_at       timestamptz not null default now(),
  unique (event_id, bracket_slot)
);
create index if not exists matches_event_idx        on public.matches(event_id);
create index if not exists matches_status_idx       on public.matches(status);
create index if not exists matches_pool_idx         on public.matches(pool_id);
create index if not exists matches_status_event_idx on public.matches(event_id, status);

-- ── sets ────────────────────────────────────────────────────────────────────
create table if not exists public.sets (
  id           uuid primary key default gen_random_uuid(),
  match_id     uuid not null references public.matches(id) on delete cascade,
  set_number   integer not null check (set_number between 1 and 3),
  p1_score     integer not null default 0 check (p1_score >= 0),
  p2_score     integer not null default 0 check (p2_score >= 0),
  target_score integer not null check (target_score in (15,21,30)),
  complete     boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (match_id, set_number)
);
create index if not exists sets_match_idx on public.sets(match_id);

-- ── podiums ─────────────────────────────────────────────────────────────────
create table if not exists public.podiums (
  id                    uuid primary key default gen_random_uuid(),
  event_id              uuid not null unique references public.events(id) on delete cascade,
  gold_id               uuid,
  silver_id             uuid,
  bronze_id             uuid,
  consolation_winner_id uuid,
  gold_type             entrant_type_t,
  silver_type           entrant_type_t,
  bronze_type           entrant_type_t,
  status                podium_status_t not null default 'draft',
  published_by          text,
  published_at          timestamptz,
  created_at            timestamptz not null default now()
);

-- ── audit_log ───────────────────────────────────────────────────────────────
create table if not exists public.audit_log (
  id          uuid primary key default gen_random_uuid(),
  timestamp   timestamptz not null default now(),
  action_type text not null,
  match_id    uuid references public.matches(id) on delete set null,
  event_id    uuid references public.events(id)  on delete set null,
  actor_name  text not null,
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists audit_log_match_idx     on public.audit_log(match_id);
create index if not exists audit_log_event_idx     on public.audit_log(event_id);
create index if not exists audit_log_timestamp_idx on public.audit_log(timestamp desc);

-- ── trigger_records ─────────────────────────────────────────────────────────
create table if not exists public.trigger_records (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references public.events(id) on delete cascade,
  trigger_type trigger_type_t not null,
  fired_by     text not null,
  fired_at     timestamptz not null default now(),
  payload      jsonb,
  unique (event_id, trigger_type)
);

-- ── Enable Row Level Security ───────────────────────────────────────────────
alter table public.players         enable row level security;
alter table public.teams           enable row level security;
alter table public.events          enable row level security;
alter table public.matches         enable row level security;
alter table public.sets            enable row level security;
alter table public.pools           enable row level security;
alter table public.pool_entrants   enable row level security;
alter table public.podiums         enable row level security;
alter table public.audit_log       enable row level security;
alter table public.trigger_records enable row level security;

-- ── Realtime publication (Supabase) ─────────────────────────────────────────
-- Public site subscribes to matches, sets, podiums.
do $$ begin
  alter publication supabase_realtime add table public.matches;
  alter publication supabase_realtime add table public.sets;
  alter publication supabase_realtime add table public.podiums;
exception when duplicate_object then null;
         when undefined_object then null;
end $$;
