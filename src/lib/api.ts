import { getHealthySession, refreshHealthySession } from "./supabase";
import type { AnalysisLevel, PlanId } from "./plans";

export type MealRating = "Excellent" | "Good" | "Reasonable" | "Needs Adjustment";
export type ActionStatus = "upcoming" | "completed" | "missed";
export type RegionId = "global" | "south-asia" | "east-asia" | "southeast-asia" | "europe" | "north-america" | "latin-america" | "mena" | "sub-saharan-africa";
export interface HealthContext { conditions: string[]; allergies: string[]; notes?: string; }
export interface UserPreferences { notifications?: boolean; dailyReminders?: boolean; weeklySummary?: boolean; appearance?: "system" | "light" | "dark"; onboardingCompleted?: boolean; dietaryPreference?: string; activityLevel?: string; healthContext?: HealthContext; region?: RegionId; timezone?: string; referralCode?: string; [key: string]: unknown; }
export interface MealAnalysis { rating: MealRating; score: number; indicators: Record<string, number>; explanation: string; mealGuidance: string[]; dailyTasks: string[]; dailyTaskReasons?: string[]; alreadyOnPlan?: string[]; recommendations?: string[]; }
export interface AnalysisContext { goals: string[]; preferences: UserPreferences; existingActions?: Array<{ title: string; status?: string; dueAt?: string | null }> | string[]; completedActions?: string[]; capturedAt?: string; }
export interface User { id: string; email: string; name: string; goals: string[]; preferences?: UserPreferences; region?: RegionId; timezone?: string; }
export interface Meal { id: string; userId: string; imageUrl: string; imageUrls?: string[]; mealName: string; capturedAt: string; status: "analysed"; analysis: MealAnalysis; }
export interface Action { id: string; userId: string; mealId: string | null; title: string; description?: string; completed: boolean; status?: ActionStatus; dueAt?: string | null; createdAt: string; completedAt: string | null; }
export interface Dashboard { mealsAnalysed: number; actionsCompleted: number; actionsTotal: number; averageMealScore: number; recentMeals: Meal[]; openActions: Action[]; }
export interface UsageSnapshot { plan: PlanId; status: string; used: number; usageLimit: number; analysisLevel: AnalysisLevel; }
export interface StreakSnapshot { currentStreak: number; longestStreak: number; lastActivityDate: string | null; }
export interface ReferralSummary { code: string | null; referredUsers: number; paidUsers: number; paidUsersThisMonth: number; referredScans: number; pendingEarnings: number; availableEarnings: number; lifetimeEarnings: number; }
export type PayoutMethodType = "crypto_transfer";
export type PayoutRequestStatus = "pending" | "approved" | "paid" | "rejected" | "cancelled";
export interface PayoutMethodOption { methodType: PayoutMethodType; currency: string; network: string; displayName: string; memoRequired: boolean; countryCodes: string[]; }
export interface PayoutMethod { id: string; countryCode: string; methodType: PayoutMethodType; currency: string; network: string; destinationPreview: string; destinationLast4: string | null; hasMemoTag: boolean; createdAt: string; updatedAt: string; }
export interface PayoutRequest { id: string; requestedAmount: number; currency: "USD"; status: PayoutRequestStatus; availableBalanceSnapshot: number; countryCode: string; methodType: PayoutMethodType; methodCurrency: string; network: string; destinationPreview: string; destinationLast4: string | null; hasMemoTag: boolean; userMessage: string | null; createdAt: string; reviewedAt: string | null; paidAt: string | null; paymentReference: string | null; }
export interface AffiliatePayouts { method: PayoutMethod | null; options: PayoutMethodOption[]; requests: PayoutRequest[]; }
export interface SavePayoutMethodInput { countryCode: string; methodType: "crypto_transfer"; currency: string; network: string; walletAddress: string; memoTag?: string; }
export type AdminWalletAddressStatus = "decrypted" | "synthetic_placeholder" | "unavailable" | "missing";
export type AdminMemoTagStatus = "decrypted" | "unavailable" | "none";
export interface AdminPayoutRequest extends PayoutRequest { affiliateId: string; affiliateName: string; affiliateEmail: string | null; payoutMethodId: string; requestNote: string; adminNotes: string | null; walletAddress: string; walletAddressStatus: AdminWalletAddressStatus; memoTag: string; memoTagStatus: AdminMemoTagStatus; isSyntheticQa: boolean; reviewerId: string | null; paidBy: string | null; }
export interface AdminPayoutSummary { pendingCount: number; pendingAmount: number; paidCount: number; paidAmount: number; }
export interface AdminPayoutsResponse { summary: AdminPayoutSummary; requests: AdminPayoutRequest[]; }

const configuredApiUrl = String(import.meta.env.VITE_API_URL || "").trim();
const API_URL = import.meta.env.MODE === "production" && /^(https?:)?\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(configuredApiUrl) ? "" : configuredApiUrl.replace(/\/+$/, "");
async function request<T>(path: string, options?: RequestInit, allowRefresh = true): Promise<T> {
  const session = await getHealthySession();
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 60000);
  try {
    const response = await fetch(`${API_URL}${path}`, { ...options, signal: controller.signal, headers: { "content-type": "application/json", ...(session?.access_token ? { authorization: `Bearer ${session.access_token}` } : {}), ...(options?.headers || {}) } });
    let payload: unknown = null;
    let malformed = false;
    try { payload = await response.json(); } catch { malformed = true; }
    if (!response.ok && allowRefresh && response.status === 401 && await refreshHealthySession()) return request<T>(path, options, false);
    if (!response.ok) { const serverMessage = payload && typeof payload === "object" && "error" in payload ? String((payload as { error?: unknown }).error || "").trim() : ""; throw new Error(serverMessage || (malformed ? `Neulifi returned an unexpected response (${response.status}). Please try again.` : "Neulifi API request failed")); }
    if (malformed || payload === null) throw new Error("Neulifi returned an unreadable response. Please refresh and try again.");
    return payload as T;
  } catch (error) {
    const isMealAnalysisRequest = path === "/api/analyze";
    if (error instanceof DOMException && error.name === "AbortError") throw new Error(isMealAnalysisRequest ? "The meal scanner timed out. Please try again in a moment." : "Neulifi request timed out. Please try again in a moment.");
    if (error instanceof TypeError) throw new Error(isMealAnalysisRequest ? "The meal scanner could not reach the Neulifi backend. Please check your connection and try again." : "Neulifi could not reach the backend. Please check your connection and try again.");
    throw error;
  } finally { window.clearTimeout(timeout); }
}

export const neulifiApi = {
  authMe: () => request<{ id: string; email: string }>("/api/auth/me"),
  dashboard: (userId: string) => request<Dashboard>(`/api/users/${userId}/dashboard`),
  profile: (userId: string) => request<User>(`/api/users/${userId}/profile`),
  updateProfile: (userId: string, input: Partial<Pick<User, "name" | "goals" | "preferences" | "region" | "timezone">>) => request<User>(`/api/users/${userId}/profile`, { method: "PATCH", body: JSON.stringify(input) }),
  meals: (userId: string) => request<Meal[]>(`/api/users/${userId}/meals`),
  analyseMeal: (userId: string, imageUrls: string[] | string, mealName: string | undefined, context: AnalysisContext | undefined, eventKey: string) => { const image = Array.isArray(imageUrls) ? imageUrls[0] || "" : imageUrls; return request<Meal & { provider?: string; imageUrls?: string[] }>(`/api/analyze`, { method: "POST", body: JSON.stringify({ userId, imageUrl: image, imageUrls: [image], mealName, context, eventKey }) }); },
  persistMeal: (input: { userId: string; eventKey: string; imageUrl: string; imageUrls?: string[]; mealName: string; capturedAt: string; provider?: string; analysis: MealAnalysis }) => { const image = input.imageUrls?.[0] || input.imageUrl; return request<{ id: string }>(`/api/persist-meal`, { method: "POST", body: JSON.stringify({ ...input, imageUrl: image, imageUrls: [image] }) }); },
  ensureUserRecords: (name = "") => request<{ ok: boolean }>("/api/user/ensure-records", { method: "POST", body: JSON.stringify({ name }) }),
  attributeReferral: (code: string) => request<{ attributed: boolean }>("/api/user/referral/attribute", { method: "POST", body: JSON.stringify({ code }) }),
  actions: (_userId?: string) => request<Action[]>("/api/user/actions"),
  completeAction: (actionId: string, completed = true) => request<Action>(`/api/user/actions/${encodeURIComponent(actionId)}`, { method: "PATCH", body: JSON.stringify({ completed }) }),
  ensureReferralCode: () => request<{ code: string }>("/api/user/referral-code"),
  referralSummary: () => request<ReferralSummary>("/api/user/referral-summary"),
  payouts: () => request<AffiliatePayouts>("/api/user/payouts"),
  savePayoutMethod: (input: SavePayoutMethodInput) => request<PayoutMethod>("/api/user/payout-method", { method: "POST", body: JSON.stringify(input) }),
  removePayoutMethod: () => request<{ removed: boolean; pendingRequestsPreserved: boolean }>("/api/user/payout-method", { method: "DELETE" }),
  requestPayout: (requestedAmount: number, requestNote = "") => request<PayoutRequest>("/api/user/payout-request", { method: "POST", body: JSON.stringify({ requestedAmount, requestNote }) }),
  adminPayouts: (status = "", search = "") => request<AdminPayoutsResponse>(`/api/admin/payout-requests?status=${encodeURIComponent(status)}&search=${encodeURIComponent(search)}`),
  updateAdminPayout: (requestId: string, input: { status: Exclude<PayoutRequestStatus, "pending">; adminNotes?: string; userMessage?: string; paymentReference?: string; confirmManualPayment?: boolean }) => request<Pick<PayoutRequest, "id" | "status" | "reviewedAt" | "paidAt" | "paymentReference" | "userMessage">>(`/api/admin/payout-requests/${encodeURIComponent(requestId)}`, { method: "PATCH", body: JSON.stringify(input) }),
  insights: (userId: string) => request(`/api/users/${userId}/insights`),
  subscription: (userId: string) => request(`/api/users/${userId}/subscription`),
  usage: async () => { const payload = await request<{ plan: PlanId; status: string; used: number; usage_limit: number; analysis_level: AnalysisLevel }>("/api/usage"); return { plan: payload.plan, status: payload.status, used: payload.used, usageLimit: payload.usage_limit, analysisLevel: payload.analysis_level } as UsageSnapshot; },
  customerPortal: () => request<{ url: string }>("/api/paddle/customer-portal", { method: "POST", body: JSON.stringify({}) }),
  claimPendingPurchase: () => request<{ claimed: number; plan: PlanId | null }>("/api/paddle/claim-pending-purchase", { method: "POST", body: JSON.stringify({}) }),
};
