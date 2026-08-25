import { createClient, type Session } from "@supabase/supabase-js";

// These are intentionally public Supabase browser values. Keep service-role and AI keys server-side.
// Keep the property access static so Vite replaces the production values in the browser bundle.
const url = String(import.meta.env.VITE_SUPABASE_URL || import.meta.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
const publishableKey = String(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "").trim();

export const supabase = url && publishableKey ? createClient(url, publishableKey, {
  auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: false, flowType: "pkce" },
}) : null;

// Password-reset links must be usable when the original tab is closed or the link is opened in a new tab.
// Keep ordinary sign-in PKCE behavior unchanged, but request recovery links without a browser-bound verifier.
export const recoverySupabase = url && publishableKey ? createClient(url, publishableKey, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false, flowType: "implicit", storageKey: "neulifi-recovery-auth" },
}) : null;

function tokenTimes(accessToken: string) {
  try {
    const encoded = accessToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(encoded.padEnd(encoded.length + (4 - encoded.length % 4) % 4, "=")));
    return { issuedAt: Number(payload.iat || 0), expiresAt: Number(payload.exp || 0) };
  } catch {
    return { issuedAt: 0, expiresAt: 0 };
  }
}

let refreshPromise: Promise<Session | null> | null = null;
export async function refreshHealthySession(): Promise<Session | null> {
  if (!supabase) return null;
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const refreshed = await supabase.auth.refreshSession();
    if (refreshed.error || !refreshed.data.session) { await supabase.auth.signOut(); return null; }
    const session = refreshed.data.session;
    if (tokenTimes(session.access_token).issuedAt > Math.floor(Date.now() / 1000) + 30) { await supabase.auth.signOut(); return null; }
    return session;
  })().finally(() => { refreshPromise = null; });
  return refreshPromise;
}

export async function getHealthySession(): Promise<Session | null> {
  if (!supabase) return null;
  const current = await supabase.auth.getSession();
  if (current.error) { await supabase.auth.signOut(); return null; }
  const session = current.data.session;
  if (!session) return null;
  const now = Math.floor(Date.now() / 1000);
  const { issuedAt, expiresAt } = tokenTimes(session.access_token);
  if (issuedAt > now + 30 || (expiresAt > 0 && expiresAt <= now + 30)) return refreshHealthySession();
  return session;
}
