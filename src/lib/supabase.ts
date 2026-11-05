import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Phase 1 pages are public and read-only: one anon client, no cookies, no
// session. Everything goes through RLS and the RPCs in migrations 0003/0012.
// (Phase 2 adds @supabase/ssr for signed-in students.)
let client: SupabaseClient | null = null;

export function publicDb(): SupabaseClient {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set (see .env.local.example)');
  }
  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { 'x-client-info': 'tlevel-placement-finder/phase1' } },
  });
  return client;
}

/** Tiny per-instance TTL cache for reference data that changes monthly at most. */
const cache = new Map<string, { at: number; value: unknown }>();
export async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}
