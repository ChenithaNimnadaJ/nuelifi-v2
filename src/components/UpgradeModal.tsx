import { useEffect, useRef } from "react";
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
  const modalRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if (event.key !== "Tab" || !modalRef.current) return;
      const focusable = [...modalRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex=\"-1\"])")];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener("keydown", handleKeyDown); previousFocus?.focus(); };
  }, [open, onClose]);
  if (!open) return null;
  const current = getPlan(currentPlan);
  const pro = getPlan("pro");
  const premium = getPlan("premium");
  const isPricing = reason === "pricing";
  const title = isPricing ? "Choose more room for your rhythm" : reason === "daily-limit" ? "Keep your daily rhythm going" : "See the patterns behind your meals";
  const intro = isPricing
    ? "Pick the level that fits your year. Every paid plan is annual-only, starts after verified payment, and has no free trial."
    : reason === "daily-limit"
      ? `You’ve used today’s ${current.name} allowance. A paid plan gives you more room to check in across the meals and snacks that matter to you.`
      : "Your basic view is ready. Paid plans add more room for analysis and a clearer view of how meal choices and everyday actions connect over time.";
  return <div className="upgrade-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={modalRef} className={`upgrade-modal ${isPricing ? "upgrade-modal-premium-story" : ""}`} role="dialog" aria-modal="true" aria-labelledby="upgrade-modal-title" aria-describedby="upgrade-modal-description">
      <button ref={closeRef} className="upgrade-close" type="button" aria-label="Close upgrade message" onClick={onClose}>×</button>
      <div className="upgrade-modal-kicker"><span>NEULIFI PLANS</span><b>ANNUAL ONLY</b></div>
      <h2 id="upgrade-modal-title">{title}</h2>
      <p id="upgrade-modal-description" className="upgrade-modal-intro">{intro}</p>
      {isPricing && <div className="premium-story-hero"><div><span className="premium-story-label">NO MONTHLY TOGGLE</span><strong>One clear year</strong><small>Pay once for 12 months</small><span className="premium-story-monthly">No free trial · plan access follows verified payment</span></div><p>A small, transparent annual choice for people who want more room to understand their own habits without turning food into another source of pressure.</p></div>}
      <div className="premium-benefit-grid"><article><span>01</span><strong>More room for the day</strong><p>Check in across main meals and snacks as your real day unfolds.</p></article><article><span>02</span><strong>Clearer pattern view</strong><p>See more useful movement in your meal and action history.</p></article><article><span>03</span><strong>Private by default</strong><p>Your account, meal history, and health context stay behind your account security.</p></article></div>
      <div className="upgrade-plan-grid"><article className={`upgrade-value-card upgrade-value-card-pro ${currentPlan === "pro" ? "upgrade-active-plan" : ""}`}><span className="upgrade-recommended">{currentPlan === "pro" ? "ACTIVE PLAN" : "ANNUAL PRO"}</span><span className="upgrade-value-icon">＋</span><strong>Pro · ${pro.annualPrice}/year</strong><p>A practical step up when you want more daily analysis and better analytics without the full community view.</p><small>3 analyses per day · Better analytics · Referral rewards</small><button className="button button-soft upgrade-card-button" type="button" onClick={onViewPlans}>{currentPlan === "pro" ? "View Pro details" : "See Pro"}</button></article><article className={`upgrade-value-card upgrade-value-card-premium ${currentPlan === "premium" ? "upgrade-active-plan" : ""}`}><span className="upgrade-recommended">{currentPlan === "premium" ? "ACTIVE PLAN" : "BEST VALUE"}</span><span className="upgrade-value-icon">✦</span><strong>Premium · ${premium.annualPrice}/year</strong><p>The fullest Neulifi experience for more check-ins, full analytics, referral rewards, and the opt-in community leaderboard.</p><small>5 analyses per day · Full analytics · Premium leaderboard</small><button className="button button-green upgrade-card-button" type="button" onClick={onViewPlans}>{currentPlan === "premium" ? "View Premium details" : "See Premium"}</button></article></div>
      <p className="upgrade-health-note">Neulifi is not medical care and cannot promise to prevent or diagnose disease. It may help you notice patterns earlier and prepare for more informed conversations with a qualified professional.</p>
      <div className="upgrade-modal-footer"><span>Your plan changes only after a successful payment is verified.</span><div><button className="button button-soft" type="button" onClick={onViewPlans}>View full plan details</button><button className="button button-soft" type="button" onClick={onClose}>Keep exploring</button></div></div>
    </section>
  </div>;
}
