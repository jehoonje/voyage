// Supabase client (project "voyage", Seoul). The publishable key is meant to ship in the page:
// what each player can read or write is enforced by row-level security on the database.
import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://vlrbzvcypflcemxvygzw.supabase.co';
const KEY = import.meta.env.VITE_SUPABASE_KEY || 'sb_publishable_tQLxRRHW3i92l7ZPNOyxXA_zqY9eoca';

export const supabase = createClient(SUPABASE_URL, KEY, {
  auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true },
});
