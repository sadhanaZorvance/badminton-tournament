import { supabase } from './supabase';

export type Role = 'top_admin' | 'court_admin' | 'public';

export interface Session {
  role: Role;
  name: string;
}

const STORAGE_KEY = 'leo-rs.session';

export function getSession(): Session | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Session;
    if (
      !parsed ||
      typeof parsed.name !== 'string' ||
      (parsed.role !== 'court_admin' && parsed.role !== 'top_admin' && parsed.role !== 'public')
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function setSession(session: Session): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(STORAGE_KEY);
}

export function verifyPin(role: 'court_admin' | 'top_admin', pin: string): boolean {
  const expected =
    role === 'court_admin'
      ? import.meta.env.VITE_COURT_ADMIN_PIN
      : import.meta.env.VITE_TOP_ADMIN_PIN;
  if (!expected) return false;
  return pin === expected;
}

export async function applyRoleToSupabase(role: Role): Promise<void> {
  try {
    await supabase.rpc('set_role', { role });
  } catch {
    // set_role RPC may not yet exist in dev; failure is non-fatal for client routing.
  }
}

export function getCourtAdminSlug(): string {
  return import.meta.env.VITE_COURT_ADMIN_SLUG ?? '';
}

export function getTopAdminSlug(): string {
  return import.meta.env.VITE_TOP_ADMIN_SLUG ?? '';
}
