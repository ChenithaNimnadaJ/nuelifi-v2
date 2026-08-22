import { useState } from "react";
import { getPlan, type PlanId } from "../lib/plans";

type UpgradeReason = "daily-limit" | "analytics";

type UpgradeModalProps = {
  open: boolean;
  reason: UpgradeReason;
  currentPlan: PlanId;
  onClose: () => void;
  onViewProfile: () => void;
  onCheckout: (plan: "pro" | "premium") => Promise<void>;
};

export function UpgradeModal({ open, reason, currentPlan, onClose, onViewProfile, onCheckout }: UpgradeModalProps) {
  const [loading, setLoading] = useState<"pro" | "premium" | null>(null);
  const [checkoutError, setCheckoutError] = useState("");
  if (!open) return null;
  const current = getPlan(currentPlan);
  const pro = getPlan("pro");
  const premium = getPlan("premium");
  const title = reason === "daily-limit" ? "Keep your daily rhythm going" : "See the patterns behind your meals";
  const intro = reason === "daily-limit" ? `You’ve reached today’s ${current.name} allowance. Upgrade when you want more room to check in across your day.` : "Your basic view is ready. Unlock richer patterns, comparisons, and context-aware insights as your Neulifi space grows.";
  const checkout = async (plan: "pro" | "premium") => { setCheckoutError(""); setLoading(plan); try { await onCheckout(plan); } catch (error) { setCheckoutError(error instanceof Error ? error.message : "Checkout could not be started."); } finally { setLoading(null); } };
  return <div className="upgrade-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="upgrade-modal" role="dialog" aria-modal="true" aria-labelledby="upgrade-modal-title">
      <button className="upgrade-close" type="button" aria-label="Close upgrade message" onClick={onClose}>×</button>
      <div className="upgrade-modal-kicker"><span>NUELIFI PLANS</span><b>More room, more clarity</b></div>
      <h2 id="upgrade-modal-title">{title}</h2>
      <p className="upgrade-modal-intro">{intro}</p>
      <div className="upgrade-value-grid">
        <article className="upgrade-value-card"><span className="upgrade-value-icon">◷</span><strong>Pro · ${pro.annualPrice}/year</strong><p>Scan your main meals and still have room for a little more. Better analytics help you see what is becoming a pattern.</p><small>Higher AI usage limits · Better analytics</small><button className="button button-soft upgrade-card-button" type="button" onClick={() => { void checkout("pro"); }} disabled={Boolean(loading)}>{loading === "pro" ? "Opening checkout…" : "Choose Pro"}</button></article>
        <article className="upgrade-value-card upgrade-value-card-premium"><span className="upgrade-recommended">BEST VALUE</span><span className="upgrade-value-icon">✦</span><strong>Premium · ${premium.annualPrice}/year</strong><p>Make room for your full day: breakfast, lunch, dinner, and snacks, with the fullest analytics experience for a richer view over time.</p><small>5×–10× more room than Pro · Full access to analytics</small><button className="button button-green upgrade-card-button" type="button" onClick={() => { void checkout("premium"); }} disabled={Boolean(loading)}>{loading === "premium" ? "Opening checkout…" : "Choose Premium"}</button></article>
      </div>
      {checkoutError && <div className="data-note data-error upgrade-checkout-error" role="alert">{checkoutError}</div>}
      <div className="upgrade-modal-footer"><span>Your plan changes only after a successful payment is verified.</span><div><button className="button button-soft" type="button" onClick={onViewProfile}>View plan details</button><button className="button button-soft" type="button" onClick={onClose}>Keep exploring</button></div></div>
    </section>
  </div>;
}
