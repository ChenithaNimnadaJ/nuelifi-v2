import { supabase } from "./supabase";
import type { Action, User } from "./api";

export async function fetchProfile(userId: string, fallback: User): Promise<User> {
  if (!supabase) return fallback;
  const { data, error } = await supabase.from("profiles").select("id,name,goals,preferences").eq("id", userId).maybeSingle();
  if (error || !data) return fallback;
  return { ...fallback, id: data.id, name: data.name || fallback.name, email: fallback.email, goals: Array.isArray(data.goals) ? data.goals : fallback.goals, preferences: (data.preferences || {}) as Record<string, unknown> };
}

export async function updateProfile(userId: string, patch: { name?: string; goals?: string[]; preferences?: Record<string, unknown> }, fallback: User): Promise<User> {
  if (!supabase) return { ...fallback, ...patch };
  const { data, error } = await supabase.from("profiles").upsert({ id: userId, ...patch }).select("id,name,goals,preferences").single();
  if (error || !data) return { ...fallback, ...patch };
  return { ...fallback, id: data.id, name: data.name || fallback.name, goals: Array.isArray(data.goals) ? data.goals : fallback.goals, preferences: (data.preferences || {}) as Record<string, unknown> };
}

export async function fetchActions(userId: string): Promise<Action[]> {
  if (!supabase) return [];
  const { data } = await supabase.from("actions").select("id,user_id,meal_id,title,completed,created_at,completed_at").eq("user_id", userId).order("created_at", { ascending: false });
  return (data || []) as Action[];
}

export async function createTask(userId: string, title: string, mealId?: string | null): Promise<Action | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from("actions").insert({ user_id: userId, meal_id: mealId || null, title, completed: false }).select("id,user_id,meal_id,title,completed,created_at,completed_at").single();
  return error ? null : data as Action;
}

export async function completeTask(userId: string, actionId: string, completed: boolean): Promise<void> {
  if (!supabase) return;
  await supabase.from("actions").update({ completed, completed_at: completed ? new Date().toISOString() : null }).eq("id", actionId).eq("user_id", userId);
}

export async function saveMealResult(userId: string, meal: { imageUrl: string; mealName: string; capturedAt: string; analysis: { rating: string; score: number; indicators: Record<string, unknown>; explanation: string; recommendations: string[] } }): Promise<string | null> {
  if (!supabase) return null;
  const { data: savedMeal, error: mealError } = await supabase.from("meals").insert({ user_id: userId, image_url: meal.imageUrl, meal_name: meal.mealName, status: "analysed", captured_at: meal.capturedAt }).select("id").single();
  if (mealError || !savedMeal) return null;
  await supabase.from("meal_analyses").insert({ meal_id: savedMeal.id, rating: meal.analysis.rating, score: meal.analysis.score, indicators: meal.analysis.indicators, explanation: meal.analysis.explanation, recommendations: meal.analysis.recommendations });
  return savedMeal.id;
}
