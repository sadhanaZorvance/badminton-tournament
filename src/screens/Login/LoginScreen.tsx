import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import logo from '../../assets/logo.png';
import {
  applyRoleToSupabase,
  setSession,
  verifyPin,
  type Role,
} from '../../lib/auth';

interface LoginScreenProps {
  role: Exclude<Role, 'public'>;
  basePath: string;
}

export default function LoginScreen({ role, basePath }: LoginScreenProps) {
  const navigate = useNavigate();
  const pinInputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [shaking, setShaking] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!shaking) return;
    const t = window.setTimeout(() => setShaking(false), 320);
    return () => window.clearTimeout(t);
  }, [shaking]);

  const canSubmit = name.trim().length > 0 && pin.length > 0 && !submitting;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;

    if (!verifyPin(role, pin)) {
      setError('Incorrect PIN — try again');
      setPin('');
      setShaking(true);
      pinInputRef.current?.focus();
      return;
    }

    setSubmitting(true);
    setError(null);
    const cleanName = name.trim();
    setSession({ role, name: cleanName });
    await applyRoleToSupabase(role);
    navigate(`${basePath}/picker`, { replace: true });
  }

  const roleLabel = role === 'court_admin' ? 'Court Admin' : 'Top Admin';

  return (
    <div className="min-h-screen bg-navy text-white flex flex-col items-center justify-center px-6 py-10">
      <div className="w-full max-w-sm flex flex-col items-center">
        <img src={logo} alt="Leo Badminton Club" className="h-24 mb-6" />
        <h1 className="font-display text-3xl text-gold-bright tracking-wide text-center">
          Leo Badminton Club
        </h1>
        <p className="font-display text-lg text-gold tracking-widest text-center mt-1">
          Rising Stars 2026
        </p>
        <p className="font-body text-slate text-sm uppercase tracking-[0.25em] mt-3">
          {roleLabel}
        </p>

        <form onSubmit={handleSubmit} className="w-full mt-10 space-y-4" noValidate>
          <div>
            <label className="sr-only" htmlFor="admin-name">
              Your name
            </label>
            <input
              id="admin-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              autoComplete="name"
              className="w-full h-12 px-4 rounded-md bg-navy-light border border-navy-light focus:border-gold focus:outline-none text-white placeholder-slate font-body"
              required
            />
          </div>

          <div>
            <label className="sr-only" htmlFor="admin-pin">
              Admin PIN
            </label>
            <input
              id="admin-pin"
              ref={pinInputRef}
              type="password"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={pin}
              onChange={(e) => {
                if (error) setError(null);
                setPin(e.target.value);
              }}
              placeholder="Admin PIN"
              className={`w-full h-12 px-4 rounded-md bg-navy-light border focus:outline-none text-white placeholder-slate font-body tracking-widest ${
                error ? 'border-error' : 'border-navy-light focus:border-gold'
              } ${shaking ? 'animate-shake' : ''}`}
              required
            />
            {error && (
              <p className="mt-2 text-error text-sm font-body" role="alert">
                {error}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full h-12 rounded-md bg-gold text-navy font-body font-semibold tracking-wide uppercase transition disabled:bg-gold-muted disabled:text-slate disabled:cursor-not-allowed hover:bg-gold-bright"
          >
            {submitting ? 'Signing in…' : 'Enter'}
          </button>
        </form>
      </div>

      <footer className="mt-12 text-slate text-xs">
        Powered by Zorvance Technology · info@zorvance.com
      </footer>
    </div>
  );
}
