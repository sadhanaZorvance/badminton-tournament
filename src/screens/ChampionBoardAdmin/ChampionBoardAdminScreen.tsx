import { useCallback, useEffect, useMemo, useState } from 'react';
import AdminHeader from '../../components/AdminHeader';
import ConfirmModal from '../../components/ConfirmModal';
import ErrorBanner from '../../components/ErrorBanner';
import LoadingSkeleton from '../../components/LoadingSkeleton';
import Toast from '../../components/Toast';
import { getSession } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import type { EntrantType, Event, Match, Player, Podium, Team } from '../../types';

interface ChampionBoardAdminScreenProps {
  basePath: string;
  loginPath: string;
}

type EventStatusKind = 'pending' | 'draft' | 'published';

interface EventRowState {
  event: Event;
  podium: Podium | null;
  outstandingCount: number;
  kind: EventStatusKind;
}

function parseRpcErrorCode(message: string | undefined): string | null {
  if (!message) return null;
  const match = message.match(/^([A-Z_]+):/);
  return match ? match[1] : null;
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function entrantName(
  id: string | null,
  type: EntrantType | null,
  playerMap: Record<string, Player>,
  teamMap: Record<string, Team>,
): string | null {
  if (!id || !type) return null;
  if (type === 'team') return teamMap[id]?.display_name ?? null;
  return playerMap[id]?.display_name ?? null;
}

export default function ChampionBoardAdminScreen({
  basePath,
  loginPath,
}: ChampionBoardAdminScreenProps) {
  const [events, setEvents] = useState<Event[]>([]);
  const [podiums, setPodiums] = useState<Podium[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [openEventId, setOpenEventId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setLoadError(null);
    try {
      const [eventsRes, podiumsRes, matchesRes, playersRes, teamsRes] =
        await Promise.all([
          supabase.from('events').select('*').order('code'),
          supabase.from('podiums').select('*'),
          supabase.from('matches').select('*'),
          supabase.from('players').select('*'),
          supabase.from('teams').select('*'),
        ]);
      if (eventsRes.error) throw eventsRes.error;
      if (podiumsRes.error) throw podiumsRes.error;
      if (matchesRes.error) throw matchesRes.error;
      if (playersRes.error) throw playersRes.error;
      if (teamsRes.error) throw teamsRes.error;

      setEvents((eventsRes.data ?? []) as Event[]);
      setPodiums((podiumsRes.data ?? []) as Podium[]);
      setMatches((matchesRes.data ?? []) as Match[]);
      setPlayers((playersRes.data ?? []) as Player[]);
      setTeams((teamsRes.data ?? []) as Team[]);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load podiums');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const playerMap = useMemo(() => {
    const m: Record<string, Player> = {};
    for (const p of players) m[p.id] = p;
    return m;
  }, [players]);

  const teamMap = useMemo(() => {
    const m: Record<string, Team> = {};
    for (const t of teams) m[t.id] = t;
    return m;
  }, [teams]);

  const podiumByEvent = useMemo(() => {
    const m: Record<string, Podium> = {};
    for (const p of podiums) m[p.event_id] = p;
    return m;
  }, [podiums]);

  const rowStates = useMemo<EventRowState[]>(() => {
    return events.map((event) => {
      const podium = podiumByEvent[event.id] ?? null;
      const outstandingCount = matches.filter(
        (m) =>
          m.event_id === event.id &&
          !['complete', 'walkover', 'retired'].includes(m.status),
      ).length;
      let kind: EventStatusKind;
      if (podium && podium.status === 'published') {
        kind = 'published';
      } else if (podium && podium.status === 'draft' && outstandingCount === 0) {
        kind = 'draft';
      } else {
        kind = 'pending';
      }
      return { event, podium, outstandingCount, kind };
    });
  }, [events, podiumByEvent, matches]);

  const openRow = useMemo(
    () => (openEventId ? rowStates.find((r) => r.event.id === openEventId) ?? null : null),
    [openEventId, rowStates],
  );

  function handleRowSelect(state: EventRowState) {
    if (state.kind === 'pending') {
      const n = state.outstandingCount;
      setToast(`Waiting for ${n} match${n === 1 ? '' : 'es'} to complete`);
      return;
    }
    setOpenEventId(state.event.id);
  }

  return (
    <div className="min-h-screen bg-navy text-white flex flex-col">
      <AdminHeader
        basePath={basePath}
        loginPath={loginPath}
        onRefresh={() => void load(true)}
        refreshing={refreshing}
      />
      <main className="flex-1 max-w-3xl w-full mx-auto px-4 py-6 space-y-6">
        <header className="space-y-1">
          <h1 className="font-display text-2xl text-gold-bright">
            Champion Board Admin
          </h1>
          <p className="font-body text-sm text-slate">
            Review and publish podiums as events conclude.
          </p>
        </header>

        {loadError && <ErrorBanner message={loadError} onRetry={() => void load()} />}

        {loading ? (
          <LoadingSkeleton rows={8} height="3.5rem" />
        ) : rowStates.length === 0 ? (
          <p className="font-body text-sm text-slate-light">No events to display.</p>
        ) : (
          <ul className="space-y-2">
            {rowStates.map((state) => (
              <EventListRow
                key={state.event.id}
                state={state}
                onSelect={() => handleRowSelect(state)}
              />
            ))}
          </ul>
        )}
      </main>

      {openRow && (
        <PodiumPanel
          state={openRow}
          playerMap={playerMap}
          teamMap={teamMap}
          onClose={() => setOpenEventId(null)}
          onChanged={() => {
            void load(true);
          }}
        />
      )}

      {toast && (
        <Toast message={toast} onDismiss={() => setToast(null)} />
      )}
    </div>
  );
}

interface EventListRowProps {
  state: EventRowState;
  onSelect: () => void;
}

function EventListRow({ state, onSelect }: EventListRowProps) {
  const { event, kind, outstandingCount } = state;

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className="w-full text-left rounded-lg border border-navy-light bg-navy-light/40 hover:bg-navy-light hover:border-gold/40 transition-colors px-4 py-3 min-h-[64px]"
      >
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="font-body text-[11px] uppercase tracking-wider text-slate mb-0.5">
              {event.code}
            </p>
            <p className="font-body text-sm text-white truncate">{event.name}</p>
          </div>
          <PodiumStatusIndicator
            kind={kind}
            outstandingCount={outstandingCount}
          />
        </div>
      </button>
    </li>
  );
}

function PodiumStatusIndicator({
  kind,
  outstandingCount,
}: {
  kind: EventStatusKind;
  outstandingCount: number;
}) {
  if (kind === 'pending') {
    return (
      <span className="shrink-0 inline-flex items-center gap-1.5 text-slate font-body text-xs uppercase tracking-wider">
        <span className="w-2 h-2 rounded-full bg-slate/60" />
        Pending
        {outstandingCount > 0 && (
          <span className="text-slate-light normal-case tracking-normal">
            ({outstandingCount} match{outstandingCount === 1 ? '' : 'es'} left)
          </span>
        )}
      </span>
    );
  }
  if (kind === 'draft') {
    return (
      <span className="shrink-0 inline-flex items-center gap-1.5 text-amber-warning font-body text-xs uppercase tracking-wider">
        <span className="w-2 h-2 rounded-full bg-amber-warning animate-pulse" />
        Draft ready
      </span>
    );
  }
  return (
    <span className="shrink-0 inline-flex items-center gap-1.5 text-gold-bright font-body text-xs uppercase tracking-wider">
      <span className="w-2 h-2 rounded-full bg-gold-bright" />
      Published
    </span>
  );
}

interface PodiumPanelProps {
  state: EventRowState;
  playerMap: Record<string, Player>;
  teamMap: Record<string, Team>;
  onClose: () => void;
  onChanged: () => void;
}

function PodiumPanel({
  state,
  playerMap,
  teamMap,
  onClose,
  onChanged,
}: PodiumPanelProps) {
  const { event, podium, kind } = state;
  const session = getSession();
  const adminName = session?.name ?? '';

  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [outstandingFromError, setOutstandingFromError] = useState<number | null>(null);
  const [confirmingUnpublish, setConfirmingUnpublish] = useState(false);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !submitting && !confirmingUnpublish) onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose, submitting, confirmingUnpublish]);

  const goldName = podium
    ? entrantName(podium.gold_id, podium.gold_type, playerMap, teamMap)
    : null;
  const silverName = podium
    ? entrantName(podium.silver_id, podium.silver_type, playerMap, teamMap)
    : null;
  const bronzeName = podium
    ? entrantName(podium.bronze_id, podium.bronze_type, playerMap, teamMap)
    : null;
  // Consolation winner stored without a *_type column (always a player or team
  // matching the event format). Try player first, then team, for display.
  const consolationName =
    podium && podium.consolation_winner_id
      ? playerMap[podium.consolation_winner_id]?.display_name ??
        teamMap[podium.consolation_winner_id]?.display_name ??
        null
      : null;

  async function handlePublish() {
    if (!adminName || submitting) return;
    setSubmitting(true);
    setActionError(null);
    setOutstandingFromError(null);
    try {
      const { error } = await supabase.rpc('publish_podium', {
        p_event_id: event.id,
        p_admin_name: adminName,
      });
      if (error) throw error;
      onChanged();
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not publish podium';
      const code = parseRpcErrorCode(message);
      if (code === 'MATCHES_OUTSTANDING') {
        const n = parseInt(message.match(/(\d+)\s+matches?/)?.[1] ?? '0', 10);
        setOutstandingFromError(Number.isFinite(n) ? n : 0);
      }
      setActionError(message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUnpublish() {
    if (!adminName || submitting) return;
    setSubmitting(true);
    setActionError(null);
    try {
      const { error } = await supabase.rpc('unpublish_podium', {
        p_event_id: event.id,
        p_admin_name: adminName,
      });
      if (error) throw error;
      setConfirmingUnpublish(false);
      onChanged();
      onClose();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Could not unpublish podium';
      setActionError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="podium-panel-title"
        className="fixed inset-0 z-40 flex items-end sm:items-center justify-center"
      >
        <div
          className="absolute inset-0 bg-navy-dark/80 backdrop-blur-sm"
          onClick={() => {
            if (!submitting) onClose();
          }}
          aria-hidden="true"
        />
        <div className="relative w-full sm:max-w-lg bg-navy-light border border-navy-light sm:rounded-xl rounded-t-xl shadow-2xl max-h-[90vh] overflow-y-auto animate-slide-up-fade">
          <header className="px-5 pt-5 pb-3 border-b border-navy-dark/50 sticky top-0 bg-navy-light z-10">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-body text-[11px] uppercase tracking-wider text-slate">
                  {event.code}
                </p>
                <h2
                  id="podium-panel-title"
                  className="font-display text-lg text-gold-bright"
                >
                  {event.name}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!submitting) onClose();
                }}
                aria-label="Close"
                className="p-2 -m-2 text-slate hover:text-gold-bright"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="w-5 h-5"
                  aria-hidden="true"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </header>

          <div className="px-5 py-5 space-y-5">
            <ul className="space-y-3">
              <PodiumLine medal="🥇" label="Gold" name={goldName} accent="gold" />
              <PodiumLine medal="🥈" label="Silver" name={silverName} accent="silver" />
              <PodiumLine medal="🥉" label="Bronze" name={bronzeName} accent="bronze" />
            </ul>

            {consolationName && (
              <p className="font-body text-sm text-slate-light">
                <span className="text-slate uppercase tracking-wider text-[11px] mr-2">
                  Consolation
                </span>
                <span className="text-white">{consolationName}</span>
              </p>
            )}

            {kind === 'published' && podium?.published_by && podium.published_at && (
              <p className="font-body text-xs text-slate">
                Published by{' '}
                <span className="text-white">{podium.published_by}</span> at{' '}
                {formatTimestamp(podium.published_at)}
              </p>
            )}

            {actionError && (
              <div
                role="alert"
                className="rounded-md px-3 py-2 text-sm font-body bg-error/15 border border-error/40 text-error"
              >
                {outstandingFromError !== null ? (
                  <>
                    {outstandingFromError} match
                    {outstandingFromError === 1 ? '' : 'es'} still outstanding —
                    finish them before publishing.
                  </>
                ) : (
                  <>{actionError}</>
                )}
              </div>
            )}

            {!adminName && (
              <p className="font-body text-xs text-amber-warning">
                Admin name missing from session. Sign out and back in.
              </p>
            )}

            <div className="flex flex-col-reverse sm:flex-row gap-3 sm:justify-end pt-2">
              <button
                type="button"
                onClick={() => {
                  if (!submitting) onClose();
                }}
                className="px-4 py-2.5 rounded-md bg-navy-dark text-white font-body font-medium hover:bg-navy transition-colors min-h-[44px]"
              >
                Back
              </button>
              {kind === 'draft' && (
                <button
                  type="button"
                  onClick={() => void handlePublish()}
                  disabled={submitting || !adminName}
                  className="px-5 py-2.5 rounded-md bg-gold text-navy-dark font-body font-semibold hover:bg-gold-bright transition-colors disabled:bg-navy-dark disabled:text-slate disabled:cursor-not-allowed min-h-[44px]"
                >
                  {submitting ? 'Publishing…' : 'Publish'}
                </button>
              )}
              {kind === 'published' && (
                <button
                  type="button"
                  onClick={() => setConfirmingUnpublish(true)}
                  disabled={submitting || !adminName}
                  className="px-5 py-2.5 rounded-md border border-amber-warning/60 bg-amber-warning/10 text-amber-warning font-body font-semibold hover:bg-amber-warning/20 transition-colors disabled:opacity-60 disabled:cursor-not-allowed min-h-[44px]"
                >
                  Unpublish
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {confirmingUnpublish && (
        <ConfirmModal
          title="Unpublish Podium"
          body={
            <>
              <p>
                This will remove <span className="text-white">{event.name}</span>{' '}
                from the public Champion Board and unlock its matches for editing.
                Continue?
              </p>
              {actionError && (
                <p className="mt-3 text-error">{actionError}</p>
              )}
            </>
          }
          confirmLabel={submitting ? 'Unpublishing…' : 'Unpublish'}
          cancelLabel="Cancel"
          variant="destructive"
          onConfirm={() => void handleUnpublish()}
          onCancel={() => {
            if (!submitting) {
              setConfirmingUnpublish(false);
              setActionError(null);
            }
          }}
        />
      )}
    </>
  );
}

function PodiumLine({
  medal,
  label,
  name,
  accent,
}: {
  medal: string;
  label: string;
  name: string | null;
  accent: 'gold' | 'silver' | 'bronze';
}) {
  const nameClass =
    accent === 'gold'
      ? 'text-gold-bright'
      : accent === 'silver'
        ? 'text-white'
        : 'text-amber-warning';
  return (
    <li className="flex items-baseline gap-3">
      <span className="text-2xl shrink-0" aria-hidden="true">
        {medal}
      </span>
      <span className="sr-only">{label}:</span>
      <span className={`font-display text-xl ${nameClass} truncate`}>
        {name ?? <span className="text-slate text-base font-body">—</span>}
      </span>
    </li>
  );
}
