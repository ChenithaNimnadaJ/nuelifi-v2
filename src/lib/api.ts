import { getHealthySession, refreshHealthySession } from "./supabase";
import type { AnalysisLevel, PlanId } from "./plans";

export type MealRating = "Excellent" | "Good" | "Reasonable" | "Needs Adjustment";
export interface HealthContext { conditions: string[]; allergies: string[]; notes?: string; }
export interface UserPreferences { notifications?: boolean; dailyReminders?: boolean; weeklySummary?: boolean; appearance?: "system" | "light" | "dark"; onboardingCompleted?: boolean; dietaryPreference?: string; activityLevel?: string; healthContext?: HealthContext; [key: string]: unknown; }
export interface MealAnalysis { rating: MealRating; score: number; indicators: Record<string, number>; explanation: string; mealGuidance: string[]; dailyTasks: string[]; recommendations?: string[]; }
export interface User { id: string; email: string; name: string; goals: string[]; preferences?: UserPreferences; }
export interface Meal { id: string; userId: string; imageUrl: string; mealName: string; capturedAt: string; status: "analysed"; analysis: MealAnalysis; }
export interface Action { id: string; userId: string; mealId: string | null; title: string; completed: boolean; createdAt: string; completedAt: string | null; }
export interface Dashboard { mealsAnalysed: number; actionsCompleted: number; actionsTotal: number; averageMealScore: number; recentMeals: Meal[]; openActions: Action[]; }
export interface UsageSnapshot { plan: PlanId; status: string; used: number; usageLimit: number; analysisLevel: AnalysisLevel; }

const API_URL = String(import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");
async function request<T>(path: string, options?: RequestInit, allowRefresh = true): Promise<T> {
  const session = await getHealthySession();
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 60000);
  try {
    const response = await fetch(`${API_URL}${path}`, { ...options, signal: controller.signal, headers: { "content-type": "application/json", ...(session?.access_token ? { authorization: `Bearer ${session.access_token}` } : {}), ...(options?.headers || {}) } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok && allowRefresh && response.status === 401 && await refreshHealthySession()) return request<T>(path, options, false);
    if (!response.ok) throw new Error(payload.error || "Nuelifi API request failed");
    return payload as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw new Error("The meal scanner timed out. Please try again in a moment.");
    if (error instanceof TypeError) throw new Error("The meal scanner could not reach the Nuelifi backend. Please check your connection and try again.");
    throw error;
  } finally { window.clearTimeout(timeout); }
}

export const demoProfile = (): User => ({ id: "demo-user", email: "sarah@example.com", name: "Sarah Chen", goals: ["Reduce blood sugar", "Eat more vegetables", "Lower cholesterol", "Build consistent habits"], preferences: { notifications: true, dailyReminders: true, weeklySummary: false, appearance: "light", healthContext: { conditions: [], allergies: [] } } });
export const demoDashboard = (): Dashboard => ({ mealsAnalysed: 1, actionsCompleted: 1, actionsTotal: 2, averageMealScore: 78, recentMeals: [{ id: "demo-meal", userId: "demo-user", imageUrl: "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=900&q=80", mealName: "Colourful grain bowl", capturedAt: new Date().toISOString(), status: "analysed", analysis: { rating: "Good", score: 78, indicators: { vegetables: 3, fibre: 8, sugar: 1 }, explanation: "A balanced meal with a strong mix of food groups.", mealGuidance: ["Keep the colourful vegetable mix going.", "Pair the grain portion with a steady protein source."], dailyTasks: ["Drink a glass of water with your next meal", "Take a short walk or movement break today"] } }], openActions: [{ id: "demo-action-2", userId: "demo-user", mealId: "demo-meal", title: "Take a short walk or movement break today", completed: false, createdAt: new Date().toISOString(), completedAt: null }] });

export const nuelifiApi = {
  authMe: () => request<{ id: string; email: string }>("/api/auth/me"),
  dashboard: (userId: string) => request<Dashboard>(`/api/users/${userId}/dashboard`),
  profile: (userId: string) => request<User>(`/api/users/${userId}/profile`),
  updateProfile: (userId: string, input: Partial<Pick<User, "name" | "goals" | "preferences">>) => request<User>(`/api/users/${userId}/profile`, { method: "PATCH", body: JSON.stringify(input) }),
  meals: (userId: string) => request<Meal[]>(`/api/users/${userId}/meals`),
  analyseMeal: (userId: string, imageUrl: string, mealName?: string, context?: { goals: string[]; preferences: UserPreferences }) => request<Meal>(`/api/analyze`, { method: "POST", body: JSON.stringify({ userId, imageUrl, mealName, context }) }),
  actions: (userId: string) => request<Action[]>(`/api/users/${userId}/actions`),
  completeAction: (actionId: string, completed = true) => request<Action>(`/api/actions/${actionId}`, { method: "PATCH", body: JSON.stringify({ completed }) }),
  insights: (userId: string) => request(`/api/users/${userId}/insights`),
  subscription: (userId: string) => request(`/api/users/${userId}/subscription`),
  usage: () => request<UsageSnapshot>("/api/usage"),
};
