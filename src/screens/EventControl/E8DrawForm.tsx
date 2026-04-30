import { useCallback, useEffect, useMemo, useState } from 'react';
import ConfirmModal from '../../components/ConfirmModal';
import ErrorBanner from '../../components/ErrorBanner';
import LoadingSkeleton from '../../components/LoadingSkeleton';
import { getSession } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import type { Player, TriggerRecord } from '../../types';

interface E8DrawFormProps {
  eventId: string;
  open: boolean;
  onClose: () => void;
  onLocked: () => void;
}

type SlotState = { p1: string; p2: string };
type PairKind = 'U15+U11' | 'U15+U13' | 'invalid' | 'incomplete';

const SLOT_COUNT = 5;
const REQUIRED_U15_U11 = 3;
const REQUIRED_U15_U13 = 2;

function emptySlots(): SlotState[] {
  return Array.from({ length: SLOT_COUNT }, () => ({ p1: '', p2: '' }));
}

function classifyPair(p1: Player | undefined, p2: Player | undefined): PairKind {
  if (!p1 || !p2) return 'incomplete';
  const a = p1.age_group;
  const b = p2.age_group;
  if ((a === 'U15' && b === 'U11') || (a === 'U11' && b === 'U15')) return 'U15+U11';
  if ((a === 'U15' && b === 'U13') || (a === 'U13' && b === 'U15')) return 'U15+U13';
  return 'invalid';
}

function parseRpcErrorCode(message: string | undefined): string | null {
  if (!message) return null;
  const match = message.match(/^([A-Z_]+):/);
  return match ? match[1] : null;
}

function parsePairIndexFromError(message: string | undefined): number | null {
  if (!message) return null;
  const m = message.match(/pair (\d+)/);
  return m ? parseInt(m[1], 10) - 1 : null;
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

export default function E8DrawForm({ eventId, open, onClose, onLocked }: E8DrawFormProps) {
  const session = getSession();
  const adminName = session?.name ?? '';

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [players, setPlayers] = useState<Player[]>([]);
  const [trigger, setTrigger] = useState<TriggerRecord | null>(null);

  const [slots, setSlots] = useState<SlotState[]>(emptySlots);
  const [serverInvalidIndex, setServerInvalidIndex] = useState<number | null>(null);

  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [playersRes, triggerRes] = await Promise.all([
        supabase
          .from('players')
          .select('*')
          .eq('gender', 'F')
          .eq('status', 'active')
          .in('age_group', ['U11', 'U13', 'U15']),
        supabase
          .from('trigger_records')
          .select('*')
          .eq('event_id', eventId)
          .eq('trigger_type', 'e8_draw')
          .maybeSingle(),
      ]);

      if (playersRes.error) throw playersRes.error;
      if (triggerRes.error && triggerRes.error.code !== 'PGRST116') {
        throw triggerRes.error;
      }

      const list = (playersRes.data ?? []) as Player[];
      list.sort((a, b) => {
        if (a.age_group !== b.age_group) {
          const order: Record<string, number> = { U15: 0, U13: 1, U11: 2 };
          return order[a.age_group] - order[b.age_group];
        }
        return a.display_name.localeCompare(b.display_name);
      });
      setPlayers(list);
      setTrigger((triggerRes.data ?? null) as TriggerRecord | null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load draw data');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    if (open) {
      setSlots(emptySlots());
      setServerInvalidIndex(null);
      setSubmitError(null);
      void load();
    }
  }, [open, load]);

  const playerMap = useMemo(() => {
    const map: Record<string, Player> = {};
    for (const p of players) map[p.id] = p;
    return map;
  }, [players]);

  const selectedIds = useMemo(() => {
    const ids = new Set<string>();
    slots.forEach((s) => {
      if (s.p1) ids.add(s.p1);
      if (s.p2) ids.add(s.p2);
    });
    return ids;
  }, [slots]);

  const pairKinds = useMemo(
    () => slots.map((s) => classifyPair(playerMap[s.p1], playerMap[s.p2])),
    [slots, playerMap],
  );

  const counts = useMemo(() => {
    let u15u11 = 0;
    let u15u13 = 0;
    for (const kind of pairKinds) {
      if (kind === 'U15+U11') u15u11 += 1;
      else if (kind === 'U15+U13') u15u13 += 1;
    }
    return { u15u11, u15u13 };
  }, [pairKinds]);

  const allPairsAssigned = slots.every((s) => s.p1 && s.p2);
  const allPairsValid = pairKinds.every((k) => k === 'U15+U11' || k === 'U15+U13');
  const compositionSatisfied =
    counts.u15u11 === REQUIRED_U15_U11 && counts.u15u13 === REQUIRED_U15_U13;
  const canLock = allPairsAssigned && allPairsValid && compositionSatisfied;

  const setSlot = useCallback((idx: number, slot: 'p1' | 'p2', value: string) => {
    setSlots((prev) => {
      const next = prev.map((s, i) => (i === idx ? { ...s, [slot]: value } : s));
      return next;
    });
    setServerInvalidIndex(null);
    setSubmitError(null);
  }, []);

  const submit = useCallback(async () => {
    setSubmitting(true);
    setSubmitError(null);
    setServerInvalidIndex(null);
    try {
      const pairs = slots.map((s) => ({ p1_id: s.p1, p2_id: s.p2 }));
      const { error } = await supabase.rpc('lock_e8_draw', {
        p_event_id: eventId,
        p_pairs: pairs,
        p_admin_name: adminName,
      });
      if (error) throw error;
      onLocked();
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not lock draw';
      setSubmitError(message);
      const code = parseRpcErrorCode(message);
      if (code === 'INVALID_COMPOSITION' || code === 'WITHDRAWN_PLAYER' || code === 'INVALID_PLAYER' || code === 'INVALID_GENDER') {
        const idx = parsePairIndexFromError(message);
        if (idx !== null) setServerInvalidIndex(idx);
      }
      if (code === 'DRAW_ALREADY_LOCKED') {
        await load();
      }
    } finally {
      setSubmitting(false);
      setConfirming(false);
    }
  }, [adminName, eventId, slots, onClose, onLocked, load]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="e8-draw-title"
      className="fixed inset-0 z-50 flex flex-col bg-navy"
    >
      <header className="flex items-center justify-between px-4 py-3 border-b border-navy-light bg-navy-dark/40">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="text-slate-light hover:text-white text-sm font-body min-h-[44px] min-w-[44px] -ml-2 px-2"
            aria-label="Close draw form"
          >
            ←
          </button>
          <h2 id="e8-draw-title" className="font-display text-xl text-gold-bright">
            Girls Doubles Draw
          </h2>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 py-5 space-y-5">
          {loadError && <ErrorBanner message={loadError} onRetry={() => void load()} />}

          {loading ? (
            <LoadingSkeleton rows={6} height="3rem" />
          ) : trigger ? (
            <IdempotentNotice trigger={trigger} onClose={onClose} />
          ) : (
            <>
              <CompositionCounter
                counts={counts}
                required={{ u15u11: REQUIRED_U15_U11, u15u13: REQUIRED_U15_U13 }}
              />

              <ol className="space-y-4">
                {slots.map((slot, idx) => {
                  const kind = pairKinds[idx];
                  const isInvalid =
                    kind === 'invalid' || serverInvalidIndex === idx;
                  return (
                    <PairSlot
                      key={idx}
                      index={idx}
                      slot={slot}
                      players={players}
                      excludedIds={selectedIds}
                      kind={kind}
                      isInvalid={isInvalid}
                      isServerHighlighted={serverInvalidIndex === idx}
                      onChange={(s, v) => setSlot(idx, s, v)}
                    />
                  );
                })}
              </ol>

              {submitError && (
                <SubmitErrorPanel
                  message={submitError}
                  onDismiss={() => setSubmitError(null)}
                />
              )}
            </>
          )}
        </div>
      </div>

      {!loading && !trigger && (
        <footer className="border-t border-navy-light bg-navy-dark/40 px-4 py-3">
          <div className="max-w-3xl mx-auto flex flex-col-reverse sm:flex-row gap-3 sm:justify-end items-stretch sm:items-center">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2.5 rounded-md bg-navy-light text-white font-body font-medium hover:bg-navy transition-colors min-h-[44px]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={!canLock || submitting}
              className="px-4 py-2.5 rounded-md bg-gold text-navy-dark font-body font-semibold hover:bg-gold-bright transition-colors disabled:bg-navy-light disabled:text-slate disabled:cursor-not-allowed min-h-[44px]"
            >
              {submitting ? 'Locking…' : 'Lock Draw'}
            </button>
          </div>
        </footer>
      )}

      {confirming && (
        <ConfirmModal
          title="Lock Girls Doubles Draw"
          body="Create 5 teams and 10 round-robin matches. Once locked the draw cannot be changed. Continue?"
          confirmLabel={submitting ? 'Locking…' : 'Lock Draw'}
          cancelLabel="Cancel"
          onConfirm={() => void submit()}
          onCancel={() => (submitting ? null : setConfirming(false))}
        />
      )}
    </div>
  );
}

function CompositionCounter({
  counts,
  required,
}: {
  counts: { u15u11: number; u15u13: number };
  required: { u15u11: number; u15u13: number };
}) {
  const u15u11Ok = counts.u15u11 === required.u15u11;
  const u15u13Ok = counts.u15u13 === required.u15u13;
  return (
    <div className="rounded-lg border border-navy-light bg-navy-light/30 p-3">
      <p className="font-body text-xs uppercase tracking-[0.2em] text-slate mb-2">
        Composition
      </p>
      <div className="flex flex-wrap gap-3 text-sm font-body">
        <CountChip label="U15 + U11" current={counts.u15u11} required={required.u15u11} ok={u15u11Ok} />
        <CountChip label="U15 + U13" current={counts.u15u13} required={required.u15u13} ok={u15u13Ok} />
      </div>
    </div>
  );
}

function CountChip({
  label,
  current,
  required,
  ok,
}: {
  label: string;
  current: number;
  required: number;
  ok: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border ${
        ok
          ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
          : 'bg-navy-dark/40 text-slate-light border-navy-light'
      }`}
    >
      <span className="font-medium">{label}</span>
      <span className="tabular-nums">
        {current}/{required}
      </span>
    </span>
  );
}

function PairSlot({
  index,
  slot,
  players,
  excludedIds,
  kind,
  isInvalid,
  isServerHighlighted,
  onChange,
}: {
  index: number;
  slot: SlotState;
  players: Player[];
  excludedIds: Set<string>;
  kind: PairKind;
  isInvalid: boolean;
  isServerHighlighted: boolean;
  onChange: (slot: 'p1' | 'p2', value: string) => void;
}) {
  const showInvalid = isInvalid && (kind === 'invalid' || isServerHighlighted);
  const borderClass = showInvalid
    ? 'border-error/60 ring-1 ring-error/30'
    : kind === 'U15+U11' || kind === 'U15+U13'
      ? 'border-gold/30'
      : 'border-navy-light';

  return (
    <li
      className={`rounded-lg border bg-navy-light/30 p-3 space-y-3 ${borderClass}`}
      data-pair-index={index}
    >
      <div className="flex items-center justify-between">
        <span className="font-display text-sm text-white">Pair {index + 1}</span>
        <PairKindBadge kind={kind} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <PlayerSelect
          label={`Pair ${index + 1} · Player A`}
          value={slot.p1}
          players={players}
          excludedIds={excludedIds}
          onChange={(v) => onChange('p1', v)}
        />
        <PlayerSelect
          label={`Pair ${index + 1} · Player B`}
          value={slot.p2}
          players={players}
          excludedIds={excludedIds}
          onChange={(v) => onChange('p2', v)}
        />
      </div>
      {showInvalid && (
        <p className="text-xs font-body text-error">
          Invalid pair — needs U15+U11 or U15+U13.
        </p>
      )}
    </li>
  );
}

function PairKindBadge({ kind }: { kind: PairKind }) {
  if (kind === 'incomplete') {
    return (
      <span className="text-[11px] font-body uppercase tracking-wider text-slate">
        Incomplete
      </span>
    );
  }
  if (kind === 'invalid') {
    return (
      <span className="text-[11px] font-body uppercase tracking-wider text-error">
        Invalid
      </span>
    );
  }
  return (
    <span className="text-[11px] font-body uppercase tracking-wider text-gold-bright">
      {kind}
    </span>
  );
}

function PlayerSelect({
  label,
  value,
  players,
  excludedIds,
  onChange,
}: {
  label: string;
  value: string;
  players: Player[];
  excludedIds: Set<string>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md bg-navy-dark text-white font-body text-sm border border-navy-light focus:border-gold focus:outline-none px-3 py-2.5 min-h-[44px]"
      >
        <option value="">Select player…</option>
        {players.map((p) => {
          const taken = excludedIds.has(p.id) && p.id !== value;
          if (taken) return null;
          return (
            <option key={p.id} value={p.id}>
              {p.display_name} · {p.age_group}
            </option>
          );
        })}
      </select>
    </label>
  );
}

function SubmitErrorPanel({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  const code = parseRpcErrorCode(message);
  let body: string;
  let amber = false;
  switch (code) {
    case 'DRAW_ALREADY_LOCKED':
      body = `${message.replace(/^DRAW_ALREADY_LOCKED:\s*/, 'Draw already locked: ')}`;
      amber = true;
      break;
    case 'INVALID_COMPOSITION':
      body = 'Invalid composition — exactly 3 (U15+U11) and 2 (U15+U13) pairs are required.';
      break;
    case 'WITHDRAWN_PLAYER':
      body = 'One pair includes a withdrawn player. Refresh and reassign.';
      break;
    default:
      body = message;
  }
  return (
    <div
      role="alert"
      className={`rounded-md px-3 py-2 text-sm font-body border ${
        amber
          ? 'bg-amber-warning/15 border-amber-warning/40 text-amber-warning'
          : 'bg-error/15 border-error/40 text-error'
      }`}
    >
      {body}
      <button
        type="button"
        onClick={onDismiss}
        className="ml-3 underline underline-offset-2"
      >
        Dismiss
      </button>
    </div>
  );
}

function IdempotentNotice({ trigger, onClose }: { trigger: TriggerRecord; onClose: () => void }) {
  return (
    <div className="rounded-lg border border-amber-warning/40 bg-amber-warning/10 p-4 space-y-3">
      <p className="font-body text-sm text-amber-warning">
        Draw posted by <span className="text-white">{trigger.fired_by}</span> at{' '}
        {formatTimestamp(trigger.fired_at)}. The draw cannot be re-posted.
      </p>
      <button
        type="button"
        onClick={onClose}
        className="px-4 py-2.5 rounded-md bg-navy-light text-white font-body font-medium hover:bg-navy transition-colors min-h-[44px]"
      >
        Close
      </button>
    </div>
  );
}
