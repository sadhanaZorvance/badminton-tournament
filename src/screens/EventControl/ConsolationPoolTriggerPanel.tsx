import { useCallback, useEffect, useMemo, useState } from 'react';
import ConfirmModal from '../../components/ConfirmModal';
import ErrorBanner from '../../components/ErrorBanner';
import LoadingSkeleton from '../../components/LoadingSkeleton';
import { getSession } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import type { Match, Player, TriggerRecord } from '../../types';

interface ConsolationPoolTriggerPanelProps {
  eventId: string;
}

interface PoolAssignmentsPayload {
  pool_a: string[];
  pool_b: string[];
  matches_created?: number;
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

export default function ConsolationPoolTriggerPanel({
  eventId,
}: ConsolationPoolTriggerPanelProps) {
  const session = getSession();
  const adminName = session?.name ?? '';

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [trigger, setTrigger] = useState<TriggerRecord | null>(null);
  const [blpMatch, setBlpMatch] = useState<Match | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);

  const [confirming, setConfirming] = useState(false);
  const [firing, setFiring] = useState(false);
  const [fireError, setFireError] = useState<string | null>(null);
  const [fireResult, setFireResult] = useState<PoolAssignmentsPayload | null>(null);

  const playerMap = useMemo(() => {
    const map: Record<string, Player> = {};
    for (const p of players) map[p.id] = p;
    return map;
  }, [players]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [triggerRes, blpRes, playersRes] = await Promise.all([
        supabase
          .from('trigger_records')
          .select('*')
          .eq('event_id', eventId)
          .eq('trigger_type', 'consolation_pools')
          .maybeSingle(),
        supabase
          .from('matches')
          .select('*')
          .eq('event_id', eventId)
          .eq('round', 'BLP')
          .maybeSingle(),
        supabase.from('players').select('*'),
      ]);

      if (triggerRes.error && triggerRes.error.code !== 'PGRST116') {
        throw triggerRes.error;
      }
      if (blpRes.error && blpRes.error.code !== 'PGRST116') {
        throw blpRes.error;
      }
      if (playersRes.error) throw playersRes.error;

      setTrigger((triggerRes.data ?? null) as TriggerRecord | null);
      setBlpMatch((blpRes.data ?? null) as Match | null);
      setPlayers((playersRes.data ?? []) as Player[]);
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : 'Could not load consolation pool status',
      );
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  const blpComplete = blpMatch?.status === 'complete';

  const fire = useCallback(async () => {
    setFiring(true);
    setFireError(null);
    try {
      const { data, error } = await supabase.rpc('generate_consolation_pools', {
        p_event_id: eventId,
        p_admin_name: adminName,
      });
      if (error) throw error;
      setFireResult(data as PoolAssignmentsPayload);
      await load();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Could not generate consolation pools';
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
          E1 Consolation Pools
        </h3>
        <LoadingSkeleton rows={2} height="3rem" />
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-navy-light bg-navy-light/30 p-4">
      <h3 className="font-display text-lg text-gold-bright mb-3">
        E1 Consolation Pools
      </h3>

      {loadError && <ErrorBanner message={loadError} onRetry={() => void load()} />}

      {trigger ? (
        <IdempotentDisplay
          trigger={trigger}
          payload={trigger.payload as PoolAssignmentsPayload | null}
          playerMap={playerMap}
        />
      ) : (
        <>
          {fireResult ? (
            <ResultPanel result={fireResult} playerMap={playerMap} />
          ) : (
            <ReadyPanel
              blpComplete={blpComplete}
              blpMatchExists={blpMatch !== null}
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
          title="Generate Consolation Pools"
          body="Randomly split 6 consolation players (5 R1 losers + BLP loser) into Pool A and Pool B, and create 6 round-robin matches. Continue?"
          confirmLabel={firing ? 'Generating…' : 'Generate Pools'}
          cancelLabel="Cancel"
          onConfirm={() => void fire()}
          onCancel={() => (firing ? null : setConfirming(false))}
        />
      )}
    </section>
  );
}

function ReadyPanel({
  blpComplete,
  blpMatchExists,
  fireError,
  firing,
  onFire,
  onClearError,
}: {
  blpComplete: boolean;
  blpMatchExists: boolean;
  fireError: string | null;
  firing: boolean;
  onFire: () => void;
  onClearError: () => void;
}) {
  const errorCode = parseRpcErrorCode(fireError ?? undefined);
  const insufficient = errorCode === 'INSUFFICIENT_PLAYERS';

  let waitingMessage: string | null = null;
  if (!blpMatchExists) {
    waitingMessage = 'BLP match has not been created yet — run BLP Computation first.';
  } else if (!blpComplete) {
    waitingMessage = 'Waiting for BLP match to complete.';
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={onFire}
        disabled={!blpComplete || firing}
        className="w-full sm:w-auto px-4 py-2.5 rounded-md bg-gold text-navy-dark font-body font-semibold hover:bg-gold-bright transition-colors disabled:bg-navy-light disabled:text-slate disabled:cursor-not-allowed min-h-[44px]"
      >
        Generate Consolation Pools
      </button>

      {waitingMessage && (
        <p className="font-body text-sm text-slate-light">
          <span className="text-amber-warning">{waitingMessage}</span>
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
              Not enough eligible consolation players. Resolve manually — walkover
              losses are excluded.
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
  result: PoolAssignmentsPayload;
  playerMap: Record<string, Player>;
}) {
  return (
    <div className="space-y-3">
      <p className="font-body text-sm text-emerald-300">
        Consolation pools generated. 6 round-robin matches created.
      </p>
      <PoolAssignments
        poolA={result.pool_a}
        poolB={result.pool_b}
        playerMap={playerMap}
      />
    </div>
  );
}

function IdempotentDisplay({
  trigger,
  payload,
  playerMap,
}: {
  trigger: TriggerRecord;
  payload: PoolAssignmentsPayload | null;
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
      {payload && (
        <PoolAssignments
          poolA={payload.pool_a ?? []}
          poolB={payload.pool_b ?? []}
          playerMap={playerMap}
        />
      )}
      <button
        type="button"
        disabled
        className="w-full sm:w-auto px-4 py-2.5 rounded-md bg-navy-light text-slate font-body font-semibold cursor-not-allowed min-h-[44px]"
      >
        Generate Consolation Pools
      </button>
    </div>
  );
}

function PoolAssignments({
  poolA,
  poolB,
  playerMap,
}: {
  poolA: string[];
  poolB: string[];
  playerMap: Record<string, Player>;
}) {
  return (
    <div className="grid sm:grid-cols-2 gap-3">
      <PoolCard label="Pool A" entrants={poolA} playerMap={playerMap} />
      <PoolCard label="Pool B" entrants={poolB} playerMap={playerMap} />
    </div>
  );
}

function PoolCard({
  label,
  entrants,
  playerMap,
}: {
  label: string;
  entrants: string[];
  playerMap: Record<string, Player>;
}) {
  return (
    <div className="rounded-md bg-navy-dark/40 border border-gold/20 p-3">
      <h4 className="font-display text-base text-gold mb-2">{label}</h4>
      <ol className="space-y-1">
        {entrants.map((id, idx) => {
          const player = playerMap[id];
          const name = player?.display_name ?? 'Unknown';
          return (
            <li
              key={`${label}-${id}`}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-body bg-navy-light/40 text-white"
            >
              <span className="text-slate tabular-nums">#{idx + 1}</span>
              <span>{name}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
