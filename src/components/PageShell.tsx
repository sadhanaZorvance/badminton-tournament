import type { ReactNode } from 'react';
import AdminHeader from './AdminHeader';

interface PageShellProps {
  basePath: string;
  loginPath: string;
  children: ReactNode;
}

export default function PageShell({ basePath, loginPath, children }: PageShellProps) {
  return (
    <div className="min-h-screen bg-navy text-white flex flex-col">
      <AdminHeader basePath={basePath} loginPath={loginPath} />
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-6 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
