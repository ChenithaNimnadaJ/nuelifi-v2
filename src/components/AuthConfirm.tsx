import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { getHealthySession, supabase } from "../lib/supabase";
import { clearPasswordRecoveryContext, markPasswordRecoveryContext } from "../lib/authRecovery";
import { BrandMark } from "./BrandMark";

const emailTypes = new Set(["signup", "magiclink", "recovery", "invite", "email_change", "email"]);
const AUTH_OPERATION_TIMEOUT_MS = 15000;

type CallbackPayload = {
  type: string;
  code: string;
  tokenHash: string;
  accessToken: string;
  refreshToken: string;
  error: string;
  errorCode: string;
  errorDescription: string;
};

function readCallbackPayload(): CallbackPayload {
  const search = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const read = (name: string) => search.get(name)?.trim() || hash.get(name)?.trim() || "";
  return {
    type: read("type"),
    code: read("code"),
    tokenHash: read("token_hash"),
    accessToken: read("access_token"),
    refreshToken: read("refresh_token"),
    error: read("error"),
    errorCode: read("error_code"),
    errorDescription: read("error_description"),
  };
}

function hasCallbackPayload(payload: CallbackPayload) {
  return Boolean(payload.type || payload.code || payload.tokenHash || payload.accessToken || payload.refreshToken || payload.error || payload.errorCode || payload.errorDescription);
}

function clearCallbackUrl() {
  window.history.replaceState(null, "", "/auth/confirm");
}

function callbackMessage(payload: CallbackPayload) {
  const raw = payload.errorDescription || payload.error || payload.errorCode;
  if (!raw) return "";
  return /expired|invalid/i.test(raw) ? "This sign-in link has expired or is no longer valid. Request a new one from Neulifi." : "We could not complete this sign-in link. Request a new one and try again.";
}

function safeReturnPath() {
  return window.localStorage.getItem("neulifi-auth-return-path") === "/welcome" ? "/welcome" : "/app";
}

function withAuthTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("verification_timed_out")), AUTH_OPERATION_TIMEOUT_MS);
    promise.then((value) => { window.clearTimeout(timer); resolve(value); }, (error) => { window.clearTimeout(timer); reject(error); });
  });
}

export function AuthConfirm({ onAuthenticated, themeMode, onThemeChange, passwordRecovery = false }: { onAuthenticated: () => void; themeMode: "system" | "light" | "dark"; onThemeChange: (mode: "system" | "light" | "dark") => Promise<void>; passwordRecovery?: boolean }) {
  const [callbackPayload] = useState<CallbackPayload>(() => readCallbackPayload());
  const initialMessage = callbackMessage(callbackPayload);
  const [message, setMessage] = useState(initialMessage);
  const [state, setState] = useState<"checking" | "success" | "error">(initialMessage ? "error" : "checking");
  const verificationStarted = useRef(false);

  useLayoutEffect(() => {
    if (hasCallbackPayload(callbackPayload)) clearCallbackUrl();
  }, [callbackPayload]);

  useEffect(() => {
    if (verificationStarted.current || message || !supabase) {
      if (!supabase && !message) { setMessage("Account services are not available in this environment."); setState("error"); }
      return;
    }
    verificationStarted.current = true;
    const client = supabase;
    let active = true;
    const requestedType = callbackPayload.type || (passwordRecovery ? "recovery" : "email");
    const type = emailTypes.has(requestedType) ? requestedType as "signup" | "magiclink" | "recovery" | "invite" | "email_change" | "email" : "email";
    const code = callbackPayload.code;
    const tokenHash = callbackPayload.tokenHash;
    const accessToken = callbackPayload.accessToken;
    const refreshToken = callbackPayload.refreshToken;

    const finish = () => {
      if (!active) return;
      if (passwordRecovery || type === "recovery") {
        if (!markPasswordRecoveryContext()) throw new Error("recovery_context_unavailable");
        window.history.replaceState(null, "", "/login?reset=1");
        window.dispatchEvent(new PopStateEvent("popstate"));
        return;
      }
      clearCallbackUrl();
      setState("success");
      setMessage(safeReturnPath() === "/welcome" ? "Your email is confirmed. Connecting your verified purchase…" : "Your email is confirmed. Opening your private Neulifi space…");
      onAuthenticated();
    };

    const verify = async () => {
      if (accessToken || refreshToken) {
        if (!accessToken || !refreshToken) throw new Error("incomplete");
        const verification = await withAuthTimeout(client.auth.setSession({ access_token: accessToken, refresh_token: refreshToken }));
        if (verification.error || !verification.data.session) throw verification.error || new Error("verification_failed");
        finish();
        return;
      }
      if (code) {
        const verification = await withAuthTimeout(client.auth.exchangeCodeForSession(code));
        if (verification.error || !verification.data.session) throw verification.error || new Error("verification_failed");
        finish();
        return;
      }
      if (tokenHash) {
        const verification = await withAuthTimeout(client.auth.verifyOtp({ token_hash: tokenHash, type }));
        if (verification.error || !verification.data.session) throw verification.error || new Error("verification_failed");
        finish();
        return;
      }
      const existingSession = await withAuthTimeout(getHealthySession()).catch(() => null);
      if (existingSession && (!passwordRecovery || !hasCallbackPayload(callbackPayload))) {
        if (passwordRecovery && !markPasswordRecoveryContext()) throw new Error("recovery_context_unavailable");
        finish();
        return;
      }
      throw new Error("incomplete");
    };

    void verify().catch((error) => {
      if (!active) return;
      clearPasswordRecoveryContext();
      clearCallbackUrl();
      setMessage(error instanceof Error && /expired|invalid|code verifier|verifier/i.test(error.message) ? "This sign-in link has expired or is no longer valid. Request a new one from Neulifi." : error instanceof Error && error.message === "incomplete" ? "This sign-in link is incomplete. Request a new one from Neulifi." : error instanceof Error && error.message === "verification_timed_out" ? "The sign-in link took too long to verify. Request a new one and try again." : error instanceof Error && error.message === "recovery_context_unavailable" ? "Your browser could not save the recovery state. Allow site storage, then request a new link and try again." : "We could not verify this sign-in link. Request a new one and try again.");
      setState("error");
    });
    return () => { active = false; };
  }, [callbackPayload, message, onAuthenticated, passwordRecovery]);

  const chooseTheme = (mode: "system" | "light" | "dark") => { void onThemeChange(mode).catch(() => undefined); };
  return <div className="auth-shell"><div className="auth-brand"><BrandMark className="brand-logo"/><strong>Neulifi</strong></div><div className="auth-card auth-confirm-card"><div className="auth-card-topline"><div className="auth-icon"><BrandMark className="auth-icon-logo"/></div><label className="auth-appearance"><span className="sr-only">Appearance theme</span><select aria-label="Appearance theme" value={themeMode} onChange={(event) => chooseTheme(event.target.value as "system" | "light" | "dark")}><option value="system">System theme</option><option value="light">Light mode</option><option value="dark">Dark mode</option></select></label></div><p className="eyebrow">SECURE EMAIL SIGN-IN</p><h1>{state === "checking" ? "Checking your link" : state === "success" ? "You’re signed in" : "That link needs attention"}</h1><p className={`auth-confirm-status ${state === "error" ? "auth-confirm-error" : ""}`} role={state === "error" ? "alert" : "status"}>{state === "checking" ? "Please wait while we verify your secure link." : message}</p>{state === "error" && <button type="button" className="button button-green auth-submit" onClick={() => window.location.assign("/login")}>Return to sign in</button>}</div><p className="auth-footnote">Your health data is private to your account.</p></div>;
}
