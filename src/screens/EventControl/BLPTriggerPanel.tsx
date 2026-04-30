import { useCallback, useEffect, useMemo, useState } from 'react';
import ConfirmModal from '../../components/ConfirmModal';
import ErrorBanner from '../../components/ErrorBanner';
import LoadingSkeleton from '../../components/LoadingSkeleton';
import { getSession } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import type { Match, Player, TriggerRecord } from '../../types';

interface BLPTriggerPanelProps {
  eventId: string;
}

interface BLPRanking {
  match_id: string;
  player_id: string;
  player_type: 'player' | 'team';
  margin: number;
}

interface FireBlpResponse {
  blp_match_id: string;
  rankings: BLPRanking[];
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

export default function BLPTriggerPanel({ eventId }: BLPTriggerPanelProps) {
  const session = getSession();
  const adminName = session?.name ?? '';

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [trigger, setTrigger] = useState<TriggerRecord | null>(null);
  const [r1Matches, setR1Matches] = useState<Match[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);

  const [confirming, setConfirming] = useState(false);
  const [firing, setFiring] = useState(false);
  const [fireError, setFireError] = useState<string | null>(null);
  const [fireResult, setFireResult] = useState<FireBlpResponse | null>(null);

  const playerMap = useMemo(() => {
    const map: Record<string, Player> = {};
    for (const p of players) map[p.id] = p;
    return map;
  }, [players]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [triggerRes, matchesRes, playersRes] = await Promise.all([
        supabase
          .from('trigger_records')
          .select('*')
          .eq('event_id', eventId)
          .eq('trigger_type', 'blp')
          .maybeSingle(),
        supabase
          .from('matches')
          .select('*')
          .eq('event_id', eventId)
          .eq('round', 'R1'),
        supabase.from('players').select('*'),
      ]);

      if (triggerRes.error && triggerRes.error.code !== 'PGRST116') {
        throw triggerRes.error;
      }
      if (matchesRes.error) throw matchesRes.error;
      if (playersRes.error) throw playersRes.error;

      setTrigger((triggerRes.data ?? null) as TriggerRecord | null);
      setR1Matches((matchesRes.data ?? []) as Match[]);
      setPlayers((playersRes.data ?? []) as Player[]);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load BLP status');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  const outstanding = useMemo(
    () =>
      r1Matches
        .filter((m) => !['complete', 'walkover', 'retired'].includes(m.status))
        .map((m) => m.bracket_slot)
        .sort(),
    [r1Matches],
  );
  const allR1Complete = r1Matches.length > 0 && outstanding.length === 0;

  const fireBlp = useCallback(async () => {
    setFiring(true);
    setFireError(null);
    try {
      const { data, error } = await supabase.rpc('fire_blp', {
        p_event_id: eventId,
        p_admin_name: adminName,
      });
      if (error) throw error;
      setFireResult(data as FireBlpResponse);
      // Refresh trigger record so the idempotent display takes over.
      await load();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Could not run BLP computation';
      setFireError(message);
    } finally {
      setFiring(false);
      setConfirming(false);
    }
  }, [adminName, eventId, load]);

  if (loading) {
    return (
      <section className="rounded-lg border border-navy-light bg-navy-light/30 p-4">
        <h3 className="font-display text-lg text-gold-bright mb-3">
          E1 Best Loser Playoff
        </h3>
        <LoadingSkeleton rows={2} height="3rem" />
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-navy-light bg-navy-light/30 p-4">
      <h3 className="font-display text-lg text-gold-bright mb-3">
        E1 Best Loser Playoff
      </h3>

      {loadError && <ErrorBanner message={loadError} onRetry={() => void load()} />}

      {trigger ? (
        <IdempotentDisplay
          trigger={trigger}
          rankings={
            (trigger.payload as { rankings?: BLPRanking[] } | null)?.rankings ?? []
          }
          playerMap={playerMap}
        />
      ) : (
        <>
          {fireResult ? (
            <ResultPanel
              result={fireResult}
              playerMap={playerMap}
            />
          ) : (
            <ReadyPanel
              outstanding={outstanding}
              allR1Complete={allR1Complete}
              fireError={fireError}
              firing={firing}
              onFire={() => setConfirming(true)}
              onClearError={() => setFireError(null)}
            />
          )}
        </>
      )}

      {confirming && (
        <ConfirmModal
          title="Run BLP Computation"
          body="Rank R1 losers by point margin and create the BLP match. Continue?"
          confirmLabel={firing ? 'Running…' : 'Run BLP'}
          cancelLabel="Cancel"
          onConfirm={() => void fireBlp()}
          onCancel={() => (firing ? null : setConfirming(false))}
        />
      )}
    </section>
  );
}

function ReadyPanel({
  outstanding,
  allR1Complete,
  fireError,
  firing,
  onFire,
  onClearError,
}: {
  outstanding: string[];
  allR1Complete: boolean;
  fireError: string | null;
  firing: boolean;
  onFire: () => void;
  onClearError: () => void;
}) {
  const errorCode = parseRpcErrorCode(fireError ?? undefined);
  const insufficient = errorCode === 'INSUFFICIENT_ELIGIBLE_PLAYERS';

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={onFire}
        disabled={!allR1Complete || firing}
        className="w-full sm:w-auto px-4 py-2.5 rounded-md bg-gold text-navy-dark font-body font-semibold hover:bg-gold-bright transition-colors disabled:bg-navy-light disabled:text-slate disabled:cursor-not-allowed min-h-[44px]"
      >
        Run BLP Computation
      </button>

      {!allR1Complete && (
        <p className="font-body text-sm text-slate-light">
          Waiting for:{' '}
          <span className="text-amber-warning">
            {outstanding.length > 0 ? outstanding.join(', ') : 'R1 matches to be created'}
          </span>
        </p>
      )}

      {fireError && (
        <div
          role="alert"
          className={`rounded-md px-3 py-2 text-sm font-body border ${
            insufficient
              ? 'bg-amber-warning/15 border-amber-warning/40 text-amber-warning'
              : 'bg-error/15 border-error/40 text-error'
          }`}
        >
          {insufficient ? (
            <>
              Not enough eligible R1 losers for a BLP match. Resolve manually —
              walkover-only losses are excluded from BLP ranking.
            </>
          ) : (
            <>{fireError}</>
          )}
          <button
            type="button"
            onClick={onClearError}
            className="ml-3 underline underline-offset-2"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

function ResultPanel({
  result,
  playerMap,
}: {
  result: FireBlpResponse;
  playerMap: Record<string, Player>;
}) {
  return (
    <div className="space-y-3">
      <p className="font-body text-sm text-emerald-300">
        BLP match created. Top 2 closest losers have been seeded.
      </p>
      <RankingsList rankings={result.rankings.slice(0, 2)} playerMap={playerMap} highlight />
      {result.rankings.length > 2 && (
        <details className="text-sm font-body text-slate-light">
          <summary className="cursor-pointer">All ranked losers</summary>
          <RankingsList rankings={result.rankings} playerMap={playerMap} />
        </details>
      )}
    </div>
  );
}

function IdempotentDisplay({
  trigger,
  rankings,
  playerMap,
}: {
  trigger: TriggerRecord;
  rankings: BLPRanking[];
  playerMap: Record<string, Player>;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-body text-slate-light">
        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[11px] uppercase tracking-wider">
          Generated
        </span>
        <span>
          by <span className="text-white">{trigger.fired_by}</span> at{' '}
          {formatTimestamp(trigger.fired_at)}
        </span>
      </div>
      {rankings.length > 0 && (
        <RankingsList rankings={rankings.slice(0, 2)} playerMap={playerMap} highlight />
      )}
      <button
        type="button"
        disabled
        className="w-full sm:w-auto px-4 py-2.5 rounded-md bg-navy-light text-slate font-body font-semibold cursor-not-allowed min-h-[44px]"
      >
        Run BLP Computation
      </button>
    </div>
  );
}

function RankingsList({
  rankings,
  playerMap,
  highlight = false,
}: {
  rankings: BLPRanking[];
  playerMap: Record<string, Player>;
  highlight?: boolean;
}) {
  return (
    <ol className="space-y-1">
      {rankings.map((r, idx) => {
        const player = playerMap[r.player_id];
        const name = player?.display_name ?? 'Unknown';
        const isBlpSlot = highlight && idx < 2;
        return (
          <li
            key={`${r.match_id}-${r.player_id}`}
            className={`flex items-center justify-between rounded-md px-3 py-2 text-sm font-body ${
              isBlpSlot
                ? 'bg-gold/15 text-white border border-gold/30'
                : 'bg-navy-dark/40 text-slate-light'
            }`}
          >
            <span>
              <span className="text-slate mr-2 tabular-nums">#{idx + 1}</span>
              {name}
            </span>
            <span className="tabular-nums">margin {r.margin}</span>
          </li>
        );
      })}
    </ol>
  );
}
