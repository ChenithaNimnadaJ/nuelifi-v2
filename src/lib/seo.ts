export type PublicPage = "landing" | "how-it-works" | "plans" | "privacy" | "terms" | "refund-policy";

type SeoDefinition = { title: string; description: string; canonical: string };

const ORIGIN = "https://neulifi.online";

export const publicSeo: Record<PublicPage, SeoDefinition> = {
  landing: {
    title: "Neulifi — AI Meal & Nutrition Scanner",
    description: "Neulifi helps you understand your meals, make practical next choices, and notice food, movement, and lifestyle patterns over time.",
    canonical: `${ORIGIN}/`,
  },
  "how-it-works": {
    title: "How Neulifi Works — AI Meal & Nutrition Insights",
    description: "See how Neulifi turns a meal photo into useful observations and practical next steps, then helps you track patterns over time.",
    canonical: `${ORIGIN}/how-it-works`,
  },
  plans: {
    title: "Neulifi Plans — Free, Pro & Premium",
    description: "Explore Neulifi’s Free, Pro and Premium plans and see what each plan includes.",
    canonical: `${ORIGIN}/plans`,
  },
  privacy: {
    title: "Privacy Policy — Neulifi",
    description: "Learn how Neulifi handles account information, meal photos, health context, and service usage.",
    canonical: `${ORIGIN}/privacy`,
  },
  terms: {
    title: "Terms & Conditions — Neulifi",
    description: "Read the terms for using Neulifi’s nutrition and lifestyle companion, including AI limitations and account responsibilities.",
    canonical: `${ORIGIN}/terms`,
  },
  "refund-policy": {
    title: "Refund Policy — Neulifi",
    description: "Review Neulifi’s refund, cancellation, renewal, and payment-issue request process for future paid plans.",
    canonical: `${ORIGIN}/refund-policy`,
  },
};

function setMeta(selector: string, attribute: "name" | "property", key: string, content: string) {
  const existing = document.head.querySelector<HTMLMetaElement>(selector);
  const element = existing || document.createElement("meta");
  element.setAttribute(attribute, key);
  element.setAttribute("content", content);
  if (!existing) document.head.appendChild(element);
}

function setCanonical(href: string) {
  const existing = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  const element = existing || document.createElement("link");
  element.setAttribute("rel", "canonical");
  element.setAttribute("href", href);
  if (!existing) document.head.appendChild(element);
}

function setWebSiteSchema(definition: SeoDefinition | null) {
  const id = "neulifi-website-schema";
  const existing = document.getElementById(id);
  if (!definition) {
    existing?.remove();
    return;
  }
  const script = (existing as HTMLScriptElement | null) || document.createElement("script");
  script.id = id;
  script.type = "application/ld+json";
  script.textContent = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Neulifi",
    url: `${ORIGIN}/`,
    description: publicSeo.landing.description,
  });
  if (!existing) document.head.appendChild(script);
}

export function applySeoMetadata(page: PublicPage | null, authMode: "signin" | "signup" | null, privateRoute: boolean) {
  if (typeof document === "undefined") return;
  const publicDefinition = page && !privateRoute && !authMode ? publicSeo[page] : null;
  const definition = publicDefinition || (authMode === "signup"
    ? { title: "Create your Neulifi account", description: "Create a private Neulifi space for meal insights, practical next steps, and lifestyle patterns.", canonical: `${ORIGIN}/signup` }
    : authMode === "signin"
      ? { title: "Sign in — Neulifi", description: "Sign in to your private Neulifi space for meal insights, actions, and patterns.", canonical: `${ORIGIN}/login` }
      : { title: "Neulifi Dashboard — Your private health space", description: "Your private Neulifi space for meal insights, actions, and food and lifestyle patterns.", canonical: `${ORIGIN}/app` });
  document.title = definition.title;
  setMeta('meta[name="description"]', "name", "description", definition.description);
  setMeta('meta[property="og:title"]', "property", "og:title", definition.title);
  setMeta('meta[property="og:description"]', "property", "og:description", definition.description);
  setMeta('meta[property="og:url"]', "property", "og:url", definition.canonical);
  setMeta('meta[property="og:type"]', "property", "og:type", "website");
  setMeta('meta[property="og:image"]', "property", "og:image", `${ORIGIN}/neulifi-dashboard-preview-light.webp`);
  setMeta('meta[name="twitter:card"]', "name", "twitter:card", "summary_large_image");
  setMeta('meta[name="robots"]', "name", "robots", publicDefinition && !privateRoute ? "index, follow" : "noindex, nofollow");
  setCanonical(definition.canonical);
  setWebSiteSchema(publicDefinition);
}
