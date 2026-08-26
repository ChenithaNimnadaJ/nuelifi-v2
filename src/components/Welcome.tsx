import { useEffect, useState } from "react";
import { neulifiApi } from "../lib/api";

type WelcomeProps = { signedIn: boolean; userId?: string; onContinue: () => void; onSignUp: () => void };
type ClaimState = "checking" | "claimed" | "none" | "error";

export function Welcome({ signedIn, userId, onContinue, onSignUp }: WelcomeProps) {
  const [claimState, setClaimState] = useState<ClaimState>(signedIn ? "checking" : "none");
  const [claimedPlan, setClaimedPlan] = useState<string | null>(null);
  const [claimError, setClaimError] = useState("");
  const [retryNonce, setRetryNonce] = useState(0);

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
        const linked = userId ? await neulifiApi.subscription(userId).catch(() => null) : null;
        if (!active) return;
        const linkedPlan = linked?.plan === "premium" || linked?.plan === "pro" ? linked.plan : null;
        const linkedStatus = String(linked?.status || "").toLowerCase();
        const activeLinkedPlan = linkedPlan && linkedStatus !== "unavailable" && linkedStatus !== "cancelled" ? linkedPlan : null;
        const connectedPlan = result.claimed > 0 ? result.plan : activeLinkedPlan;
        if (connectedPlan === "premium" || connectedPlan === "pro") {
          setClaimedPlan(connectedPlan === "premium" ? "Premium" : "Pro");
          setClaimError("");
          window.localStorage.removeItem("neulifi-checkout-intent");
          setClaimState("claimed");
          return;
        }
        attempts += 1;
        if (attempts < 15) {
          timer = window.setTimeout(() => void check(), 2000);
        } else {
          setClaimState("none");
        }
      } catch (error) {
        if (active) {
          setClaimError(error instanceof Error ? error.message : "We could not check the purchase yet.");
          setClaimState("error");
        }
      }
    };
    void check();
    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [signedIn, retryNonce]);

  const title = !signedIn ? "Your Neulifi space is ready when you are." : claimState === "claimed" ? "Your plan is connected." : "Welcome back to Neulifi.";
  const message = !signedIn
    ? "Your checkout is complete or being confirmed. Create or sign in to the account that uses the same checkout email, and we will connect the verified plan to it."
    : claimState === "checking"
      ? "We are waiting for Paddle’s verified confirmation and checking whether this account has a matching purchase."
      : claimState === "claimed"
        ? `Your ${claimedPlan || "paid"} plan is now linked to this account. You can continue into your private Neulifi space.`
        : claimState === "error"
          ? `${claimError || "We could not check the purchase yet."} You can continue to Neulifi and refresh your account shortly.`
          : "We could not find your purchase yet. It may still be processing. If you used a different email for payment, sign in with that account, or try checking again in a few minutes.";

  return <main className="welcome-page">
    <div className="welcome-card">
      <span className="public-kicker">WELCOME TO NEULIFI</span>
      <div className="welcome-mark" aria-hidden="true">{claimState === "checking" ? "…" : "✓"}</div>
      <h1>{title}</h1>
      <p>{message}</p>
      <div className="welcome-actions">
        {!signedIn ? <button className="button button-green" type="button" onClick={onSignUp}>Create or sign in <span aria-hidden="true">→</span></button> : <><button className="button button-green" type="button" onClick={onContinue}>Continue to Neulifi <span aria-hidden="true">→</span></button>{(claimState === "none" || claimState === "error") && <button className="text-button" type="button" onClick={() => { setClaimState("checking"); setRetryNonce((value) => value + 1); }}>Check purchase again</button>}</>}
        <small>Neulifi is a nutrition and lifestyle companion, not medical care.</small>
      </div>
    </div>
  </main>;
}
