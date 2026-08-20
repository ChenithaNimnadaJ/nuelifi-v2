import { useState } from "react";
import { supabase } from "../lib/supabase";

export function AuthScreen({ onPreview }: { onPreview: () => void }) {
  const [mode, setMode] = useState<"signin" | "signup">("signup");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!supabase) { setMessage("Supabase is not configured in this environment."); return; }
    setBusy(true); setMessage("");
    const result = mode === "signin"
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password, options: { data: { name } } });
    setBusy(false);
    if (result.error) setMessage(result.error.message);
    else if (mode === "signup" && !result.data.session) setMessage("Check your email to confirm your account, then sign in.");
  };
  return <div className="auth-shell"><div className="auth-brand"><span className="brand-mark">⌁</span><strong>Nuelifi</strong></div><div className="auth-card"><div className="auth-icon">S</div><p className="eyebrow">YOUR HEALTH COMPANION</p><h1>{mode === "signin" ? "Welcome back" : "Start your Nuelifi journey"}</h1><p className="auth-subtitle">{mode === "signin" ? "Sign in to keep your meals, actions, and insights together." : "Create a private space for practical, sustainable progress."}</p><form onSubmit={submit}>{mode === "signup" && <label className="auth-field"><span>Your name</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Sarah Chen" required/></label>}<label className="auth-field"><span>Email</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required/></label><label className="auth-field"><span>Password</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 6 characters" minLength={6} required/></label><button className="button button-green auth-submit" disabled={busy}>{busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}</button></form>{message && <p className="auth-message">{message}</p>}<button className="auth-switch" onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setMessage(""); }}>{mode === "signin" ? "New to Nuelifi? Create an account" : "Already have an account? Sign in"}</button></div><button className="preview-link" onClick={onPreview}>Continue with preview data</button><p className="auth-footnote">Your health data is private to your account.</p></div>;
}
