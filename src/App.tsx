import { supabase } from './lib/supabase';
import logo from './assets/logo.png';

if (typeof window !== 'undefined') {
  // eslint-disable-next-line no-console
  console.log('Supabase URL:', import.meta.env.VITE_SUPABASE_URL ?? '(unset)');
  // eslint-disable-next-line no-console
  console.log('Supabase client initialised:', Boolean(supabase));
}

export default function App() {
  return (
    <div className="min-h-screen bg-navy text-white flex flex-col items-center justify-center px-6 py-10">
      <img src={logo} alt="Leo Badminton Club" className="h-24 mb-8" />

      <h1 className="font-display text-4xl text-gold-bright tracking-wide mb-2">
        Leo Rising Stars
      </h1>
      <p className="font-body text-slate text-lg mb-10">Smash Your Limits</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-xl">
        <div className="bg-navy-light border-l-4 border-gold rounded-md p-5">
          <p className="font-display text-gold uppercase tracking-widest text-sm mb-2">
            Display Font
          </p>
          <p className="font-display text-2xl">Cinzel renders here</p>
        </div>

        <div className="bg-navy-light border-l-4 border-gold-bright rounded-md p-5">
          <p className="font-body text-slate uppercase tracking-widest text-xs mb-2">
            Body Font
          </p>
          <p className="font-body text-xl">DM Sans renders here</p>
        </div>

        <div className="bg-navy-dark rounded-md p-5">
          <p className="text-slate text-xs uppercase tracking-widest mb-2">Palette</p>
          <div className="flex gap-2">
            <span className="w-6 h-6 rounded bg-navy border border-slate" />
            <span className="w-6 h-6 rounded bg-navy-light border border-slate" />
            <span className="w-6 h-6 rounded bg-gold" />
            <span className="w-6 h-6 rounded bg-gold-bright" />
            <span className="w-6 h-6 rounded bg-amber-warning" />
          </div>
        </div>

        <div className="bg-navy-light rounded-md p-5 animate-pulse-gold border-l-4 border-gold-bright">
          <p className="text-gold-bright text-xs uppercase tracking-widest mb-2">Live</p>
          <p className="font-display text-xl">Pulse animation</p>
        </div>
      </div>

      <footer className="mt-12 text-slate text-xs">
        Powered by Zorvance Technology · info@zorvance.com
      </footer>
    </div>
  );
}
