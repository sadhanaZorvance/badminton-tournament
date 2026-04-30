-- ============================================================================
-- Leo Rising Stars Tournament — Row Level Security policies
-- Run AFTER 01_schema.sql.
--
-- Auth model:
--   - No Supabase Auth users / no user table.
--   - Role is a session variable: app.user_role ∈ {public, court_admin, top_admin}.
--   - set_role(role) RPC sets the variable. RPCs internally are SECURITY DEFINER
--     so they perform atomic multi-table writes without re-checking RLS.
--   - current_setting('app.user_role', true) returns NULL when unset (public).
-- ============================================================================

-- Helper: read role with missing_ok=true so unauthenticated requests don't error.
create or replace function public.current_user_role()
returns text
language sql
stable
as $$
  select coalesce(current_setting('app.user_role', true), 'public')
$$;

-- ── players ─────────────────────────────────────────────────────────────────
drop policy if exists players_select on public.players;
drop policy if exists players_update on public.players;

create policy players_select on public.players
  for select using (true);

-- Top admin can flip status (withdraw). Other writes are RPC-only.
create policy players_update on public.players
  for update
  using (public.current_user_role() = 'top_admin')
  with check (public.current_user_role() = 'top_admin');

-- ── events ──────────────────────────────────────────────────────────────────
drop policy if exists events_select on public.events;
create policy events_select on public.events for select using (true);

-- ── teams ───────────────────────────────────────────────────────────────────
drop policy if exists teams_select on public.teams;
create policy teams_select on public.teams for select using (true);

-- ── matches ─────────────────────────────────────────────────────────────────
drop policy if exists matches_select on public.matches;
drop policy if exists matches_start  on public.matches;
drop policy if exists matches_edit   on public.matches;
drop policy if exists matches_court  on public.matches;

create policy matches_select on public.matches for select using (true);

-- start_match path — client UPDATE matches SET status='in_progress' WHERE status='ready'
create policy matches_start on public.matches
  for update
  using (
    status = 'ready'
    and public.current_user_role() in ('court_admin','top_admin')
  )
  with check (public.current_user_role() in ('court_admin','top_admin'));

-- top_admin edits — blocked when event is published
create policy matches_edit on public.matches
  for update
  using (
    public.current_user_role() = 'top_admin'
    and (select status from public.events where id = matches.event_id) <> 'published'
  )
  with check (
    public.current_user_role() = 'top_admin'
    and (select status from public.events where id = matches.event_id) <> 'published'
  );

-- ── sets ────────────────────────────────────────────────────────────────────
drop policy if exists sets_select on public.sets;
drop policy if exists sets_write  on public.sets;

create policy sets_select on public.sets for select using (true);

-- court_admin writes own in_progress match; top_admin writes any non-published
create policy sets_write on public.sets
  for all
  using (
    (
      public.current_user_role() = 'court_admin'
      and (select status from public.matches where id = sets.match_id) = 'in_progress'
    )
    or (
      public.current_user_role() = 'top_admin'
      and (
        select e.status from public.events e
        join public.matches m on m.event_id = e.id
        where m.id = sets.match_id
      ) <> 'published'
    )
  )
  with check (
    (
      public.current_user_role() = 'court_admin'
      and (select status from public.matches where id = sets.match_id) = 'in_progress'
    )
    or (
      public.current_user_role() = 'top_admin'
      and (
        select e.status from public.events e
        join public.matches m on m.event_id = e.id
        where m.id = sets.match_id
      ) <> 'published'
    )
  );

-- ── pools ───────────────────────────────────────────────────────────────────
drop policy if exists pools_select on public.pools;
create policy pools_select on public.pools for select using (true);

-- ── pool_entrants ───────────────────────────────────────────────────────────
drop policy if exists pool_entrants_select on public.pool_entrants;
create policy pool_entrants_select on public.pool_entrants for select using (true);

-- ── podiums ─────────────────────────────────────────────────────────────────
drop policy if exists podiums_select on public.podiums;
drop policy if exists podiums_write  on public.podiums;

-- Anyone reads (client filters to status='published' for public site).
create policy podiums_select on public.podiums for select using (true);

-- Direct writes are top_admin only; RPCs (SECURITY DEFINER) bypass this anyway.
create policy podiums_write on public.podiums
  for all
  using (public.current_user_role() = 'top_admin')
  with check (public.current_user_role() = 'top_admin');

-- ── audit_log ───────────────────────────────────────────────────────────────
drop policy if exists audit_insert on public.audit_log;
drop policy if exists audit_select on public.audit_log;

-- Append-only: only INSERT for admins. UPDATE / DELETE blocked by absence of policy.
create policy audit_insert on public.audit_log
  for insert
  with check (public.current_user_role() in ('court_admin','top_admin'));

create policy audit_select on public.audit_log
  for select
  using (public.current_user_role() = 'top_admin');

-- ── trigger_records ─────────────────────────────────────────────────────────
drop policy if exists triggers_select on public.trigger_records;

-- Top admin reads via UI ("Generated by X at HH:MM"). Writes via RPC only.
create policy triggers_select on public.trigger_records
  for select
  using (public.current_user_role() = 'top_admin');
