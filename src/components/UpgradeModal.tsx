import { getPlan, type PlanId } from "../lib/plans";

type UpgradeReason = "daily-limit" | "analytics" | "pricing";

type UpgradeModalProps = {
  open: boolean;
  reason: UpgradeReason;
  currentPlan: PlanId;
  onClose: () => void;
  onViewPlans: () => void;
};

export function UpgradeModal({ open, reason, currentPlan, onClose, onViewPlans }: UpgradeModalProps) {
  if (!open) return null;
  const current = getPlan(currentPlan);
  const premium = getPlan("premium");
  const isPricing = reason === "pricing";
  const title = isPricing ? "Go deeper with Neulifi Premium" : reason === "daily-limit" ? "Keep your daily rhythm going" : "See the patterns behind your meals";
  const intro = isPricing
    ? "A calmer way to keep more of your day together: more meal check-ins, fuller analytics, and practical context over time."
    : reason === "daily-limit"
      ? `You’ve used today’s ${current.name} allowance. Premium gives you more room to check in across breakfast, lunch, dinner, and snacks.`
      : "Your basic view is ready. Premium adds the richer pattern view that helps your meal history and daily actions make more sense together.";
  return <div className="upgrade-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={`upgrade-modal ${isPricing ? "upgrade-modal-premium-story" : ""}`} role="dialog" aria-modal="true" aria-labelledby="upgrade-modal-title">
      <button className="upgrade-close" type="button" aria-label="Close upgrade message" onClick={onClose}>×</button>
      <div className="upgrade-modal-kicker"><span>NEULIFI PREMIUM</span><b>{isPricing ? "$30 / YEAR" : "More room, more clarity"}</b></div>
      <h2 id="upgrade-modal-title">{title}</h2>
      <p className="upgrade-modal-intro">{intro}</p>
      {isPricing && <div className="premium-story-hero"><div><span className="premium-story-label">ONE SIMPLE YEARLY PLAN</span><strong>$30</strong><small>per year</small><span className="premium-story-monthly">$2.50 per month when billed annually</span></div><p>Think of it as a small investment in noticing your own rhythm more clearly—without turning food into another source of pressure.</p></div>}
      <div className="premium-benefit-grid"><article><span>01</span><strong>More room for the day</strong><p>Check in across your main meals and snacks as your real day unfolds.</p></article><article><span>02</span><strong>Deeper pattern view</strong><p>Connect meal history, actions, and progress with full analytics access.</p></article><article><span>03</span><strong>Private, practical guidance</strong><p>Use your context to keep suggestions relevant, gentle, and easier to repeat.</p></article></div>
      <div className="upgrade-value-grid upgrade-value-grid-secondary"><article className="upgrade-value-card upgrade-value-card-premium"><span className="upgrade-recommended">{currentPlan === "premium" ? "ACTIVE PLAN" : "BEST VALUE"}</span><span className="upgrade-value-icon">✦</span><strong>Premium · ${premium.annualPrice}/year</strong><p>More room to check in, fuller analytics, community leaderboard access, and a clearer view of what is becoming consistent.</p><small>5 analyses per day · Full analytics · Referral rewards · Premium leaderboard</small><button className="button button-green upgrade-card-button" type="button" onClick={onViewPlans}>{currentPlan === "premium" ? "View plan details" : "See Premium"}</button></article></div>
      <p className="upgrade-health-note">Neulifi is not medical care and cannot promise to prevent or diagnose disease. It may help you notice patterns earlier and prepare for more informed conversations with a qualified professional.</p>
      <div className="upgrade-modal-footer"><span>{isPricing ? "Choose the plan that fits today. There are no free trials, and billing starts with the first cycle." : "Your plan changes only after a successful payment is verified."}</span><div><button className="button button-soft" type="button" onClick={onViewPlans}>View plan details</button><button className="button button-soft" type="button" onClick={onClose}>Keep exploring</button></div></div>
    </section>
  </div>;
}
