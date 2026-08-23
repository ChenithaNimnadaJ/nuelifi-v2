const ratings = new Set(["Excellent", "Good", "Reasonable", "Needs Adjustment"]);

function number(value, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function bounded(value, minimum, maximum, fallback = minimum) { return Math.max(minimum, Math.min(maximum, number(value, fallback))); }
function portionScale(value) { const parsed = number(value, 2); return parsed > 3 ? bounded(parsed / 100 * 3, 0, 3, 2) : bounded(parsed, 0, 3, 2); }
function cleanList(value, limit = 12) { return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean).slice(0, limit) : []; }
const dailyTaskFallbacks = ["Keep water nearby and drink regularly through your day.", "Take a short movement break when it fits your day.", "Choose a realistic time to wind down later, if it suits your routine.", "Set aside one small planning step for tomorrow."];
function isSafeDailyTask(item) { const text = String(item).trim(); if (!text || text.length > 110 || !/water|hydrate|walk|movement|move|break|sleep|bedtime|stretch|plan|prepare|schedule|routine|habit|breathe|mindful|rest|today|tomorrow|wind down|planning/i.test(text)) return false; if (/\b(?:at|by|before|after|around)\s+(?:[01]?\d|2[0-3])(?::[0-5]\d)?\s*(?:am|pm)?\b|\b(?:[01]?\d|2[0-3]):[0-5]\d\b/i.test(text)) return false; return !/\b(meal|food|plate|ingredient|vegetable|greens|fruit|protein|fibre|fiber|sodium|salt|sugar|sauce|dressing|carbohydrate|calorie|portion|snack|allerg|label|dietary|recipe|cook|eat|consume|add|remove|reduce|increase|choose|swap|replace|include|serve|limit|avoid|measure|count|soup|bowl|rice|chicken|tofu|yoga|squat|lunge|push-up|plank|jog|run|cycling|medication|insulin|dose|blood pressure|blood sugar)\b/i.test(text); }
function contextualDailyTasks(context = {}) { const preferences = context?.preferences && typeof context.preferences === "object" ? context.preferences : context; const goals = cleanList(context.goals || preferences?.goals, 1); const activity = String(preferences?.activityLevel || "").trim(); const tasks = []; tasks.push(/mostly sitting/i.test(activity) ? "Take a short movement break during your next long sitting period." : "Make room for one short movement window today."); const goal = String(goals[0] || "").toLowerCase(); if (/habit|consistent/i.test(goal)) tasks.push("Choose one small routine you can repeat today."); else if (/energy/i.test(goal)) tasks.push("Notice one part of your routine that supports steadier energy today."); else if (goal) tasks.push("Set aside one small planning step for tomorrow."); return tasks; }
function localTaskContext(context = {}) { const preferences = context?.preferences && typeof context.preferences === "object" ? context.preferences : context; const timezone = String(preferences?.timezone || "").trim(); let period = "the day"; let weekday = "today"; try { const parts = new Intl.DateTimeFormat("en", { timeZone: timezone || undefined, weekday: "long", hour: "numeric", hour12: false }).formatToParts(new Date()); const hour = Number(parts.find((part) => part.type === "hour")?.value || 12); weekday = parts.find((part) => part.type === "weekday")?.value || "today"; period = hour < 5 ? "overnight" : hour < 12 ? "morning" : hour < 17 ? "afternoon" : hour < 22 ? "evening" : "late evening"; } catch { /* keep broad neutral timing when timezone is invalid */ } return `For dailyTasks only: it is ${period} on ${weekday} in the user's local day. Use this only to choose a fitting general action; never suggest a meal or exact time.`; }
function completeDailyTasks(items, context = {}) { const selected = cleanList(items, 6).filter(isSafeDailyTask); const contextual = contextualDailyTasks(context).filter(isSafeDailyTask); return [...new Set([...selected, ...contextual, ...dailyTaskFallbacks])].slice(0, 4); }
function legacyDailyTasks(recommendations) { return completeDailyTasks(recommendations); }

export function contextSummary(context = {}) {
  const preferences = context.preferences && typeof context.preferences === "object" ? context.preferences : context;
  const health = preferences?.healthContext && typeof preferences.healthContext === "object" ? preferences.healthContext : {};
  const lines = [];
  const goals = cleanList(context.goals || preferences?.goals);
  const conditions = cleanList(health.conditions);
  const allergies = cleanList(health.allergies);
  if (goals.length) lines.push(`Health goals supplied by the user: ${goals.join(", ")}.`);
  if (conditions.length) lines.push(`Known health conditions supplied by the user: ${conditions.join(", ")}.`);
  if (allergies.length) lines.push(`Food allergies or intolerances supplied by the user: ${allergies.join(", ")}.`);
  if (preferences?.dietaryPreference) lines.push(`Dietary preference: ${String(preferences.dietaryPreference)}.`);
  if (preferences?.activityLevel) lines.push(`Activity level: ${String(preferences.activityLevel)}.`);
  if (typeof health.notes === "string" && health.notes.trim()) lines.push(`Additional user context: ${health.notes.trim().slice(0, 600)}.`);
  return lines.length ? lines.join(" ") : "No personal health context was supplied.";
}

export function analysisDepth(level = "basic") { if (level === "complete") return "Provide a complete single-meal assessment: use the available indicators, explain the reasoning in fuller detail, and connect the guidance carefully to the supplied context without diagnosing."; if (level === "enhanced") return "Provide an enhanced assessment: use the available indicators, explain the main trade-offs, and connect the guidance to the supplied context with a little more detail."; return "Provide a clear general assessment with concise explanations and practical guidance." }
export function buildMealPrompt(mealName, context = {}, analysisLevel = "basic") {
  return `You are Neulifi, a calm food and lifestyle companion. Analyse the meal called "${mealName}" for a consumer wellness app. ${contextSummary(context)} ${analysisDepth(analysisLevel)} Treat this as user-provided context only: never infer a diagnosis, prescribe treatment, recommend medication changes, or overrule a clinician. Avoid known allergens and respect dietary preferences where relevant. Nutrition values are estimates. Return only JSON. Keep mealGuidance and dailyTasks separate: mealGuidance must discuss this meal or the next similar meal and must not be imported into the task list. ${localTaskContext(context)} For dailyTasks only, return 2 to 4 short, broad, non-meal actions such as hydration, a movement break, rest, planning, or a simple routine. Never suggest eating, cooking, changing a meal, a specific food, ingredient, nutrient, portion, recipe, or meal time. Never use an exact clock time, named exercise, medical action, medication instruction, diagnosis, or condition-specific treatment. Use cautious, non-judgmental language. The JSON fields are rating (Excellent, Good, Reasonable, or Needs Adjustment), score (integer 0-100), indicators (numeric calories, protein, carbohydrates, fats, vegetables, fibre, sugar, sodium, portionBalance), explanation, mealGuidance (2 to 4 strings), and dailyTasks (2 to 4 short strings).`;
}

export function analysisSchema() { return { type: "OBJECT", properties: { rating: { type: "STRING", enum: ["Excellent", "Good", "Reasonable", "Needs Adjustment"] }, score: { type: "INTEGER", minimum: 0, maximum: 100 }, indicators: { type: "OBJECT", properties: { calories: { type: "NUMBER" }, protein: { type: "NUMBER" }, carbohydrates: { type: "NUMBER" }, fats: { type: "NUMBER" }, vegetables: { type: "NUMBER" }, fibre: { type: "NUMBER" }, sugar: { type: "NUMBER" }, sodium: { type: "NUMBER" }, portionBalance: { type: "NUMBER" } }, required: ["calories", "protein", "carbohydrates", "fats", "vegetables", "fibre", "sugar", "portionBalance"] }, explanation: { type: "STRING" }, mealGuidance: { type: "ARRAY", items: { type: "STRING" }, minItems: 2, maxItems: 4 }, dailyTasks: { type: "ARRAY", items: { type: "STRING" }, minItems: 2, maxItems: 4 } }, required: ["rating", "score", "indicators", "explanation", "mealGuidance", "dailyTasks"] }; }

export function normalizeMealAnalysis(input) {
  let raw = typeof input === "string" ? input : JSON.stringify(input);
  const thinkEnd = raw.lastIndexOf("</think>");
  if (thinkEnd >= 0) raw = raw.slice(thinkEnd + "</think>".length);
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) raw = raw.slice(firstBrace, lastBrace + 1);
  const parsed = typeof input === "string" ? JSON.parse(raw.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim()) : input;
  if (!parsed || typeof parsed !== "object") throw new Error("AI returned an invalid analysis object");
  const indicators = parsed.indicators && typeof parsed.indicators === "object" ? parsed.indicators : {};
  const legacyRecommendations = cleanList(parsed.recommendations, 4);
  const mealGuidance = cleanList(parsed.mealGuidance ?? parsed.meal_guidance ?? legacyRecommendations, 4);
  const dailyTasks = cleanList(parsed.dailyTasks ?? parsed.daily_tasks ?? parsed.dayTasks, 6);
  const safeMealGuidance = mealGuidance.length >= 2 ? mealGuidance : ["Keep a balanced mix of food groups in your next meal.", "Use the meal-specific guidance as a flexible idea, not a strict rule."];
  const safeDailyTasks = completeDailyTasks(dailyTasks.length ? dailyTasks : legacyRecommendations);
  return { rating: ratings.has(parsed.rating) ? parsed.rating : "Reasonable", score: Math.round(bounded(parsed.score, 0, 100, 60)), indicators: { calories: bounded(indicators.calories, 0, 3000), protein: bounded(indicators.protein, 0, 250), carbohydrates: bounded(indicators.carbohydrates, 0, 400), fats: bounded(indicators.fats, 0, 200), vegetables: bounded(indicators.vegetables, 0, 10), fibre: bounded(indicators.fibre, 0, 100), sugar: bounded(indicators.sugar, 0, 200), sodium: bounded(indicators.sodium, 0, 5000), portionBalance: portionScale(indicators.portionBalance) }, explanation: String(parsed.explanation || "This meal has a few strengths and a few practical opportunities to improve."), mealGuidance: safeMealGuidance, dailyTasks: safeDailyTasks, recommendations: safeMealGuidance };
}
