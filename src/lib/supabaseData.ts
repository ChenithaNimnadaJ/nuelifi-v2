import { refreshHealthySession, supabase } from "./supabase";
import type { Action, Meal, User } from "./api";

function requireClient() {
  if (!supabase) throw new Error("Supabase is not configured in this environment.");
  return supabase;
}

function isSessionError(message: string) {
  return /jwt|token|session|auth|issued at future|expired/i.test(message);
}

async function withSession<T>(operation: (client: NonNullable<typeof supabase>) => Promise<T>): Promise<T> {
  const client = requireClient();
  const current = await client.auth.getSession();
  if (current.error) throw new Error(`Could not restore your session: ${current.error.message}`);
  if (!current.data.session) throw new Error("Your session has expired. Please sign in again.");
  try {
    return await operation(client);
  } catch (firstError) {
    const message = firstError instanceof Error ? firstError.message : String(firstError);
    if (!isSessionError(message)) throw firstError;
    const refreshed = await refreshHealthySession();
    if (!refreshed) throw new Error("Your session is no longer valid. Please sign in again.");
    try {
      return await operation(client);
    } catch (secondError) {
      const secondMessage = secondError instanceof Error ? secondError.message : String(secondError);
      if (isSessionError(secondMessage)) {
        await client.auth.signOut();
        throw new Error("Your session is out of date. Please sign in again.");
      }
      throw secondError;
    }
  }
}

function mapMeal(row: any, analysisRow: any): Meal {
  return { id: row.id, userId: row.user_id, imageUrl: row.image_url, mealName: row.meal_name, capturedAt: row.captured_at, status: row.status, analysis: { rating: analysisRow?.rating || "Reasonable", score: Number(analysisRow?.score || 0), indicators: (analysisRow?.indicators || {}) as Record<string, number>, explanation: analysisRow?.explanation || "", recommendations: Array.isArray(analysisRow?.recommendations) ? analysisRow.recommendations.map(String) : [] } };
}

export async function fetchProfile(userId: string, fallback: User): Promise<User> {
  return withSession(async (client) => { const { data, error } = await client.from("profiles").select("id,name,goals,preferences").eq("id", userId).maybeSingle(); if (error) throw new Error(`Could not load profile: ${error.message}`); if (!data) return fallback; return { ...fallback, id: data.id, name: data.name || fallback.name, goals: Array.isArray(data.goals) ? data.goals : [], preferences: (data.preferences || {}) as Record<string, unknown> }; });
}

export async function updateProfile(userId: string, patch: { name?: string; goals?: string[]; preferences?: Record<string, unknown> }, fallback: User): Promise<User> {
  return withSession(async (client) => { const { data, error } = await client.from("profiles").upsert({ id: userId, ...patch }).select("id,name,goals,preferences").single(); if (error || !data) throw new Error(`Could not save profile: ${error?.message || "No profile was returned"}`); return { ...fallback, id: data.id, name: data.name || fallback.name, goals: Array.isArray(data.goals) ? data.goals : [], preferences: (data.preferences || {}) as Record<string, unknown> }; });
}

export async function fetchMeals(userId: string): Promise<Meal[]> {
  return withSession(async (client) => { const { data: rows, error } = await client.from("meals").select("id,user_id,image_url,meal_name,captured_at,status").eq("user_id", userId).order("captured_at", { ascending: false }).limit(50); if (error) throw new Error(`Could not load meals: ${error.message}`); const meals = rows || []; if (!meals.length) return []; const ids = meals.map((row) => row.id); const { data: analyses, error: analysisError } = await client.from("meal_analyses").select("meal_id,rating,score,indicators,explanation,recommendations").in("meal_id", ids); if (analysisError) throw new Error(`Could not load meal analyses: ${analysisError.message}`); const byMeal = new Map((analyses || []).map((row) => [row.meal_id, row])); return meals.map((row) => mapMeal(row, byMeal.get(row.id))); });
}

export async function fetchActions(userId: string): Promise<Action[]> {
  return withSession(async (client) => { const { data, error } = await client.from("actions").select("id,user_id,meal_id,title,completed,created_at,completed_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(100); if (error) throw new Error(`Could not load actions: ${error.message}`); return (data || []).map((row) => ({ id: row.id, userId: row.user_id, mealId: row.meal_id, title: row.title, completed: Boolean(row.completed), createdAt: row.created_at, completedAt: row.completed_at })); });
}

export async function fetchSubscription(userId: string): Promise<{ plan: "free" | "pro"; status: string }> {
  return withSession(async (client) => { const { data, error } = await client.from("subscriptions").select("plan,status").eq("user_id", userId).maybeSingle(); if (error) throw new Error(`Could not load subscription: ${error.message}`); return { plan: data?.plan === "pro" ? "pro" : "free", status: data?.status || "active" }; });
}

export async function createTask(userId: string, title: string, mealId?: string | null): Promise<Action> {
  return withSession(async (client) => { const { data, error } = await client.from("actions").insert({ user_id: userId, meal_id: mealId || null, title, completed: false }).select("id,user_id,meal_id,title,completed,created_at,completed_at").single(); if (error || !data) throw new Error(`Could not add task: ${error?.message || "No task was returned"}`); return { id: data.id, userId: data.user_id, mealId: data.meal_id, title: data.title, completed: Boolean(data.completed), createdAt: data.created_at, completedAt: data.completed_at }; });
}

export async function completeTask(userId: string, actionId: string, completed: boolean): Promise<void> {
  return withSession(async (client) => { const { error } = await client.from("actions").update({ completed, completed_at: completed ? new Date().toISOString() : null }).eq("id", actionId).eq("user_id", userId); if (error) throw new Error(`Could not update task: ${error.message}`); });
}

export async function saveMealResult(userId: string, meal: { imageUrl: string; mealName: string; capturedAt: string; analysis: { rating: string; score: number; indicators: Record<string, unknown>; explanation: string; recommendations: string[] } }): Promise<string> {
  return withSession(async (client) => { const { data: savedMeal, error: mealError } = await client.from("meals").insert({ user_id: userId, image_url: meal.imageUrl, meal_name: meal.mealName, status: "analysed", captured_at: meal.capturedAt }).select("id").single(); if (mealError || !savedMeal) throw new Error(`Could not save meal: ${mealError?.message || "No meal was returned"}`); const { error: analysisError } = await client.from("meal_analyses").insert({ meal_id: savedMeal.id, rating: meal.analysis.rating, score: meal.analysis.score, indicators: meal.analysis.indicators, explanation: meal.analysis.explanation, recommendations: meal.analysis.recommendations }); if (analysisError) { await client.from("meals").delete().eq("id", savedMeal.id).eq("user_id", userId); throw new Error(`Could not save meal analysis: ${analysisError.message}`); } return savedMeal.id; });
}
