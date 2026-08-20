import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { createStore } from "./store.mjs";

const port = Number(process.env.PORT || 8787);
const dataFile = resolve(process.env.NUELIFI_DATA_FILE || "./data/nuelifi.json");
const { db, persist, findUser, findMeal, findAction } = await createStore(dataFile);

const now = () => new Date().toISOString();
const send = (res, status, payload) => {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,PATCH,OPTIONS",
    "access-control-allow-headers": "content-type",
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
    explanation: rating === "Excellent" ? "A balanced meal with a strong mix of food groups." : "This meal has a good foundation and one or two practical opportunities to improve.",
    recommendations: [
      ...(vegetables < 3 ? ["Add vegetables to your next meal"] : []),
      ...(portion < 3 ? ["Keep the carbohydrate portion moderate"] : []),
      ...(sugar > 2 ? ["Choose a lower-sugar option"] : []),
      "Take a short walk after eating",
    ],
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
  if (req.method === "GET" && url.pathname === "/health") return send(res, 200, { status: "ok", service: "nuelifi-api", time: now() });
  if (parts[0] !== "api") return fail(res, 404, "Route not found");

  try {
    if (req.method === "POST" && parts.length === 2 && parts[1] === "users") {
      const input = await body(req); required(input.email, "email");
      if (db.users.some((user) => user.email === input.email)) return fail(res, 409, "A user with this email already exists");
      const user = { id: randomUUID(), email: input.email, name: input.name || "", goals: input.goals || [], createdAt: now(), updatedAt: now() };
      db.users.push(user); db.subscriptions.push({ id: randomUUID(), userId: user.id, plan: "free", status: "active", createdAt: now() }); await persist();
      return send(res, 201, user);
    }
    if (parts[1] === "users") {
      const user = userOrFail(parts[2]);
      if (req.method === "GET" && parts[3] === "dashboard") return send(res, 200, { user, ...dashboard(user.id) });
      if (req.method === "GET" && parts[3] === "profile") return send(res, 200, user);
      if (req.method === "PATCH" && parts[3] === "profile") {
        const input = await body(req);
        Object.assign(user, { name: input.name ?? user.name, goals: input.goals ?? user.goals, preferences: input.preferences ?? user.preferences, updatedAt: now() }); await persist(); return send(res, 200, user);
      }
      if (req.method === "GET" && parts[3] === "meals") return send(res, 200, db.meals.filter((meal) => meal.userId === user.id).reverse());
      if (req.method === "POST" && parts[3] === "meals") {
        const input = await body(req); required(input.imageUrl, "imageUrl");
        const meal = { id: randomUUID(), userId: user.id, imageUrl: input.imageUrl, mealName: input.mealName || "Meal", capturedAt: now(), status: "analysed", analysis: mealAssessment(input.analysis) };
        db.meals.push(meal);
        for (const title of meal.analysis.recommendations.slice(0, 3)) db.actions.push({ id: randomUUID(), userId: user.id, mealId: meal.id, title, completed: false, createdAt: now(), completedAt: null });
        await persist(); return send(res, 201, meal);
      }
      if (req.method === "GET" && parts[3] === "actions") return send(res, 200, db.actions.filter((action) => action.userId === user.id).reverse());
      if (req.method === "POST" && parts[3] === "actions") { const input = await body(req); const action = { id: randomUUID(), userId: user.id, mealId: input.mealId || null, title: required(input.title, "title"), completed: false, createdAt: now(), completedAt: null }; db.actions.push(action); await persist(); return send(res, 201, action); }
      if (req.method === "GET" && parts[3] === "insights") { const meals = db.meals.filter((meal) => meal.userId === user.id); return send(res, 200, { averageMealScore: dashboard(user.id).averageMealScore, mealsAnalysed: meals.length, ratings: meals.reduce((acc, meal) => { acc[meal.analysis.rating] = (acc[meal.analysis.rating] || 0) + 1; return acc; }, {}), recommendationThemes: ["portion balance", "vegetable intake", "consistent movement"] }); }
      if (req.method === "GET" && parts[3] === "subscription") return send(res, 200, db.subscriptions.find((item) => item.userId === user.id) || { plan: "free", status: "active" });
    }
    if (parts[1] === "meals" && req.method === "GET") { const meal = findMeal(parts[2]); if (!meal) return fail(res, 404, "Meal not found"); return send(res, 200, meal); }
    if (parts[1] === "actions" && req.method === "PATCH") { const action = findAction(parts[2]); if (!action) return fail(res, 404, "Action not found"); const input = await body(req); action.completed = input.completed ?? true; action.completedAt = action.completed ? now() : null; await persist(); return send(res, 200, action); }
    return fail(res, 404, "Route not found");
  } catch (error) { return fail(res, error.status || 400, error.message); }
}

const server = createServer((req, res) => route(req, res).catch((error) => fail(res, 500, error.message)));
server.listen(port, "0.0.0.0", () => console.log(`Nuelifi API listening on http://localhost:${port}`));

export { server, dataFile };
