import { getHealthySession, refreshHealthySession } from "./supabase";
import type { AnalysisLevel, PlanId } from "./plans";

export type MealRating = "Excellent" | "Good" | "Reasonable" | "Needs Adjustment";
export type ActionStatus = "upcoming" | "completed" | "missed";
export type RegionId = "global" | "south-asia" | "east-asia" | "southeast-asia" | "europe" | "north-america" | "latin-america" | "mena" | "sub-saharan-africa";
export interface HealthContext { conditions: string[]; allergies: string[]; notes?: string; }
export interface UserPreferences { notifications?: boolean; dailyReminders?: boolean; weeklySummary?: boolean; appearance?: "system" | "light" | "dark"; onboardingCompleted?: boolean; dietaryPreference?: string; activityLevel?: string; healthContext?: HealthContext; region?: RegionId; timezone?: string; leaderboardOptIn?: boolean; referralCode?: string; [key: string]: unknown; }
export interface MealAnalysis { rating: MealRating; score: number; indicators: Record<string, number>; explanation: string; mealGuidance: string[]; dailyTasks: string[]; recommendations?: string[]; }
export interface User { id: string; email: string; name: string; goals: string[]; preferences?: UserPreferences; region?: RegionId; timezone?: string; leaderboardOptIn?: boolean; neulifiScore?: number; }
export interface Meal { id: string; userId: string; imageUrl: string; mealName: string; capturedAt: string; status: "analysed"; analysis: MealAnalysis; }
export interface Action { id: string; userId: string; mealId: string | null; title: string; description?: string; completed: boolean; status?: ActionStatus; dueAt?: string | null; createdAt: string; completedAt: string | null; }
export interface Dashboard { mealsAnalysed: number; actionsCompleted: number; actionsTotal: number; averageMealScore: number; recentMeals: Meal[]; openActions: Action[]; }
export interface UsageSnapshot { plan: PlanId; status: string; used: number; usageLimit: number; analysisLevel: AnalysisLevel; }
export interface StreakSnapshot { currentStreak: number; longestStreak: number; lastActivityDate: string | null; }
export interface LeaderboardEntry { rank: number; userId: string; displayName: string; score: number; isCurrent: boolean; }
export interface ReferralSummary { code: string | null; referredUsers: number; paidUsers: number; referredScans: number; pendingEarnings: number; availableEarnings: number; lifetimeEarnings: number; }

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

export const demoProfile = (): User => ({ id: "demo-user", email: "sarah@example.com", name: "Sarah Chen", goals: ["Reduce blood sugar", "Eat more vegetables", "Lower cholesterol", "Build consistent habits"], region: "south-asia", timezone: "UTC", leaderboardOptIn: false, neulifiScore: 78, preferences: { notifications: true, dailyReminders: true, weeklySummary: false, appearance: "light", region: "south-asia", timezone: "UTC", leaderboardOptIn: false, healthContext: { conditions: [], allergies: [] } } });
export const demoDashboard = (): Dashboard => ({ mealsAnalysed: 1, actionsCompleted: 1, actionsTotal: 2, averageMealScore: 78, recentMeals: [{ id: "demo-meal", userId: "demo-user", imageUrl: "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=900&q=80", mealName: "Colourful grain bowl", capturedAt: new Date().toISOString(), status: "analysed", analysis: { rating: "Good", score: 78, indicators: { vegetables: 3, fibre: 8, sugar: 1 }, explanation: "A balanced meal with a strong mix of food groups.", mealGuidance: ["Keep the colourful vegetable mix going.", "Pair the grain portion with a steady protein source."], dailyTasks: ["Drink a glass of water with your next meal", "Take a short walk or movement break today"] } }], openActions: [{ id: "demo-action-2", userId: "demo-user", mealId: "demo-meal", title: "Take a short walk or movement break today", description: "A small movement break that fits into today.", status: "upcoming", dueAt: new Date(Date.now() + 86400000).toISOString(), completed: false, createdAt: new Date().toISOString(), completedAt: null }] });

export const neulifiApi = {
  authMe: () => request<{ id: string; email: string }>("/api/auth/me"),
  dashboard: (userId: string) => request<Dashboard>(`/api/users/${userId}/dashboard`),
  profile: (userId: string) => request<User>(`/api/users/${userId}/profile`),
  updateProfile: (userId: string, input: Partial<Pick<User, "name" | "goals" | "preferences" | "region" | "timezone" | "leaderboardOptIn">>) => request<User>(`/api/users/${userId}/profile`, { method: "PATCH", body: JSON.stringify(input) }),
  meals: (userId: string) => request<Meal[]>(`/api/users/${userId}/meals`),
  analyseMeal: (userId: string, imageUrl: string, mealName?: string, context?: { goals: string[]; preferences: UserPreferences }, eventKey?: string) => request<Meal & { provider?: string }>(`/api/analyze`, { method: "POST", body: JSON.stringify({ userId, imageUrl, mealName, context, eventKey }) }),
  persistMeal: (input: { userId: string; eventKey: string; imageUrl: string; mealName: string; capturedAt: string; provider?: string; analysis: MealAnalysis }) => request<{ id: string }>(`/api/persist-meal`, { method: "POST", body: JSON.stringify(input) }),
  actions: (userId: string) => request<Action[]>(`/api/users/${userId}/actions`),
  completeAction: (actionId: string, completed = true) => request<Action>(`/api/actions/${actionId}`, { method: "PATCH", body: JSON.stringify({ completed }) }),
  insights: (userId: string) => request(`/api/users/${userId}/insights`),
  subscription: (userId: string) => request(`/api/users/${userId}/subscription`),
  usage: async () => { const payload = await request<{ plan: PlanId; status: string; used: number; usage_limit: number; analysis_level: AnalysisLevel }>("/api/usage"); return { plan: payload.plan, status: payload.status, used: payload.used, usageLimit: payload.usage_limit, analysisLevel: payload.analysis_level } as UsageSnapshot; },
  checkout: (plan: "pro" | "premium") => request<{ url: string }>("/api/checkout", { method: "POST", body: JSON.stringify({ plan }) }),
};
