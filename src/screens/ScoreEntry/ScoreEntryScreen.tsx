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
import { supabase } from '../../lib/supabase';
import type {
  EntrantType,
  Event,
  Match,
  MatchFormat,
  MatchSet,
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
}

interface DownstreamPayload {
  match_id: string;
  slot: 'p1' | 'p2';
}

type RecordType = 'walkover' | 'retired';

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

  // Set 1 entry state
  const [editing, setEditing] = useState(false);
  const [p1Input, setP1Input] = useState<number | ''>('');
  const [p2Input, setP2Input] = useState<number | ''>('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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

  const fetchMatch = useCallback(async (): Promise<{ match: Match; set1: MatchSet | null }> => {
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
      if (!id || !type) return { id: '', name: fallback || 'TBD', type: null };
      if (type === 'team') {
        const t = teams.find((tt) => tt.id === id);
        return { id, name: t?.display_name ?? fallback ?? 'TBD', type: 'team' };
      }
      const pl = players.find((pp) => pp.id === id);
      return { id, name: pl?.display_name ?? fallback ?? 'TBD', type: 'player' };
    }

    setMatch(m);
    setMatchSets(sets);
    setEvent(ev);
    setEventMatches(evMatches);
    setP1(resolve(m.p1_id, m.p1_type, m.p1_ref));
    setP2(resolve(m.p2_id, m.p2_type, m.p2_ref));

    return { match: m, set1: sets.find((s) => s.set_number === 1) ?? null };
  }, [matchId]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { set1 } = await fetchMatch();
      // If no set 1 yet, default to editing mode so inputs are visible.
      if (!set1) {
        setEditing(true);
        setP1Input('');
        setP2Input('');
      } else {
        setEditing(false);
      }
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
  const set1 = useMemo(() => matchSets.find((s) => s.set_number === 1) ?? null, [matchSets]);

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

  const winnerFromSet1 = useMemo<{
    id: string;
    type: EntrantType;
    name: string;
    score: string;
  } | null>(() => {
    if (!match || !set1 || !set1.complete) return null;
    if (match.match_format === 'best_of_3x15') return null; // single-set screens only
    if (!match.p1_id || !match.p2_id || !match.p1_type || !match.p2_type) return null;
    const p1Won = set1.p1_score > set1.p2_score;
    const winnerId = p1Won ? match.p1_id : match.p2_id;
    const winnerType = p1Won ? match.p1_type : match.p2_type;
    const name = p1Won ? p1?.name ?? '' : p2?.name ?? '';
    const score = `${set1.p1_score}–${set1.p2_score}`;
    return { id: winnerId, type: winnerType, name, score };
  }, [match, set1, p1, p2]);

  const canMarkComplete =
    !!match && match.status === 'in_progress' && !!winnerFromSet1;

  // Handicap banner — for E7 the rule names which players carry the head start.
  const handicapBannerText = useMemo(() => {
    if (!match?.handicap_applied) return null;
    if (!p1 || !p2) return null;
    return `Handicap match — ${p1.name} & ${p2.name} start each set at 3-0. Enter the FINAL score including the head start.`;
  }, [match, p1, p2]);

  function buildDownstreamUpdates(winnerSlot: 'p1' | 'p2'): DownstreamPayload[] {
    if (!match || !event) return [];
    void winnerSlot;
    const rules = getDownstreamSlots(event.code, match.bracket_slot, 'winner');
    const updates: DownstreamPayload[] = [];
    for (const rule of rules) {
      if (rule.targetSlot !== 'p1' && rule.targetSlot !== 'p2') continue;
      const targetMatch = eventMatches.find((em) => em.bracket_slot === rule.target);
      if (!targetMatch) continue;
      updates.push({ match_id: targetMatch.id, slot: rule.targetSlot });
    }
    return updates;
  }

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
    if (!set1) return;
    setEditing(true);
    setP1Input(set1.p1_score);
    setP2Input(set1.p2_score);
    setValidationError(null);
    setSubmitError(null);
  }

  async function handleSubmitSet() {
    if (!match || submitting) return;
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
        p_match_id: match.id,
        p_set_number: 1,
        p_p1_score: p1Val,
        p_p2_score: p2Val,
        p_admin_name: adminName,
      });
      if (rpcError) {
        setSubmitError(rpcErrorMessage(rpcError.message, 'Score could not be saved'));
        return;
      }
      await fetchMatch();
      setEditing(false);
    } catch (caught) {
      const msg = caught instanceof Error ? caught.message : 'Score could not be saved';
      setSubmitError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConfirmComplete() {
    if (!match || !winnerFromSet1 || completing) return;
    setCompleteError(null);
    setCompleting(true);
    try {
      const winnerSlot: 'p1' | 'p2' = match.p1_id === winnerFromSet1.id ? 'p1' : 'p2';
      const downstream = buildDownstreamUpdates(winnerSlot);
      const { error: rpcError } = await supabase.rpc('complete_match', {
        p_match_id: match.id,
        p_winner_id: winnerFromSet1.id,
        p_winner_type: winnerFromSet1.type,
        p_admin_name: adminName,
        p_downstream_updates: downstream,
      });
      if (rpcError) {
        setCompleteError(rpcErrorMessage(rpcError.message, 'Could not complete match'));
        return;
      }
      navigate(`${basePath}/picker`);
    } catch (caught) {
      const msg = caught instanceof Error ? caught.message : 'Could not complete match';
      setCompleteError(msg);
    } finally {
      setCompleting(false);
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

    const downstream = buildDownstreamUpdates(recordWinnerSide);

    setRecording(true);
    try {
      if (recordType === 'walkover') {
        const { error: rpcError } = await supabase.rpc('record_walkover', {
          p_match_id: match.id,
          p_winner_id: winnerId,
          p_winner_type: winnerType,
          p_admin_name: adminName,
          p_downstream_updates: downstream,
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
          p_downstream_updates: downstream,
        });
        if (rpcError) {
          setRecordError(rpcErrorMessage(rpcError.message, 'Could not record retirement'));
          return;
        }
      }
      navigate(`${basePath}/picker`);
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
          onClick={() => navigate(`${basePath}/picker`)}
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

            <section className="rounded-lg bg-navy-light/60 border border-navy-light p-4 mb-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-body text-xs uppercase tracking-[0.2em] text-slate">
                  Set 1 · First to {target}
                </h2>
                {set1?.complete && !editing && canEditSet && (
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
                      playerName={p1.name}
                      disabled={submitting}
                    />
                    <ScoreInput
                      value={p2Input}
                      onChange={(v) => {
                        setP2Input(v);
                        setValidationError(null);
                      }}
                      playerName={p2.name}
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
                    onClick={() => void handleSubmitSet()}
                    disabled={submitting}
                    className="mt-4 w-full h-11 rounded-md bg-gold text-navy-dark font-body font-semibold tracking-wide uppercase text-sm transition disabled:bg-navy-light disabled:text-slate disabled:cursor-not-allowed hover:bg-gold-bright"
                  >
                    {submitting ? 'Saving…' : 'Submit Set'}
                  </button>

                  {submitError && (
                    <div className="mt-3">
                      <ErrorBanner
                        message={submitError}
                        onRetry={() => void handleSubmitSet()}
                      />
                    </div>
                  )}
                </>
              ) : set1 ? (
                <div className="flex items-center justify-between gap-4">
                  <div className="flex-1 grid grid-cols-2 gap-4">
                    <div className="text-center">
                      <p className="font-body text-xs text-slate uppercase tracking-wider mb-1">
                        {p1.name}
                      </p>
                      <p className="font-display text-3xl text-white tabular-nums">
                        {set1.p1_score}
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="font-body text-xs text-slate uppercase tracking-wider mb-1">
                        {p2.name}
                      </p>
                      <p className="font-display text-3xl text-white tabular-nums">
                        {set1.p2_score}
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-slate font-body text-sm">
                  Enter Set 1 scores to begin.
                </p>
              )}
            </section>

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

      {showCompleteModal && winnerFromSet1 && (
        <ConfirmModal
          title={`${winnerFromSet1.name} wins`}
          body={
            <>
              <p className="font-display text-xl text-gold-bright tabular-nums mb-2">
                {winnerFromSet1.score}
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
