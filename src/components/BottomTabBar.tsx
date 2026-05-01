export type PublicTab = 'now-playing' | 'brackets' | 'standings' | 'champion-board';

interface BottomTabBarProps {
  activeTab: PublicTab;
  onTabChange: (tab: PublicTab) => void;
}

function PlayIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? 'w-5 h-5'}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M10 8.5l5.5 3.5-5.5 3.5V8.5z" fill="currentColor" stroke="none" />
    </svg>
  );
}

function BracketsIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? 'w-5 h-5'}
      aria-hidden="true"
    >
      <rect x="2" y="4" width="6" height="4" rx="1" />
      <rect x="2" y="16" width="6" height="4" rx="1" />
      <rect x="16" y="10" width="6" height="4" rx="1" />
      <path d="M8 6h4v6h4M8 18h4v-6" />
    </svg>
  );
}

function ListIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? 'w-5 h-5'}
      aria-hidden="true"
    >
      <path d="M8 6h13M8 12h10M8 18h7" />
      <circle cx="4" cy="6" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="4" cy="12" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="4" cy="18" r="1.25" fill="currentColor" stroke="none" />
    </svg>
  );
}

function TrophyIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? 'w-5 h-5'}
      aria-hidden="true"
    >
      <path d="M8 4h8v6a4 4 0 0 1-8 0V4z" />
      <path d="M4 6h4M16 6h4" />
      <path d="M12 14v3M9 17h6" />
    </svg>
  );
}

const TABS: {
  id: PublicTab;
  label: string;
  Icon: React.FC<{ className?: string }>;
}[] = [
  { id: 'now-playing', label: 'Now Playing', Icon: PlayIcon },
  { id: 'brackets',    label: 'Brackets',    Icon: BracketsIcon },
  { id: 'standings',   label: 'Standings',   Icon: ListIcon },
  { id: 'champion-board', label: 'Champions', Icon: TrophyIcon },
];

import type React from 'react';

export default function BottomTabBar({ activeTab, onTabChange }: BottomTabBarProps) {
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-20 bg-navy-dark/95 backdrop-blur-sm border-t border-white/[0.07]"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
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
                className="w-full flex flex-col items-center justify-center pt-2.5 pb-1.5 px-1 min-h-[60px] group"
              >
                <span
                  className={`inline-flex flex-col items-center gap-1 px-3 py-1.5 rounded-xl transition-all duration-200 ${
                    isActive
                      ? 'bg-gold/[0.13]'
                      : 'group-active:bg-white/[0.04] group-hover:bg-white/[0.03]'
                  }`}
                >
                  <tab.Icon
                    className={`w-5 h-5 transition-colors duration-200 ${
                      isActive ? 'text-gold-bright' : 'text-slate group-hover:text-slate-light'
                    }`}
                  />
                  <span
                    className={`text-[10px] font-body font-medium tracking-wide transition-colors duration-200 ${
                      isActive ? 'text-gold-bright' : 'text-slate group-hover:text-slate-light'
                    }`}
                  >
                    {tab.label}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="text-center text-[9px] font-body pb-2 pt-0.5 text-slate/35 select-none pointer-events-none">
        Powered by Zorvance Technology
      </p>
    </nav>
  );
}
