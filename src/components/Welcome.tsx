import { useEffect, useState } from "react";
import { neulifiApi } from "../lib/api";

type WelcomeProps = { signedIn: boolean; onContinue: () => void; onSignUp: () => void };
type ClaimState = "checking" | "claimed" | "none" | "error";

export function Welcome({ signedIn, onContinue, onSignUp }: WelcomeProps) {
  const [claimState, setClaimState] = useState<ClaimState>(signedIn ? "checking" : "none");
  const [claimedPlan, setClaimedPlan] = useState<string | null>(null);

  useEffect(() => {
    if (!signedIn) {
      setClaimState("none");
      return;
    }
    let active = true;
    let attempts = 0;
    let timer: number | undefined;
    const check = async () => {
      try {
        const result = await neulifiApi.claimPendingPurchase();
        if (!active) return;
        if (result.claimed > 0) {
          setClaimedPlan(result.plan === "premium" ? "Premium" : result.plan === "pro" ? "Pro" : null);
          setClaimState("claimed");
          return;
        }
        attempts += 1;
        if (attempts < 6) {
          timer = window.setTimeout(() => void check(), 2000);
        } else {
          setClaimState("none");
        }
      } catch {
        if (active) setClaimState("error");
      }
    };
    void check();
    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [signedIn]);

  const title = !signedIn ? "Your Neulifi space is ready when you are." : claimState === "claimed" ? "Your plan is connected." : "Welcome back to Neulifi.";
  const message = !signedIn
    ? "Your checkout is complete or being confirmed. Create or sign in to the account that uses the same checkout email, and we will connect the verified plan to it."
    : claimState === "checking"
      ? "We are waiting for Paddle’s verified confirmation and checking whether this account has a matching purchase."
      : claimState === "claimed"
        ? `Your ${claimedPlan || "paid"} plan is now linked to this account. You can continue into your private Neulifi space.`
        : claimState === "error"
          ? "We could not check the purchase yet. You can continue to Neulifi and refresh your account shortly."
          : "No matching purchase is linked yet. If you completed checkout with another email, sign in with that email or wait for Paddle’s notification to arrive.";

  return <main className="welcome-page">
    <div className="welcome-card">
      <span className="public-kicker">WELCOME TO NEULIFI</span>
      <div className="welcome-mark" aria-hidden="true">{claimState === "checking" ? "…" : "✓"}</div>
      <h1>{title}</h1>
      <p>{message}</p>
      <div className="welcome-actions">
        {!signedIn ? <button className="button button-green" type="button" onClick={onSignUp}>Create or sign in <span aria-hidden="true">→</span></button> : <button className="button button-green" type="button" onClick={onContinue}>Continue to Neulifi <span aria-hidden="true">→</span></button>}
        <small>Neulifi is a nutrition and lifestyle companion, not medical care.</small>
      </div>
    </div>
  </main>;
}
