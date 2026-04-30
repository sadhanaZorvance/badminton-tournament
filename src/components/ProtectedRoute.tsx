import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { getSession, type Role } from '../lib/auth';

interface ProtectedRouteProps {
  role: Exclude<Role, 'public'>;
  loginPath: string;
  children: ReactNode;
}

export default function ProtectedRoute({ role, loginPath, children }: ProtectedRouteProps) {
  const location = useLocation();
  const session = getSession();

  if (!session || session.role !== role) {
    return <Navigate to={loginPath} replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
