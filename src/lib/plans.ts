import rawPlanConfig from "../../plan-config.json";

export type PlanId = "free" | "pro" | "premium";
export type AnalysisLevel = "basic" | "enhanced" | "complete";
export type PlanConfig = (typeof rawPlanConfig)["plans"][PlanId];

export const planConfig = rawPlanConfig as {
  version: number;
  usagePeriod: "calendar_month";
  currency: string;
  plans: Record<PlanId, PlanConfig>;
};

export const plans = Object.values(planConfig.plans).sort((a, b) => a.displayOrder - b.displayOrder);

export function getPlan(plan: unknown): PlanConfig {
  return planConfig.plans[plan === "pro" || plan === "premium" ? plan : "free"];
}

export function hasCapability(plan: unknown, capability: string): boolean {
  return getPlan(plan).capabilities.includes(capability);
}

export function usageLabel(plan: unknown): string {
  const current = getPlan(plan);
  return `${current.aiUsageLimit} analyses / month`;
}
