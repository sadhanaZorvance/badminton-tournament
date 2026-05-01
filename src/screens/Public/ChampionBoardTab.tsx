import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ErrorBanner from '../../components/ErrorBanner';
import LoadingSkeleton from '../../components/LoadingSkeleton';
import { supabase } from '../../lib/supabase';
import type { EntrantType, Event, Player, Podium, Team } from '../../types';

interface ChampionBoardTabProps {
  refreshTick: number;
}

const POLL_INTERVAL_MS = 30_000;

function formatTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function entrantName(
  id: string | null,
  type: EntrantType | null,
  playerMap: Record<string, Player>,
  teamMap: Record<string, Team>,
): string | null {
  if (!id) return null;
  if (type === 'team') return teamMap[id]?.display_name ?? null;
  if (type === 'player') return playerMap[id]?.display_name ?? null;
  // Fallback when type is null (consolation winner has no *_type column).
  return playerMap[id]?.display_name ?? teamMap[id]?.display_name ?? null;
}

function TrophyIcon() {
  return (
    <svg
      viewBox="0 0 48 48"
      className="w-14 h-14 text-gold"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 8h20v8a10 10 0 0 1-20 0V8z" />
      <path d="M14 12H9a3 3 0 0 0 0 6h5" />
      <path d="M34 12h5a3 3 0 0 1 0 6h-5" />
      <path d="M20 26v6" />
      <path d="M28 26v6" />
      <rect x="16" y="32" width="16" height="3" rx="1" />
      <rect x="14" y="35" width="20" height="4" rx="1" />
    </svg>
  );
}

export default function ChampionBoardTab({ refreshTick }: ChampionBoardTabProps) {
  const [podiums, setPodiums] = useState<Podium[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const isInitial = useRef(true);

  // Track which podium IDs have already been rendered so already-visible cards
  // do not re-animate on refresh — only newly-published ones get the slide-up.
  const seenPodiumIds = useRef<Set<string>>(new Set());

  const fetchAll = useCallback(async () => {
    const [podiumsRes, eventsRes, playersRes, teamsRes] = await Promise.all([
      supabase.from('podiums').select('*').eq('status', 'published'),
      supabase.from('events').select('*').order('code'),
      supabase.from('players').select('*'),
      supabase.from('teams').select('*'),
    ]);
    if (podiumsRes.error) throw podiumsRes.error;
    if (eventsRes.error) throw eventsRes.error;
    if (playersRes.error) throw playersRes.error;
    if (teamsRes.error) throw teamsRes.error;
    setPodiums((podiumsRes.data ?? []) as Podium[]);
    setEvents((eventsRes.data ?? []) as Event[]);
    setPlayers((playersRes.data ?? []) as Player[]);
    setTeams((teamsRes.data ?? []) as Team[]);
    setLastUpdated(new Date());
  }, []);

  const load = useCallback(async () => {
    if (isInitial.current) setLoading(true);
    setError(null);
    try {
      await fetchAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load champions');
    } finally {
      setLoading(false);
      isInitial.current = false;
    }
  }, [fetchAll]);

  useEffect(() => {
    void load();
  }, [load, refreshTick]);

  // Polling fallback: 30s alongside Realtime, never instead of it.
  useEffect(() => {
    const id = window.setInterval(() => {
      void load();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  // Realtime: any podium change re-fetches. INSERT/UPDATE with status='published'
  // will surface a new card; UPDATE flipping to 'draft' removes it.
  useEffect(() => {
    const channel = supabase
      .channel('public-champion-board')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'podiums' },
        () => {
          void load();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
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

  const eventById = useMemo(() => {
    const m = new Map<string, Event>();
    for (const e of events) m.set(e.id, e);
    return m;
  }, [events]);

  const sortedPodiums = useMemo(() => {
    const list = podiums
      .map((p) => ({ podium: p, event: eventById.get(p.event_id) ?? null }))
      .filter((x): x is { podium: Podium; event: Event } => x.event !== null);
    list.sort((a, b) => a.event.code.localeCompare(b.event.code));
    return list;
  }, [podiums, eventById]);

  if (loading) {
    return (
      <div>
        <LoadingSkeleton rows={3} height="11rem" />
      </div>
    );
  }

  if (sortedPodiums.length === 0) {
    return (
      <div>
        {error && <ErrorBanner message={error} onRetry={() => void load()} />}
        <div className="rounded-lg bg-navy-light/40 border border-navy-light px-6 py-14 flex flex-col items-center gap-4 text-center">
          <TrophyIcon />
          <p className="font-body text-white text-base">
            Champions will appear here as events conclude
          </p>
          <p className="font-body text-slate italic text-sm">
            Smash Your Limits
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {error && <ErrorBanner message={error} onRetry={() => void load()} />}

      <ul className="space-y-4">
        {sortedPodiums.map(({ podium, event }) => {
          const isNew = !seenPodiumIds.current.has(podium.id);
          if (isNew) seenPodiumIds.current.add(podium.id);
          const goldName = entrantName(podium.gold_id, podium.gold_type, playerMap, teamMap);
          const silverName = entrantName(podium.silver_id, podium.silver_type, playerMap, teamMap);
          const bronzeName = entrantName(podium.bronze_id, podium.bronze_type, playerMap, teamMap);
          const consolationName = entrantName(
            podium.consolation_winner_id,
            null,
            playerMap,
            teamMap,
          );
          return (
            <li key={podium.id}>
              <PodiumCard
                eventName={event.name}
                eventCode={event.code}
                goldName={goldName}
                silverName={silverName}
                bronzeName={bronzeName}
                consolationName={consolationName}
                animate={isNew}
              />
            </li>
          );
        })}
      </ul>

      {lastUpdated && (
        <p className="text-slate text-xs font-body text-center mt-6">
          Last updated {formatTime(lastUpdated)}
        </p>
      )}
    </div>
  );
}

interface PodiumCardProps {
  eventName: string;
  eventCode: string;
  goldName: string | null;
  silverName: string | null;
  bronzeName: string | null;
  consolationName: string | null;
  animate: boolean;
}

function PodiumCard({
  eventName,
  eventCode,
  goldName,
  silverName,
  bronzeName,
  consolationName,
  animate,
}: PodiumCardProps) {
  return (
    <article
      className={`rounded-xl bg-navy-light border border-gold/30 px-5 py-5 shadow-lg ${
        animate ? 'animate-slide-up-fade' : ''
      }`}
    >
      <header className="mb-4">
        <p className="font-body text-[11px] uppercase tracking-[0.2em] text-slate mb-0.5">
          {eventCode}
        </p>
        <h3 className="font-display text-xl text-gold-bright tracking-wide">
          {eventName}
        </h3>
      </header>

      <ul className="space-y-2.5">
        <PodiumRow
          medal="🥇"
          label="Gold"
          name={goldName}
          nameClass="font-display text-2xl text-white"
        />
        <PodiumRow
          medal="🥈"
          label="Silver"
          name={silverName}
          nameClass="font-display text-lg text-white"
        />
        <PodiumRow
          medal="🥉"
          label="Bronze"
          name={bronzeName}
          nameClass="font-display text-lg text-white"
        />
      </ul>

      {consolationName && (
        <p className="font-body text-sm text-slate-light mt-4 pt-3 border-t border-navy-dark/60">
          <span className="text-slate uppercase tracking-wider text-[11px] mr-2">
            Consolation
          </span>
          <span className="text-white">{consolationName}</span>
        </p>
      )}
    </article>
  );
}

function PodiumRow({
  medal,
  label,
  name,
  nameClass,
}: {
  medal: string;
  label: string;
  name: string | null;
  nameClass: string;
}) {
  return (
    <li className="flex items-baseline gap-3">
      <span className="text-2xl shrink-0" aria-hidden="true">
        {medal}
      </span>
      <span className="sr-only">{label}:</span>
      <span className={`${nameClass} truncate`}>
        {name ?? <span className="text-slate text-base font-body">—</span>}
      </span>
    </li>
  );
}
