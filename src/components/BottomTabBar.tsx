import type React from 'react';

export type PublicTab = 'now-playing' | 'brackets' | 'standings' | 'champion-board' | 'results';

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

function ResultsIcon({ className }: { className?: string }) {
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
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3-3" />
      <path d="M8 11h6M11 8v6" strokeWidth="1.5" />
    </svg>
  );
}

const TABS: {
  id: PublicTab;
  label: string;
  Icon: React.FC<{ className?: string }>;
}[] = [
  { id: 'now-playing',    label: 'Live',      Icon: PlayIcon },
  { id: 'brackets',       label: 'Brackets',  Icon: BracketsIcon },
  { id: 'standings',      label: 'Standings', Icon: ListIcon },
  { id: 'champion-board', label: 'Champions', Icon: TrophyIcon },
  { id: 'results',        label: 'Results',   Icon: ResultsIcon },
];

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
                className="w-full flex flex-col items-center justify-center pt-2.5 pb-1.5 px-1 min-h-[56px] group"
              >
                <span
                  className={`inline-flex flex-col items-center gap-1 px-2 py-1 rounded-xl transition-all duration-200 ${
                    isActive
                      ? 'bg-gold/[0.13]'
                      : 'group-active:bg-white/[0.04] group-hover:bg-white/[0.03]'
                  }`}
                >
                  <tab.Icon
                    className={`w-[18px] h-[18px] transition-colors duration-200 ${
                      isActive ? 'text-gold-bright' : 'text-slate group-hover:text-slate-light'
                    }`}
                  />
                  <span
                    className={`text-[9px] font-body font-medium tracking-wide transition-colors duration-200 ${
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

      {/* Footer */}
      <div className="flex items-center justify-center gap-2 py-2 border-t border-white/[0.04]">
        <span className="font-body text-[11px] text-slate/60 select-none">
          Powered by Zorvance Technologies Ltd
        </span>
        <span className="text-slate/30 select-none">|</span>
        <a
          href="mailto:info@zorvance.com"
          className="inline-flex items-center gap-1 font-body text-[11px] text-slate/60 hover:text-gold-bright transition-colors"
          aria-label="Email info@zorvance.com"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-3 h-3 shrink-0"
            aria-hidden="true"
          >
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <path d="M2 8l10 6 10-6" />
          </svg>
          <span>info@zorvance.com</span>
        </a>
      </div>
    </nav>
  );
}
