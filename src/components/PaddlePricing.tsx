import { useEffect, useMemo, useState } from "react";
import { getHealthySession } from "../lib/supabase";
import { getPaddle, paddleTiers, readFormattedTotal, type PaddleBillingInterval, type PaddleRuntimeConfig, type Tier } from "../lib/paddle";

type PaddlePricingProps = { onAuth: (mode: "signin" | "signup") => void };
type PriceState = Record<string, string>;

function runtimeConfigUrl() {
  const configured = String(import.meta.env.VITE_API_URL || "").trim().replace(/\/+$/, "");
  const safeBase = import.meta.env.MODE === "production" && /^(https?:)?\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(configured) ? "" : configured;
  return `${safeBase}/api/paddle/config`;
}

async function loadPrices(config: PaddleRuntimeConfig): Promise<PriceState> {
  const paddle = await getPaddle();
  const entries = await Promise.all(paddleTiers.flatMap((tier) => (Object.entries(tier.priceId) as [PaddleBillingInterval, string][]).filter(([, priceId]) => priceId).map(async ([interval, priceId]) => {
    const preview = await paddle.PricePreview({ items: [{ priceId, quantity: 1 }], ...(config.countryCode ? { address: { countryCode: config.countryCode } } : {}) });
    return [`${tier.planId}-${interval}`, readFormattedTotal(preview)] as const;
  })));
  return Object.fromEntries(entries);
}

export function PaddlePricing({ onAuth }: PaddlePricingProps) {
  const [interval, setInterval] = useState<PaddleBillingInterval>("year");
  const [prices, setPrices] = useState<PriceState>({});
  const [countryCode, setCountryCode] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [checkoutPlan, setCheckoutPlan] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(runtimeConfigUrl(), { headers: { accept: "application/json" } });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || "Paddle pricing is not configured yet.");
        const config: PaddleRuntimeConfig = typeof payload.countryCode === "string" && /^[A-Z]{2}$/.test(payload.countryCode) ? { countryCode: payload.countryCode } : {};
        const nextPrices = await loadPrices(config);
        if (active) { setCountryCode(config.countryCode); setPrices(nextPrices); }
      } catch (value) {
        if (active) setError(value instanceof Error ? value.message : "Paddle pricing could not be loaded.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, []);

  const priceLabel = (tier: Tier) => tier.planId === "free" ? "Free" : prices[`${tier.planId}-${interval}`] || "—";
  const checkout = async (tier: Tier) => {
    if (tier.planId === "free") { onAuth("signup"); return; }
    if (!tier.priceId[interval]) { setError(`${tier.name} is not configured for ${interval === "year" ? "yearly" : "monthly"} billing yet.`); return; }
    setCheckoutPlan(tier.planId);
    setError("");
    try {
      const session = await getHealthySession();
      if (!session?.user) { onAuth("signup"); return; }
      const paddle = await getPaddle();
      paddle.Checkout.open({
        items: [{ priceId: tier.priceId[interval], quantity: 1 }],
        customer: session.user.email ? { email: session.user.email } : undefined,
        customData: { user_id: session.user.id, plan: tier.planId, billing_interval: interval, source: "neulifi" },
        settings: { displayMode: "overlay", variant: "one-page", successUrl: `${window.location.origin}/welcome` },
      });
    } catch (value) {
      setError(value instanceof Error ? value.message : "Checkout could not be opened.");
    } finally {
      setCheckoutPlan(null);
    }
  };

  const countryLabel = useMemo(() => countryCode ? `Prices shown for ${countryCode}` : "Prices adapt to your location", [countryCode]);
  return <main className="public-main paddle-pricing-page">
    <section className="public-page-heading pricing-heading pricing-heading-premium">
      <span className="public-kicker">NEULIFI PLANS</span>
      <h1>More room for the rhythm you are building.</h1>
      <p>Choose the level that fits today. Paid plans are billed from the first cycle—there are no free trials—and you can manage your plan from your account.</p>
      <div className="paddle-billing-controls" role="group" aria-label="Billing period">
        <button type="button" className={interval === "month" ? "active" : ""} onClick={() => setInterval("month")}>Monthly</button>
        <button type="button" className={interval === "year" ? "active" : ""} onClick={() => setInterval("year")}>Yearly <span>Save with annual billing</span></button>
      </div>
      <small className="paddle-location-note">{countryLabel}. Final totals, taxes, and currency are returned by Paddle.</small>
    </section>
    {error && <div className="data-note data-error paddle-status" role="alert">{error}</div>}
    <section className="plan-grid plan-grid-premium paddle-plan-grid" aria-label="Neulifi plans">
      {paddleTiers.map((tier) => <PaddlePlanCard key={tier.planId} tier={tier} interval={interval} price={priceLabel(tier)} loading={loading} checkoutPlan={checkoutPlan} onSubscribe={() => void checkout(tier)} />)}
    </section>
    <section className="pricing-value-story paddle-pricing-note"><div><span className="public-kicker">A CLEARER CHOICE</span><h2>Start small. Keep the useful signal.</h2><p>Neulifi is a nutrition and lifestyle companion, not medical care. It can help you notice patterns and prepare for informed conversations, but it cannot diagnose or prevent disease.</p></div><div className="pricing-value-points"><p><b>Free</b> keeps the essentials open while you build your private history.</p><p><b>Pro</b> gives you more daily room and a better view of movement over time.</p><p><b>Premium</b> brings the fullest analytics and Premium community access.</p></div></section>
  </main>;
}

function PaddlePlanCard({ tier, interval, price, loading, checkoutPlan, onSubscribe }: { tier: Tier; interval: PaddleBillingInterval; price: string; loading: boolean; checkoutPlan: string | null; onSubscribe: () => void }) {
  const highlighted = tier.planId === "premium";
  return <article className={`plan-card plan-card-premium paddle-plan-card ${highlighted ? "highlighted" : ""}`}>
    <div className="plan-card-top"><span className="plan-label">{tier.name}</span>{highlighted && <span className="plan-popular">BEST VALUE</span>}</div>
    <p>{tier.description}</p>
    <div className="plan-price">{loading && tier.planId !== "free" ? <span className="paddle-price-loading" aria-label="Loading price">…</span> : price}<small>{tier.planId === "free" ? "" : ` / ${interval === "year" ? "year" : "month"}`}</small></div>
    {tier.planId !== "free" && <div className="plan-monthly-anchor">No free trial · billed from the first cycle</div>}
    <div className="plan-features plan-features-premium">{tier.features.map((feature, index) => <span className={index === 0 ? "plan-feature-emphasis" : ""} key={feature}>✓ {feature}</span>)}</div>
    <button className={`button ${highlighted ? "button-green" : "button-soft"}`} type="button" onClick={onSubscribe} disabled={loading && tier.planId !== "free" || checkoutPlan === tier.planId}>{checkoutPlan === tier.planId ? "Opening…" : tier.planId === "free" ? "Start free" : "Subscribe"}</button>
  </article>;
}
