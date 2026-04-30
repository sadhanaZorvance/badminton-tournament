import { useCallback, useEffect, useMemo, useState } from 'react';
import AdminHeader from '../../components/AdminHeader';
import ErrorBanner from '../../components/ErrorBanner';
import LoadingSkeleton from '../../components/LoadingSkeleton';
import { supabase } from '../../lib/supabase';
import type { Event } from '../../types';
import BLPTriggerPanel from './BLPTriggerPanel';

interface EventControlScreenProps {
  basePath: string;
  loginPath: string;
}

export default function EventControlScreen({
  basePath,
  loginPath,
}: EventControlScreenProps) {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from('events')
        .select('*')
        .order('code');
      if (err) throw err;
      const list = (data ?? []) as Event[];
      setEvents(list);
      setSelectedEventId((current) => current ?? list.find((e) => e.code === 'E1')?.id ?? list[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load events');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedEvent = useMemo(
    () => events.find((e) => e.id === selectedEventId) ?? null,
    [events, selectedEventId],
  );

  return (
    <div className="min-h-screen bg-navy text-white flex flex-col">
      <AdminHeader
        basePath={basePath}
        loginPath={loginPath}
        onRefresh={() => void load(true)}
        refreshing={refreshing}
      />
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-6 space-y-6">
        <h1 className="font-display text-2xl text-gold-bright">Event Control</h1>

        {error && <ErrorBanner message={error} onRetry={() => void load()} />}

        {loading ? (
          <LoadingSkeleton rows={3} height="3rem" />
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {events.map((ev) => {
                const active = ev.id === selectedEventId;
                return (
                  <button
                    key={ev.id}
                    type="button"
                    onClick={() => setSelectedEventId(ev.id)}
                    className={`px-3 py-1.5 rounded-full text-sm font-body border transition-colors min-h-[36px] ${
                      active
                        ? 'bg-gold text-navy-dark border-gold'
                        : 'bg-navy-light/40 text-slate-light border-navy-light hover:text-white'
                    }`}
                  >
                    {ev.code}
                  </button>
                );
              })}
            </div>

            {selectedEvent ? (
              <section className="space-y-4">
                <header className="space-y-1">
                  <h2 className="font-display text-xl text-white">
                    {selectedEvent.name}
                  </h2>
                  <p className="font-body text-xs uppercase tracking-[0.2em] text-slate">
                    {selectedEvent.code} · {selectedEvent.format_type} · {selectedEvent.status}
                  </p>
                </header>

                {selectedEvent.code === 'E1' ? (
                  <BLPTriggerPanel eventId={selectedEvent.id} />
                ) : (
                  <p className="font-body text-sm text-slate-light">
                    Triggers and match control for this event are built in a later prompt.
                  </p>
                )}
              </section>
            ) : (
              <p className="font-body text-sm text-slate-light">
                No events to display.
              </p>
            )}
          </>
        )}
      </main>
    </div>
  );
}
