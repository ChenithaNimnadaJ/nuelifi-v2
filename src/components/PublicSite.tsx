import { getPlan, plans, type PlanId } from "../lib/plans";

type PublicPage = "landing" | "features" | "pricing";

type PublicSiteProps = {
  page: PublicPage;
  onNavigate: (page: PublicPage) => void;
  onAuth: (mode: "signin" | "signup") => void;
  onPreview: () => void;
};

export function PublicSite({ page, onNavigate, onAuth, onPreview }: PublicSiteProps) {
  const title = page === "features" ? "A calmer way to understand your meals" : page === "pricing" ? "Plans that grow with your rhythm" : "Health awareness that fits into real life";
  return <div className="public-site">
    <PublicNav page={page} onNavigate={onNavigate} onAuth={onAuth} />
    {page === "landing" ? <Landing title={title} onNavigate={onNavigate} onAuth={onAuth} onPreview={onPreview} /> : page === "features" ? <Features title={title} onAuth={onAuth} /> : <Pricing title={title} onAuth={onAuth} />}
    <PublicFooter onNavigate={onNavigate} onAuth={onAuth} />
  </div>;
}

function PublicNav({ page, onNavigate, onAuth }: { page: PublicPage; onNavigate: (page: PublicPage) => void; onAuth: (mode: "signin" | "signup") => void }) {
  return <header className="public-nav">
    <button className="public-brand" type="button" onClick={() => onNavigate("landing")}><img className="brand-logo" src="/neulifi-logo.png" alt="" aria-hidden="true"/><strong>Neulifi</strong></button>
    <nav className="public-links" aria-label="Public navigation"><button className={page === "features" ? "active" : ""} type="button" onClick={() => onNavigate("features")}>Features</button><button className={page === "pricing" ? "active" : ""} type="button" onClick={() => onNavigate("pricing")}>Plans</button></nav>
    <div className="public-actions"><button className="public-login" type="button" onClick={() => onAuth("signin")}>Sign in</button><button className="button button-green public-cta" type="button" onClick={() => onAuth("signup")}>Get started</button></div>
  </header>;
}

function Landing({ title, onNavigate, onAuth, onPreview }: { title: string; onNavigate: (page: PublicPage) => void; onAuth: (mode: "signin" | "signup") => void; onPreview: () => void }) {
  return <main className="public-main public-landing">
    <section className="public-hero public-hero-premium">
      <div className="public-hero-copy">
        <span className="public-kicker"><span className="public-kicker-dot" />YOUR EVERYDAY HEALTH COMPANION</span>
        <h1>{title}</h1>
        <p className="public-hero-lede">Turn a meal photo into a clearer next step. Neulifi brings your meals, daily actions, and personal context together in one private space.</p>
        <div className="public-hero-actions"><button className="button button-green public-primary-button" type="button" onClick={() => onAuth("signup")}>Create your free space <span aria-hidden="true">→</span></button><button className="public-secondary-cta" type="button" onClick={() => onNavigate("features")}>See how it works <span aria-hidden="true">↗</span></button></div>
        <div className="public-trust-row"><span>Private by design</span><span>Practical, not prescriptive</span><span>Start free</span></div>
      </div>
      <ProductPreview />
    </section>
    <section className="public-proof public-proof-premium" aria-label="Neulifi benefits"><div><span className="public-proof-icon">◌</span><strong>See the signal</strong><span>Understand what is on your plate without the noise.</span></div><div><span className="public-proof-icon">＋</span><strong>Keep the useful part</strong><span>Turn simple day-level ideas into actions when you choose.</span></div><div><span className="public-proof-icon">↗</span><strong>Build your rhythm</strong><span>Notice patterns over time in a calm, private dashboard.</span></div></section>
    <section className="public-section public-story-section"><div className="public-story-intro"><span className="public-kicker">A BETTER DAILY LOOP</span><h2>Less guessing. More clarity for the next choice.</h2><p>Neulifi helps you move from information to action without asking you to change everything at once.</p></div><div className="public-step-grid"><article className="public-step-card"><span>01</span><h3>Capture</h3><p>Take a photo or upload a meal in seconds.</p></article><article className="public-step-card"><span>02</span><h3>Understand</h3><p>Get a simple view of the signals that matter.</p></article><article className="public-step-card"><span>03</span><h3>Keep going</h3><p>Return to small actions and patterns that feel doable.</p></article></div></section>
    <section className="public-section public-product-story"><div className="public-story-card"><div className="public-story-card-copy"><span className="public-kicker">MADE FOR REAL LIFE</span><h2>Your health space, without the pressure.</h2><p>Use the context you already know about yourself, keep meal guidance separate from daily tasks, and make progress feel visible without turning your day into a spreadsheet.</p><button className="text-button public-text-button" type="button" onClick={() => onNavigate("features")}>Explore the product <span aria-hidden="true">→</span></button></div><div className="public-story-metric"><span>YOUR DAY</span><strong>One clear next step</strong><div className="story-metric-line"><i /><i /><i /></div><small>Meals · actions · insights</small></div></div></section>
    <section className="public-bottom-cta public-bottom-cta-premium"><div><span className="public-kicker">START WITH WHAT YOU HAVE</span><h2>Make health feel more doable.</h2><p>A calmer way to pay attention to the things that shape your day.</p></div><button className="button button-green" type="button" onClick={() => onAuth("signup")}>Get started free <span aria-hidden="true">→</span></button></section>
  </main>;
}

function ProductPreview() {
  return <div className="public-product-preview public-product-preview-premium" aria-label="Illustration of the Neulifi product"><div className="preview-floating-chip preview-chip-top">● Today feels clearer</div><div className="preview-window-bar"><span /><span /><span /></div><div className="preview-window-body"><div className="preview-mini-rail"><img className="preview-mini-logo" src="/neulifi-logo.png" alt="" aria-hidden="true"/><i /><i /><i /><i /><i /></div><div className="preview-mini-content"><div className="preview-mini-top"><span>OVERVIEW</span><b>SC</b></div><div className="preview-mini-greeting"><small>MONDAY, JUN 16</small><strong>Good morning, Sarah</strong></div><div className="preview-mini-score"><small>AVERAGE HEALTH SCORE</small><strong>82 <em>/100</em></strong><span><i /></span><label>3 meals analysed <b>4/6 actions done</b></label></div><div className="preview-mini-stats"><div><small>MEALS</small><strong>12</strong></div><div><small>ACTIONS</small><strong>8/11</strong></div><div><small>STREAK</small><strong>5d</strong></div></div><div className="preview-mini-capture"><b>＋</b><span><strong>Analyse a meal</strong><small>Photo or upload — takes 10 seconds</small></span><i>→</i></div></div></div><div className="preview-floating-chip preview-chip-bottom"><span>✓</span> Keep one small action</div></div>;
}

function Features({ title, onAuth }: { title: string; onAuth: (mode: "signin" | "signup") => void }) {
  const featureCards: [string, string, string][] = [["01", "Analyse without overwhelm", "See the important signals from a meal photo in language that is clear, calm, and easy to return to."], ["02", "Keep guidance in its place", "Meal-specific observations stay with the meal. Practical hydration, movement, sleep, and planning steps become tasks only when you choose."], ["03", "Bring your context", "Add the conditions, allergies, preferences, and goals you already know so guidance can be more relevant without pretending to diagnose."], ["04", "Build your own history", "Your private dashboard connects meals, actions, and insights so progress can feel visible over time."]];
  return <main className="public-main"><section className="public-page-heading"><span className="public-kicker">THE PRODUCT</span><h1>{title}</h1><p>Neulifi is designed around the space between information and action: enough context to be useful, never so much that everyday health becomes another full-time job.</p></section><section className="feature-grid">{featureCards.map(([number, heading, description]) => <article className="feature-card" key={number}><span>{number}</span><h2>{heading}</h2><p>{description}</p></article>)}</section><section className="public-privacy"><div><span className="public-kicker">YOUR SPACE, YOUR CONTEXT</span><h2>Private information should feel private.</h2></div><p>Neulifi keeps account data behind Supabase authentication and uses the health context you provide only to shape the app’s analysis. It does not replace a clinician, diagnose conditions, or prescribe treatment.</p></section><section className="public-bottom-cta"><h2>Ready for a calmer starting point?</h2><button className="button button-green" type="button" onClick={() => onAuth("signup")}>Create your free space <span aria-hidden="true">→</span></button></section></main>;
}

function Pricing({ title, onAuth }: { title: string; onAuth: (mode: "signin" | "signup") => void }) {
  return <main className="public-main"><section className="public-page-heading pricing-heading pricing-heading-premium"><span className="public-kicker">SIMPLE PLAN PREVIEW</span><h1>{title}</h1><p>Choose the level of room and perspective that fits your everyday health rhythm. Annual pricing is shown clearly, with no hidden commitments.</p><div className="pricing-billing-note"><span>Annual billing</span><small>Save more when you stay with your rhythm</small></div></section><section className="plan-grid plan-grid-premium">{plans.map((plan) => <PlanCard key={plan.id} plan={plan} highlighted={plan.id === "pro"} onAuth={onAuth} />)}</section><p className="pricing-note">Checkout is not connected yet. These are the intended annual prices and plan boundaries; billing will be enabled only after the payment provider is connected.</p></main>;
}

function PlanCard({ plan, highlighted, onAuth }: { plan: ReturnType<typeof getPlan>; highlighted: boolean; onAuth: (mode: "signin" | "signup") => void }) {
  const id = plan.id as PlanId;
  const annualPrice = plan.annualPrice;
  return <article className={`plan-card plan-card-premium ${highlighted ? "highlighted" : ""}`}><div className="plan-card-top"><span className="plan-label">{plan.name}</span>{highlighted && <span className="plan-popular">MOST POPULAR</span>}</div><p>{plan.description}</p><div className="plan-price">{annualPrice === null ? plan.priceLabel : `$${annualPrice}`}<small>{annualPrice === null ? "" : " / year"}</small></div>{plan.price !== null && <div className="plan-monthly-anchor">${plan.price} monthly plan · billed annually</div>}<div className="plan-features plan-features-premium">{plan.marketingFeatures.map((feature, index) => <span className={index === 0 ? "plan-feature-emphasis" : ""} key={feature}>✓ {feature}</span>)}</div><button className={`button ${highlighted ? "button-green" : "button-soft"}`} type="button" onClick={() => onAuth("signup")}>{id === "free" ? "Start free" : "Get started"}</button></article>;
}

function PublicFooter({ onNavigate, onAuth }: { onNavigate: (page: PublicPage) => void; onAuth: (mode: "signin" | "signup") => void }) {
  return <footer className="public-footer"><div><button className="public-brand" type="button" onClick={() => onNavigate("landing")}><img className="brand-logo" src="/neulifi-logo.png" alt="" aria-hidden="true"/><strong>Neulifi</strong></button><p>A calmer, more practical way to build health awareness.</p></div><div className="public-footer-links"><button type="button" onClick={() => onNavigate("features")}>Features</button><button type="button" onClick={() => onNavigate("pricing")}>Plans</button><button type="button" onClick={() => onAuth("signin")}>Sign in</button></div><small>© {new Date().getFullYear()} Neulifi. Annual plan preview — billing is not connected.</small></footer>;
}
