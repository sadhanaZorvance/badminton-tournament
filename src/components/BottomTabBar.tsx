export type PublicTab = 'now-playing' | 'brackets' | 'standings' | 'champion-board';

interface BottomTabBarProps {
  activeTab: PublicTab;
  onTabChange: (tab: PublicTab) => void;
}

const TABS: { id: PublicTab; label: string }[] = [
  { id: 'now-playing', label: 'Now Playing' },
  { id: 'brackets', label: 'Brackets' },
  { id: 'standings', label: 'Standings' },
  { id: 'champion-board', label: 'Champions' },
];

export default function BottomTabBar({ activeTab, onTabChange }: BottomTabBarProps) {
  return (
    <nav
      className="fixed bottom-7 left-0 right-0 z-20 bg-navy-dark border-t border-navy-light"
      aria-label="Public site navigation"
    >
      <ul className="max-w-5xl mx-auto flex items-stretch">
        {TABS.map((tab) => {
          const isActive = tab.id === activeTab;
          return (
            <li key={tab.id} className="flex-1">
              <button
                type="button"
                onClick={() => onTabChange(tab.id)}
                aria-current={isActive ? 'page' : undefined}
                className={`w-full min-h-[56px] px-2 py-2 text-xs font-body font-medium tracking-wide transition-colors ${
                  isActive
                    ? 'text-gold-bright border-t-2 border-gold-bright'
                    : 'text-slate border-t-2 border-transparent hover:text-slate-light'
                }`}
              >
                {tab.label}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
