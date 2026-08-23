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
  const [magicLinkSent, setMagicLinkSent] = useState(false);

  useEffect(() => { if (initialEmail) setEmail(initialEmail); }, [initialEmail]);
  useEffect(() => { setMessage(initialMessage); }, [initialMessage]);
  useEffect(() => {
    const resetAfterAuthReturn = () => { if (document.visibilityState === "visible") setBusy(false); };
    window.addEventListener("pageshow", resetAfterAuthReturn);
    window.addEventListener("focus", resetAfterAuthReturn);
    window.addEventListener("popstate", resetAfterAuthReturn);
    document.addEventListener("visibilitychange", resetAfterAuthReturn);
    return () => { window.removeEventListener("pageshow", resetAfterAuthReturn); window.removeEventListener("focus", resetAfterAuthReturn); window.removeEventListener("popstate", resetAfterAuthReturn); document.removeEventListener("visibilitychange", resetAfterAuthReturn); };
  }, []);

  const returnPath = window.localStorage.getItem("neulifi-auth-return-path") === "/welcome" ? "/welcome" : "/app";
  const configuredAuthOrigin = String(import.meta.env.VITE_AUTH_REDIRECT_URL || "").trim().replace(/\/+$/, "");
  const authOrigin = configuredAuthOrigin || (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" ? window.location.origin : "https://neulifi.online");
  const redirectTo = new URL(returnPath, authOrigin).toString();
  const magicLinkRedirectTo = new URL("/auth/confirm", authOrigin).toString();
  const recoveryRedirectTo = new URL("/login?reset=1", authOrigin).toString();
  const returningFromCheckout = returnPath === "/welcome";

  const chooseTheme = async (nextMode: ThemeMode) => { try { await onThemeChange(nextMode); } catch (value) { setMessage(value instanceof Error ? value.message : "Could not save your appearance preference."); } };

  const requestMagicLink = async () => {
    if (!supabase) { setMessage("Account services are not available in this environment."); return; }
    const nextEmail = email.trim();
    if (!nextEmail) { setMessage("Enter your email address first."); return; }
    setBusy(true);
    setMessage("");
    try {
      const result = await supabase.auth.signInWithOtp({
        email: nextEmail,
        options: {
          emailRedirectTo: magicLinkRedirectTo,
          shouldCreateUser: mode === "signup",
          data: mode === "signup" && name.trim() ? { name: name.trim() } : undefined,
        },
      });
      if (result.error) throw result.error;
      setMagicLinkSent(true);
      setMessage(returningFromCheckout
        ? "Check your email for a secure link. Use the same address you used at checkout so Neulifi can connect your annual plan after confirmation."
        : mode === "signup"
          ? "Check your email for a secure link to finish creating your private Neulifi space."
          : "If an account exists for this email, a secure sign-in link is on its way.");
    } catch (value) { setMessage(value instanceof Error ? value.message : "We could not send the sign-in link yet. Please try again."); }
    finally { setBusy(false); }
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

  return <div className="auth-shell"><div className="auth-brand"><BrandMark className="brand-logo"/><strong>Neulifi</strong></div><div className="auth-card"><div className="auth-card-topline"><div className="auth-icon"><BrandMark className="auth-icon-logo"/></div><label className="auth-appearance"><span className="sr-only">Appearance theme</span><select aria-label="Appearance theme" value={themeMode} onChange={(event) => { void chooseTheme(event.target.value as ThemeMode); }}><option value="system">System theme</option><option value="light">Light mode</option><option value="dark">Dark mode</option></select></label></div><p className="eyebrow">YOUR HEALTH COMPANION</p><h1>{returningFromCheckout ? "Finish setting up Neulifi" : mode === "signin" ? "Welcome back" : "Start your Neulifi journey"}</h1><p className="auth-subtitle">{returningFromCheckout ? "Create or sign in with the same verified email used at checkout. We will connect your annual plan after confirmation." : mode === "signin" ? "Sign in to keep your meals, actions, and insights together." : "Create a private space for practical, sustainable progress."}</p><div className="auth-magic-link-card"><div><strong>{magicLinkSent ? "Check your inbox" : "Passwordless sign-in"}</strong><p>{magicLinkSent ? "The secure link expires after a short time. You can request another link below." : "No password to remember. We will email you a secure link for this address."}</p></div><button type="button" className="button button-green" onClick={() => { void requestMagicLink(); }} disabled={busy}>{busy ? "Sending…" : magicLinkSent ? "Send another link" : "Email me a secure link"}</button></div><div className="auth-divider"><span>or use a password</span></div><form onSubmit={submit}>{mode === "signup" && <label className="auth-field"><span>Your name</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" autoComplete="name" required/></label>}<label className="auth-field"><span>Email</span><input type="email" value={email} onChange={(event) => { setEmail(event.target.value); setMagicLinkSent(false); }} placeholder="you@example.com" autoComplete="email" required/></label><label className="auth-field"><span>Password</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 6 characters" autoComplete={mode === "signin" ? "current-password" : "new-password"} minLength={6} required/><small className="auth-helper">Use at least 6 characters.</small></label>{mode === "signin" && <button type="button" className="auth-forgot" onClick={() => { void requestPasswordReset(); }} disabled={busy}>{resetSent ? "Reset email requested" : "Forgot password?"}</button>}<button className="button button-soft auth-submit" disabled={busy}>{busy ? "Please wait…" : mode === "signin" ? "Sign in with password" : "Create account with password"}</button></form>{message && <p className="auth-message" role="alert">{message}</p>}{verificationEmail && <button type="button" className="auth-resend" onClick={() => { void resendVerification(); }} disabled={busy}>Resend verification email</button>}<button type="button" className="auth-switch" onClick={() => { const nextMode = mode === "signin" ? "signup" : "signin"; setMode(nextMode); setMessage(""); setVerificationEmail(""); setMagicLinkSent(false); window.history.replaceState(null, "", nextMode === "signin" ? "/login" : "/signup"); window.dispatchEvent(new PopStateEvent("popstate")); }}>{mode === "signin" ? "New to Neulifi? Create an account" : "Already have an account? Sign in"}</button></div><p className="auth-footnote">Your health data is private to your account.</p></div>;
}
