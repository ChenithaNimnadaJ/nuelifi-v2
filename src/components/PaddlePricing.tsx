import { useEffect, useMemo, useState } from "react";
import { getHealthySession } from "../lib/supabase";
import { fetchPaddleRuntimeConfig, getPaddle, paddleTiers, readFormattedTotal, type PaddleBillingInterval, type PaddleRuntimeConfig, type Tier } from "../lib/paddle";

type PaddlePricingProps = { onAuth: (mode: "signin" | "signup", returnPath?: "/app" | "/welcome") => void };
type PriceState = Record<string, string>;

function publicOrigin() { return import.meta.env.MODE === "production" ? "https://neulifi.online" : window.location.origin; }

async function loadPrices(config: PaddleRuntimeConfig): Promise<{ prices: PriceState; failures: number }> {
  const paddle = await getPaddle(config);
  const results = await Promise.allSettled(paddleTiers.flatMap((tier) => (Object.entries(tier.priceId) as [PaddleBillingInterval, string][]).filter(([, priceId]) => priceId).map(async ([interval, priceId]) => {
    const preview = await paddle.PricePreview({ items: [{ priceId, quantity: 1 }], ...(config.countryCode ? { address: { countryCode: config.countryCode } } : {}) });
    return [`${tier.planId}-${interval}`, readFormattedTotal(preview)] as const;
  })));
  const prices: PriceState = {};
  let failures = 0;
  for (const result of results) {
    if (result.status === "fulfilled") prices[result.value[0]] = result.value[1];
    else failures += 1;
  }
  return { prices, failures };
}

export function PaddlePricing({ onAuth }: PaddlePricingProps) {
  const interval: PaddleBillingInterval = "year";
  const [prices, setPrices] = useState<PriceState>({});
  const [runtimeConfig, setRuntimeConfig] = useState<PaddleRuntimeConfig | null>(null);
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
        const config = await fetchPaddleRuntimeConfig();
        const { prices: nextPrices, failures } = await loadPrices(config);
        if (active) {
          setRuntimeConfig(config);
          setCountryCode(config.countryCode);
          setPrices(nextPrices);
          if (failures) setError(failures === paddleTiers.filter((tier) => tier.planId !== "free" && tier.priceId.year).length ? "Annual prices could not be loaded. Please refresh and try again." : "Some annual prices could not be loaded. Those plans will remain unavailable until pricing is confirmed.");
        }
      } catch (value) {
        if (active) setError(value instanceof Error ? value.message : "Paddle pricing could not be loaded.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, []);

  const priceLabel = (tier: Tier) => tier.planId === "free" ? "Free" : prices[`${tier.planId}-${interval}`] || "Unavailable";
  const checkout = async (tier: Tier) => {
    if (tier.planId === "free") { onAuth("signup"); return; }
    if (!tier.priceId.year) { setError(`${tier.name} is not configured for annual billing yet.`); return; }
    if (!runtimeConfig) { setError("Paddle checkout is still loading. Please try again in a moment."); return; }
    setCheckoutPlan(tier.planId);
    setError("");
    window.localStorage.setItem("neulifi-checkout-intent", JSON.stringify({ plan: tier.planId, billing_interval: "year", startedAt: Date.now() }));
    try {
      const session = await getHealthySession().catch(() => null);
      const paddle = await getPaddle(runtimeConfig);
      paddle.Checkout.open({
        items: [{ priceId: tier.priceId.year, quantity: 1 }],
        customer: session?.user?.email ? { email: session.user.email } : undefined,
        customData: { billing_interval: "year", source: "neulifi" },
        settings: { displayMode: "overlay", variant: "one-page", successUrl: `${publicOrigin()}/welcome` },
      });
    } catch (value) {
      window.localStorage.removeItem("neulifi-checkout-intent");
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
      <div className="paddle-billing-note" aria-label="Billing frequency"><strong>Billed annually</strong><small>Annual-only plans</small></div>
      <small className="paddle-location-note">{countryLabel}. Final totals, taxes, and currency are shown at checkout.</small>
    </section>
    {error && <div className="data-note data-error paddle-status" role="alert">{error}</div>}
    <section className="plan-grid plan-grid-premium paddle-plan-grid" aria-label="Neulifi plans">
      {paddleTiers.map((tier) => <PaddlePlanCard key={tier.planId} tier={tier} interval={interval} price={priceLabel(tier)} loading={loading} checkoutPlan={checkoutPlan} onSubscribe={() => void checkout(tier)} />)}
    </section>
    <section className="pricing-value-story paddle-pricing-note"><div><span className="public-kicker">A CLEARER CHOICE</span><h2>Start small. Keep the useful signal.</h2><p>Neulifi is a nutrition and lifestyle companion, not medical care. It can help you notice patterns and prepare for informed conversations, but it cannot diagnose or prevent disease.</p></div><div className="pricing-value-points"><p><b>Free</b> keeps the essentials open while you build your private history.</p><p><b>Pro</b> gives you more daily room and adds Meal consistency to your private insights.</p><p><b>Premium</b> brings the fullest analytics: Score stability, Meal patterns, and Action follow-through.</p></div></section>
  </main>;
}

function PaddlePlanCard({ tier, interval, price, loading, checkoutPlan, onSubscribe }: { tier: Tier; interval: PaddleBillingInterval; price: string; loading: boolean; checkoutPlan: string | null; onSubscribe: () => void }) {
  const highlighted = tier.planId === "premium";
  return <article className={`plan-card plan-card-premium paddle-plan-card ${highlighted ? "highlighted" : ""}`}>
    <div className="plan-card-top"><span className="plan-label">{tier.name}</span>{highlighted && <span className="plan-popular">BEST VALUE</span>}</div>
    <p>{tier.description}</p>
    <div className="plan-price">{loading && tier.planId !== "free" ? <span className="paddle-price-loading" aria-label="Loading price">…</span> : price}<small>{tier.planId === "free" ? "" : " / year"}</small></div>
    {tier.planId !== "free" && <div className="plan-annual-label">Billed annually · no free trial</div>}
    <div className="plan-features plan-features-premium">{tier.features.map((feature, index) => <span className={index === 0 ? "plan-feature-emphasis" : ""} key={feature}>✓ {feature}</span>)}</div>
    <button className={`button ${price === "Unavailable" ? "button-soft" : highlighted ? "button-green" : "button-soft"}`} type="button" onClick={onSubscribe} disabled={loading && tier.planId !== "free" || tier.planId !== "free" && price === "Unavailable" || checkoutPlan === tier.planId}>{checkoutPlan === tier.planId ? "Opening…" : tier.planId === "free" ? "Start free" : price === "Unavailable" ? "Price unavailable" : "Subscribe"}</button>
  </article>;
}
