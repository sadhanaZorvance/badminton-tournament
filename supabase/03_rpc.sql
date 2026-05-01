-- ============================================================================
-- Leo Rising Stars Tournament — RPC Functions
-- Run AFTER 01_schema.sql and 02_rls.sql.
--
-- Conventions:
--   - All functions are SECURITY DEFINER → bypass RLS so multi-table writes
--     happen atomically inside one transaction.
--   - Errors raise structured codes as the first word of MESSAGE
--     (e.g. 'MATCH_ALREADY_CLAIMED: ...'). Client parses these.
--   - Each function runs inside its own implicit transaction. All-or-nothing.
--
-- p_downstream_updates / p_loser_downstream_updates schema (used by
-- complete_match / record_walkover / record_retirement / cascade_edit_match):
--
--   [
--     { "match_id": "<uuid>",  "slot": "p1" | "p2" }
--   ]
--
-- The client computes both lists from src/lib/bracketWiring.ts:
--   - p_downstream_updates       → slots that should receive the WINNER
--                                  (e.g. SF1 winner → F.p1)
--   - p_loser_downstream_updates → slots that should receive the LOSER
--                                  (e.g. SF1 loser → 3P.p1)
-- ============================================================================

-- ──────────────────────────────────────────────────────────────────────────
-- set_role
-- Sets the session variable used by RLS policies.
-- ──────────────────────────────────────────────────────────────────────────
create or replace function public.set_role(role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if role not in ('public','court_admin','top_admin') then
    raise exception 'INVALID_ROLE: %', role;
  end if;
  perform set_config('app.user_role', role, false);
end;
$$;

grant execute on function public.set_role(text) to anon, authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- _resolve_downstream  (private helper)
-- Apply a p_downstream_updates list, marking target matches ready when both
-- opponents are known. Returns count of rows updated.
-- ──────────────────────────────────────────────────────────────────────────
create or replace function public._resolve_downstream(
  p_winner_id   uuid,
  p_winner_type entrant_type_t,
  p_updates     jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_update      jsonb;
  v_match_id    uuid;
  v_slot        text;
  v_count       int := 0;
  v_p1_id       uuid;
  v_p2_id       uuid;
  v_match_status match_status_t;
begin
  if p_updates is null or jsonb_array_length(p_updates) = 0 then
    return 0;
  end if;

  for v_update in select * from jsonb_array_elements(coalesce(p_updates,'[]'::jsonb))
  loop
    v_match_id := (v_update->>'match_id')::uuid;
    v_slot     := v_update->>'slot';

    if v_slot not in ('p1','p2') then
      raise exception 'INVALID_SLOT: % (must be p1 or p2)', v_slot;
    end if;

    if v_slot = 'p1' then
      update public.matches
         set p1_id   = p_winner_id,
             p1_type = p_winner_type
       where id = v_match_id;
    else
      update public.matches
         set p2_id   = p_winner_id,
             p2_type = p_winner_type
       where id = v_match_id;
    end if;

    -- If both opponents resolved and match is still pending → flip to ready.
    select status, p1_id, p2_id into v_match_status, v_p1_id, v_p2_id
      from public.matches
     where id = v_match_id;

    if v_match_status = 'pending' and v_p1_id is not null and v_p2_id is not null then
      update public.matches set status = 'ready' where id = v_match_id;
    end if;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- _maybe_update_podium  (private helper)
-- Derives podium positions from completed bracket slots (F, 3P, ConF) and
-- auto-publishes each position as it becomes known — no manual publish step
-- needed. Positions are updated independently: 3P can publish bronze before
-- the Final completes, and ConF publishes consolation winner separately.
-- Also sets event.status='complete' when all matches are terminal.
-- ──────────────────────────────────────────────────────────────────────────
create or replace function public._maybe_update_podium(
  p_event_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_code    text;
  v_event_format  text;
  v_final         record;
  v_third         record;
  v_confinal      record;
  v_gold_id       uuid;
  v_gold_type     entrant_type_t;
  v_silver_id     uuid;
  v_silver_type   entrant_type_t;
  v_bronze_id     uuid;
  v_bronze_type   entrant_type_t;
  v_con_id        uuid;
  v_any_known     boolean;
  v_outstanding   int;
  v_rr_rank       int;
  v_standings_row record;
begin
  -- Compute outstanding count early (needed for RR standings branch)
  select count(*) into v_outstanding
    from public.matches
   where event_id = p_event_id
     and status not in ('complete','walkover','retired');

  -- Final → gold + silver
  select winner_id, winner_type, p1_id, p2_id, p1_type, p2_type
    into v_final
    from public.matches
   where event_id = p_event_id and bracket_slot = 'F'
     and status in ('complete','walkover')
   limit 1;

  if v_final.winner_id is not null then
    v_gold_id   := v_final.winner_id;
    v_gold_type := v_final.winner_type;
    if v_final.p1_id = v_final.winner_id then
      v_silver_id   := v_final.p2_id;
      v_silver_type := v_final.p2_type;
    else
      v_silver_id   := v_final.p1_id;
      v_silver_type := v_final.p1_type;
    end if;
  end if;

  -- 3rd place → bronze
  select winner_id, winner_type into v_third
    from public.matches
   where event_id = p_event_id and bracket_slot = '3P'
     and status in ('complete','walkover')
   limit 1;

  if v_third.winner_id is not null then
    v_bronze_id   := v_third.winner_id;
    v_bronze_type := v_third.winner_type;
  end if;

  -- Consolation Final → consolation winner
  select winner_id into v_confinal
    from public.matches
   where event_id = p_event_id and bracket_slot = 'ConF'
     and status in ('complete','walkover')
   limit 1;

  if v_confinal.winner_id is not null then
    v_con_id := v_confinal.winner_id;
  end if;

  v_any_known := (v_gold_id is not null or v_bronze_id is not null or v_con_id is not null);

  -- Pure RR branch: derive podium from standings when all matches done and no bracket winners yet
  if not v_any_known and v_outstanding = 0 then
    select e.code, e.format_type into v_event_code, v_event_format
      from public.events e where e.id = p_event_id;

    if v_event_format = 'rr'
       and not exists (
         select 1 from public.matches
          where event_id = p_event_id
            and bracket_slot in ('F','3P','ConF')
       )
    then
      v_rr_rank := 0;
      for v_standings_row in
        with entrants as (
          select distinct p1_id as entrant_id, p1_type as entrant_type
            from public.matches
           where event_id = p_event_id and round = 'RR' and p1_id is not null
          union
          select distinct p2_id, p2_type
            from public.matches
           where event_id = p_event_id and round = 'RR' and p2_id is not null
        ),
        match_scores as (
          select
            m.p1_id, m.p2_id, m.winner_id,
            coalesce((select sum((el->>'p1')::int) from jsonb_array_elements(m.score_sets) el), 0) as p1_pf,
            coalesce((select sum((el->>'p2')::int) from jsonb_array_elements(m.score_sets) el), 0) as p2_pf
          from public.matches m
         where m.event_id = p_event_id
           and m.round = 'RR'
           and m.status in ('complete','walkover','retired')
        ),
        standings_agg as (
          select
            e.entrant_id,
            e.entrant_type,
            count(*) filter (where ms.winner_id = e.entrant_id) as wins,
            coalesce(sum(
              case when ms.p1_id = e.entrant_id then ms.p1_pf - ms.p2_pf
                   else ms.p2_pf - ms.p1_pf end
            ), 0) as point_diff
          from entrants e
          left join match_scores ms on (ms.p1_id = e.entrant_id or ms.p2_id = e.entrant_id)
          group by e.entrant_id, e.entrant_type
          order by wins desc, point_diff desc
        )
        select * from standings_agg
      loop
        v_rr_rank := v_rr_rank + 1;
        if v_rr_rank = 1 then
          v_gold_id     := v_standings_row.entrant_id;
          v_gold_type   := v_standings_row.entrant_type;
        elsif v_rr_rank = 2 then
          v_silver_id   := v_standings_row.entrant_id;
          v_silver_type := v_standings_row.entrant_type;
        elsif v_rr_rank = 3 then
          v_bronze_id   := v_standings_row.entrant_id;
          v_bronze_type := v_standings_row.entrant_type;
        else
          exit;
        end if;
      end loop;
      v_any_known := (v_gold_id is not null);
    end if;
  end if;

  if v_any_known then
    insert into public.podiums (
      event_id, gold_id, gold_type,
      silver_id, silver_type,
      bronze_id, bronze_type,
      consolation_winner_id, status,
      published_by, published_at
    ) values (
      p_event_id, v_gold_id, v_gold_type,
      v_silver_id, v_silver_type,
      v_bronze_id, v_bronze_type,
      v_con_id, 'published',
      'system', now()
    )
    on conflict (event_id) do update set
      gold_id               = excluded.gold_id,
      gold_type             = excluded.gold_type,
      silver_id             = excluded.silver_id,
      silver_type           = excluded.silver_type,
      bronze_id             = excluded.bronze_id,
      bronze_type           = excluded.bronze_type,
      consolation_winner_id = excluded.consolation_winner_id,
      status                = 'published',
      published_by          = 'system',
      published_at          = coalesce(podiums.published_at, now());
  else
    -- No bracket positions known: revert existing row to draft so it hides on public board
    update public.podiums set status = 'draft' where event_id = p_event_id;
  end if;

  -- Update event to complete when all matches are terminal
  if v_outstanding = 0 then
    update public.events set status = 'complete' where id = p_event_id and status <> 'published';
  end if;

  return v_any_known;
end;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- _maybe_create_rr_playoffs
-- E8-only: when all RR matches are terminal and no Final exists yet,
-- compute standings and insert F (best_of_3x15) and 3P (set30) matches.
-- Idempotent — safe to call multiple times.
-- ──────────────────────────────────────────────────────────────────────────
drop function if exists public._maybe_create_rr_playoffs(uuid);
create or replace function public._maybe_create_rr_playoffs(p_event_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_code    text;
  v_outstanding   int;
  v_rr_rank       int;
  v_standings_row record;
  v_rank1_id      uuid;  v_rank1_type entrant_type_t;
  v_rank2_id      uuid;  v_rank2_type entrant_type_t;
  v_rank3_id      uuid;  v_rank3_type entrant_type_t;
  v_rank4_id      uuid;  v_rank4_type entrant_type_t;
begin
  select code into v_event_code from public.events where id = p_event_id;
  if v_event_code <> 'E8' then return false; end if;

  -- Idempotent: F already created
  if exists (select 1 from public.matches where event_id = p_event_id and bracket_slot = 'F') then
    return false;
  end if;

  -- All non-playoff matches must be terminal (exclude bracket_slot to avoid filtering on round value
  -- which may be 'RR' or 'ConRR' depending on which version of lock_e8_draw was run)
  select count(*) into v_outstanding
    from public.matches
   where event_id = p_event_id
     and bracket_slot not in ('F','3P','ConF')
     and status not in ('complete','walkover','retired');

  if v_outstanding > 0 then return false; end if;

  -- Compute standings from completed pool matches (bracket_slot-based filter handles both
  -- round='RR' and round='ConRR' from older lock_e8_draw versions)
  v_rr_rank := 0;
  for v_standings_row in
    with entrants as (
      select distinct p1_id as entrant_id, p1_type as entrant_type
        from public.matches
       where event_id = p_event_id and bracket_slot not in ('F','3P','ConF') and p1_id is not null
      union
      select distinct p2_id, p2_type
        from public.matches
       where event_id = p_event_id and bracket_slot not in ('F','3P','ConF') and p2_id is not null
    ),
    match_scores as (
      select
        m.p1_id, m.p2_id, m.winner_id,
        coalesce((select sum((el->>'p1')::int) from jsonb_array_elements(m.score_sets) el), 0) as p1_pf,
        coalesce((select sum((el->>'p2')::int) from jsonb_array_elements(m.score_sets) el), 0) as p2_pf
      from public.matches m
     where m.event_id = p_event_id
       and m.bracket_slot not in ('F','3P','ConF')
       and m.status in ('complete','walkover','retired')
    ),
    standings_agg as (
      select
        e.entrant_id,
        e.entrant_type,
        count(*) filter (where ms.winner_id = e.entrant_id) as wins,
        coalesce(sum(
          case when ms.p1_id = e.entrant_id then ms.p1_pf - ms.p2_pf
               else ms.p2_pf - ms.p1_pf end
        ), 0) as point_diff
      from entrants e
      left join match_scores ms on (ms.p1_id = e.entrant_id or ms.p2_id = e.entrant_id)
      group by e.entrant_id, e.entrant_type
      order by wins desc, point_diff desc
    )
    select * from standings_agg
  loop
    v_rr_rank := v_rr_rank + 1;
    if    v_rr_rank = 1 then v_rank1_id := v_standings_row.entrant_id; v_rank1_type := v_standings_row.entrant_type;
    elsif v_rr_rank = 2 then v_rank2_id := v_standings_row.entrant_id; v_rank2_type := v_standings_row.entrant_type;
    elsif v_rr_rank = 3 then v_rank3_id := v_standings_row.entrant_id; v_rank3_type := v_standings_row.entrant_type;
    elsif v_rr_rank = 4 then v_rank4_id := v_standings_row.entrant_id; v_rank4_type := v_standings_row.entrant_type;
    else exit;
    end if;
  end loop;

  if v_rank1_id is null or v_rank2_id is null then return false; end if;

  -- Final: 1st vs 2nd
  insert into public.matches (
    event_id, round, bracket_slot, match_format,
    p1_id, p1_type, p1_ref,
    p2_id, p2_type, p2_ref,
    status
  ) values (
    p_event_id, 'F', 'F', 'best_of_3x15',
    v_rank1_id, v_rank1_type, 'Rank1:RR',
    v_rank2_id, v_rank2_type, 'Rank2:RR',
    'ready'
  );

  -- 3rd place: 3rd vs 4th (only if both ranked)
  if v_rank3_id is not null and v_rank4_id is not null then
    insert into public.matches (
      event_id, round, bracket_slot, match_format,
      p1_id, p1_type, p1_ref,
      p2_id, p2_type, p2_ref,
      status
    ) values (
      p_event_id, '3P', '3P', 'set30',
      v_rank3_id, v_rank3_type, 'Rank3:RR',
      v_rank4_id, v_rank4_type, 'Rank4:RR',
      'ready'
    );
  end if;

  return true;
end;
$$;

grant execute on function public._maybe_create_rr_playoffs(uuid) to anon, authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- start_match
-- Optimistic lock — only succeeds if status is still 'ready'.
-- ──────────────────────────────────────────────────────────────────────────
create or replace function public.start_match(
  p_match_id   uuid,
  p_court      text,
  p_admin_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows int;
begin
  if p_admin_name is null or length(trim(p_admin_name)) = 0 then
    raise exception 'INVALID_ADMIN_NAME: admin name required';
  end if;

  update public.matches
     set status     = 'in_progress',
         court      = p_court,
         started_at = now(),
         started_by = p_admin_name
   where id = p_match_id and status = 'ready';
  get diagnostics v_rows = row_count;

  if v_rows = 0 then
    raise exception 'MATCH_ALREADY_CLAIMED: match is not in ready state';
  end if;

  insert into public.audit_log (action_type, match_id, event_id, actor_name, payload)
  select 'match_started', m.id, m.event_id, p_admin_name,
         jsonb_build_object('court', p_court)
    from public.matches m where m.id = p_match_id;

  return jsonb_build_object('success', true);
end;
$$;

grant execute on function public.start_match(uuid,text,text) to anon, authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- submit_set
-- Upsert one set + refresh score_sets denormalised snapshot on matches.
-- ──────────────────────────────────────────────────────────────────────────
create or replace function public.submit_set(
  p_match_id   uuid,
  p_set_number int,
  p_p1_score   int,
  p_p2_score   int,
  p_admin_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match        record;
  v_target       int;
  v_existing     record;
  v_action       text;
  v_before       jsonb;
  v_score_sets   jsonb;
begin
  if p_admin_name is null or length(trim(p_admin_name)) = 0 then
    raise exception 'INVALID_ADMIN_NAME: admin name required';
  end if;

  select * into v_match from public.matches where id = p_match_id;
  if not found then
    raise exception 'MATCH_NOT_FOUND: %', p_match_id;
  end if;

  if v_match.status <> 'in_progress' then
    raise exception 'MATCH_NOT_IN_PROGRESS: status=%', v_match.status;
  end if;

  -- Target score by format
  v_target := case v_match.match_format
                when 'set21'        then 21
                when 'set30'        then 30
                when 'best_of_3x15' then 15
              end;

  -- Validate (BR-010, BR-011): exactly one score equals target, other in [0,target-1].
  if not (
    (p_p1_score = v_target and p_p2_score between 0 and v_target - 1)
    or
    (p_p2_score = v_target and p_p1_score between 0 and v_target - 1)
  ) then
    raise exception 'INVALID_SET_SCORE: exactly one player must reach % (got %-%)',
      v_target, p_p1_score, p_p2_score;
  end if;

  -- Best of 3: only allow set 2 if set 1 exists complete; only allow set 3 if 1-1.
  if v_match.match_format = 'best_of_3x15' then
    if p_set_number = 2 then
      if not exists (select 1 from public.sets
                       where match_id = p_match_id and set_number = 1 and complete) then
        raise exception 'INVALID_SET_ORDER: set 1 must be complete first';
      end if;
    elsif p_set_number = 3 then
      if not exists (
        select 1 from public.sets s1
          join public.sets s2 on s2.match_id = s1.match_id and s2.set_number = 2
         where s1.match_id = p_match_id and s1.set_number = 1
           and s1.complete and s2.complete
           and (
             (s1.p1_score = v_target and s2.p2_score = v_target)
             or
             (s1.p2_score = v_target and s2.p1_score = v_target)
           )
      ) then
        raise exception 'INVALID_SET_ORDER: set 3 only allowed after sets 1+2 split 1-1';
      end if;
    end if;
  elsif p_set_number <> 1 then
    raise exception 'INVALID_SET_ORDER: format % only has one set', v_match.match_format;
  end if;

  -- Read existing for audit
  select * into v_existing
    from public.sets where match_id = p_match_id and set_number = p_set_number;

  if not found then
    v_action := 'set_entered';
    v_before := null;
    insert into public.sets (match_id, set_number, p1_score, p2_score, target_score, complete, updated_at)
    values (p_match_id, p_set_number, p_p1_score, p_p2_score, v_target, true, now());
  else
    v_action := 'set_edited';
    v_before := jsonb_build_object('p1', v_existing.p1_score, 'p2', v_existing.p2_score);
    update public.sets
       set p1_score = p_p1_score,
           p2_score = p_p2_score,
           target_score = v_target,
           complete = true,
           updated_at = now()
     where match_id = p_match_id and set_number = p_set_number;
  end if;

  -- Recompute score_sets jsonb snapshot from sets table
  select coalesce(jsonb_agg(
           jsonb_build_object('p1', p1_score, 'p2', p2_score, 'complete', complete)
           order by set_number
         ), '[]'::jsonb)
    into v_score_sets
    from public.sets where match_id = p_match_id;

  update public.matches
     set score_sets = v_score_sets,
         entered_by = p_admin_name
   where id = p_match_id;

  insert into public.audit_log (action_type, match_id, event_id, actor_name, payload)
  values (
    v_action, p_match_id, v_match.event_id, p_admin_name,
    jsonb_build_object(
      'set_number', p_set_number,
      'before',     v_before,
      'after',      jsonb_build_object('p1', p_p1_score, 'p2', p_p2_score)
    )
  );

  return jsonb_build_object('success', true, 'action', v_action);
end;
$$;

grant execute on function public.submit_set(uuid,int,int,int,text) to anon, authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- complete_match
-- Mark complete + apply downstream wiring + maybe draft podium.
-- ──────────────────────────────────────────────────────────────────────────
drop function if exists public.complete_match(uuid,uuid,entrant_type_t,text,jsonb);
create or replace function public.complete_match(
  p_match_id                 uuid,
  p_winner_id                uuid,
  p_winner_type              entrant_type_t,
  p_admin_name               text,
  p_downstream_updates       jsonb default '[]'::jsonb,
  p_loser_downstream_updates jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match              record;
  v_loser_id           uuid;
  v_loser_type         entrant_type_t;
  v_winner_count       int;
  v_loser_count        int;
  v_podium_drafted     boolean;
  -- ConRR → ConF resolution
  v_conrr_outstanding  int;
  v_conf_match_id      uuid;
  v_top1_id            uuid;
  v_top1_type          entrant_type_t;
  v_top2_id            uuid;
  v_top2_type          entrant_type_t;
  v_conrr_row          record;
begin
  if p_admin_name is null or length(trim(p_admin_name)) = 0 then
    raise exception 'INVALID_ADMIN_NAME: admin name required';
  end if;

  select * into v_match from public.matches where id = p_match_id;
  if not found then
    raise exception 'MATCH_NOT_FOUND: %', p_match_id;
  end if;

  if v_match.status <> 'in_progress' then
    raise exception 'MATCH_NOT_IN_PROGRESS: status=%', v_match.status;
  end if;

  if p_winner_id <> v_match.p1_id and p_winner_id <> v_match.p2_id then
    raise exception 'INVALID_WINNER: winner must be one of the two opponents';
  end if;

  if v_match.p1_id = p_winner_id then
    v_loser_id   := v_match.p2_id;
    v_loser_type := v_match.p2_type;
  else
    v_loser_id   := v_match.p1_id;
    v_loser_type := v_match.p1_type;
  end if;

  update public.matches
     set status       = 'complete',
         winner_id    = p_winner_id,
         winner_type  = p_winner_type,
         completed_at = now(),
         entered_by   = p_admin_name
   where id = p_match_id;

  v_winner_count := public._resolve_downstream(p_winner_id, p_winner_type, p_downstream_updates);
  v_loser_count  := public._resolve_downstream(v_loser_id,  v_loser_type,  p_loser_downstream_updates);

  -- When the completed match is a ConRR match, check if all 3 are done and fill ConF.
  if v_match.round = 'ConRR' then
    select count(*) into v_conrr_outstanding
      from public.matches
     where event_id = v_match.event_id
       and round = 'ConRR'
       and status not in ('complete','walkover','retired');

    if v_conrr_outstanding = 0 then
      -- Rank entrants by wins desc, then point differential desc.
      for v_conrr_row in
        select ent_id, ent_type
          from (
            select
              ent_id, ent_type,
              sum(case when is_win then 1 else 0 end)::int as wins,
              sum(pf - pa)::int as diff
            from (
              select p1_id as ent_id, p1_type as ent_type,
                     (winner_id = p1_id) as is_win,
                     coalesce((score_sets->0->>'p1')::int, 0) as pf,
                     coalesce((score_sets->0->>'p2')::int, 0) as pa
                from public.matches
               where event_id = v_match.event_id and round = 'ConRR'
                 and p1_id is not null
              union all
              select p2_id as ent_id, p2_type as ent_type,
                     (winner_id = p2_id) as is_win,
                     coalesce((score_sets->0->>'p2')::int, 0) as pf,
                     coalesce((score_sets->0->>'p1')::int, 0) as pa
                from public.matches
               where event_id = v_match.event_id and round = 'ConRR'
                 and p2_id is not null
            ) sub
            group by ent_id, ent_type
          ) ranked
         order by wins desc, diff desc
         limit 2
      loop
        if v_top1_id is null then
          v_top1_id   := v_conrr_row.ent_id;
          v_top1_type := v_conrr_row.ent_type;
        else
          v_top2_id   := v_conrr_row.ent_id;
          v_top2_type := v_conrr_row.ent_type;
        end if;
      end loop;

      if v_top1_id is not null and v_top2_id is not null then
        select id into v_conf_match_id
          from public.matches
         where event_id = v_match.event_id and bracket_slot = 'ConF';

        if v_conf_match_id is not null then
          update public.matches
             set p1_id   = v_top1_id,
                 p1_type = v_top1_type,
                 p2_id   = v_top2_id,
                 p2_type = v_top2_type,
                 status  = 'ready'
           where id = v_conf_match_id;
        end if;
      end if;
    end if;
  end if;

  insert into public.audit_log (action_type, match_id, event_id, actor_name, payload)
  values (
    'match_completed', p_match_id, v_match.event_id, p_admin_name,
    jsonb_build_object(
      'winner_id', p_winner_id,
      'downstream_updated', v_winner_count + v_loser_count
    )
  );

  perform public._maybe_create_rr_playoffs(v_match.event_id);
  v_podium_drafted := public._maybe_update_podium(v_match.event_id);

  return jsonb_build_object(
    'success',            true,
    'downstream_updated', v_winner_count + v_loser_count,
    'podium_drafted',     v_podium_drafted
  );
end;
$$;

grant execute on function public.complete_match(uuid,uuid,entrant_type_t,text,jsonb,jsonb) to anon, authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- record_walkover
-- ──────────────────────────────────────────────────────────────────────────
drop function if exists public.record_walkover(uuid,uuid,entrant_type_t,text,jsonb);
create or replace function public.record_walkover(
  p_match_id                 uuid,
  p_winner_id                uuid,
  p_winner_type              entrant_type_t,
  p_admin_name               text,
  p_downstream_updates       jsonb default '[]'::jsonb,
  p_loser_downstream_updates jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match          record;
  v_loser_id       uuid;
  v_loser_type     entrant_type_t;
  v_winner_count   int;
  v_loser_count    int;
  v_podium_drafted boolean;
begin
  if p_admin_name is null or length(trim(p_admin_name)) = 0 then
    raise exception 'INVALID_ADMIN_NAME: admin name required';
  end if;

  select * into v_match from public.matches where id = p_match_id;
  if not found then
    raise exception 'MATCH_NOT_FOUND: %', p_match_id;
  end if;

  if v_match.status not in ('ready','in_progress') then
    raise exception 'INVALID_STATE: walkover only from ready or in_progress (status=%)', v_match.status;
  end if;

  if p_winner_id <> v_match.p1_id and p_winner_id <> v_match.p2_id then
    raise exception 'INVALID_WINNER: winner must be one of the two opponents';
  end if;

  if v_match.p1_id = p_winner_id then
    v_loser_id   := v_match.p2_id;
    v_loser_type := v_match.p2_type;
  else
    v_loser_id   := v_match.p1_id;
    v_loser_type := v_match.p1_type;
  end if;

  update public.matches
     set status       = 'walkover',
         winner_id    = p_winner_id,
         winner_type  = p_winner_type,
         score_sets   = '[]'::jsonb,
         completed_at = now(),
         entered_by   = p_admin_name
   where id = p_match_id;

  v_winner_count := public._resolve_downstream(p_winner_id, p_winner_type, p_downstream_updates);
  v_loser_count  := public._resolve_downstream(v_loser_id,  v_loser_type,  p_loser_downstream_updates);

  insert into public.audit_log (action_type, match_id, event_id, actor_name, payload)
  values (
    'match_walkover', p_match_id, v_match.event_id, p_admin_name,
    jsonb_build_object(
      'winner_id', p_winner_id,
      'downstream_updated', v_winner_count + v_loser_count
    )
  );

  perform public._maybe_create_rr_playoffs(v_match.event_id);
  v_podium_drafted := public._maybe_update_podium(v_match.event_id);

  return jsonb_build_object(
    'success', true,
    'downstream_updated', v_winner_count + v_loser_count,
    'podium_drafted', v_podium_drafted
  );
end;
$$;

grant execute on function public.record_walkover(uuid,uuid,entrant_type_t,text,jsonb,jsonb) to anon, authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- record_retirement
-- Optional partial scores; same downstream/podium handling as complete_match.
-- ──────────────────────────────────────────────────────────────────────────
drop function if exists public.record_retirement(uuid,uuid,entrant_type_t,jsonb,text,jsonb);
create or replace function public.record_retirement(
  p_match_id                 uuid,
  p_winner_id                uuid,
  p_winner_type              entrant_type_t,
  p_partial_sets             jsonb,            -- [{set_number, p1_score, p2_score}]  may be null
  p_admin_name               text,
  p_downstream_updates       jsonb default '[]'::jsonb,
  p_loser_downstream_updates jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match          record;
  v_set            jsonb;
  v_target         int;
  v_score_sets     jsonb;
  v_loser_id       uuid;
  v_loser_type     entrant_type_t;
  v_winner_count   int;
  v_loser_count    int;
  v_podium_drafted boolean;
begin
  if p_admin_name is null or length(trim(p_admin_name)) = 0 then
    raise exception 'INVALID_ADMIN_NAME: admin name required';
  end if;

  select * into v_match from public.matches where id = p_match_id;
  if not found then
    raise exception 'MATCH_NOT_FOUND: %', p_match_id;
  end if;

  if v_match.status not in ('ready','in_progress') then
    raise exception 'INVALID_STATE: retirement only from ready or in_progress (status=%)', v_match.status;
  end if;

  if p_winner_id <> v_match.p1_id and p_winner_id <> v_match.p2_id then
    raise exception 'INVALID_WINNER: winner must be one of the two opponents';
  end if;

  if v_match.p1_id = p_winner_id then
    v_loser_id   := v_match.p2_id;
    v_loser_type := v_match.p2_type;
  else
    v_loser_id   := v_match.p1_id;
    v_loser_type := v_match.p1_type;
  end if;

  v_target := case v_match.match_format
                when 'set21'        then 21
                when 'set30'        then 30
                when 'best_of_3x15' then 15
              end;

  -- Apply partial sets if provided (these are NOT validated as winning scores —
  -- a retirement may include incomplete sets).
  if p_partial_sets is not null then
    for v_set in select * from jsonb_array_elements(p_partial_sets)
    loop
      insert into public.sets (match_id, set_number, p1_score, p2_score, target_score, complete, updated_at)
      values (
        p_match_id,
        (v_set->>'set_number')::int,
        coalesce((v_set->>'p1_score')::int, 0),
        coalesce((v_set->>'p2_score')::int, 0),
        v_target,
        coalesce((v_set->>'complete')::boolean, false),
        now()
      )
      on conflict (match_id, set_number) do update set
        p1_score = excluded.p1_score,
        p2_score = excluded.p2_score,
        target_score = excluded.target_score,
        complete = excluded.complete,
        updated_at = now();
    end loop;
  end if;

  -- Recompute snapshot
  select coalesce(jsonb_agg(
           jsonb_build_object('p1', p1_score, 'p2', p2_score, 'complete', complete)
           order by set_number
         ), '[]'::jsonb)
    into v_score_sets
    from public.sets where match_id = p_match_id;

  update public.matches
     set status       = 'retired',
         winner_id    = p_winner_id,
         winner_type  = p_winner_type,
         score_sets   = v_score_sets,
         completed_at = now(),
         entered_by   = p_admin_name
   where id = p_match_id;

  v_winner_count := public._resolve_downstream(p_winner_id, p_winner_type, p_downstream_updates);
  v_loser_count  := public._resolve_downstream(v_loser_id,  v_loser_type,  p_loser_downstream_updates);

  insert into public.audit_log (action_type, match_id, event_id, actor_name, payload)
  values (
    'match_retired', p_match_id, v_match.event_id, p_admin_name,
    jsonb_build_object('winner_id', p_winner_id, 'partial_sets', p_partial_sets)
  );

  perform public._maybe_create_rr_playoffs(v_match.event_id);
  v_podium_drafted := public._maybe_update_podium(v_match.event_id);

  return jsonb_build_object(
    'success', true,
    'downstream_updated', v_winner_count + v_loser_count,
    'podium_drafted', v_podium_drafted
  );
end;
$$;

grant execute on function public.record_retirement(uuid,uuid,entrant_type_t,jsonb,text,jsonb,jsonb) to anon, authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- cascade_edit_match
-- Top Admin edit; cascade or flag downstream as inconsistent. Blocked when
-- event is published.
-- ──────────────────────────────────────────────────────────────────────────
create or replace function public.cascade_edit_match(
  p_match_id            uuid,
  p_new_score_sets      jsonb,            -- [{p1, p2, complete}]
  p_new_winner_id       uuid,
  p_new_winner_type     entrant_type_t,
  p_admin_name          text,
  p_cascade             boolean,
  p_downstream_match_ids uuid[] default '{}',
  p_downstream_updates   jsonb  default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match           record;
  v_event_status    event_status_t;
  v_target          int;
  v_set             jsonb;
  v_idx             int := 0;
  v_before          jsonb;
  v_history_entry   jsonb;
  v_recomputed      jsonb;
  v_downstream_count int;
begin
  if p_admin_name is null or length(trim(p_admin_name)) = 0 then
    raise exception 'INVALID_ADMIN_NAME: admin name required';
  end if;

  select * into v_match from public.matches where id = p_match_id;
  if not found then
    raise exception 'MATCH_NOT_FOUND: %', p_match_id;
  end if;

  select status into v_event_status from public.events where id = v_match.event_id;
  if v_event_status = 'published' then
    raise exception 'EVENT_PUBLISHED: unpublish the podium before editing matches in this event';
  end if;

  v_target := case v_match.match_format
                when 'set21'        then 21
                when 'set30'        then 30
                when 'best_of_3x15' then 15
              end;

  v_before := jsonb_build_object(
    'score_sets',  v_match.score_sets,
    'winner_id',   v_match.winner_id,
    'winner_type', v_match.winner_type,
    'status',      v_match.status
  );

  -- Replace sets rows from p_new_score_sets
  delete from public.sets where match_id = p_match_id;
  if p_new_score_sets is not null then
    for v_set in select * from jsonb_array_elements(p_new_score_sets)
    loop
      v_idx := v_idx + 1;
      insert into public.sets (match_id, set_number, p1_score, p2_score, target_score, complete, updated_at)
      values (
        p_match_id, v_idx,
        coalesce((v_set->>'p1')::int, 0),
        coalesce((v_set->>'p2')::int, 0),
        v_target,
        coalesce((v_set->>'complete')::boolean, true),
        now()
      );
    end loop;
  end if;

  select coalesce(jsonb_agg(
           jsonb_build_object('p1', p1_score, 'p2', p2_score, 'complete', complete)
           order by set_number
         ), '[]'::jsonb)
    into v_recomputed
    from public.sets where match_id = p_match_id;

  v_history_entry := jsonb_build_object(
    'actor',     p_admin_name,
    'timestamp', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'before',    v_before,
    'after',     jsonb_build_object(
                   'score_sets',  v_recomputed,
                   'winner_id',   p_new_winner_id,
                   'winner_type', p_new_winner_type
                 )
  );

  update public.matches
     set score_sets   = v_recomputed,
         winner_id    = p_new_winner_id,
         winner_type  = p_new_winner_type,
         status       = case when v_match.status in ('pending','ready','in_progress') then 'complete' else v_match.status end,
         completed_at = coalesce(v_match.completed_at, now()),
         entered_by   = p_admin_name,
         edit_history = v_match.edit_history || v_history_entry,
         inconsistent = false
   where id = p_match_id;

  if p_cascade then
    -- Reset listed downstream matches to ready/pending (winner cleared).
    if array_length(p_downstream_match_ids, 1) > 0 then
      update public.matches
         set status       = 'ready',
             winner_id    = null,
             winner_type  = null,
             score_sets   = '[]'::jsonb,
             completed_at = null,
             inconsistent = false
       where id = any(p_downstream_match_ids);
      delete from public.sets where match_id = any(p_downstream_match_ids);
    end if;
    -- Re-resolve direct downstream slots with the new winner.
    v_downstream_count := public._resolve_downstream(p_new_winner_id, p_new_winner_type, p_downstream_updates);

    insert into public.audit_log (action_type, match_id, event_id, actor_name, payload)
    values (
      'match_cascaded', p_match_id, v_match.event_id, p_admin_name,
      jsonb_build_object(
        'affected_match_ids', to_jsonb(p_downstream_match_ids),
        'choice',             'cascade',
        'before_winner_id',   v_match.winner_id,
        'after_winner_id',    p_new_winner_id
      )
    );
  else
    if array_length(p_downstream_match_ids, 1) > 0 then
      update public.matches
         set inconsistent = true
       where id = any(p_downstream_match_ids);
    end if;
    v_downstream_count := 0;

    insert into public.audit_log (action_type, match_id, event_id, actor_name, payload)
    values (
      'match_inconsistent_flagged', p_match_id, v_match.event_id, p_admin_name,
      jsonb_build_object(
        'affected_match_ids', to_jsonb(p_downstream_match_ids),
        'choice',             'leave',
        'before_winner_id',   v_match.winner_id,
        'after_winner_id',    p_new_winner_id
      )
    );
  end if;

  -- Re-derive podium in case F/3P/ConF result changed
  perform public._maybe_update_podium(v_match.event_id);

  return jsonb_build_object(
    'success',            true,
    'affected_matches',   to_jsonb(p_downstream_match_ids),
    'downstream_updated', v_downstream_count
  );
end;
$$;

grant execute on function public.cascade_edit_match(uuid,jsonb,uuid,entrant_type_t,text,boolean,uuid[],jsonb) to anon, authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- get_blp_eligible_losers
-- BR-019: BLP ranking includes only fully-played R1 losers — walkovers and
-- retirements are excluded (status='complete' only). Returns each loser with
-- the point margin of their R1 match, ordered closest-margin-first.
-- ──────────────────────────────────────────────────────────────────────────
drop function if exists public.get_blp_eligible_losers(uuid);
create or replace function public.get_blp_eligible_losers(p_event_id uuid)
returns table (
  match_id    uuid,
  player_id   uuid,
  player_type entrant_type_t,
  margin      integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    m.id   as match_id,
    case when m.winner_id = m.p1_id then m.p2_id   else m.p1_id   end as player_id,
    case when m.winner_id = m.p1_id then m.p2_type else m.p1_type end as player_type,
    abs(
      coalesce((m.score_sets->0->>'p1')::int, 0)
      - coalesce((m.score_sets->0->>'p2')::int, 0)
    )::int as margin
  from public.matches m
  where m.event_id = p_event_id
    and m.round    = 'R1'
    and m.status   = 'complete'
    and m.winner_id is not null
  order by margin asc;
$$;

grant execute on function public.get_blp_eligible_losers(uuid) to anon, authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- fire_blp
-- Compute BLP (best-loser playoff) rankings for E1, create the BLP match.
-- Idempotent via trigger_records.
-- ──────────────────────────────────────────────────────────────────────────
create or replace function public.fire_blp(
  p_event_id   uuid,
  p_admin_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing            record;
  v_outstanding_slots   text[];
  v_ranked              jsonb;
  v_blp_match_id        uuid;
  v_p1_id               uuid;
  v_p2_id               uuid;
  v_rankings_count      int;
  v_event_code          text;
begin
  if p_admin_name is null or length(trim(p_admin_name)) = 0 then
    raise exception 'INVALID_ADMIN_NAME: admin name required';
  end if;

  select code into v_event_code from public.events where id = p_event_id;

  -- Idempotency
  select * into v_existing
    from public.trigger_records
   where event_id = p_event_id and trigger_type = 'blp';
  if v_existing.id is not null then
    raise exception 'BLP_ALREADY_FIRED: fired by % at %', v_existing.fired_by, v_existing.fired_at;
  end if;

  -- All R1 matches must be terminal — surface outstanding bracket_slots
  select coalesce(array_agg(bracket_slot order by bracket_slot), '{}')
    into v_outstanding_slots
    from public.matches
   where event_id = p_event_id and round = 'R1'
     and status not in ('complete','walkover','retired');

  if array_length(v_outstanding_slots, 1) > 0 then
    raise exception 'R1_INCOMPLETE: outstanding R1 matches: %',
      array_to_string(v_outstanding_slots, ',');
  end if;

  -- Rank losers from played (status='complete') R1 matches by margin ascending.
  with played as (
    select m.id as match_id,
           m.winner_id,
           case when m.p1_id = m.winner_id then m.p2_id else m.p1_id end as loser_id,
           case when m.p1_id = m.winner_id then m.p2_type else m.p1_type end as loser_type
      from public.matches m
     where m.event_id = p_event_id and m.round = 'R1' and m.status = 'complete'
  ),
  margins as (
    select p.match_id, p.loser_id, p.loser_type,
           sum(abs(s.p1_score - s.p2_score)) as margin
      from played p
      join public.sets s on s.match_id = p.match_id
     group by p.match_id, p.loser_id, p.loser_type
  )
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'match_id', match_id,
             'player_id', loser_id,
             'player_type', loser_type,
             'margin', margin
           )
           order by margin asc
         ), '[]'::jsonb)
    into v_ranked
    from margins;

  v_rankings_count := jsonb_array_length(v_ranked);

  if v_rankings_count < 2 then
    raise exception 'INSUFFICIENT_ELIGIBLE_PLAYERS: only % BLP-eligible loser(s)', v_rankings_count;
  end if;

  v_p1_id := ((v_ranked->0)->>'player_id')::uuid;
  v_p2_id := ((v_ranked->1)->>'player_id')::uuid;

  insert into public.matches (
    event_id, round, bracket_slot, p1_ref, p2_ref,
    p1_id, p2_id, p1_type, p2_type,
    match_format, status
  )
  values (
    p_event_id, 'BLP', 'BLP',
    'BLP-L1', 'BLP-L2',
    v_p1_id, v_p2_id, 'player', 'player',
    'set21', 'ready'
  )
  returning id into v_blp_match_id;

  insert into public.trigger_records (event_id, trigger_type, fired_by, payload)
  values (
    p_event_id, 'blp', p_admin_name,
    jsonb_build_object('rankings', v_ranked, 'blp_match_id', v_blp_match_id)
  );

  insert into public.audit_log (action_type, event_id, actor_name, payload)
  values (
    'trigger_blp', p_event_id, p_admin_name,
    jsonb_build_object('rankings', v_ranked, 'blp_match_id', v_blp_match_id)
  );

  return jsonb_build_object(
    'blp_match_id', v_blp_match_id,
    'rankings',     v_ranked
  );
end;
$$;

grant execute on function public.fire_blp(uuid,text) to anon, authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- generate_consolation_pools (E1 only — 2 pools of 3)
-- ──────────────────────────────────────────────────────────────────────────
create or replace function public.generate_consolation_pools(
  p_event_id   uuid,
  p_admin_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing      record;
  v_blp_status    match_status_t;
  v_blp_winner    uuid;
  v_blp_match     record;
  v_blp_loser     uuid;
  v_eligible      jsonb;
  v_count         int;
  v_pool_a        uuid;
  v_pool_b        uuid;
  v_a1 uuid; v_a2 uuid; v_a3 uuid;
  v_b1 uuid; v_b2 uuid; v_b3 uuid;
begin
  if p_admin_name is null or length(trim(p_admin_name)) = 0 then
    raise exception 'INVALID_ADMIN_NAME: admin name required';
  end if;

  select * into v_existing
    from public.trigger_records
   where event_id = p_event_id and trigger_type = 'consolation_pools';
  if v_existing.id is not null then
    raise exception 'POOLS_ALREADY_GENERATED: fired by % at %', v_existing.fired_by, v_existing.fired_at;
  end if;

  -- BLP must be complete
  select * into v_blp_match from public.matches
   where event_id = p_event_id and round = 'BLP' limit 1;

  if not found then
    raise exception 'BLP_NOT_FIRED: BLP match does not exist for this event';
  end if;
  if v_blp_match.status <> 'complete' then
    raise exception 'BLP_NOT_COMPLETE: BLP match status is %', v_blp_match.status;
  end if;

  v_blp_winner := v_blp_match.winner_id;
  v_blp_loser  := case when v_blp_match.p1_id = v_blp_winner then v_blp_match.p2_id else v_blp_match.p1_id end;

  -- Eligible: 5 R1 losers ranked 3..7 + BLP loser. The BLP players are ranks 1+2.
  with played as (
    select m.id as match_id,
           case when m.p1_id = m.winner_id then m.p2_id else m.p1_id end as loser_id
      from public.matches m
     where m.event_id = p_event_id and m.round = 'R1' and m.status = 'complete'
  ),
  margins as (
    select p.loser_id,
           sum(abs(s.p1_score - s.p2_score)) as margin
      from played p
      join public.sets s on s.match_id = p.match_id
     group by p.loser_id
  ),
  ranked as (
    select loser_id, row_number() over (order by margin asc) as rnk
      from margins
  )
  select coalesce(jsonb_agg(loser_id order by random()), '[]'::jsonb)
    into v_eligible
    from (
      select loser_id from ranked where rnk between 3 and 7
      union all
      select v_blp_loser as loser_id
    ) sub;

  v_count := jsonb_array_length(v_eligible);
  if v_count < 6 then
    raise exception 'INSUFFICIENT_PLAYERS: need 6 consolation players, have %', v_count;
  end if;

  -- Pool A
  insert into public.pools (event_id, label) values (p_event_id, 'A') returning id into v_pool_a;
  v_a1 := (v_eligible->>0)::uuid;
  v_a2 := (v_eligible->>1)::uuid;
  v_a3 := (v_eligible->>2)::uuid;
  insert into public.pool_entrants (pool_id, entrant_id, entrant_type) values
    (v_pool_a, v_a1, 'player'),
    (v_pool_a, v_a2, 'player'),
    (v_pool_a, v_a3, 'player');

  insert into public.matches (event_id, round, bracket_slot, pool_id, p1_ref, p2_ref, p1_id, p2_id, p1_type, p2_type, match_format, status) values
    (p_event_id, 'ConRR', 'ConRR.A.1', v_pool_a, 'A1','A2', v_a1, v_a2, 'player','player','set21','ready'),
    (p_event_id, 'ConRR', 'ConRR.A.2', v_pool_a, 'A1','A3', v_a1, v_a3, 'player','player','set21','ready'),
    (p_event_id, 'ConRR', 'ConRR.A.3', v_pool_a, 'A2','A3', v_a2, v_a3, 'player','player','set21','ready');

  -- Pool B
  insert into public.pools (event_id, label) values (p_event_id, 'B') returning id into v_pool_b;
  v_b1 := (v_eligible->>3)::uuid;
  v_b2 := (v_eligible->>4)::uuid;
  v_b3 := (v_eligible->>5)::uuid;
  insert into public.pool_entrants (pool_id, entrant_id, entrant_type) values
    (v_pool_b, v_b1, 'player'),
    (v_pool_b, v_b2, 'player'),
    (v_pool_b, v_b3, 'player');

  insert into public.matches (event_id, round, bracket_slot, pool_id, p1_ref, p2_ref, p1_id, p2_id, p1_type, p2_type, match_format, status) values
    (p_event_id, 'ConRR', 'ConRR.B.1', v_pool_b, 'B1','B2', v_b1, v_b2, 'player','player','set21','ready'),
    (p_event_id, 'ConRR', 'ConRR.B.2', v_pool_b, 'B1','B3', v_b1, v_b3, 'player','player','set21','ready'),
    (p_event_id, 'ConRR', 'ConRR.B.3', v_pool_b, 'B2','B3', v_b2, v_b3, 'player','player','set21','ready');

  insert into public.trigger_records (event_id, trigger_type, fired_by, payload)
  values (
    p_event_id, 'consolation_pools', p_admin_name,
    jsonb_build_object(
      'pool_a', jsonb_build_array(v_a1, v_a2, v_a3),
      'pool_b', jsonb_build_array(v_b1, v_b2, v_b3)
    )
  );

  insert into public.audit_log (action_type, event_id, actor_name, payload)
  values (
    'trigger_consolation_pools', p_event_id, p_admin_name,
    jsonb_build_object(
      'pool_a', jsonb_build_array(v_a1, v_a2, v_a3),
      'pool_b', jsonb_build_array(v_b1, v_b2, v_b3),
      'matches_created', 6
    )
  );

  return jsonb_build_object(
    'pool_a', jsonb_build_array(v_a1, v_a2, v_a3),
    'pool_b', jsonb_build_array(v_b1, v_b2, v_b3),
    'matches_created', 6
  );
end;
$$;

grant execute on function public.generate_consolation_pools(uuid,text) to anon, authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- lock_e8_draw  (Girls Doubles)
-- 5 pairs → 5 teams + 10 RR matches. Composition must be 3x(U15+U11) + 2x(U15+U13).
-- ──────────────────────────────────────────────────────────────────────────
create or replace function public.lock_e8_draw(
  p_event_id   uuid,
  p_pairs      jsonb,            -- [{p1_id, p2_id}] length 5
  p_admin_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing       record;
  v_pair           jsonb;
  v_idx            int := 0;
  v_p1_id          uuid;
  v_p2_id          uuid;
  v_p1             record;
  v_p2             record;
  v_count_u15_u11  int := 0;
  v_count_u15_u13  int := 0;
  v_team_ids       uuid[] := array[]::uuid[];
  v_team_id        uuid;
  v_p1_dn          text;
  v_p2_dn          text;
  v_e8_pool_id     uuid;
  i int; j int;
begin
  if p_admin_name is null or length(trim(p_admin_name)) = 0 then
    raise exception 'INVALID_ADMIN_NAME: admin name required';
  end if;

  select * into v_existing
    from public.trigger_records
   where event_id = p_event_id and trigger_type = 'e8_draw';
  if v_existing.id is not null then
    raise exception 'DRAW_ALREADY_LOCKED: locked by % at %', v_existing.fired_by, v_existing.fired_at;
  end if;

  if jsonb_array_length(p_pairs) <> 5 then
    raise exception 'INVALID_PAIR_COUNT: expected 5 pairs, got %', jsonb_array_length(p_pairs);
  end if;

  -- Validate composition + create teams
  for v_pair in select * from jsonb_array_elements(p_pairs)
  loop
    v_idx := v_idx + 1;
    v_p1_id := (v_pair->>'p1_id')::uuid;
    v_p2_id := (v_pair->>'p2_id')::uuid;

    select * into v_p1 from public.players where id = v_p1_id;
    if not found then
      raise exception 'INVALID_PLAYER: pair % references unknown p1', v_idx;
    end if;
    select * into v_p2 from public.players where id = v_p2_id;
    if not found then
      raise exception 'INVALID_PLAYER: pair % references unknown p2', v_idx;
    end if;
    if v_p1.status = 'withdrawn' or v_p2.status = 'withdrawn' then
      raise exception 'WITHDRAWN_PLAYER: pair % includes withdrawn player', v_idx;
    end if;
    if v_p1.gender <> 'F' or v_p2.gender <> 'F' then
      raise exception 'INVALID_GENDER: pair % must be female players', v_idx;
    end if;

    if (v_p1.age_group = 'U15' and v_p2.age_group = 'U11') or
       (v_p1.age_group = 'U11' and v_p2.age_group = 'U15') then
      v_count_u15_u11 := v_count_u15_u11 + 1;
    elsif (v_p1.age_group = 'U15' and v_p2.age_group = 'U13') or
          (v_p1.age_group = 'U13' and v_p2.age_group = 'U15') then
      v_count_u15_u13 := v_count_u15_u13 + 1;
    else
      raise exception 'INVALID_COMPOSITION: pair % must be U15+U11 or U15+U13 (got %, %)',
        v_idx, v_p1.age_group, v_p2.age_group;
    end if;
  end loop;

  if v_count_u15_u11 <> 3 or v_count_u15_u13 <> 2 then
    raise exception 'INVALID_COMPOSITION: expected 3x U15+U11 and 2x U15+U13, got % and %',
      v_count_u15_u11, v_count_u15_u13;
  end if;

  -- Create teams
  v_idx := 0;
  for v_pair in select * from jsonb_array_elements(p_pairs)
  loop
    v_idx := v_idx + 1;
    v_p1_id := (v_pair->>'p1_id')::uuid;
    v_p2_id := (v_pair->>'p2_id')::uuid;
    select display_name into v_p1_dn from public.players where id = v_p1_id;
    select display_name into v_p2_dn from public.players where id = v_p2_id;

    insert into public.teams (event_id, player1_id, player2_id, display_name)
    values (p_event_id, v_p1_id, v_p2_id, v_p1_dn || ' & ' || v_p2_dn)
    returning id into v_team_id;
    v_team_ids := array_append(v_team_ids, v_team_id);
  end loop;

  -- Create Main pool for E8 standings (BracketsTab requires a pool row)
  insert into public.pools (event_id, label)
  values (p_event_id, 'Main')
  returning id into v_e8_pool_id;

  -- Insert pool entrants (all 5 teams)
  for i in 1..array_length(v_team_ids, 1) loop
    insert into public.pool_entrants (pool_id, entrant_id, entrant_type)
    values (v_e8_pool_id, v_team_ids[i], 'team');
  end loop;

  -- Generate 10 RR matches (all 5-choose-2 combinations)
  for i in 1..4 loop
    for j in (i+1)..5 loop
      insert into public.matches (
        event_id, round, bracket_slot,
        p1_ref, p2_ref,
        p1_id, p2_id, p1_type, p2_type,
        match_format, status, pool_id
      ) values (
        p_event_id, 'RR', format('RR.%s.%s', i, j),
        format('T%s', i), format('T%s', j),
        v_team_ids[i], v_team_ids[j], 'team', 'team',
        'set21', 'ready', v_e8_pool_id
      );
    end loop;
  end loop;

  update public.events set draw_locked = true, status = 'active' where id = p_event_id;

  insert into public.trigger_records (event_id, trigger_type, fired_by, payload)
  values (
    p_event_id, 'e8_draw', p_admin_name,
    jsonb_build_object('teams', to_jsonb(v_team_ids), 'matches_created', 10)
  );

  insert into public.audit_log (action_type, event_id, actor_name, payload)
  values (
    'trigger_e8_draw', p_event_id, p_admin_name,
    jsonb_build_object('teams', to_jsonb(v_team_ids), 'matches_created', 10)
  );

  return jsonb_build_object('teams_created', 5, 'matches_created', 10, 'team_ids', to_jsonb(v_team_ids));
end;
$$;

grant execute on function public.lock_e8_draw(uuid,jsonb,text) to anon, authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- publish_podium
-- ──────────────────────────────────────────────────────────────────────────
create or replace function public.publish_podium(
  p_event_id   uuid,
  p_admin_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_outstanding int;
  v_podium      record;
begin
  if p_admin_name is null or length(trim(p_admin_name)) = 0 then
    raise exception 'INVALID_ADMIN_NAME: admin name required';
  end if;

  select count(*) into v_outstanding
    from public.matches
   where event_id = p_event_id
     and status not in ('complete','walkover','retired');
  if v_outstanding > 0 then
    raise exception 'MATCHES_OUTSTANDING: % matches still in non-terminal state', v_outstanding;
  end if;

  select * into v_podium from public.podiums where event_id = p_event_id;
  if not found then
    raise exception 'NO_DRAFT_PODIUM: podium row missing for event %', p_event_id;
  end if;
  if v_podium.status = 'published' then
    raise exception 'ALREADY_PUBLISHED: podium for event % already published', p_event_id;
  end if;

  update public.podiums
     set status       = 'published',
         published_by = p_admin_name,
         published_at = now()
   where event_id = p_event_id;

  update public.events set status = 'published' where id = p_event_id;

  insert into public.trigger_records (event_id, trigger_type, fired_by)
  values (p_event_id, 'podium_publish', p_admin_name)
  on conflict (event_id, trigger_type) do nothing;

  insert into public.audit_log (action_type, event_id, actor_name, payload)
  values ('podium_published', p_event_id, p_admin_name, '{}'::jsonb);

  return jsonb_build_object('success', true);
end;
$$;

grant execute on function public.publish_podium(uuid,text) to anon, authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- unpublish_podium
-- ──────────────────────────────────────────────────────────────────────────
create or replace function public.unpublish_podium(
  p_event_id   uuid,
  p_admin_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_podium record;
begin
  if p_admin_name is null or length(trim(p_admin_name)) = 0 then
    raise exception 'INVALID_ADMIN_NAME: admin name required';
  end if;

  select * into v_podium from public.podiums where event_id = p_event_id;
  if not found or v_podium.status <> 'published' then
    raise exception 'PODIUM_NOT_PUBLISHED: nothing to unpublish for event %', p_event_id;
  end if;

  update public.podiums
     set status       = 'draft',
         published_by = null,
         published_at = null
   where event_id = p_event_id;

  update public.events set status = 'complete' where id = p_event_id;

  delete from public.trigger_records
   where event_id = p_event_id and trigger_type = 'podium_publish';

  insert into public.audit_log (action_type, event_id, actor_name, payload)
  values ('podium_unpublished', p_event_id, p_admin_name, '{}'::jsonb);

  return jsonb_build_object('success', true);
end;
$$;

grant execute on function public.unpublish_podium(uuid,text) to anon, authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- release_match
-- Return a wrongly-started in_progress match to ready status.
-- Only valid when no sets have been entered yet (escape hatch — no scores).
-- ──────────────────────────────────────────────────────────────────────────
create or replace function public.release_match(
  p_match_id   uuid,
  p_admin_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match     record;
  v_set_count int;
begin
  if p_admin_name is null or length(trim(p_admin_name)) = 0 then
    raise exception 'INVALID_ADMIN_NAME: admin name required';
  end if;

  select * into v_match from public.matches where id = p_match_id;
  if not found then
    raise exception 'MATCH_NOT_FOUND: %', p_match_id;
  end if;

  if v_match.status <> 'in_progress' then
    raise exception 'MATCH_NOT_IN_PROGRESS: status=%', v_match.status;
  end if;

  select count(*) into v_set_count from public.sets where match_id = p_match_id;
  if v_set_count > 0 then
    raise exception 'SETS_ALREADY_ENTERED: cannot release a match after scores have been saved';
  end if;

  update public.matches
     set status     = 'ready',
         court      = null,
         started_at = null,
         started_by = null
   where id = p_match_id;

  insert into public.audit_log (action_type, match_id, event_id, actor_name, payload)
  values (
    'match_released', p_match_id, v_match.event_id, p_admin_name,
    jsonb_build_object('reason', 'wrong_match_started')
  );

  return jsonb_build_object('success', true);
end;
$$;

grant execute on function public.release_match(uuid,text) to anon, authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- reset_tournament  (DEMO ONLY — gated at application level)
-- Wipes runtime data, restores matches to seeded state.
-- The "seeded state" is reconstructed by:
--   - Clearing all runtime artifacts
--   - Resetting matches.status: ready if both p1_id+p2_id resolved at seed,
--     else pending
--   - Clearing winner/score/court/edit_history
-- ──────────────────────────────────────────────────────────────────────────
create or replace function public.reset_tournament()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.sets;
  delete from public.audit_log;
  delete from public.trigger_records;
  delete from public.pool_entrants;
  delete from public.pools;
  delete from public.podiums;
  delete from public.teams;

  -- Drop runtime-created matches (BLP, E1 ConRR, ConF — plus anything with a pool_id).
  -- E8 RR matches are caught by pool_id is not null; second delete is a safety net.
  delete from public.matches where round in ('BLP','ConRR','ConF') or pool_id is not null;
  delete from public.matches m
   using public.events e
   where m.event_id = e.id and e.code = 'E8';

  -- Reset surviving (seeded) matches.
  update public.matches set
    status       = case
                     when p1_id is not null and p2_id is not null and round = 'R1' then 'ready'::match_status_t
                     when p1_id is not null and p2_id is not null then 'ready'::match_status_t
                     else 'pending'::match_status_t
                   end,
    score_sets   = '[]'::jsonb,
    winner_id    = null,
    winner_type  = null,
    court        = null,
    started_at   = null,
    completed_at = null,
    started_by   = null,
    entered_by   = null,
    edit_history = '[]'::jsonb,
    inconsistent = false;

  -- For non-R1 knockout slots the seeded state may have unresolved p1_id/p2_id
  -- (placeholders). Reset those too.
  update public.matches
     set p1_id = null, p1_type = null, p2_id = null, p2_type = null,
         status = 'pending'::match_status_t
   where round in ('QF','SF','F','3P');

  -- Reset event status: E1 active (always first), E8 pending until draw locked, others pending.
  update public.events set status = 'pending', draw_locked = false;
  update public.events set status = 'active' where code = 'E1';

  return jsonb_build_object('success', true);
end;
$$;

grant execute on function public.reset_tournament() to anon, authenticated;
