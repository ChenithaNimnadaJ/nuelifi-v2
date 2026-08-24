export type NotificationPermissionState = "unsupported" | "default" | "granted" | "denied";
export type NotificationCategory = "meal" | "action" | "weekly";

export interface NotificationMeal { capturedAt: string; }
export interface NotificationAction { title: string; completed: boolean; status?: string; dueAt?: string | null; }
export interface NotificationCandidate { category: NotificationCategory; title: string; body: string; tag: string; localDate: string; }

function numberPart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) { return Number(parts.find((part) => part.type === type)?.value || 0); }
function localParts(value: Date, timezone?: string) { try { return new Intl.DateTimeFormat("en-CA", { timeZone: timezone || undefined, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false }).formatToParts(value); } catch { return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false }).formatToParts(value); } }
export function localDateKey(value: Date, timezone?: string) { const parts = localParts(value, timezone); return `${numberPart(parts, "year")}-${String(numberPart(parts, "month")).padStart(2, "0")}-${String(numberPart(parts, "day")).padStart(2, "0")}`; }
export function localHour(value: Date, timezone?: string) { return numberPart(localParts(value, timezone), "hour") % 24; }
export function localWeekKey(value: Date, timezone?: string) { const date = localDateKey(value, timezone).split("-").map(Number); const utc = new Date(Date.UTC(date[0] || 1970, (date[1] || 1) - 1, date[2] || 1)); const day = utc.getUTCDay() || 7; utc.setUTCDate(utc.getUTCDate() - day + 1); return utc.toISOString().slice(0, 10); }

export function getBrowserNotificationPermission(): NotificationPermissionState { if (typeof window === "undefined" || !("Notification" in window)) return "unsupported"; const permission = window.Notification.permission; return permission === "granted" || permission === "denied" ? permission : "default"; }
export async function requestBrowserNotificationPermission(): Promise<NotificationPermissionState> { const current = getBrowserNotificationPermission(); if (current !== "default") return current; try { const next = await window.Notification.requestPermission(); return next === "granted" || next === "denied" ? next : "default"; } catch { return current; } }

export function notificationHistoryKey(userId: string, candidate: Pick<NotificationCandidate, "category" | "localDate">) { return `neulifi-notification:${userId}:${candidate.category}:${candidate.localDate}`; }
export function notificationDayHistoryKey(userId: string, timezone: string | undefined, now: Date) { return `neulifi-notification-day:${userId}:${localDateKey(now, timezone)}`; }
export function notificationWeekHistoryKey(userId: string, timezone: string | undefined, now: Date) { return `neulifi-notification-week:${userId}:${localWeekKey(now, timezone)}`; }

function validDate(value: unknown) { const date = new Date(String(value || "")); return Number.isFinite(date.getTime()) ? date : null; }
function recentMeals(meals: NotificationMeal[], now: Date) { const dates = meals.map((meal) => validDate(meal.capturedAt)).filter((date): date is Date => Boolean(date)); return dates.filter((date) => date.getTime() <= now.getTime() && now.getTime() - date.getTime() <= 7 * 24 * 60 * 60 * 1000); }

export function getNotificationCandidate(input: { now?: Date; timezone?: string; notificationsEnabled: boolean; permission: NotificationPermissionState; meals: NotificationMeal[]; actions: NotificationAction[]; sentToday?: number; sentThisWeek?: number; }): NotificationCandidate | null {
  const now = input.now || new Date();
  const timezone = input.timezone || undefined;
  if (!input.notificationsEnabled || input.permission !== "granted" || localHour(now, timezone) < 8 || localHour(now, timezone) >= 21) return null;
  if ((input.sentToday || 0) >= 1 || (input.sentThisWeek || 0) >= 3) return null;
  const localDate = localDateKey(now, timezone);
  const dueLimit = now.getTime() + 24 * 60 * 60 * 1000;
  const actionEntries = input.actions.filter((item) => !item.completed && item.status !== "missed").map((item) => ({ item, due: validDate(item.dueAt) })).filter((entry): entry is { item: NotificationAction; due: Date } => Boolean(entry.due));
  const action = actionEntries.filter((entry) => entry.due.getTime() <= dueLimit).sort((a, b) => a.due.getTime() - b.due.getTime())[0];
  if (action) return { category: "action", title: "Your Neulifi action is still waiting", body: action.item.title, tag: "action-reminder", localDate };
  const meals = recentMeals(input.meals, now).sort((a, b) => b.getTime() - a.getTime());
  const latestMeal = meals[0];
  if (latestMeal && now.getTime() - latestMeal.getTime() >= 4 * 60 * 60 * 1000 && now.getTime() - latestMeal.getTime() <= 18 * 60 * 60 * 1000) return { category: "meal", title: "Ready to log your next meal?", body: "Keep your private Neulifi meal history moving when it suits your day.", tag: "meal-reminder", localDate };
  if (meals.length >= 3) return { category: "weekly", title: "Your Neulifi week is ready", body: "Open Insights to see the patterns in your recent meal history.", tag: "weekly-insights", localDate };
  return null;
}
