import { initializePaddle, type Environments, type Paddle, type PricePreviewResponse } from "@paddle/paddle-js";
import type { PlanId } from "./plans";

export type PaddleBillingInterval = "year";
export type PaddleTierName = "Free" | "Pro" | "Premium";

export interface Tier {
  name: PaddleTierName;
  description: string;
  features: string[];
  priceId: { year: string };
  /** Retained for backend recognition of existing monthly records; never shown in the public plan picker. */
  legacyPriceId?: { month: string };
  planId: PlanId;
}

/**
 * Keep the public catalog map in one place. The public names match Neulifi's
 * existing Free, Pro, and Premium entitlements.
 * Paddle price IDs are public catalog identifiers, not credentials.
 */
export const paddleTiers: Tier[] = [
  {
    name: "Free",
    planId: "free",
    description: "A simple starting point for building a healthier daily rhythm.",
    features: ["2 meal analyses each day", "Basic analytics", "Private meal history", "Referral rewards"],
    priceId: { year: "" },
  },
  {
    name: "Pro",
    planId: "pro",
    description: "More room to understand patterns and keep your momentum going.",
    features: ["3 meal analyses each day", "Better analytics", "Private meal history", "Referral rewards"],
    priceId: { year: "pri_01m0n2hxhsb9ktr7wrab5h7jkr" },
    legacyPriceId: { month: "pri_01m0n2etrg948zmj7waaxgt2yp" },
  },
  {
    name: "Premium",
    planId: "premium",
    description: "The complete Neulifi experience for a deeper view of your health rhythm.",
    features: ["5 meal analyses each day", "Full analytics access", "Premium leaderboard access", "Referral rewards"],
    priceId: { year: "pri_01m0n2cgc7tjfqg3n2pzmkyvx7" },
    legacyPriceId: { month: "pri_01m0n27xgae352hc3xjpa69e1d" },
  },
];

export interface PaddleRuntimeConfig {
  countryCode?: string;
}

function requiredEnvironment(): Environments {
  const value = String(import.meta.env.VITE_PADDLE_ENVIRONMENT || "").trim().toLowerCase();
  if (value !== "production" && value !== "sandbox") {
    throw new Error("Paddle environment is not configured. Set VITE_PADDLE_ENVIRONMENT to production or sandbox.");
  }
  return value;
}

function requiredClientToken(environment: Environments): string {
  const token = String(import.meta.env.VITE_PADDLE_CLIENT_TOKEN || "").trim();
  if (!token) throw new Error("Paddle checkout is not configured. Set VITE_PADDLE_CLIENT_TOKEN.");
  if (environment === "production" && !token.startsWith("live_")) throw new Error("Paddle production checkout requires a live_ client-side token.");
  if (environment === "sandbox" && !token.startsWith("test_")) throw new Error("Paddle sandbox checkout requires a test_ client-side token.");
  return token;
}

let paddlePromise: Promise<Paddle> | null = null;

function publicOrigin() { return import.meta.env.MODE === "production" ? "https://neulifi.online" : window.location.origin; }

export async function getPaddle(): Promise<Paddle> {
  const environment = requiredEnvironment();
  const token = requiredClientToken(environment);
  if (!paddlePromise) {
    paddlePromise = initializePaddle({
      environment,
      token,
      eventCallback: (event) => {
        if (event.name === "checkout.completed") window.location.assign(`${publicOrigin()}/welcome`);
      },
    }).then((instance) => {
      if (!instance) throw new Error("Paddle could not initialize. Check the client-side token and approved domain.");
      return instance;
    }).catch((error) => {
      paddlePromise = null;
      throw error;
    });
  }
  return paddlePromise;
}

export async function fetchPaddleRuntimeConfig(): Promise<PaddleRuntimeConfig> {
  const response = await fetch("/api/paddle/config", { headers: { accept: "application/json" } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Paddle pricing is not configured yet.");
  const countryCode = typeof payload.countryCode === "string" && /^[A-Z]{2}$/.test(payload.countryCode) ? payload.countryCode : undefined;
  return countryCode ? { countryCode } : {};
}

export function readFormattedTotal(response: PricePreviewResponse): string {
  const total = response.data.details.lineItems[0]?.formattedTotals?.total;
  if (!total) throw new Error("Paddle returned no formatted price for this plan.");
  return total;
}
