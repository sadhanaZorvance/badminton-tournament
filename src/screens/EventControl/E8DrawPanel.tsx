import { useCallback, useEffect, useState } from 'react';
import ErrorBanner from '../../components/ErrorBanner';
import LoadingSkeleton from '../../components/LoadingSkeleton';
import { supabase } from '../../lib/supabase';
import type { TriggerRecord } from '../../types';

interface E8DrawPanelProps {
  eventId: string;
  drawLocked: boolean;
  onOpenForm: () => void;
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

export default function E8DrawPanel({ eventId, drawLocked, onOpenForm }: E8DrawPanelProps) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [trigger, setTrigger] = useState<TriggerRecord | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { data, error } = await supabase
        .from('trigger_records')
        .select('*')
        .eq('event_id', eventId)
        .eq('trigger_type', 'e8_draw')
        .maybeSingle();
      if (error && error.code !== 'PGRST116') throw error;
      setTrigger((data ?? null) as TriggerRecord | null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load draw status');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <section className="rounded-lg border border-navy-light bg-navy-light/30 p-4">
        <h3 className="font-display text-lg text-gold-bright mb-3">
          Girls Doubles Draw
        </h3>
        <LoadingSkeleton rows={1} height="3rem" />
      </section>
    );
  }

  const locked = drawLocked || trigger !== null;

  return (
    <section className="rounded-lg border border-navy-light bg-navy-light/30 p-4">
      <h3 className="font-display text-lg text-gold-bright mb-3">
        Girls Doubles Draw
      </h3>

      {loadError && <ErrorBanner message={loadError} onRetry={() => void load()} />}

      {locked ? (
        <div className="space-y-3">
          {trigger && (
            <div className="flex items-center gap-2 text-sm font-body text-slate-light">
              <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[11px] uppercase tracking-wider">
                Locked
              </span>
              <span>
                by <span className="text-white">{trigger.fired_by}</span> at{' '}
                {formatTimestamp(trigger.fired_at)}
              </span>
            </div>
          )}
          <p className="font-body text-sm text-slate-light">
            10 round-robin matches have been generated. The draw cannot be re-posted.
          </p>
          <button
            type="button"
            disabled
            className="w-full sm:w-auto px-4 py-2.5 rounded-md bg-navy-light text-slate font-body font-semibold cursor-not-allowed min-h-[44px]"
          >
            Post Girls Doubles Draw
          </button>
        </div>
      ) : (
        <div>
          <button
            type="button"
            onClick={onOpenForm}
            className="w-full sm:w-auto px-4 py-2.5 rounded-md bg-gold text-navy-dark font-body font-semibold hover:bg-gold-bright transition-colors min-h-[44px]"
          >
            Post Girls Doubles Draw
          </button>
        </div>
      )}
    </section>
  );
}
