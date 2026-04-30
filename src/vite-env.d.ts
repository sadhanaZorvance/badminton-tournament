/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_COURT_ADMIN_PIN: string;
  readonly VITE_TOP_ADMIN_PIN: string;
  readonly VITE_COURT_ADMIN_SLUG: string;
  readonly VITE_TOP_ADMIN_SLUG: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
