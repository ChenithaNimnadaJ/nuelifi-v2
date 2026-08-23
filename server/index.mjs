import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { createStore } from "./store.mjs";
import { analyzeMealWithGemini } from "./gemini.mjs";

const port = Number(process.env.PORT || 8787);
const dataFile = resolve(process.env.NEULIFI_DATA_FILE || process.env.NUELIFI_DATA_FILE || "./data/neulifi.json");
const { db, persist, findUser, findMeal, findAction } = await createStore(dataFile);

const now = () => new Date().toISOString();
const requireAuth = process.env.REQUIRE_AUTH === "true";

async function authUser(req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) { if (requireAuth) { const error = new Error("Authentication required"); error.status = 401; throw error; } return null; }
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !supabaseKey) { const error = new Error("Supabase server authentication is not configured"); error.status = 503; throw error; }
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: supabaseKey, authorization: header } });
  if (!response.ok) { const error = new Error("Invalid or expired authentication session"); error.status = 401; throw error; }
  return await response.json();
}

async function scopedUser(req, id) {
  const tokenUser = await authUser(req);
  if (tokenUser && tokenUser.id !== id) { const error = new Error("You cannot access another user’s data"); error.status = 403; throw error; }
  if (tokenUser) return findUser(id) || { id: tokenUser.id, email: tokenUser.email || "", name: tokenUser.user_metadata?.name || "", goals: [], preferences: {} };
  return userOrFail(id);
}

async function analyzeMeal(imageUrl, mealName, context = {}) {
  const providers = [];
  if (process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY_2) providers.push(["gemini", () => analyzeMealWithGemini({ imageUrl, mealName, context })]);
  let lastError;
  for (const [name, run] of providers) {
    try { const analysis = await run(); if (analysis) return { analysis, provider: name }; } catch (error) { lastError = error; console.warn(`${name} meal analysis unavailable: ${error.message}`); }
  }
  throw lastError || new Error("No AI provider is configured");
}
const send = (res, status, payload) => {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,PATCH,OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
  });
  res.end(JSON.stringify(payload));
};
const fail = (res, status, message) => send(res, status, { error: message });

async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new Error("Request body must be valid JSON"); }
}
function required(value, name) {
  if (value === undefined || value === null || value === "") throw new Error(`${name} is required`);
  return value;
}
function userOrFail(id) {
  const user = findUser(id);
  if (!user) { const error = new Error("User not found"); error.status = 404; throw error; }
  return user;
}
function mealAssessment(input = {}) {
  const vegetables = Number(input.vegetables ?? 2);
  const sugar = Number(input.sugar ?? 1);
  const portion = Number(input.portionBalance ?? 2);
  const score = Math.max(0, Math.min(100, Math.round(50 + vegetables * 10 + portion * 8 - sugar * 8)));
  const rating = score >= 82 ? "Excellent" : score >= 65 ? "Good" : score >= 45 ? "Reasonable" : "Needs Adjustment";
  return {
    rating, score,
    indicators: {
      calories: Number(input.calories ?? 520), protein: Number(input.protein ?? 28),
      carbohydrates: Number(input.carbohydrates ?? 55), fats: Number(input.fats ?? 18),
      vegetables, fibre: Number(input.fibre ?? 6), sugar, portionBalance: portion,
    },
    explanation: "This meal has a useful foundation. Here are one or two practical ways to add variety or balance.",
    mealGuidance: [
      ...(vegetables < 3 ? ["Add another serving of vegetables alongside a similar meal."] : []),
      ...(portion < 3 ? ["If it suits you, balance the plate with a little more of the other food groups."] : []),
      ...(sugar > 2 ? ["Consider a less sweet option next time, if that feels practical."] : []),
      "Keep a varied mix of foods across the day.",
    ].slice(0, 4),
    dailyTasks: ["Take a short movement break today", "Drink a glass of water with your next meal"],
  };
}
function dashboard(userId) {
  const meals = db.meals.filter((meal) => meal.userId === userId);
  const actions = db.actions.filter((action) => action.userId === userId);
  const completed = actions.filter((action) => action.completed).length;
  const average = meals.length ? Math.round(meals.reduce((sum, meal) => sum + meal.analysis.score, 0) / meals.length) : 0;
  return { mealsAnalysed: meals.length, actionsCompleted: completed, actionsTotal: actions.length, averageMealScore: average, recentMeals: meals.slice(-5).reverse(), openActions: actions.filter((action) => !action.completed).slice(-5).reverse() };
}

async function route(req, res) {
  if (req.method === "OPTIONS") return send(res, 204, {});
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const parts = url.pathname.split("/").filter(Boolean);
  if (req.method === "GET" && url.pathname === "/health") return send(res, 200, { status: "ok", service: "neulifi-api", time: now() });
  if (req.method === "GET" && url.pathname === "/api/paddle/config") { const environment = String(process.env.PADDLE_ENVIRONMENT || "").trim().toLowerCase(); if (environment !== "production" && environment !== "sandbox") return fail(res, 503, "Paddle environment is not configured. Set PADDLE_ENVIRONMENT to production or sandbox."); const values = [req.headers["cf-ipcountry"], req.headers["x-vercel-ip-country"]].map((value) => String(value || "").trim().toUpperCase()); const countryCode = values.find((value) => /^[A-Z]{2}$/.test(value) && value !== "XX" && value !== "T1"); return send(res, 200, countryCode ? { countryCode } : {}); }
  if (parts[0] !== "api") return fail(res, 404, "Route not found");

  try {
    if (req.method === "POST" && parts.length === 2 && parts[1] === "users") {
      const input = await body(req); required(input.email, "email");
      if (db.users.some((user) => user.email === input.email)) return fail(res, 409, "A user with this email already exists");
      const user = { id: randomUUID(), email: input.email, name: input.name || "", goals: input.goals || [], createdAt: now(), updatedAt: now() };
      db.users.push(user); db.subscriptions.push({ id: randomUUID(), userId: user.id, plan: "free", status: "active", createdAt: now() }); await persist();
      return send(res, 201, user);
    }
    if (parts[1] === "auth" && parts[2] === "me" && req.method === "GET") {
      const user = await authUser(req);
      if (!user) return fail(res, 401, "Authentication required");
      return send(res, 200, { id: user.id, email: user.email || "", name: user.user_metadata?.name || "" });
    }
    if (parts[1] === "analyze" && req.method === "POST") {
      const input = await body(req); required(input.imageUrl, "imageUrl");
      const tokenUser = await authUser(req);
      if (tokenUser && input.userId && tokenUser.id !== input.userId) return fail(res, 403, "You cannot analyze for another user");
      const result = await analyzeMeal(input.imageUrl, input.mealName || "Meal", input.context || {});
      return send(res, 200, { id: `analysis-${Date.now()}`, userId: tokenUser?.id || input.userId || "", imageUrl: input.imageUrl, mealName: input.mealName || "Meal", capturedAt: now(), status: "analysed", analysis: result.analysis, provider: result.provider });
    }
    if (parts[1] === "users") {
      const user = await scopedUser(req, parts[2]);
      if (req.method === "GET" && parts[3] === "dashboard") return send(res, 200, { user, ...dashboard(user.id) });
      if (req.method === "GET" && parts[3] === "profile") return send(res, 200, user);
      if (req.method === "PATCH" && parts[3] === "profile") {
        const input = await body(req);
        Object.assign(user, { name: input.name ?? user.name, goals: input.goals ?? user.goals, preferences: input.preferences ?? user.preferences, updatedAt: now() }); await persist(); return send(res, 200, user);
      }
      if (req.method === "GET" && parts[3] === "meals") return send(res, 200, db.meals.filter((meal) => meal.userId === user.id).reverse());
      if (req.method === "POST" && parts[3] === "meals") {
        const input = await body(req); required(input.imageUrl, "imageUrl");
        let analysis = mealAssessment(input.analysis);
        if (!input.analysis && (process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY_2)) {
          try { analysis = (await analyzeMeal(input.imageUrl, input.mealName || "Meal", input.context || {})).analysis || analysis; }
          catch (error) { console.warn(`AI unavailable; using local assessment: ${error.message}`); }
        }
        const meal = { id: randomUUID(), userId: user.id, imageUrl: input.imageUrl, mealName: input.mealName || "Meal", capturedAt: now(), status: "analysed", analysis };
        db.meals.push(meal);
        await persist(); return send(res, 201, meal);
      }
      if (req.method === "GET" && parts[3] === "actions") return send(res, 200, db.actions.filter((action) => action.userId === user.id).reverse());
      if (req.method === "POST" && parts[3] === "actions") { const input = await body(req); const action = { id: randomUUID(), userId: user.id, mealId: input.mealId || null, title: required(input.title, "title"), completed: false, createdAt: now(), completedAt: null }; db.actions.push(action); await persist(); return send(res, 201, action); }
      if (req.method === "GET" && parts[3] === "insights") { const meals = db.meals.filter((meal) => meal.userId === user.id); return send(res, 200, { averageMealScore: dashboard(user.id).averageMealScore, mealsAnalysed: meals.length, ratings: meals.reduce((acc, meal) => { acc[meal.analysis.rating] = (acc[meal.analysis.rating] || 0) + 1; return acc; }, {}), recommendationThemes: ["portion balance", "vegetable intake", "consistent movement"] }); }
      if (req.method === "GET" && parts[3] === "subscription") return send(res, 200, db.subscriptions.find((item) => item.userId === user.id) || { plan: "free", status: "active" });
    }
    if (parts[1] === "meals" && req.method === "GET") { const meal = findMeal(parts[2]); if (!meal) return fail(res, 404, "Meal not found"); return send(res, 200, meal); }
    if (parts[1] === "actions" && req.method === "PATCH") { const action = findAction(parts[2]); if (!action) return fail(res, 404, "Action not found"); const tokenUser = await authUser(req); if (tokenUser && tokenUser.id !== action.userId) return fail(res, 403, "You cannot update another user’s action"); const input = await body(req); action.completed = input.completed ?? true; action.completedAt = action.completed ? now() : null; await persist(); return send(res, 200, action); }
    return fail(res, 404, "Route not found");
  } catch (error) { return fail(res, error.status || 400, error.message); }
}

const server = createServer((req, res) => route(req, res).catch((error) => fail(res, 500, error.message)));
server.listen(port, "0.0.0.0", () => console.log(`Neulifi API listening on http://localhost:${port}`));

export { server, dataFile };
