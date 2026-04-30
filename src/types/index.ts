// TypeScript interfaces for all DB entities.
// Field names mirror docs/BACKEND_DESIGN.md exactly — wrong names cause silent failures.

export type AgeGroup = 'U11' | 'U13' | 'U15';
export type AgeGroupOrMixed = AgeGroup | 'mixed';
export type Gender = 'M' | 'F';
export type GenderOrMixed = Gender | 'mixed';
export type ActiveStatus = 'active' | 'withdrawn';

export type EntrantType = 'player' | 'team';

export type EventStatus = 'pending' | 'active' | 'complete' | 'published';
export type EventFormatType = 'knockout' | 'rr' | 'hybrid';
export type CourtPool = 'boys' | 'girls' | 'any';

export type MatchStatus =
  | 'pending'
  | 'ready'
  | 'in_progress'
  | 'complete'
  | 'walkover'
  | 'retired';

export type MatchFormat = 'set21' | 'set30' | 'best_of_3x15';

export type MatchRound =
  | 'R1'
  | 'QF'
  | 'SF'
  | 'F'
  | '3P'
  | 'BLP'
  | 'ConRR'
  | 'ConF';

export type PodiumStatus = 'draft' | 'published';

export type TriggerType = 'blp' | 'consolation_pools' | 'e8_draw' | 'podium_publish';

export type AuditActionType =
  | 'match_started'
  | 'set_entered'
  | 'set_edited'
  | 'match_completed'
  | 'match_walkover'
  | 'match_retired'
  | 'match_cascaded'
  | 'match_inconsistent_flagged'
  | 'trigger_blp'
  | 'trigger_consolation_pools'
  | 'trigger_e8_draw'
  | 'podium_drafted'
  | 'podium_published'
  | 'podium_unpublished';

// ─────────────────────────────────────────────────────────────────────────────
// Entities
// ─────────────────────────────────────────────────────────────────────────────

export interface Player {
  id: string;
  code: string;
  full_name: string;
  first_name: string;
  middle_name: string | null;
  last_name: string | null;
  display_name: string;
  age_group: AgeGroup;
  gender: Gender;
  status: ActiveStatus;
  created_at: string;
}

export interface Team {
  id: string;
  event_id: string;
  player1_id: string;
  player2_id: string;
  display_name: string;
  status: ActiveStatus;
  created_at: string;
}

export interface Event {
  id: string;
  code: string;
  name: string;
  format_type: EventFormatType;
  gender: GenderOrMixed;
  age_group: AgeGroupOrMixed;
  status: EventStatus;
  depends_on: string[];
  court_pool: CourtPool;
  handicap_rule: string | null;
  draw_locked: boolean;
  created_at: string;
}

export interface ScoreSetSnapshot {
  p1: number;
  p2: number;
  complete: boolean;
}

export interface MatchEditHistoryEntry {
  actor: string;
  timestamp: string;
  before: unknown;
  after: unknown;
}

export interface Match {
  id: string;
  event_id: string;
  round: MatchRound;
  bracket_slot: string;
  pool_id: string | null;
  court: string | null;
  p1_ref: string;
  p2_ref: string;
  p1_id: string | null;
  p2_id: string | null;
  p1_type: EntrantType | null;
  p2_type: EntrantType | null;
  score_sets: ScoreSetSnapshot[];
  winner_id: string | null;
  winner_type: EntrantType | null;
  match_format: MatchFormat;
  handicap_applied: boolean;
  status: MatchStatus;
  inconsistent: boolean;
  started_at: string | null;
  completed_at: string | null;
  started_by: string | null;
  entered_by: string | null;
  edit_history: MatchEditHistoryEntry[];
  created_at: string;
}

export interface MatchSet {
  id: string;
  match_id: string;
  set_number: 1 | 2 | 3;
  p1_score: number;
  p2_score: number;
  target_score: 15 | 21 | 30;
  complete: boolean;
  created_at: string;
  updated_at: string;
}

export type PoolLabel = 'A' | 'B' | 'Main';

export interface Pool {
  id: string;
  event_id: string;
  label: PoolLabel;
  created_at: string;
}

export interface PoolEntrant {
  id: string;
  pool_id: string;
  entrant_id: string;
  entrant_type: EntrantType;
  created_at: string;
}

export interface Podium {
  id: string;
  event_id: string;
  gold_id: string | null;
  silver_id: string | null;
  bronze_id: string | null;
  consolation_winner_id: string | null;
  gold_type: EntrantType | null;
  silver_type: EntrantType | null;
  bronze_type: EntrantType | null;
  status: PodiumStatus;
  published_by: string | null;
  published_at: string | null;
  created_at: string;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  action_type: AuditActionType;
  match_id: string | null;
  event_id: string | null;
  actor_name: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface TriggerRecord {
  id: string;
  event_id: string;
  trigger_type: TriggerType;
  fired_by: string;
  fired_at: string;
  payload: Record<string, unknown> | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth (client-only — no DB user table)
// ─────────────────────────────────────────────────────────────────────────────

export type AdminRole = 'court_admin' | 'top_admin';

export interface AdminSession {
  role: AdminRole;
  name: string;
}
