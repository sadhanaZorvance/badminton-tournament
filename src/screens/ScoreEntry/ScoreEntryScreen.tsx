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

  // Mark Complete modal
  const [showCompleteModal, setShowCompleteModal] = useState(false);
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

  // Demo mode
  const demo = isDemoMode();
  const [simulating, setSimulating] = useState(false);
  const [simulateError, setSimulateError] = useState<string | null>(null);

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

  // Court Admin: edit available while match is in_progress only.
  // Top Admin: edit available while event is not published (covers complete/in_progress).
  const canEditSet = useMemo(() => {
    if (!match) return false;
    if (match.status === 'in_progress') return true;
    if (isTopAdmin && match.status === 'complete' && event?.status !== 'published') return true;
    return false;
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

  async function handleConfirmComplete() {
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

            {completeError && (
              <ErrorBanner
                message={completeError}
                onRetry={() => setCompleteError(null)}
              />
            )}

            <button
              type="button"
              onClick={() => {
                setCompleteError(null);
                setShowCompleteModal(true);
              }}
              disabled={!canMarkComplete}
              className="w-full h-12 rounded-md bg-gold text-navy-dark font-body font-semibold tracking-wide uppercase text-sm transition disabled:bg-navy-light disabled:text-slate disabled:cursor-not-allowed hover:bg-gold-bright"
            >
              Mark Match Complete
            </button>

            {matchTerminal && (
              <p className="text-center text-slate text-sm font-body mt-3">
                Match {match.status}. {isTopAdmin ? 'Use Event Control to edit.' : 'Locked.'}
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

            <div className="text-center mt-6">
              <button
                type="button"
                onClick={openRecordModal}
                disabled={matchTerminal}
                className="text-slate-light font-body text-sm hover:text-gold-bright underline-offset-4 hover:underline disabled:text-slate disabled:no-underline disabled:cursor-not-allowed"
              >
                Walkover / Retire
              </button>
            </div>
          </>
        )}
      </main>

      {showCompleteModal && matchWinner && (
        <ConfirmModal
          title={`${matchWinner.name} wins`}
          body={
            <>
              <p className="font-display text-xl text-gold-bright tabular-nums mb-2">
                {matchWinner.scoresText}
              </p>
              <p>This will lock the match and advance the bracket.</p>
              {completeError && (
                <div className="mt-3">
                  <ErrorBanner
                    message={completeError}
                    onRetry={() => void handleConfirmComplete()}
                  />
                </div>
              )}
            </>
          }
          confirmLabel={completing ? 'Completing…' : 'Confirm'}
          cancelLabel="Cancel"
          onConfirm={() => void handleConfirmComplete()}
          onCancel={() => {
            if (completing) return;
            setShowCompleteModal(false);
            setCompleteError(null);
          }}
        />
      )}

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
  const [editing, setEditing] = useState(!existingSet || !existingSet.complete);
  const [p1Input, setP1Input] = useState<number | ''>(existingSet?.p1_score ?? '');
  const [p2Input, setP2Input] = useState<number | ''>(existingSet?.p2_score ?? '');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Only allow score-edit interactions while the parent match is editable.
  const canSubmit = matchStatus === 'in_progress' || (canEditSet && matchStatus === 'complete');

  function validateSet(p1Val: number | '', p2Val: number | ''): string | null {
    if (p1Val === '' || p2Val === '') {
      return `Enter both scores. One player must reach ${target}.`;
    }
    if (p1Val < 0 || p2Val < 0) return 'Scores cannot be negative.';
    const p1IsTarget = p1Val === target;
    const p2IsTarget = p2Val === target;
    if (p1IsTarget && p2IsTarget) {
      return `Only one player can reach ${target}.`;
    }
    if (!p1IsTarget && !p2IsTarget) {
      return `One player must reach ${target}. Other must be lower.`;
    }
    const other = p1IsTarget ? p2Val : p1Val;
    if (other < 0 || other > target - 1) {
      return `One player must reach ${target}. Other must be 0 to ${target - 1}.`;
    }
    return null;
  }

  function handleStartEdit() {
    if (!existingSet) return;
    setP1Input(existingSet.p1_score);
    setP2Input(existingSet.p2_score);
    setEditing(true);
    setValidationError(null);
    setSubmitError(null);
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
    const p1Val = p1Input as number;
    const p2Val = p2Input as number;
    setSubmitting(true);
    try {
      const { error: rpcError } = await supabase.rpc('submit_set', {
        p_match_id: matchId,
        p_set_number: setNumber,
        p_p1_score: p1Val,
        p_p2_score: p2Val,
        p_admin_name: adminName,
      });
      if (rpcError) {
        setSubmitError(rpcErrorMessage(rpcError.message, 'Score could not be saved'));
        return;
      }
      await onAfterSubmit();
      setEditing(false);
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
        {existingSet?.complete && !editing && canEditSet && (
          <button
            type="button"
            onClick={handleStartEdit}
            className="text-gold-bright hover:text-gold text-sm font-body underline-offset-4 hover:underline px-1 py-1"
          >
            Edit
          </button>
        )}
      </div>

      {editing ? (
        <>
          <div className="grid grid-cols-2 gap-4 items-end">
            <ScoreInput
              value={p1Input}
              onChange={(v) => {
                setP1Input(v);
                setValidationError(null);
              }}
              playerName={p1Name}
              disabled={submitting}
            />
            <ScoreInput
              value={p2Input}
              onChange={(v) => {
                setP2Input(v);
                setValidationError(null);
              }}
              playerName={p2Name}
              disabled={submitting}
            />
          </div>

          {validationError && (
            <p
              role="alert"
              className="mt-3 text-sm text-error font-body"
            >
              {validationError}
            </p>
          )}

          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={submitting || !canSubmit}
            className="mt-4 w-full h-11 rounded-md bg-gold text-navy-dark font-body font-semibold tracking-wide uppercase text-sm transition disabled:bg-navy-light disabled:text-slate disabled:cursor-not-allowed hover:bg-gold-bright"
          >
            {submitting ? 'Saving…' : 'Submit Set'}
          </button>

          {submitError && (
            <div className="mt-3">
              <ErrorBanner
                message={submitError}
                onRetry={() => void handleSubmit()}
              />
            </div>
          )}
        </>
      ) : existingSet ? (
        <div className="flex items-center justify-between gap-4">
          <div className="flex-1 grid grid-cols-2 gap-4">
            <div className="text-center">
              <p className="font-body text-xs text-slate uppercase tracking-wider mb-1">
                {p1Name}
              </p>
              <p className="font-display text-3xl text-white tabular-nums">
                {existingSet.p1_score}
              </p>
            </div>
            <div className="text-center">
              <p className="font-body text-xs text-slate uppercase tracking-wider mb-1">
                {p2Name}
              </p>
              <p className="font-display text-3xl text-white tabular-nums">
                {existingSet.p2_score}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <p className="text-slate font-body text-sm">
          Enter Set {setNumber} scores to begin.
        </p>
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
