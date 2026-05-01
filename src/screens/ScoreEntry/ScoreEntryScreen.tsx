import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import AdminHeader from '../../components/AdminHeader';
import ConfirmModal from '../../components/ConfirmModal';
import CourtBadge from '../../components/CourtBadge';
import ErrorBanner from '../../components/ErrorBanner';
import FormatChip from '../../components/FormatChip';
import LoadingSkeleton from '../../components/LoadingSkeleton';
import ScoreInput from '../../components/ScoreInput';
import { getSession } from '../../lib/auth';
import { getDownstreamSlots } from '../../lib/bracketWiring';
import { isDemoMode, runSimulatedMatch, withDemoQuery } from '../../lib/demo';
import { supabase } from '../../lib/supabase';
import type {
  EntrantType,
  Event,
  Match,
  MatchFormat,
  MatchSet,
  MatchStatus,
  Player,
  Team,
} from '../../types';

interface ScoreEntryScreenProps {
  basePath: string;
  loginPath: string;
}

interface EntrantInfo {
  id: string;
  name: string;
  type: EntrantType | null;
  code: string | null;
}

interface DownstreamPayload {
  match_id: string;
  slot: 'p1' | 'p2';
}

type RecordType = 'walkover' | 'retired';
type SetNumber = 1 | 2 | 3;

function targetForFormat(format: MatchFormat): number {
  switch (format) {
    case 'set21':
      return 21;
    case 'set30':
      return 30;
    case 'best_of_3x15':
      return 15;
  }
}

function rpcErrorMessage(message: string | undefined, fallback: string): string {
  if (!message) return fallback;
  const stripped = message.replace(/^[A-Z_]+:\s*/, '').trim();
  return stripped || fallback;
}

function eventLabel(ev: Event | null, match: Match | null): string {
  if (!ev || !match) return '';
  const round = match.round;
  const roundLabel: Record<typeof round, string> = {
    R1: 'Round 1',
    RR: 'Round Robin',
    QF: 'Quarter Final',
    SF: 'Semi Final',
    F: 'Final',
    '3P': '3rd Place',
    BLP: 'Best Loser Playoff',
    ConRR: 'Consolation Pool',
    ConF: 'Consolation Final',
  };
  return `${ev.name} · ${roundLabel[round] ?? round}`;
}

function setWinnerSide(s: MatchSet | null): 'p1' | 'p2' | null {
  if (!s || !s.complete) return null;
  if (s.p1_score > s.p2_score) return 'p1';
  if (s.p2_score > s.p1_score) return 'p2';
  return null;
}

export default function ScoreEntryScreen({ basePath, loginPath }: ScoreEntryScreenProps) {
  const { matchId } = useParams<{ matchId: string }>();
  const navigate = useNavigate();
  const session = getSession();
  const adminName = session?.name ?? '';
  const isTopAdmin = session?.role === 'top_admin';

  const [match, setMatch] = useState<Match | null>(null);
  const [matchSets, setMatchSets] = useState<MatchSet[]>([]);
  const [event, setEvent] = useState<Event | null>(null);
  const [eventMatches, setEventMatches] = useState<Match[]>([]);
  const [p1, setP1] = useState<EntrantInfo | null>(null);
  const [p2, setP2] = useState<EntrantInfo | null>(null);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [completing, setCompleting] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);

  // Walkover / Retire modal
  const [showRecordModal, setShowRecordModal] = useState(false);
  const [recordType, setRecordType] = useState<RecordType>('walkover');
  const [recordWinnerSide, setRecordWinnerSide] = useState<'p1' | 'p2' | null>(null);
  const [includeRetireScores, setIncludeRetireScores] = useState(false);
  const [retP1, setRetP1] = useState<number | ''>('');
  const [retP2, setRetP2] = useState<number | ''>('');
  const [recording, setRecording] = useState(false);
  const [recordError, setRecordError] = useState<string | null>(null);

  // Release match (wrong match started, no scores yet)
  const [showReleaseModal, setShowReleaseModal] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const [releaseError, setReleaseError] = useState<string | null>(null);

  // Demo mode
  const demo = isDemoMode();
  const [simulating, setSimulating] = useState(false);
  const [simulateError, setSimulateError] = useState<string | null>(null);

  // Top Admin cascade-edit flow (BR-023, TA-01/TA-02).
  const [editMode, setEditMode] = useState(false);
  const [editP1S1, setEditP1S1] = useState<number | ''>('');
  const [editP2S1, setEditP2S1] = useState<number | ''>('');
  const [editP1S2, setEditP1S2] = useState<number | ''>('');
  const [editP2S2, setEditP2S2] = useState<number | ''>('');
  const [editP1S3, setEditP1S3] = useState<number | ''>('');
  const [editP2S3, setEditP2S3] = useState<number | ''>('');
  const [editValidationError, setEditValidationError] = useState<string | null>(null);
  const [cascadeError, setCascadeError] = useState<string | null>(null);
  const [cascadeSubmitting, setCascadeSubmitting] = useState(false);
  const [pendingCascade, setPendingCascade] = useState<{
    newScoreSets: { p1: number; p2: number; complete: boolean }[];
    winnerId: string;
    winnerType: EntrantType;
    downstreamUpdates: DownstreamPayload[];
    downstreamMatchIds: string[];
    affected: { id: string; label: string }[];
  } | null>(null);

  const fetchMatch = useCallback(async (): Promise<void> => {
    if (!matchId) throw new Error('No match id in URL');

    const matchRes = await supabase
      .from('matches')
      .select('*')
      .eq('id', matchId)
      .single();
    if (matchRes.error) throw matchRes.error;
    if (!matchRes.data) throw new Error('Match not found');
    const m = matchRes.data as Match;

    const [setsRes, eventRes, eventMatchesRes] = await Promise.all([
      supabase
        .from('sets')
        .select('*')
        .eq('match_id', matchId)
        .order('set_number', { ascending: true }),
      supabase.from('events').select('*').eq('id', m.event_id).single(),
      supabase.from('matches').select('*').eq('event_id', m.event_id),
    ]);
    if (setsRes.error) throw setsRes.error;
    if (eventRes.error) throw eventRes.error;
    if (eventMatchesRes.error) throw eventMatchesRes.error;

    const sets = (setsRes.data ?? []) as MatchSet[];
    const ev = eventRes.data as Event;
    const evMatches = (eventMatchesRes.data ?? []) as Match[];

    const playerIds = [m.p1_id, m.p2_id].filter(
      (id, idx) => !!id && (idx === 0 ? m.p1_type === 'player' : m.p2_type === 'player'),
    ) as string[];
    const teamIds = [m.p1_id, m.p2_id].filter(
      (id, idx) => !!id && (idx === 0 ? m.p1_type === 'team' : m.p2_type === 'team'),
    ) as string[];

    const [playersRes, teamsRes] = await Promise.all([
      playerIds.length
        ? supabase.from('players').select('*').in('id', playerIds)
        : Promise.resolve({ data: [] as Player[], error: null }),
      teamIds.length
        ? supabase.from('teams').select('*').in('id', teamIds)
        : Promise.resolve({ data: [] as Team[], error: null }),
    ]);
    if (playersRes.error) throw playersRes.error;
    if (teamsRes.error) throw teamsRes.error;
    const players = (playersRes.data ?? []) as Player[];
    const teams = (teamsRes.data ?? []) as Team[];

    function resolve(id: string | null, type: EntrantType | null, fallback: string): EntrantInfo {
      if (!id || !type) return { id: '', name: fallback || 'TBD', type: null, code: null };
      if (type === 'team') {
        const t = teams.find((tt) => tt.id === id);
        return { id, name: t?.display_name ?? fallback ?? 'TBD', type: 'team', code: null };
      }
      const pl = players.find((pp) => pp.id === id);
      return {
        id,
        name: pl?.display_name ?? fallback ?? 'TBD',
        type: 'player',
        code: pl?.code ?? null,
      };
    }

    setMatch(m);
    setMatchSets(sets);
    setEvent(ev);
    setEventMatches(evMatches);
    setP1(resolve(m.p1_id, m.p1_type, m.p1_ref));
    setP2(resolve(m.p2_id, m.p2_type, m.p2_ref));
  }, [matchId]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      await fetchMatch();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not load match';
      setLoadError(msg);
    } finally {
      setLoading(false);
    }
  }, [fetchMatch]);

  useEffect(() => {
    void load();
  }, [load]);

  const target = match ? targetForFormat(match.match_format) : 21;
  const isBestOf3 = match?.match_format === 'best_of_3x15';

  const set1 = useMemo(() => matchSets.find((s) => s.set_number === 1) ?? null, [matchSets]);
  const set2 = useMemo(() => matchSets.find((s) => s.set_number === 2) ?? null, [matchSets]);
  const set3 = useMemo(() => matchSets.find((s) => s.set_number === 3) ?? null, [matchSets]);

  // Set 3 renders only after Set 2 completes AND the two players have split sets 1-1.
  const showSet3 = useMemo(() => {
    if (!isBestOf3) return false;
    const w1 = setWinnerSide(set1);
    const w2 = setWinnerSide(set2);
    return !!w1 && !!w2 && w1 !== w2;
  }, [isBestOf3, set1, set2]);

  const matchTerminal = useMemo(() => {
    if (!match) return false;
    return match.status === 'complete' || match.status === 'walkover' || match.status === 'retired';
  }, [match]);

  // Per-set inline edit is reserved for the in_progress flow. Once a match is
  // complete, edits go through the Top Admin cascade-edit path instead so
  // downstream slots stay correct (BR-006, BR-023).
  const canEditSet = useMemo(() => {
    if (!match) return false;
    return match.status === 'in_progress';
  }, [match]);

  // Top Admin override on a completed match — gated by event-not-published
  // (BR-022). This drives the "Edit Result" button + cascade modal flow.
  const canCascadeEdit = useMemo(() => {
    if (!match || !isTopAdmin) return false;
    if (event?.status === 'published') return false;
    return match.status === 'complete';
  }, [match, isTopAdmin, event]);

  // Winner is derived from completed sets:
  // - set21 / set30: one set winner = match winner
  // - best_of_3x15: first player to 2 set wins
  const matchWinner = useMemo<{
    id: string;
    type: EntrantType;
    name: string;
    scoresText: string;
  } | null>(() => {
    if (!match) return null;
    if (!match.p1_id || !match.p2_id || !match.p1_type || !match.p2_type) return null;

    const completed = matchSets
      .filter((s) => s.complete)
      .sort((a, b) => a.set_number - b.set_number);
    const p1Wins = completed.filter((s) => s.p1_score > s.p2_score).length;
    const p2Wins = completed.filter((s) => s.p2_score > s.p1_score).length;

    let winnerSide: 'p1' | 'p2' | null = null;
    if (match.match_format === 'best_of_3x15') {
      if (p1Wins >= 2) winnerSide = 'p1';
      else if (p2Wins >= 2) winnerSide = 'p2';
    } else {
      if (p1Wins >= 1) winnerSide = 'p1';
      else if (p2Wins >= 1) winnerSide = 'p2';
    }
    if (!winnerSide) return null;

    const winnerId = winnerSide === 'p1' ? match.p1_id : match.p2_id;
    const winnerType = winnerSide === 'p1' ? match.p1_type : match.p2_type;
    const name = winnerSide === 'p1' ? p1?.name ?? '' : p2?.name ?? '';
    const scoresText = completed.map((s) => `${s.p1_score}–${s.p2_score}`).join(', ');
    return { id: winnerId, type: winnerType, name, scoresText };
  }, [match, matchSets, p1, p2]);

  const canMarkComplete = !!match && match.status === 'in_progress' && !!matchWinner;

  const handicapBannerText = useMemo(() => {
    if (!match?.handicap_applied) return null;
    if (!p1 || !p2) return null;
    // Only the players coded P1 / P2 (the two U13 girls) actually receive
    // the 3-0 head start (BR-015). The opponent does not.
    const recipients = [p1, p2].filter((e) => e.code === 'P1' || e.code === 'P2');
    if (recipients.length === 0) return null;
    const namesText =
      recipients.length === 2
        ? `${recipients[0].name} & ${recipients[1].name}`
        : recipients[0].name;
    const verb = recipients.length === 2 ? 'start' : 'starts';
    return `Handicap match — ${namesText} ${verb} each set at 3-0. Enter the FINAL score including the head start.`;
  }, [match, p1, p2]);

  function buildDownstreamForResult(result: 'winner' | 'loser'): DownstreamPayload[] {
    if (!match || !event) return [];
    const rules = getDownstreamSlots(event.code, match.bracket_slot, result);
    const updates: DownstreamPayload[] = [];
    for (const rule of rules) {
      // Only p1/p2 slot targets are resolvable here. Pool slots (slot1/slot2/
      // slot3) are filled by the consolation-pool RPC, not by this wiring.
      if (rule.targetSlot !== 'p1' && rule.targetSlot !== 'p2') continue;
      const targetMatch = eventMatches.find((em) => em.bracket_slot === rule.target);
      if (!targetMatch) continue;
      updates.push({ match_id: targetMatch.id, slot: rule.targetSlot });
    }
    return updates;
  }

  async function handleCompleteMatch() {
    if (!match || !matchWinner || completing) return;
    setCompleteError(null);
    setCompleting(true);
    try {
      const winnerDownstream = buildDownstreamForResult('winner');
      const loserDownstream = buildDownstreamForResult('loser');
      const { error: rpcError } = await supabase.rpc('complete_match', {
        p_match_id: match.id,
        p_winner_id: matchWinner.id,
        p_winner_type: matchWinner.type,
        p_admin_name: adminName,
        p_downstream_updates: winnerDownstream,
        p_loser_downstream_updates: loserDownstream,
      });
      if (rpcError) {
        setCompleteError(rpcErrorMessage(rpcError.message, 'Could not complete match'));
        return;
      }
      navigate(withDemoQuery(`${basePath}/picker`));
    } catch (caught) {
      const msg = caught instanceof Error ? caught.message : 'Could not complete match';
      setCompleteError(msg);
    } finally {
      setCompleting(false);
    }
  }

  async function handleRelease() {
    if (!match || releasing) return;
    setReleaseError(null);
    setReleasing(true);
    try {
      const { error: updateError } = await supabase
        .from('matches')
        .update({ status: 'ready', court: null })
        .eq('id', match.id)
        .eq('status', 'in_progress');
      if (updateError) throw updateError;
      await supabase.from('audit_log').insert({
        match_id: match.id,
        action_type: 'match_released',
        actor_name: adminName,
        payload: { reason: 'wrong_match_started' },
      });
      navigate(withDemoQuery(`${basePath}/picker`));
    } catch (err) {
      setReleaseError(err instanceof Error ? err.message : 'Could not release match');
      setReleasing(false);
    }
  }

  async function handleSimulate() {
    if (!match || !event || simulating) return;
    setSimulateError(null);
    setSimulating(true);
    try {
      await runSimulatedMatch({ match, eventCode: event.code, adminName });
      navigate(withDemoQuery(`${basePath}/picker`));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Simulation failed';
      setSimulateError(msg);
    } finally {
      setSimulating(false);
    }
  }

  function openRecordModal() {
    setRecordType('walkover');
    setRecordWinnerSide(null);
    setIncludeRetireScores(false);
    setRetP1('');
    setRetP2('');
    setRecordError(null);
    setShowRecordModal(true);
  }

  async function handleConfirmRecord() {
    if (!match || !recordWinnerSide || recording) return;
    setRecordError(null);

    const winnerEntrant = recordWinnerSide === 'p1' ? p1 : p2;
    const winnerId = recordWinnerSide === 'p1' ? match.p1_id : match.p2_id;
    const winnerType = recordWinnerSide === 'p1' ? match.p1_type : match.p2_type;
    if (!winnerId || !winnerType || !winnerEntrant) {
      setRecordError('Winner not resolved — cannot proceed.');
      return;
    }

    const winnerDownstream = buildDownstreamForResult('winner');
    const loserDownstream = buildDownstreamForResult('loser');

    setRecording(true);
    try {
      if (recordType === 'walkover') {
        const { error: rpcError } = await supabase.rpc('record_walkover', {
          p_match_id: match.id,
          p_winner_id: winnerId,
          p_winner_type: winnerType,
          p_admin_name: adminName,
          p_downstream_updates: winnerDownstream,
          p_loser_downstream_updates: loserDownstream,
        });
        if (rpcError) {
          setRecordError(rpcErrorMessage(rpcError.message, 'Could not record walkover'));
          return;
        }
      } else {
        let partialSets: { set_number: number; p1_score: number; p2_score: number; complete: boolean }[] | null = null;
        if (includeRetireScores && retP1 !== '' && retP2 !== '') {
          partialSets = [
            {
              set_number: 1,
              p1_score: retP1 as number,
              p2_score: retP2 as number,
              complete: false,
            },
          ];
        }
        const { error: rpcError } = await supabase.rpc('record_retirement', {
          p_match_id: match.id,
          p_winner_id: winnerId,
          p_winner_type: winnerType,
          p_partial_sets: partialSets,
          p_admin_name: adminName,
          p_downstream_updates: winnerDownstream,
          p_loser_downstream_updates: loserDownstream,
        });
        if (rpcError) {
          setRecordError(rpcErrorMessage(rpcError.message, 'Could not record retirement'));
          return;
        }
      }
      navigate(withDemoQuery(`${basePath}/picker`));
    } catch (caught) {
      const msg = caught instanceof Error ? caught.message : 'Could not record outcome';
      setRecordError(msg);
    } finally {
      setRecording(false);
    }
  }

  function handleStartEdit() {
    if (!match || !canCascadeEdit) return;
    const s1 = matchSets.find((s) => s.set_number === 1);
    const s2 = matchSets.find((s) => s.set_number === 2);
    const s3 = matchSets.find((s) => s.set_number === 3);
    setEditP1S1(s1?.p1_score ?? '');
    setEditP2S1(s1?.p2_score ?? '');
    setEditP1S2(s2?.p1_score ?? '');
    setEditP2S2(s2?.p2_score ?? '');
    setEditP1S3(s3?.p1_score ?? '');
    setEditP2S3(s3?.p2_score ?? '');
    setEditValidationError(null);
    setCascadeError(null);
    setEditMode(true);
  }

  function handleCancelEdit() {
    if (cascadeSubmitting) return;
    setEditMode(false);
    setEditValidationError(null);
    setCascadeError(null);
    setPendingCascade(null);
  }

  function validateSetPair(
    p1Val: number | '',
    p2Val: number | '',
    target: number,
    setLabel: string,
  ): string | null {
    if (p1Val === '' || p2Val === '') {
      return `${setLabel}: enter both scores. One player must reach ${target}.`;
    }
    if (p1Val < 0 || p2Val < 0) return `${setLabel}: scores cannot be negative.`;
    const p1IsTarget = p1Val === target;
    const p2IsTarget = p2Val === target;
    if (p1IsTarget && p2IsTarget) return `${setLabel}: only one player can reach ${target}.`;
    if (!p1IsTarget && !p2IsTarget) return `${setLabel}: one player must reach ${target}.`;
    const other = p1IsTarget ? p2Val : p1Val;
    if (other < 0 || other > target - 1) {
      return `${setLabel}: one player must reach ${target}. Other must be 0 to ${target - 1}.`;
    }
    return null;
  }

  // Validate the full edit form and compute the new winner. Returns null on
  // failure (with editValidationError set) or the payload to send to the RPC.
  function buildEditPayload():
    | {
        newScoreSets: { p1: number; p2: number; complete: boolean }[];
        winnerId: string;
        winnerType: EntrantType;
      }
    | null {
    if (!match || !p1 || !p2) return null;
    if (!match.p1_id || !match.p2_id || !match.p1_type || !match.p2_type) {
      setEditValidationError('Match opponents not resolved — cannot edit.');
      return null;
    }

    const s1Err = validateSetPair(editP1S1, editP2S1, target, 'Set 1');
    if (s1Err) {
      setEditValidationError(s1Err);
      return null;
    }
    const s1: { p1: number; p2: number; complete: boolean } = {
      p1: editP1S1 as number,
      p2: editP2S1 as number,
      complete: true,
    };

    if (!isBestOf3) {
      const winnerSide: 'p1' | 'p2' = s1.p1 > s1.p2 ? 'p1' : 'p2';
      const winnerId = winnerSide === 'p1' ? match.p1_id : match.p2_id;
      const winnerType = winnerSide === 'p1' ? match.p1_type : match.p2_type;
      return { newScoreSets: [s1], winnerId, winnerType };
    }

    // best_of_3x15
    const s2Err = validateSetPair(editP1S2, editP2S2, target, 'Set 2');
    if (s2Err) {
      setEditValidationError(s2Err);
      return null;
    }
    const s2: { p1: number; p2: number; complete: boolean } = {
      p1: editP1S2 as number,
      p2: editP2S2 as number,
      complete: true,
    };
    const s1Winner: 'p1' | 'p2' = s1.p1 > s1.p2 ? 'p1' : 'p2';
    const s2Winner: 'p1' | 'p2' = s2.p1 > s2.p2 ? 'p1' : 'p2';

    if (s1Winner === s2Winner) {
      // Match decided in two sets — set 3 not played.
      const winnerId = s1Winner === 'p1' ? match.p1_id : match.p2_id;
      const winnerType = s1Winner === 'p1' ? match.p1_type : match.p2_type;
      return { newScoreSets: [s1, s2], winnerId, winnerType };
    }

    // 1–1 split — set 3 required.
    const s3Err = validateSetPair(editP1S3, editP2S3, target, 'Set 3');
    if (s3Err) {
      setEditValidationError(s3Err);
      return null;
    }
    const s3: { p1: number; p2: number; complete: boolean } = {
      p1: editP1S3 as number,
      p2: editP2S3 as number,
      complete: true,
    };
    const s3Winner: 'p1' | 'p2' = s3.p1 > s3.p2 ? 'p1' : 'p2';
    const winnerId = s3Winner === 'p1' ? match.p1_id : match.p2_id;
    const winnerType = s3Winner === 'p1' ? match.p1_type : match.p2_type;
    return { newScoreSets: [s1, s2, s3], winnerId, winnerType };
  }

  function handleSaveEdit() {
    if (!match || !event || !p1 || !p2 || cascadeSubmitting) return;
    setEditValidationError(null);
    setCascadeError(null);

    const payload = buildEditPayload();
    if (!payload) return;

    // Winner-path downstream slots are the only path the cascade RPC can
    // re-resolve atomically (loser-path is a documented v1 limitation —
    // see BACKEND_DESIGN.md change log).
    const winnerDownstream = buildDownstreamForResult('winner');
    const affected = winnerDownstream
      .map((u) => {
        const m = eventMatches.find((em) => em.id === u.match_id);
        return m ? { id: m.id, label: m.bracket_slot } : null;
      })
      .filter((x): x is { id: string; label: string } => x !== null);

    const downstreamMatchIds = affected.map((a) => a.id);

    const cascadePayload = {
      newScoreSets: payload.newScoreSets,
      winnerId: payload.winnerId,
      winnerType: payload.winnerType,
      downstreamUpdates: winnerDownstream,
      downstreamMatchIds,
      affected,
    };

    if (affected.length === 0) {
      // No downstream — apply directly with cascade=true (no modal needed).
      void executeCascade(cascadePayload, true);
      return;
    }

    setPendingCascade(cascadePayload);
  }

  async function executeCascade(
    payload: NonNullable<typeof pendingCascade>,
    cascade: boolean,
  ) {
    if (!match || cascadeSubmitting) return;
    setCascadeError(null);
    setCascadeSubmitting(true);
    try {
      const { error: rpcError } = await supabase.rpc('cascade_edit_match', {
        p_match_id: match.id,
        p_new_score_sets: payload.newScoreSets,
        p_new_winner_id: payload.winnerId,
        p_new_winner_type: payload.winnerType,
        p_admin_name: adminName,
        p_cascade: cascade,
        p_downstream_match_ids: payload.downstreamMatchIds,
        p_downstream_updates: payload.downstreamUpdates,
      });
      if (rpcError) {
        const raw = rpcError.message ?? '';
        const fallback = raw.startsWith('EVENT_PUBLISHED')
          ? 'Unpublish the podium first to edit this match.'
          : 'Could not save changes';
        setCascadeError(rpcErrorMessage(raw, fallback));
        return;
      }
      await fetchMatch();
      setEditMode(false);
      setPendingCascade(null);
    } catch (caught) {
      const msg = caught instanceof Error ? caught.message : 'Could not save changes';
      setCascadeError(msg);
    } finally {
      setCascadeSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-navy text-white flex flex-col">
      <AdminHeader basePath={basePath} loginPath={loginPath} />

      <main className="flex-1 max-w-3xl w-full mx-auto px-4 py-6">
        <button
          type="button"
          onClick={() => navigate(withDemoQuery(`${basePath}/picker`))}
          className="inline-flex items-center gap-1 text-slate hover:text-gold-bright font-body text-sm mb-4 -ml-1 px-1 py-1"
          aria-label="Back to Match Picker"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-4 h-4"
            aria-hidden="true"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
          <span>Match Picker</span>
        </button>

        {loading ? (
          <LoadingSkeleton rows={4} height="4rem" />
        ) : loadError ? (
          <ErrorBanner message={loadError} onRetry={() => void load()} />
        ) : !match || !event || !p1 || !p2 ? (
          <ErrorBanner
            message="Match data unavailable"
            onRetry={() => void load()}
          />
        ) : (
          <>
            <header className="mb-4">
              <div className="flex items-center gap-2 flex-wrap mb-2">
                <FormatChip format={match.match_format} />
                {match.court && <CourtBadge court={match.court} />}
                {match.handicap_applied && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-body font-semibold bg-amber-warning/20 text-amber-warning">
                    ★ Handicap
                  </span>
                )}
                {match.inconsistent && (
                  <span
                    className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-body font-semibold bg-amber-warning/20 text-amber-warning"
                    title="Flagged as inconsistent — review and cascade if needed"
                  >
                    ⚠ Inconsistent
                  </span>
                )}
              </div>
              <h1 className="font-display text-2xl text-gold-bright leading-tight">
                {eventLabel(event, match)}
              </h1>
            </header>

            {handicapBannerText && (
              <div
                role="note"
                className="sticky top-0 z-10 -mx-4 px-4 py-3 mb-5 bg-amber-warning/15 border-y border-amber-warning/40 text-amber-warning font-body text-sm flex items-start gap-2"
              >
                <span aria-hidden="true" className="mt-0.5">★</span>
                <span>{handicapBannerText}</span>
              </div>
            )}

            {editMode ? (
              <CascadeEditForm
                target={target}
                isBestOf3={isBestOf3}
                p1Name={p1.name}
                p2Name={p2.name}
                p1S1={editP1S1}
                p2S1={editP2S1}
                p1S2={editP1S2}
                p2S2={editP2S2}
                p1S3={editP1S3}
                p2S3={editP2S3}
                onP1S1Change={(v) => {
                  setEditP1S1(v);
                  setEditValidationError(null);
                }}
                onP2S1Change={(v) => {
                  setEditP2S1(v);
                  setEditValidationError(null);
                }}
                onP1S2Change={(v) => {
                  setEditP1S2(v);
                  setEditValidationError(null);
                }}
                onP2S2Change={(v) => {
                  setEditP2S2(v);
                  setEditValidationError(null);
                }}
                onP1S3Change={(v) => {
                  setEditP1S3(v);
                  setEditValidationError(null);
                }}
                onP2S3Change={(v) => {
                  setEditP2S3(v);
                  setEditValidationError(null);
                }}
                validationError={editValidationError}
                cascadeError={cascadeError}
                submitting={cascadeSubmitting}
                onSave={handleSaveEdit}
                onCancel={handleCancelEdit}
              />
            ) : (
              <>
                <SetEntrySection
                  key={`set-1-${set1?.id ?? 'new'}`}
                  setNumber={1}
                  target={target}
                  existingSet={set1}
                  matchId={match.id}
                  matchStatus={match.status}
                  p1Name={p1.name}
                  p2Name={p2.name}
                  canEditSet={canEditSet}
                  adminName={adminName}
                  onAfterSubmit={fetchMatch}
                />

                {isBestOf3 && set1?.complete && (
                  <SetEntrySection
                    key={`set-2-${set2?.id ?? 'new'}`}
                    setNumber={2}
                    target={target}
                    existingSet={set2}
                    matchId={match.id}
                    matchStatus={match.status}
                    p1Name={p1.name}
                    p2Name={p2.name}
                    canEditSet={canEditSet}
                    adminName={adminName}
                    onAfterSubmit={fetchMatch}
                  />
                )}

                {showSet3 && (
                  <SetEntrySection
                    key={`set-3-${set3?.id ?? 'new'}`}
                    setNumber={3}
                    target={target}
                    existingSet={set3}
                    matchId={match.id}
                    matchStatus={match.status}
                    p1Name={p1.name}
                    p2Name={p2.name}
                    canEditSet={canEditSet}
                    adminName={adminName}
                    onAfterSubmit={fetchMatch}
                  />
                )}

                {match.status === 'in_progress' && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setCompleteError(null);
                        void handleCompleteMatch();
                      }}
                      disabled={!canMarkComplete || completing}
                      className="w-full h-12 rounded-md bg-gold text-navy-dark font-body font-semibold tracking-wide uppercase text-sm transition disabled:bg-navy-light disabled:text-slate disabled:cursor-not-allowed hover:bg-gold-bright"
                    >
                      {completing ? 'Completing…' : 'Mark Match Complete'}
                    </button>
                    {completeError && (
                      <div className="mt-2">
                        <ErrorBanner
                          message={completeError}
                          onRetry={() => {
                            setCompleteError(null);
                            void handleCompleteMatch();
                          }}
                        />
                      </div>
                    )}
                  </>
                )}

                {canCascadeEdit && (
                  <button
                    type="button"
                    onClick={handleStartEdit}
                    className="w-full h-12 rounded-md border border-gold/60 bg-navy-light/40 text-gold-bright font-body font-semibold tracking-wide uppercase text-sm transition hover:bg-navy-light hover:border-gold"
                  >
                    Edit Result
                  </button>
                )}

                {matchTerminal && !canCascadeEdit && (
                  <p className="text-center text-slate text-sm font-body mt-3">
                    Match {match.status}.{' '}
                    {event?.status === 'published'
                      ? 'Locked — unpublish the podium first.'
                      : 'Locked.'}
                  </p>
                )}

                {demo && match.status === 'in_progress' && (
                  <div className="mt-4">
                    <button
                      type="button"
                      onClick={() => void handleSimulate()}
                      disabled={simulating}
                      className="w-full h-11 rounded-md border border-amber-warning/60 bg-amber-warning/10 text-amber-warning font-body text-xs uppercase tracking-wider hover:bg-amber-warning/20 transition disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {simulating ? 'Simulating…' : 'Simulate Match (demo)'}
                    </button>
                    {simulateError && (
                      <div className="mt-3">
                        <ErrorBanner
                          message={simulateError}
                          onRetry={() => void handleSimulate()}
                        />
                      </div>
                    )}
                  </div>
                )}

                {match.status === 'in_progress' && (
                  <div className="text-center mt-6 space-y-3">
                    <button
                      type="button"
                      onClick={openRecordModal}
                      className="text-slate-light font-body text-sm hover:text-gold-bright underline-offset-4 hover:underline"
                    >
                      Walkover / Retire
                    </button>
                    {matchSets.length === 0 && (
                      <div>
                        <button
                          type="button"
                          onClick={() => {
                            setReleaseError(null);
                            setShowReleaseModal(true);
                          }}
                          className="text-slate font-body text-xs hover:text-amber-warning underline-offset-4 hover:underline"
                        >
                          ↩ Wrong match — release back to queue
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </main>

      {showRecordModal && match && p1 && p2 && (
        <RecordOutcomeModal
          recordType={recordType}
          onTypeChange={setRecordType}
          winnerSide={recordWinnerSide}
          onWinnerChange={setRecordWinnerSide}
          p1Name={p1.name}
          p2Name={p2.name}
          includeRetireScores={includeRetireScores}
          onIncludeRetireScoresChange={setIncludeRetireScores}
          retP1={retP1}
          retP2={retP2}
          onRetP1Change={setRetP1}
          onRetP2Change={setRetP2}
          recording={recording}
          recordError={recordError}
          onConfirm={() => void handleConfirmRecord()}
          onCancel={() => {
            if (recording) return;
            setShowRecordModal(false);
            setRecordError(null);
          }}
        />
      )}

      {showReleaseModal && (
        <ConfirmModal
          title="Release match?"
          body={
            <>
              <p>This returns the match to the Ready queue so another admin can start it on the correct court.</p>
              {releaseError && (
                <div className="mt-3">
                  <ErrorBanner message={releaseError} onRetry={() => void handleRelease()} />
                </div>
              )}
            </>
          }
          confirmLabel={releasing ? 'Releasing…' : 'Release match'}
          cancelLabel="Keep going"
          onConfirm={() => void handleRelease()}
          onCancel={() => {
            if (releasing) return;
            setShowReleaseModal(false);
            setReleaseError(null);
          }}
          variant="destructive"
        />
      )}

      {pendingCascade && (
        <CascadeChoiceModal
          affected={pendingCascade.affected}
          submitting={cascadeSubmitting}
          error={cascadeError}
          onCascade={() => void executeCascade(pendingCascade, true)}
          onLeave={() => void executeCascade(pendingCascade, false)}
          onCancel={() => {
            if (cascadeSubmitting) return;
            setPendingCascade(null);
            setCascadeError(null);
          }}
        />
      )}
    </div>
  );
}

interface SetEntrySectionProps {
  setNumber: SetNumber;
  target: number;
  existingSet: MatchSet | null;
  matchId: string;
  matchStatus: MatchStatus;
  p1Name: string;
  p2Name: string;
  canEditSet: boolean;
  adminName: string;
  onAfterSubmit: () => Promise<void>;
}

function SetEntrySection({
  setNumber,
  target,
  existingSet,
  matchId,
  matchStatus,
  p1Name,
  p2Name,
  canEditSet,
  adminName,
  onAfterSubmit,
}: SetEntrySectionProps) {
  const [p1Input, setP1Input] = useState<number | ''>(existingSet?.p1_score ?? '');
  const [p2Input, setP2Input] = useState<number | ''>(existingSet?.p2_score ?? '');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = matchStatus === 'in_progress' && canEditSet;
  const saved = existingSet?.complete ?? false;

  function validateSet(p1Val: number | '', p2Val: number | ''): string | null {
    if (p1Val === '' || p2Val === '') {
      return `Enter both scores. One player must reach ${target}.`;
    }
    if (p1Val < 0 || p2Val < 0) return 'Scores cannot be negative.';
    const p1IsTarget = p1Val === target;
    const p2IsTarget = p2Val === target;
    if (p1IsTarget && p2IsTarget) return `Only one player can reach ${target}.`;
    if (!p1IsTarget && !p2IsTarget) return `One player must reach ${target}. Other must be lower.`;
    const other = p1IsTarget ? p2Val : p1Val;
    if (other < 0 || other > target - 1) {
      return `One player must reach ${target}. Other must be 0 to ${target - 1}.`;
    }
    return null;
  }

  async function handleSubmit() {
    if (submitting || !canSubmit) return;
    setValidationError(null);
    setSubmitError(null);
    const err = validateSet(p1Input, p2Input);
    if (err) {
      setValidationError(err);
      return;
    }
    setSubmitting(true);
    try {
      const { error: rpcError } = await supabase.rpc('submit_set', {
        p_match_id: matchId,
        p_set_number: setNumber,
        p_p1_score: p1Input as number,
        p_p2_score: p2Input as number,
        p_admin_name: adminName,
      });
      if (rpcError) {
        setSubmitError(rpcErrorMessage(rpcError.message, 'Score could not be saved'));
        return;
      }
      await onAfterSubmit();
    } catch (caught) {
      const msg = caught instanceof Error ? caught.message : 'Score could not be saved';
      setSubmitError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="rounded-lg bg-navy-light/60 border border-navy-light p-4 mb-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-body text-xs uppercase tracking-[0.2em] text-slate">
          Set {setNumber} · First to {target}
        </h2>
        {saved && (
          <span className="text-xs font-body font-semibold text-emerald-400">✓ Saved</span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 items-end">
        <ScoreInput
          value={p1Input}
          onChange={(v) => { setP1Input(v); setValidationError(null); }}
          playerName={p1Name}
          disabled={!canSubmit || submitting}
        />
        <ScoreInput
          value={p2Input}
          onChange={(v) => { setP2Input(v); setValidationError(null); }}
          playerName={p2Name}
          disabled={!canSubmit || submitting}
        />
      </div>

      {validationError && (
        <p role="alert" className="mt-3 text-sm text-error font-body">
          {validationError}
        </p>
      )}

      {canSubmit && (
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={submitting}
          className="mt-4 w-full h-11 rounded-md bg-gold text-navy-dark font-body font-semibold tracking-wide uppercase text-sm transition disabled:bg-navy-light disabled:text-slate disabled:cursor-not-allowed hover:bg-gold-bright"
        >
          {submitting ? 'Saving…' : saved ? 'Update Score' : 'Save Set'}
        </button>
      )}

      {submitError && (
        <div className="mt-3">
          <ErrorBanner message={submitError} onRetry={() => void handleSubmit()} />
        </div>
      )}
    </section>
  );
}

interface RecordOutcomeModalProps {
  recordType: RecordType;
  onTypeChange: (t: RecordType) => void;
  winnerSide: 'p1' | 'p2' | null;
  onWinnerChange: (side: 'p1' | 'p2') => void;
  p1Name: string;
  p2Name: string;
  includeRetireScores: boolean;
  onIncludeRetireScoresChange: (v: boolean) => void;
  retP1: number | '';
  retP2: number | '';
  onRetP1Change: (v: number | '') => void;
  onRetP2Change: (v: number | '') => void;
  recording: boolean;
  recordError: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

function RecordOutcomeModal({
  recordType,
  onTypeChange,
  winnerSide,
  onWinnerChange,
  p1Name,
  p2Name,
  includeRetireScores,
  onIncludeRetireScoresChange,
  retP1,
  retP2,
  onRetP1Change,
  onRetP2Change,
  recording,
  recordError,
  onConfirm,
  onCancel,
}: RecordOutcomeModalProps) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onCancel]);

  const canConfirm = !!winnerSide && !recording;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="record-outcome-title"
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
    >
      <div
        className="absolute inset-0 bg-navy-dark/80 backdrop-blur-sm"
        onClick={onCancel}
        aria-hidden="true"
      />
      <div className="relative w-full max-w-md bg-navy-light border border-navy-light rounded-xl shadow-2xl p-6 animate-slide-up-fade">
        <h2
          id="record-outcome-title"
          className="font-display text-xl text-gold-bright mb-4"
        >
          Walkover / Retire
        </h2>

        <fieldset className="mb-4">
          <legend className="font-body text-xs uppercase tracking-[0.2em] text-slate mb-2">
            Type
          </legend>
          <div className="grid grid-cols-2 gap-2">
            <label
              className={`block rounded-md border px-3 py-2 cursor-pointer text-sm font-body transition ${
                recordType === 'walkover'
                  ? 'bg-gold/10 border-gold text-white'
                  : 'bg-navy-dark/40 border-navy-dark text-slate-light hover:border-gold/40'
              }`}
            >
              <input
                type="radio"
                name="record-type"
                value="walkover"
                checked={recordType === 'walkover'}
                onChange={() => onTypeChange('walkover')}
                className="sr-only"
              />
              <span className="block font-semibold">Walkover</span>
              <span className="block text-xs text-slate">Opponent didn’t show</span>
            </label>
            <label
              className={`block rounded-md border px-3 py-2 cursor-pointer text-sm font-body transition ${
                recordType === 'retired'
                  ? 'bg-gold/10 border-gold text-white'
                  : 'bg-navy-dark/40 border-navy-dark text-slate-light hover:border-gold/40'
              }`}
            >
              <input
                type="radio"
                name="record-type"
                value="retired"
                checked={recordType === 'retired'}
                onChange={() => onTypeChange('retired')}
                className="sr-only"
              />
              <span className="block font-semibold">Retired</span>
              <span className="block text-xs text-slate">Opponent withdrew</span>
            </label>
          </div>
        </fieldset>

        <fieldset className="mb-4">
          <legend className="font-body text-xs uppercase tracking-[0.2em] text-slate mb-2">
            Winner
          </legend>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => onWinnerChange('p1')}
              className={`rounded-md border px-3 py-2.5 text-sm font-body transition min-h-[44px] ${
                winnerSide === 'p1'
                  ? 'bg-gold text-navy-dark border-gold font-semibold'
                  : 'bg-navy-dark/40 border-navy-dark text-slate-light hover:border-gold/40'
              }`}
            >
              {p1Name} wins
            </button>
            <button
              type="button"
              onClick={() => onWinnerChange('p2')}
              className={`rounded-md border px-3 py-2.5 text-sm font-body transition min-h-[44px] ${
                winnerSide === 'p2'
                  ? 'bg-gold text-navy-dark border-gold font-semibold'
                  : 'bg-navy-dark/40 border-navy-dark text-slate-light hover:border-gold/40'
              }`}
            >
              {p2Name} wins
            </button>
          </div>
        </fieldset>

        {recordType === 'retired' && (
          <fieldset className="mb-4">
            <label className="flex items-center gap-2 font-body text-sm text-slate-light cursor-pointer mb-2">
              <input
                type="checkbox"
                checked={includeRetireScores}
                onChange={(e) => onIncludeRetireScoresChange(e.target.checked)}
                className="w-4 h-4 accent-gold"
              />
              Save last-known Set 1 scores
            </label>
            {includeRetireScores && (
              <div className="grid grid-cols-2 gap-3 mt-2">
                <ScoreInput
                  value={retP1}
                  onChange={onRetP1Change}
                  playerName={p1Name}
                  ariaLabel={`${p1Name} retired score`}
                />
                <ScoreInput
                  value={retP2}
                  onChange={onRetP2Change}
                  playerName={p2Name}
                  ariaLabel={`${p2Name} retired score`}
                />
              </div>
            )}
          </fieldset>
        )}

        {recordError && (
          <div className="mb-3">
            <ErrorBanner message={recordError} onRetry={onConfirm} />
          </div>
        )}

        <div className="flex flex-col-reverse sm:flex-row gap-3 sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={recording}
            className="px-4 py-2.5 rounded-md bg-navy-dark text-white font-body font-medium hover:bg-navy transition-colors min-h-[44px] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!canConfirm}
            className="px-4 py-2.5 rounded-md bg-amber-warning text-navy-dark font-body font-semibold transition-colors min-h-[44px] hover:bg-amber-warning/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {recording ? 'Saving…' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}

interface CascadeEditFormProps {
  target: number;
  isBestOf3: boolean;
  p1Name: string;
  p2Name: string;
  p1S1: number | '';
  p2S1: number | '';
  p1S2: number | '';
  p2S2: number | '';
  p1S3: number | '';
  p2S3: number | '';
  onP1S1Change: (v: number | '') => void;
  onP2S1Change: (v: number | '') => void;
  onP1S2Change: (v: number | '') => void;
  onP2S2Change: (v: number | '') => void;
  onP1S3Change: (v: number | '') => void;
  onP2S3Change: (v: number | '') => void;
  validationError: string | null;
  cascadeError: string | null;
  submitting: boolean;
  onSave: () => void;
  onCancel: () => void;
}

function CascadeEditForm({
  target,
  isBestOf3,
  p1Name,
  p2Name,
  p1S1,
  p2S1,
  p1S2,
  p2S2,
  p1S3,
  p2S3,
  onP1S1Change,
  onP2S1Change,
  onP1S2Change,
  onP2S2Change,
  onP1S3Change,
  onP2S3Change,
  validationError,
  cascadeError,
  submitting,
  onSave,
  onCancel,
}: CascadeEditFormProps) {
  // Set 3 input is shown only when sets 1 and 2 split 1-1 in the current
  // edits. Mirrors the in_progress flow's BR-013 behaviour.
  const showSet3Input = useMemo(() => {
    if (!isBestOf3) return false;
    if (p1S1 === '' || p2S1 === '' || p1S2 === '' || p2S2 === '') return false;
    const s1Winner = (p1S1 as number) > (p2S1 as number) ? 'p1' : 'p2';
    const s2Winner = (p1S2 as number) > (p2S2 as number) ? 'p1' : 'p2';
    return s1Winner !== s2Winner;
  }, [isBestOf3, p1S1, p2S1, p1S2, p2S2]);

  return (
    <section className="rounded-lg bg-navy-light/60 border border-gold/40 p-4 mb-5">
      <h2 className="font-body text-xs uppercase tracking-[0.2em] text-gold-bright mb-4">
        Editing Result
      </h2>

      <div className="rounded-md bg-navy-light/60 border border-navy-light p-4 mb-3">
        <p className="font-body text-xs uppercase tracking-[0.2em] text-slate mb-3">
          Set 1 · First to {target}
        </p>
        <div className="grid grid-cols-2 gap-4">
          <ScoreInput
            value={p1S1}
            onChange={onP1S1Change}
            playerName={p1Name}
            disabled={submitting}
          />
          <ScoreInput
            value={p2S1}
            onChange={onP2S1Change}
            playerName={p2Name}
            disabled={submitting}
          />
        </div>
      </div>

      {isBestOf3 && (
        <div className="rounded-md bg-navy-light/60 border border-navy-light p-4 mb-3">
          <p className="font-body text-xs uppercase tracking-[0.2em] text-slate mb-3">
            Set 2 · First to {target}
          </p>
          <div className="grid grid-cols-2 gap-4">
            <ScoreInput
              value={p1S2}
              onChange={onP1S2Change}
              playerName={p1Name}
              disabled={submitting}
            />
            <ScoreInput
              value={p2S2}
              onChange={onP2S2Change}
              playerName={p2Name}
              disabled={submitting}
            />
          </div>
        </div>
      )}

      {showSet3Input && (
        <div className="rounded-md bg-navy-light/60 border border-navy-light p-4 mb-3">
          <p className="font-body text-xs uppercase tracking-[0.2em] text-slate mb-3">
            Set 3 · First to {target}
          </p>
          <div className="grid grid-cols-2 gap-4">
            <ScoreInput
              value={p1S3}
              onChange={onP1S3Change}
              playerName={p1Name}
              disabled={submitting}
            />
            <ScoreInput
              value={p2S3}
              onChange={onP2S3Change}
              playerName={p2Name}
              disabled={submitting}
            />
          </div>
        </div>
      )}

      {validationError && (
        <p role="alert" className="mt-2 mb-2 text-sm text-error font-body">
          {validationError}
        </p>
      )}

      {cascadeError && (
        <div className="mt-2 mb-2">
          <ErrorBanner message={cascadeError} onRetry={onSave} />
        </div>
      )}

      <div className="flex flex-col-reverse sm:flex-row gap-3 mt-4">
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="flex-1 h-11 rounded-md bg-navy-dark text-white font-body font-medium hover:bg-navy transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={submitting}
          className="flex-1 h-11 rounded-md bg-gold text-navy-dark font-body font-semibold tracking-wide uppercase text-sm transition disabled:bg-navy-light disabled:text-slate disabled:cursor-not-allowed hover:bg-gold-bright"
        >
          {submitting ? 'Saving…' : 'Save Changes'}
        </button>
      </div>
    </section>
  );
}

interface CascadeChoiceModalProps {
  affected: { id: string; label: string }[];
  submitting: boolean;
  error: string | null;
  onCascade: () => void;
  onLeave: () => void;
  onCancel: () => void;
}

function CascadeChoiceModal({
  affected,
  submitting,
  error,
  onCascade,
  onLeave,
  onCancel,
}: CascadeChoiceModalProps) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !submitting) onCancel();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onCancel, submitting]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cascade-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
    >
      <div
        className="absolute inset-0 bg-navy-dark/80 backdrop-blur-sm"
        onClick={() => {
          if (!submitting) onCancel();
        }}
        aria-hidden="true"
      />
      <div className="relative w-full max-w-md bg-navy-light border border-navy-light rounded-xl shadow-2xl p-6 animate-slide-up-fade">
        <h2
          id="cascade-modal-title"
          className="font-display text-xl text-gold-bright mb-3"
        >
          Changing this result affects:
        </h2>
        <ul className="font-body text-sm text-white mb-4 space-y-1.5">
          {affected.map((m) => (
            <li
              key={m.id}
              className="flex items-center gap-2 px-3 py-2 rounded bg-navy-dark/40 border border-navy-dark"
            >
              <span className="text-slate text-xs uppercase tracking-wider">·</span>
              <span>{m.label}</span>
            </li>
          ))}
        </ul>

        <p className="font-body text-xs text-slate mb-4">
          Cascade resets these matches to ready and re-resolves them with the
          new winner. Flag leaves them in place but marks them as inconsistent.
        </p>

        {error && (
          <div className="mb-3">
            <ErrorBanner message={error} onRetry={onCascade} />
          </div>
        )}

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={onCascade}
            disabled={submitting}
            className="w-full h-11 rounded-md bg-gold text-navy-dark font-body font-semibold transition hover:bg-gold-bright disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Saving…' : 'Cascade changes'}
          </button>
          <button
            type="button"
            onClick={onLeave}
            disabled={submitting}
            className="w-full h-11 rounded-md bg-amber-warning/90 text-navy-dark font-body font-semibold transition hover:bg-amber-warning disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Flag as inconsistent
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="w-full h-11 rounded-md bg-navy-dark text-white font-body font-medium hover:bg-navy transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
