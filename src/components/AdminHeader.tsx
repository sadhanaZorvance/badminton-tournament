import { Link, useNavigate } from 'react-router-dom';
import logo from '../assets/logo.png';
import { clearSession, getSession } from '../lib/auth';

interface AdminHeaderProps {
  basePath: string;
  loginPath: string;
  onRefresh?: () => void;
  refreshing?: boolean;
}

export default function AdminHeader({
  basePath,
  loginPath,
  onRefresh,
  refreshing = false,
}: AdminHeaderProps) {
  const navigate = useNavigate();
  const session = getSession();
  const role = session?.role;
  const isTopAdmin = role === 'top_admin';
  const roleLabel = isTopAdmin ? 'Top Admin' : 'Court Admin';

  function handleSignOut() {
    clearSession();
    navigate(loginPath, { replace: true });
  }

  return (
    <header className="w-full bg-navy-dark border-b border-navy-light">
      <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
        <Link to={`${basePath}/picker`} className="flex items-center gap-3">
          <img src={logo} alt="Leo Badminton Club" className="h-8 w-auto" />
          <span className="font-body text-slate text-sm hidden sm:inline">
            Leo Rising Stars 2026
          </span>
        </Link>

        <span className="ml-2 px-2 py-0.5 rounded-full bg-navy-light text-gold-bright text-xs font-body uppercase tracking-wider">
          {roleLabel}
        </span>

        {isTopAdmin && (
          <nav className="ml-4 hidden sm:flex items-center gap-4">
            <Link
              to={`${basePath}/event-control`}
              className="text-slate hover:text-gold-bright text-sm font-body"
            >
              Event Control
            </Link>
            <Link
              to={`${basePath}/champion-board`}
              className="text-slate hover:text-gold-bright text-sm font-body"
            >
              Champion Board
            </Link>
          </nav>
        )}

        <div className="ml-auto flex items-center gap-3">
          {session?.name && (
            <span className="text-slate text-sm font-body hidden sm:inline">
              {session.name}
            </span>
          )}
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              aria-label="Refresh"
              className="p-2 -m-2 text-slate hover:text-gold-bright transition-colors"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`w-5 h-5 ${refreshing ? 'animate-spin' : ''}`}
              >
                <path d="M21 12a9 9 0 0 1-15.5 6.36L3 16" />
                <path d="M3 12a9 9 0 0 1 15.5-6.36L21 8" />
                <polyline points="21 3 21 8 16 8" />
                <polyline points="3 21 3 16 8 16" />
              </svg>
            </button>
          )}
          <button
            type="button"
            onClick={handleSignOut}
            className="text-gold-bright hover:text-gold text-sm font-body underline-offset-4 hover:underline"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
