import { useState } from "react";
import { supabase } from "../lib/supabase";

type ThemeMode = "system" | "light" | "dark";

export function AuthScreen({ onPreview, themeMode, onThemeChange }: { onPreview: () => void; themeMode: ThemeMode; onThemeChange: (mode: ThemeMode) => Promise<void> }) {
  const [mode, setMode] = useState<"signin" | "signup">("signup");
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

  return <div className="auth-shell"><div className="auth-brand"><span className="brand-mark">⌁</span><strong>Nuelifi</strong></div><div className="auth-card"><div className="auth-card-topline"><div className="auth-icon">S</div><label className="auth-appearance"><span className="sr-only">Appearance theme</span><select aria-label="Appearance theme" value={themeMode} onChange={(event) => { void chooseTheme(event.target.value as ThemeMode); }}><option value="system">System theme</option><option value="light">Light mode</option><option value="dark">Dark mode</option></select></label></div><p className="eyebrow">YOUR HEALTH COMPANION</p><h1>{mode === "signin" ? "Welcome back" : "Start your Nuelifi journey"}</h1><p className="auth-subtitle">{mode === "signin" ? "Sign in to keep your meals, actions, and insights together." : "Create a private space for practical, sustainable progress."}</p><button type="button" className="button button-google" onClick={signInWithGoogle} disabled={busy}><span className="google-glyph">G</span>{busy ? "Connecting…" : "Continue with Google"}</button><div className="auth-divider"><span>or use email</span></div><form onSubmit={submit}>{mode === "signup" && <label className="auth-field"><span>Your name</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Sarah Chen" required/></label>}<label className="auth-field"><span>Email</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required/></label><label className="auth-field"><span>Password</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 6 characters" minLength={6} required/><small className="auth-helper">Use at least 6 characters.</small></label><button className="button button-green auth-submit" disabled={busy}>{busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}</button></form>{message && <p className="auth-message" role="alert">{message}</p>}<button type="button" className="auth-switch" onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setMessage(""); }}>{mode === "signin" ? "New to Nuelifi? Create an account" : "Already have an account? Sign in"}</button></div><button type="button" className="preview-link" onClick={onPreview}>Continue with preview data</button><p className="auth-footnote">Your health data is private to your account.</p></div>;
}
