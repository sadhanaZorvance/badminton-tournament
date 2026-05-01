import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import LoginScreen from './screens/Login/LoginScreen';
import MatchPickerScreen from './screens/MatchPicker/MatchPickerScreen';
import ScoreEntryScreen from './screens/ScoreEntry/ScoreEntryScreen';
import EventControlScreen from './screens/EventControl/EventControlScreen';
import ChampionBoardAdminScreen from './screens/ChampionBoardAdmin/ChampionBoardAdminScreen';
import ProtectedRoute from './components/ProtectedRoute';
import AdminHeader from './components/AdminHeader';
import { getCourtAdminSlug, getTopAdminSlug } from './lib/auth';
import logo from './assets/logo.png';

function PublicPlaceholder() {
  return (
    <div className="min-h-screen bg-navy text-white flex flex-col items-center justify-center px-6 py-10">
      <img src={logo} alt="Leo Badminton Club" className="h-24 mb-6" />
      <h1 className="font-display text-4xl text-gold-bright tracking-wide mb-2">
        Leo Rising Stars 2026
      </h1>
      <p className="font-body text-slate text-lg mb-10">Smash Your Limits</p>
      <p className="font-body text-slate text-sm">
        Public site coming soon.
      </p>
      <footer className="mt-12 text-slate text-xs">
        Powered by Zorvance Technology · info@zorvance.com
      </footer>
    </div>
  );
}

function AdminPlaceholder({ basePath, loginPath, title }: { basePath: string; loginPath: string; title: string }) {
  return (
    <div className="min-h-screen bg-navy text-white flex flex-col">
      <AdminHeader basePath={basePath} loginPath={loginPath} />
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-8">
        <h2 className="font-display text-2xl text-gold-bright mb-2">{title}</h2>
        <p className="font-body text-slate">
          This screen will be built in a later prompt.
        </p>
      </main>
    </div>
  );
}

function MissingSlugBanner() {
  return (
    <div className="min-h-screen bg-navy text-white flex flex-col items-center justify-center px-6 py-10">
      <h1 className="font-display text-2xl text-gold-bright mb-3">Configuration error</h1>
      <p className="font-body text-slate text-center max-w-md">
        Admin URL slugs are not configured. Set{' '}
        <code className="text-gold">VITE_COURT_ADMIN_SLUG</code> and{' '}
        <code className="text-gold">VITE_TOP_ADMIN_SLUG</code> in your environment and rebuild.
      </p>
    </div>
  );
}

export default function App() {
  const courtSlug = getCourtAdminSlug();
  const topSlug = getTopAdminSlug();

  if (!courtSlug || !topSlug || courtSlug === topSlug) {
    return (
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<PublicPlaceholder />} />
          <Route path="*" element={<MissingSlugBanner />} />
        </Routes>
      </BrowserRouter>
    );
  }

  const courtBase = `/${courtSlug}`;
  const topBase = `/${topSlug}`;

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<PublicPlaceholder />} />

        <Route
          path={courtBase}
          element={<LoginScreen role="court_admin" basePath={courtBase} />}
        />
        <Route
          path={`${courtBase}/picker`}
          element={
            <ProtectedRoute role="court_admin" loginPath={courtBase}>
              <MatchPickerScreen basePath={courtBase} loginPath={courtBase} />
            </ProtectedRoute>
          }
        />
        <Route
          path={`${courtBase}/score/:matchId`}
          element={
            <ProtectedRoute role="court_admin" loginPath={courtBase}>
              <ScoreEntryScreen basePath={courtBase} loginPath={courtBase} />
            </ProtectedRoute>
          }
        />
        <Route
          path={`${courtBase}/*`}
          element={
            <ProtectedRoute role="court_admin" loginPath={courtBase}>
              <AdminPlaceholder basePath={courtBase} loginPath={courtBase} title="Court Admin" />
            </ProtectedRoute>
          }
        />

        <Route
          path={topBase}
          element={<LoginScreen role="top_admin" basePath={topBase} />}
        />
        <Route
          path={`${topBase}/picker`}
          element={
            <ProtectedRoute role="top_admin" loginPath={topBase}>
              <MatchPickerScreen basePath={topBase} loginPath={topBase} />
            </ProtectedRoute>
          }
        />
        <Route
          path={`${topBase}/score/:matchId`}
          element={
            <ProtectedRoute role="top_admin" loginPath={topBase}>
              <ScoreEntryScreen basePath={topBase} loginPath={topBase} />
            </ProtectedRoute>
          }
        />
        <Route
          path={`${topBase}/event-control`}
          element={
            <ProtectedRoute role="top_admin" loginPath={topBase}>
              <EventControlScreen basePath={topBase} loginPath={topBase} />
            </ProtectedRoute>
          }
        />
        <Route
          path={`${topBase}/champion-board`}
          element={
            <ProtectedRoute role="top_admin" loginPath={topBase}>
              <ChampionBoardAdminScreen basePath={topBase} loginPath={topBase} />
            </ProtectedRoute>
          }
        />
        <Route
          path={`${topBase}/*`}
          element={
            <ProtectedRoute role="top_admin" loginPath={topBase}>
              <AdminPlaceholder basePath={topBase} loginPath={topBase} title="Top Admin" />
            </ProtectedRoute>
          }
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
