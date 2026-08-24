import { useEffect, useRef, useState } from "react";
import { getHealthySession, supabase } from "../lib/supabase";
import { BrandMark } from "./BrandMark";

const emailTypes = new Set(["signup", "magiclink", "recovery", "invite", "email_change", "email"]);

function safeReturnPath() {
  return window.localStorage.getItem("neulifi-auth-return-path") === "/welcome" ? "/welcome" : "/app";
}

function callbackMessage() {
  const params = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const raw = params.get("error_description") || params.get("error") || params.get("error_code") || hash.get("error_description") || hash.get("error") || hash.get("error_code");
  if (!raw) return "";
  return /expired|invalid/i.test(raw) ? "This sign-in link has expired or is no longer valid. Request a new one from Neulifi." : "We could not complete this sign-in link. Request a new one and try again.";
}

export function AuthConfirm({ onAuthenticated, themeMode, onThemeChange }: { onAuthenticated: () => void; themeMode: "system" | "light" | "dark"; onThemeChange: (mode: "system" | "light" | "dark") => Promise<void> }) {
  const [message, setMessage] = useState(callbackMessage());
  const [state, setState] = useState<"checking" | "success" | "error">(message ? "error" : "checking");
  const verificationStarted = useRef(false);

  useEffect(() => {
    if (verificationStarted.current || message || !supabase) {
      if (!supabase && !message) { setMessage("Account services are not available in this environment."); setState("error"); }
      return;
    }
    verificationStarted.current = true;
    const client = supabase;
    if (!client) return;
    const params = new URLSearchParams(window.location.search);
    const tokenHash = params.get("token_hash")?.trim() || new URLSearchParams(window.location.hash.replace(/^#/, "")).get("token_hash")?.trim() || "";
    const code = params.get("code")?.trim() || "";
    const requestedType = params.get("type")?.trim() || "email";
    const type = emailTypes.has(requestedType) ? requestedType as "signup" | "magiclink" | "recovery" | "invite" | "email_change" | "email" : "email";
    let active = true;
    const finish = () => {
      if (!active) return;
      window.history.replaceState(null, "", "/auth/confirm");
      setState("success");
      setMessage(safeReturnPath() === "/welcome" ? "Your email is confirmed. Connecting your verified purchase…" : "Your email is confirmed. Opening your private Neulifi space…");
      window.setTimeout(() => { if (active) onAuthenticated(); }, 300);
    };
    const verify = async () => {
      const existingSession = await getHealthySession().catch(() => null);
      if (existingSession) { finish(); return; }
      if (!tokenHash && !code) throw new Error("incomplete");
      const verification = code ? await client.auth.exchangeCodeForSession(code) : await client.auth.verifyOtp({ token_hash: tokenHash, type });
      if (verification.error || !verification.data.session) throw verification.error || new Error("verification_failed");
      finish();
    };
    void verify().catch((error) => { if (active) { setMessage(error instanceof Error && /expired|invalid/i.test(error.message) ? "This sign-in link has expired or is no longer valid. Request a new one from Neulifi." : error instanceof Error && error.message === "incomplete" ? "This sign-in link is incomplete. Request a new one from Neulifi." : "We could not verify this sign-in link. Request a new one and try again."); setState("error"); } });
    return () => { active = false; };
  }, [message, onAuthenticated]);

  const chooseTheme = (mode: "system" | "light" | "dark") => { void onThemeChange(mode).catch(() => undefined); };
  return <div className="auth-shell"><div className="auth-brand"><BrandMark className="brand-logo"/><strong>Neulifi</strong></div><div className="auth-card auth-confirm-card"><div className="auth-card-topline"><div className="auth-icon"><BrandMark className="auth-icon-logo"/></div><label className="auth-appearance"><span className="sr-only">Appearance theme</span><select aria-label="Appearance theme" value={themeMode} onChange={(event) => chooseTheme(event.target.value as "system" | "light" | "dark")}><option value="system">System theme</option><option value="light">Light mode</option><option value="dark">Dark mode</option></select></label></div><p className="eyebrow">SECURE EMAIL SIGN-IN</p><h1>{state === "checking" ? "Checking your link" : state === "success" ? "You’re signed in" : "That link needs attention"}</h1><p className={`auth-confirm-status ${state === "error" ? "auth-confirm-error" : ""}`} role={state === "error" ? "alert" : "status"}>{state === "checking" ? "Please wait while we verify your secure link." : message}</p>{state === "error" && <button type="button" className="button button-green auth-submit" onClick={() => window.location.assign("/login")}>Return to sign in</button>}</div><p className="auth-footnote">Your health data is private to your account.</p></div>;
}
