import { useState } from "react";
import { supabase } from "../lib/supabase";

type ThemeMode = "system" | "light" | "dark";

export function AuthScreen({ onPreview, themeMode, onThemeChange, initialMode = "signup" }: { onPreview: () => void; themeMode: ThemeMode; onThemeChange: (mode: ThemeMode) => Promise<void>; initialMode?: "signin" | "signup" }) {
  const [mode, setMode] = useState<"signin" | "signup">(initialMode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const redirectTo = import.meta.env.VITE_AUTH_REDIRECT_URL || window.location.origin;
  const chooseTheme = async (mode: ThemeMode) => { try { await onThemeChange(mode); } catch (value) { setMessage(value instanceof Error ? value.message : "Could not save your appearance preference."); } };

  const signInWithGoogle = async () => {
    if (!supabase) { setMessage("Supabase is not configured in this environment."); return; }
    setBusy(true);
    setMessage("");
    const result = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo } });
    if (result.error) { setBusy(false); setMessage(result.error.message); }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!supabase) { setMessage("Supabase is not configured in this environment."); return; }
    setBusy(true);
    setMessage("");
    const result = mode === "signin"
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password, options: { data: { name }, emailRedirectTo: redirectTo } });
    setBusy(false);
    if (result.error) setMessage(result.error.message);
    else if (mode === "signup" && !result.data.session) setMessage(`Check your email to confirm your account. The link will return to ${redirectTo}.`);
  };

  return <div className="auth-shell"><div className="auth-brand"><img className="brand-logo" src="/neulifi-logo.png" alt="" aria-hidden="true"/><strong>Neulifi</strong></div><div className="auth-card"><div className="auth-card-topline"><div className="auth-icon">S</div><label className="auth-appearance"><span className="sr-only">Appearance theme</span><select aria-label="Appearance theme" value={themeMode} onChange={(event) => { void chooseTheme(event.target.value as ThemeMode); }}><option value="system">System theme</option><option value="light">Light mode</option><option value="dark">Dark mode</option></select></label></div><p className="eyebrow">YOUR HEALTH COMPANION</p><h1>{mode === "signin" ? "Welcome back" : "Start your Neulifi journey"}</h1><p className="auth-subtitle">{mode === "signin" ? "Sign in to keep your meals, actions, and insights together." : "Create a private space for practical, sustainable progress."}</p><button type="button" className="button button-google" onClick={signInWithGoogle} disabled={busy}><span className="google-glyph" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path fill="#4285F4" d="M21.35 12.27c0-.72-.06-1.41-.18-2.07H12v3.92h5.24a4.48 4.48 0 0 1-1.94 2.94v2.45h3.14c1.84-1.69 2.91-4.18 2.91-7.24Z"/><path fill="#34A853" d="M12 21.75c2.63 0 4.84-.87 6.45-2.35l-3.14-2.45c-.87.58-1.98.92-3.31.92-2.55 0-4.72-1.72-5.5-4.04H3.25v2.53A9.75 9.75 0 0 0 12 21.75Z"/><path fill="#FBBC05" d="M6.5 13.83A5.86 5.86 0 0 1 6.19 12c0-.64.11-1.26.31-1.83V7.64H3.25A9.75 9.75 0 0 0 2.25 12c0 1.57.38 3.05 1 4.36l3.25-2.53Z"/><path fill="#EA4335" d="M12 6.13c1.43 0 2.72.49 3.74 1.46l2.8-2.8C16.83 3.23 14.63 2.25 12 2.25a9.75 9.75 0 0 0-8.75 5.39L6.5 10.17C7.28 7.85 9.45 6.13 12 6.13Z"/></svg></span>{busy ? "Connecting…" : "Continue with Google"}</button><div className="auth-divider"><span>or use email</span></div><form onSubmit={submit}>{mode === "signup" && <label className="auth-field"><span>Your name</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Sarah Chen" required/></label>}<label className="auth-field"><span>Email</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required/></label><label className="auth-field"><span>Password</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 6 characters" minLength={6} required/><small className="auth-helper">Use at least 6 characters.</small></label><button className="button button-green auth-submit" disabled={busy}>{busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}</button></form>{message && <p className="auth-message" role="alert">{message}</p>}<button type="button" className="auth-switch" onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setMessage(""); }}>{mode === "signin" ? "New to Neulifi? Create an account" : "Already have an account? Sign in"}</button></div><button type="button" className="preview-link" onClick={onPreview}>Continue with preview data</button><p className="auth-footnote">Your health data is private to your account.</p></div>;
}
