import { getPlan, type PlanId } from "../lib/plans";

type UpgradeReason = "daily-limit" | "analytics" | "pricing";

type UpgradeModalProps = {
  open: boolean;
  reason: UpgradeReason;
  currentPlan: PlanId;
  onClose: () => void;
  onViewProfile: () => void;
};

export function UpgradeModal({ open, reason, currentPlan, onClose, onViewProfile }: UpgradeModalProps) {
  if (!open) return null;
  const current = getPlan(currentPlan);
  const pro = getPlan("pro");
  const premium = getPlan("premium");
  const isPricing = reason === "pricing";
  const title = isPricing ? "Make room for your whole day" : reason === "daily-limit" ? "Keep your daily rhythm going" : "See the patterns behind your meals";
  const intro = isPricing ? "Premium brings your meals, small actions, and patterns into one clearer view—for $30 a year." : reason === "daily-limit" ? `You’ve reached today’s ${current.name} allowance. Upgrade when you want more room to check in across your day.` : "Your basic view is ready. Unlock richer patterns, comparisons, and context-aware insights as your Neulifi space grows.";
  return <div className="upgrade-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={`upgrade-modal ${isPricing ? "upgrade-modal-premium-story" : ""}`} role="dialog" aria-modal="true" aria-labelledby="upgrade-modal-title">
      <button className="upgrade-close" type="button" aria-label="Close upgrade message" onClick={onClose}>×</button>
      <div className="upgrade-modal-kicker"><span>NEULIFI PLANS</span><b>{isPricing ? "$30 / YEAR" : "More room, more clarity"}</b></div>
      <h2 id="upgrade-modal-title">{title}</h2>
      <p className="upgrade-modal-intro">{intro}</p>
      {isPricing && <div className="premium-story-hero"><div><span className="premium-story-label">PREMIUM</span><strong>$30</strong><small>per year</small></div><p>That’s one simple yearly plan for a fuller picture of the way you eat, move, and build habits.</p></div>}
      {isPricing && <div className="premium-benefit-grid"><article><span>01</span><strong>More room to check in</strong><p>Use Neulifi across breakfast, lunch, dinner, and snacks as your day unfolds.</p></article><article><span>02</span><strong>See the full pattern</strong><p>Connect meal history, actions, and movement with full analytics access.</p></article><article><span>03</span><strong>Keep guidance practical</strong><p>Get context-aware next steps without guilt, perfection pressure, or false precision.</p></article></div>}
      <div className={`upgrade-value-grid ${isPricing ? "upgrade-value-grid-secondary" : ""}`}>
        {!isPricing && <article className="upgrade-value-card"><span className="upgrade-value-icon">◷</span><strong>Pro · ${pro.annualPrice}/year</strong><p>More space for your main meals, with better analytics to help you see what is becoming a pattern.</p><small>Higher AI usage limits · Better analytics</small><button className="button button-soft upgrade-card-button coming-soon-button" type="button" disabled>Coming soon</button></article>}
        <article className="upgrade-value-card upgrade-value-card-premium"><span className="upgrade-recommended">{currentPlan === "premium" ? "ACTIVE PLAN" : "BEST VALUE"}</span><span className="upgrade-value-icon">✦</span><strong>Premium · ${premium.annualPrice}/year</strong><p>{isPricing ? "The complete Neulifi experience: more room across the day, fuller analytics, and one calm place to notice what helps." : "Make room for your full day: breakfast, lunch, dinner, and snacks, with the fullest analytics experience over time."}</p><small>Full analytics access · Main meals and snacks · Context-aware guidance</small><button className="button button-green upgrade-card-button coming-soon-button" type="button" disabled>{currentPlan === "premium" ? "Premium is active" : "Coming soon"}</button></article>
      </div>
      <div className="upgrade-modal-footer"><span>{isPricing ? "Paid plans are coming soon. Your Free plan remains available today." : "Your plan changes only after a successful payment is verified."}</span><div><button className="button button-soft" type="button" onClick={onViewProfile}>View plan details</button><button className="button button-soft" type="button" onClick={onClose}>Keep exploring</button></div></div>
    </section>
  </div>;
}
