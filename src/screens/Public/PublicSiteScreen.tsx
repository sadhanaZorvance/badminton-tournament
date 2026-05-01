import { useCallback, useState } from 'react';
import PublicShell from '../../components/PublicShell';
import type { PublicTab } from '../../components/BottomTabBar';
import StandingsScreen from '../Standings/StandingsScreen';
import BracketsTab from './BracketsTab';
import ChampionBoardTab from './ChampionBoardTab';
import NowPlayingTab from './NowPlayingTab';

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
      {activeTab === 'brackets' && <BracketsTab refreshTick={refreshTick} />}
      {activeTab === 'standings' && <StandingsScreen key={refreshTick} />}
      {activeTab === 'champion-board' && <ChampionBoardTab refreshTick={refreshTick} />}
    </PublicShell>
  );
}
