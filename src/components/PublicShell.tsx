import type { ReactNode } from 'react';
import logo from '../assets/logo.png';
import BottomTabBar, { type PublicTab } from './BottomTabBar';

interface PublicShellProps {
  activeTab: PublicTab;
  onTabChange: (tab: PublicTab) => void;
  children: ReactNode;
}

export default function PublicShell({ activeTab, onTabChange, children }: PublicShellProps) {
  return (
    <div className="min-h-screen bg-navy text-white flex flex-col">
      <header className="sticky top-0 z-30 bg-navy-dark border-b border-navy-light">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          <img src={logo} alt="Leo Badminton Club" className="h-8 w-auto" />
          <span className="font-display text-gold-bright text-lg tracking-wide">
            Leo Rising Stars 2026
          </span>
        </div>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-4 pb-32 overflow-y-auto">
        {children}
      </main>

      <BottomTabBar activeTab={activeTab} onTabChange={onTabChange} />

      <footer className="fixed bottom-0 left-0 right-0 z-10 bg-navy-dark border-t border-navy-light text-center text-slate text-xs py-2">
        Powered by Zorvance Technology · info@zorvance.com
      </footer>
    </div>
  );
}
