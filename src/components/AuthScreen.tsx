import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";
import { BrandMark } from "./BrandMark";

type ThemeMode = "system" | "light" | "dark";

type AuthScreenProps = {
  onAuthenticated: () => void;
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => Promise<void>;
  initialMode?: "signin" | "signup";
  initialEmail?: string;
  initialMessage?: string;
  passwordRecovery?: boolean;
};

export function AuthScreen({ onAuthenticated, themeMode, onThemeChange, initialMode = "signup", initialEmail = "", initialMessage = "", passwordRecovery = false }: AuthScreenProps) {
  const [mode, setMode] = useState<"signin" | "signup">(initialMode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(initialMessage);
  const [verificationEmail, setVerificationEmail] = useState("");
  const [resetSent, setResetSent] = useState(false);

  useEffect(() => { if (initialEmail) setEmail(initialEmail); }, [initialEmail]);
  useEffect(() => { setMessage(initialMessage); }, [initialMessage]);
  useEffect(() => {
    const resetAfterOAuthReturn = () => { if (document.visibilityState === "visible") setBusy(false); };
    window.addEventListener("pageshow", resetAfterOAuthReturn);
    window.addEventListener("focus", resetAfterOAuthReturn);
    window.addEventListener("popstate", resetAfterOAuthReturn);
    document.addEventListener("visibilitychange", resetAfterOAuthReturn);
    return () => { window.removeEventListener("pageshow", resetAfterOAuthReturn); window.removeEventListener("focus", resetAfterOAuthReturn); window.removeEventListener("popstate", resetAfterOAuthReturn); document.removeEventListener("visibilitychange", resetAfterOAuthReturn); };
  }, []);

  const returnPath = window.localStorage.getItem("neulifi-auth-return-path") === "/welcome" ? "/welcome" : "/app";
  const configuredAuthOrigin = String(import.meta.env.VITE_AUTH_REDIRECT_URL || "").trim().replace(/\/+$/, "");
  const authOrigin = configuredAuthOrigin || (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" ? window.location.origin : "https://neulifi.online");
  const redirectTo = new URL(returnPath, authOrigin).toString();
  const recoveryRedirectTo = new URL("/login?reset=1", authOrigin).toString();
  const returningFromCheckout = returnPath === "/welcome";

  const chooseTheme = async (nextMode: ThemeMode) => { try { await onThemeChange(nextMode); } catch (value) { setMessage(value instanceof Error ? value.message : "Could not save your appearance preference."); } };

  const signInWithGoogle = async () => {
    if (!supabase) { setMessage("Account services are not available in this environment."); return; }
    setBusy(true);
    setMessage("");
    try {
      const result = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo, queryParams: { prompt: "select_account" } } });
      if (result.error) { setBusy(false); setMessage(/cancel|denied/i.test(result.error.message) ? "Google sign-in was cancelled. You can try again whenever you’re ready." : "Google sign-in could not be started. Please try again."); }
      else if (!result.data?.url) { setBusy(false); setMessage("Google sign-in could not be started. Please try again."); }
    } catch (value) { setBusy(false); setMessage(value instanceof Error ? value.message : "Google sign-in could not be started. Please try again."); }
  };

  const resendVerification = async () => {
    if (!supabase || !verificationEmail.trim()) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await supabase.auth.resend({ type: "signup", email: verificationEmail.trim(), options: { emailRedirectTo: redirectTo } });
      if (result.error) throw result.error;
      setMessage("A new verification email is on its way. Check your inbox and spam folder.");
    } catch (value) { setMessage(value instanceof Error ? value.message : "We could not resend the verification email yet. Please try again."); }
    finally { setBusy(false); }
  };

  const requestPasswordReset = async () => {
    if (!supabase) { setMessage("Account services are not available in this environment."); return; }
    const nextEmail = email.trim();
    if (!nextEmail) { setMessage("Enter your email address first, then choose Forgot password."); return; }
    setBusy(true);
    setMessage("");
    try {
      const result = await supabase.auth.resetPasswordForEmail(nextEmail, { redirectTo: recoveryRedirectTo });
      if (result.error) throw result.error;
      setResetSent(true);
      setMessage("If an account exists for that email, a password-reset link is on its way.");
    } catch (value) { setMessage(value instanceof Error ? value.message : "We could not start the password reset. Please try again."); }
    finally { setBusy(false); }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase) { setMessage("Account services are not available in this environment."); return; }
    setBusy(true);
    setMessage("");
    try {
      if (passwordRecovery) {
        if (password.length < 6) { setMessage("Use at least 6 characters for your new password."); return; }
        const result = await supabase.auth.updateUser({ password });
        if (result.error) throw result.error;
        setMessage("Your password has been updated. Loading your private Neulifi space…");
        onAuthenticated();
        return;
      }
      const result = mode === "signin"
        ? await supabase.auth.signInWithPassword({ email: email.trim(), password })
        : await supabase.auth.signUp({ email: email.trim(), password, options: { data: { name: name.trim() }, emailRedirectTo: redirectTo } });
      if (result.error) {
        if (/confirm|verified|verification/i.test(result.error.message) && mode === "signin") setVerificationEmail(email.trim());
        setMessage(/invalid login credentials/i.test(result.error.message) ? "The email or password did not match. Check them and try again." : result.error.message);
        return;
      }
      if (result.data.session) { onAuthenticated(); return; }
      if (mode === "signup") { setVerificationEmail(email.trim()); setMessage(returningFromCheckout ? "Check your email to confirm your account. After confirmation, return here and Neulifi will connect a matching annual purchase." : "Check your email to confirm your account. The confirmation link will return you to Neulifi."); }
    } catch (value) { setMessage(value instanceof Error ? value.message : "Authentication could not be completed. Please try again."); }
    finally { setBusy(false); }
  };

  if (passwordRecovery) return <div className="auth-shell"><div className="auth-brand"><BrandMark className="brand-logo"/><strong>Neulifi</strong></div><div className="auth-card"><div className="auth-card-topline"><div className="auth-icon"><BrandMark className="auth-icon-logo"/></div><label className="auth-appearance"><span className="sr-only">Appearance theme</span><select aria-label="Appearance theme" value={themeMode} onChange={(event) => { void chooseTheme(event.target.value as ThemeMode); }}><option value="system">System theme</option><option value="light">Light mode</option><option value="dark">Dark mode</option></select></label></div><p className="eyebrow">ACCOUNT RECOVERY</p><h1>Choose a new password</h1><p className="auth-subtitle">Set a new password for your private Neulifi account, then continue to your account.</p><form onSubmit={submit}><label className="auth-field"><span>New password</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 6 characters" autoComplete="new-password" minLength={6} required/><small className="auth-helper">Use at least 6 characters.</small></label><button className="button button-green auth-submit" disabled={busy}>{busy ? "Updating…" : "Update password"}</button></form>{message && <p className="auth-message" role="alert">{message}</p>}<button type="button" className="auth-switch" onClick={() => window.location.assign("/login")}>Return to sign in</button></div><p className="auth-footnote">Your health data is private to your account.</p></div>;

  return <div className="auth-shell"><div className="auth-brand"><BrandMark className="brand-logo"/><strong>Neulifi</strong></div><div className="auth-card"><div className="auth-card-topline"><div className="auth-icon"><BrandMark className="auth-icon-logo"/></div><label className="auth-appearance"><span className="sr-only">Appearance theme</span><select aria-label="Appearance theme" value={themeMode} onChange={(event) => { void chooseTheme(event.target.value as ThemeMode); }}><option value="system">System theme</option><option value="light">Light mode</option><option value="dark">Dark mode</option></select></label></div><p className="eyebrow">YOUR HEALTH COMPANION</p><h1>{returningFromCheckout ? "Finish setting up Neulifi" : mode === "signin" ? "Welcome back" : "Start your Neulifi journey"}</h1><p className="auth-subtitle">{returningFromCheckout ? "Create or sign in with the same verified email used at checkout. We will connect your annual plan after confirmation." : mode === "signin" ? "Sign in to keep your meals, actions, and insights together." : "Create a private space for practical, sustainable progress."}</p><button type="button" className="button button-google" onClick={signInWithGoogle} disabled={busy}><span className="google-glyph" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path fill="#4285F4" d="M21.35 12.27c0-.72-.06-1.41-.18-2.07H12v3.92h5.24a4.48 4.48 0 0 1-1.94 2.94v2.45h3.14c1.84-1.69 2.91-4.18 2.91-7.24Z"/><path fill="#34A853" d="M12 21.75c2.63 0 4.84-.87 6.45-2.35l-3.14-2.45c-.87.58-1.98.92-3.31.92-2.55 0-4.72-1.72-5.5-4.04H3.25v2.53A9.75 9.75 0 0 0 12 21.75Z"/><path fill="#FBBC05" d="M6.5 13.83A5.86 5.86 0 0 1 6.19 12c0-.64.11-1.26.31-1.83V7.64H3.25A9.75 9.75 0 0 0 2.25 12c0 1.57.38 3.05 1 4.36l3.25-2.53Z"/><path fill="#EA4335" d="M12 6.13c1.43 0 2.72.49 3.74 1.46l2.8-2.8C16.83 3.23 14.63 2.25 12 2.25a9.75 9.75 0 0 0-8.75 5.39L6.5 10.17C7.28 7.85 9.45 6.13 12 6.13Z"/></svg></span>{busy ? "Connecting…" : "Continue with Google"}</button><div className="auth-divider"><span>or use email</span></div><form onSubmit={submit}>{mode === "signup" && <label className="auth-field"><span>Your name</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" autoComplete="name" required/></label>}<label className="auth-field"><span>Email</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" autoComplete="email" required/></label><label className="auth-field"><span>Password</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 6 characters" autoComplete={mode === "signin" ? "current-password" : "new-password"} minLength={6} required/><small className="auth-helper">Use at least 6 characters.</small></label>{mode === "signin" && <button type="button" className="auth-forgot" onClick={() => { void requestPasswordReset(); }} disabled={busy}>{resetSent ? "Reset email requested" : "Forgot password?"}</button>}<button className="button button-green auth-submit" disabled={busy}>{busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}</button></form>{message && <p className="auth-message" role="alert">{message}</p>}{verificationEmail && <button type="button" className="auth-resend" onClick={() => { void resendVerification(); }} disabled={busy}>Resend verification email</button>}<button type="button" className="auth-switch" onClick={() => { const nextMode = mode === "signin" ? "signup" : "signin"; setMode(nextMode); setMessage(""); setVerificationEmail(""); window.history.replaceState(null, "", nextMode === "signin" ? "/login" : "/signup"); window.dispatchEvent(new PopStateEvent("popstate")); }}>{mode === "signin" ? "New to Neulifi? Create an account" : "Already have an account? Sign in"}</button></div><p className="auth-footnote">Your health data is private to your account.</p></div>;
}
