import { getHealthySession, refreshHealthySession } from "./supabase";
import type { AnalysisLevel, PlanId } from "./plans";

export type MealRating = "Excellent" | "Good" | "Reasonable" | "Needs Adjustment";
export type ActionStatus = "upcoming" | "completed" | "missed";
export type RegionId = "global" | "south-asia" | "east-asia" | "southeast-asia" | "europe" | "north-america" | "latin-america" | "mena" | "sub-saharan-africa";
export interface HealthContext { conditions: string[]; allergies: string[]; notes?: string; }
export interface UserPreferences { notifications?: boolean; dailyReminders?: boolean; weeklySummary?: boolean; appearance?: "system" | "light" | "dark"; onboardingCompleted?: boolean; dietaryPreference?: string; activityLevel?: string; healthContext?: HealthContext; region?: RegionId; timezone?: string; referralCode?: string; [key: string]: unknown; }
export interface MealAnalysis { rating: MealRating; score: number; indicators: Record<string, number>; explanation: string; mealGuidance: string[]; dailyTasks: string[]; dailyTaskReasons?: string[]; recommendations?: string[]; }
export interface User { id: string; email: string; name: string; goals: string[]; preferences?: UserPreferences; region?: RegionId; timezone?: string; }
export interface Meal { id: string; userId: string; imageUrl: string; imageUrls?: string[]; mealName: string; capturedAt: string; status: "analysed"; analysis: MealAnalysis; }
export interface Action { id: string; userId: string; mealId: string | null; title: string; description?: string; completed: boolean; status?: ActionStatus; dueAt?: string | null; createdAt: string; completedAt: string | null; }
export interface Dashboard { mealsAnalysed: number; actionsCompleted: number; actionsTotal: number; averageMealScore: number; recentMeals: Meal[]; openActions: Action[]; }
export interface UsageSnapshot { plan: PlanId; status: string; used: number; usageLimit: number; analysisLevel: AnalysisLevel; }
export interface StreakSnapshot { currentStreak: number; longestStreak: number; lastActivityDate: string | null; }
export interface ReferralSummary { code: string | null; referredUsers: number; paidUsers: number; paidUsersThisMonth: number; referredScans: number; pendingEarnings: number; availableEarnings: number; lifetimeEarnings: number; standardProCommission: number; standardPremiumCommission: number; highVolumeProCommission: number; highVolumePremiumCommission: number; highVolumeThreshold: number; }

const configuredApiUrl = String(import.meta.env.VITE_API_URL || "").trim();
const API_URL = import.meta.env.MODE === "production" && /^(https?:)?\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(configuredApiUrl) ? "" : configuredApiUrl.replace(/\/+$/, "");
async function request<T>(path: string, options?: RequestInit, allowRefresh = true): Promise<T> {
  const session = await getHealthySession();
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 60000);
  try {
    const response = await fetch(`${API_URL}${path}`, { ...options, signal: controller.signal, headers: { "content-type": "application/json", ...(session?.access_token ? { authorization: `Bearer ${session.access_token}` } : {}), ...(options?.headers || {}) } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok && allowRefresh && response.status === 401 && await refreshHealthySession()) return request<T>(path, options, false);
    if (!response.ok) throw new Error(payload.error || "Neulifi API request failed");
    return payload as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw new Error("The meal scanner timed out. Please try again in a moment.");
    if (error instanceof TypeError) throw new Error("The meal scanner could not reach the Neulifi backend. Please check your connection and try again.");
    throw error;
  } finally { window.clearTimeout(timeout); }
}


export const neulifiApi = {
  authMe: () => request<{ id: string; email: string }>("/api/auth/me"),
  dashboard: (userId: string) => request<Dashboard>(`/api/users/${userId}/dashboard`),
  profile: (userId: string) => request<User>(`/api/users/${userId}/profile`),
  updateProfile: (userId: string, input: Partial<Pick<User, "name" | "goals" | "preferences" | "region" | "timezone">>) => request<User>(`/api/users/${userId}/profile`, { method: "PATCH", body: JSON.stringify(input) }),
  meals: (userId: string) => request<Meal[]>(`/api/users/${userId}/meals`),
  analyseMeal: (userId: string, imageUrls: string[] | string, mealName: string | undefined, context: { goals: string[]; preferences: UserPreferences } | undefined, eventKey: string) => { const image = Array.isArray(imageUrls) ? imageUrls[0] || "" : imageUrls; return request<Meal & { provider?: string; imageUrls?: string[] }>(`/api/analyze`, { method: "POST", body: JSON.stringify({ userId, imageUrl: image, imageUrls: [image], mealName, context, eventKey }) }); },
  persistMeal: (input: { userId: string; eventKey: string; imageUrl: string; imageUrls?: string[]; mealName: string; capturedAt: string; provider?: string; analysis: MealAnalysis }) => { const image = input.imageUrls?.[0] || input.imageUrl; return request<{ id: string }>(`/api/persist-meal`, { method: "POST", body: JSON.stringify({ ...input, imageUrl: image, imageUrls: [image] }) }); },
  ensureUserRecords: (name = "") => request<{ ok: boolean }>("/api/user/ensure-records", { method: "POST", body: JSON.stringify({ name }) }),
  attributeReferral: (code: string) => request<{ attributed: boolean }>("/api/user/referral/attribute", { method: "POST", body: JSON.stringify({ code }) }),
  actions: (_userId?: string) => request<Action[]>("/api/user/actions"),
  completeAction: (actionId: string, completed = true) => request<Action>(`/api/user/actions/${encodeURIComponent(actionId)}`, { method: "PATCH", body: JSON.stringify({ completed }) }),
  ensureReferralCode: () => request<{ code: string }>("/api/user/referral-code"),
  referralSummary: () => request<ReferralSummary>("/api/user/referral-summary"),
  insights: (userId: string) => request(`/api/users/${userId}/insights`),
  subscription: (userId: string) => request(`/api/users/${userId}/subscription`),
  usage: async () => { const payload = await request<{ plan: PlanId; status: string; used: number; usage_limit: number; analysis_level: AnalysisLevel }>("/api/usage"); return { plan: payload.plan, status: payload.status, used: payload.used, usageLimit: payload.usage_limit, analysisLevel: payload.analysis_level } as UsageSnapshot; },
  customerPortal: () => request<{ url: string }>("/api/paddle/customer-portal", { method: "POST", body: JSON.stringify({}) }),
  claimPendingPurchase: () => request<{ claimed: number; plan: PlanId | null }>("/api/paddle/claim-pending-purchase", { method: "POST", body: JSON.stringify({}) }),
};
