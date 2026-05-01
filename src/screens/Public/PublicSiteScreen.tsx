import { useCallback, useState } from 'react';
import PublicShell from '../../components/PublicShell';
import type { PublicTab } from '../../components/BottomTabBar';
import NowPlayingTab from './NowPlayingTab';

function ComingSoon({ name }: { name: string }) {
  return (
    <div className="rounded-lg bg-navy-light/40 border border-navy-light px-4 py-12 text-center">
      <h2 className="font-display text-2xl text-gold-bright mb-2">{name}</h2>
      <p className="font-body text-slate">Coming soon</p>
    </div>
  );
}

export default function PublicSiteScreen() {
  const [activeTab, setActiveTab] = useState<PublicTab>('now-playing');
  const [refreshTick, setRefreshTick] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    setRefreshTick((t) => t + 1);
    window.setTimeout(() => setRefreshing(false), 800);
  }, []);

  return (
    <PublicShell
      activeTab={activeTab}
      onTabChange={setActiveTab}
      onRefresh={handleRefresh}
      refreshing={refreshing}
    >
      {activeTab === 'now-playing' && <NowPlayingTab refreshTick={refreshTick} />}
      {activeTab === 'brackets' && <ComingSoon name="Brackets" />}
      {activeTab === 'standings' && <ComingSoon name="Standings" />}
      {activeTab === 'champion-board' && <ComingSoon name="Champion Board" />}
    </PublicShell>
  );
}
