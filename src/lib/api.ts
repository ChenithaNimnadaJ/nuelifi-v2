export type MealRating = "Excellent" | "Good" | "Reasonable" | "Needs Adjustment";

export interface User { id: string; email: string; name: string; goals: string[]; preferences?: Record<string, unknown>; }
export interface Meal { id: string; userId: string; imageUrl: string; mealName: string; capturedAt: string; status: "analysed"; analysis: { rating: MealRating; score: number; indicators: Record<string, number>; explanation: string; recommendations: string[]; }; }
export interface Action { id: string; userId: string; mealId: string | null; title: string; completed: boolean; createdAt: string; completedAt: string | null; }
export interface Dashboard { mealsAnalysed: number; actionsCompleted: number; actionsTotal: number; averageMealScore: number; recentMeals: Meal[]; openActions: Action[]; }

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8787";
async function request<T>(path: string, options?: RequestInit): Promise<T> { const response = await fetch(`${API_URL}${path}`, { ...options, headers: { "content-type": "application/json", ...(options?.headers || {}) } }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Nuelifi API request failed"); return payload as T; }

export const demoProfile = (): User => ({ id: "demo-user", email: "sarah@example.com", name: "Sarah Chen", goals: ["Reduce blood sugar", "Eat more vegetables", "Lower cholesterol", "Build consistent habits"], preferences: { notifications: true, dailyReminders: true, weeklySummary: false, appearance: "light" } });
export const demoDashboard = (): Dashboard => ({ mealsAnalysed: 1, actionsCompleted: 1, actionsTotal: 2, averageMealScore: 78, recentMeals: [{ id: "demo-meal", userId: "demo-user", imageUrl: "", mealName: "Colourful grain bowl", capturedAt: new Date().toISOString(), status: "analysed", analysis: { rating: "Good", score: 78, indicators: { vegetables: 3, fibre: 8, sugar: 1 }, explanation: "A balanced meal with a strong mix of food groups.", recommendations: ["Take a short walk after eating", "Drink more water"] } }], openActions: [{ id: "demo-action-2", userId: "demo-user", mealId: "demo-meal", title: "Drink more water", completed: false, createdAt: new Date().toISOString(), completedAt: null }] });

export const nuelifiApi = {
  dashboard: (userId: string) => request<Dashboard>(`/api/users/${userId}/dashboard`),
  profile: (userId: string) => request<User>(`/api/users/${userId}/profile`),
  updateProfile: (userId: string, input: Partial<Pick<User, "name" | "goals" | "preferences">>) => request<User>(`/api/users/${userId}/profile`, { method: "PATCH", body: JSON.stringify(input) }),
  meals: (userId: string) => request<Meal[]>(`/api/users/${userId}/meals`),
  analyseMeal: (userId: string, imageUrl: string, mealName?: string) => request<Meal>(`/api/users/${userId}/meals`, { method: "POST", body: JSON.stringify({ imageUrl, mealName }) }),
  actions: (userId: string) => request<Action[]>(`/api/users/${userId}/actions`),
  completeAction: (actionId: string, completed = true) => request<Action>(`/api/actions/${actionId}`, { method: "PATCH", body: JSON.stringify({ completed }) }),
  insights: (userId: string) => request(`/api/users/${userId}/insights`),
  subscription: (userId: string) => request(`/api/users/${userId}/subscription`),
};
