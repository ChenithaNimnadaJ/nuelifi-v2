import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { createStore, emptyDb } from "./store.mjs";

const dataFile = resolve(process.env.NEULIFI_DATA_FILE || process.env.NUELIFI_DATA_FILE || "./data/neulifi.json");
const { db, persist } = await createStore(dataFile);
const user = { id: "demo-user", email: "demo@neulifi.app", name: "Demo User", goals: ["balanced meals", "consistent movement"], preferences: { units: "metric", notifications: true }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
const meal = { id: "demo-meal", userId: user.id, imageUrl: "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=900&q=80", mealName: "Colourful grain bowl", capturedAt: new Date().toISOString(), status: "analysed", analysis: { rating: "Good", score: 78, indicators: { calories: 520, protein: 28, carbohydrates: 55, fats: 18, vegetables: 3, fibre: 8, sugar: 1, portionBalance: 3 }, explanation: "A balanced meal with a strong mix of food groups.", recommendations: ["Take a short walk after eating", "Drink more water"] } };
const actions = [
  { id: "demo-action-1", userId: user.id, mealId: meal.id, title: "Take a short walk after eating", completed: true, createdAt: new Date().toISOString(), completedAt: new Date().toISOString() },
  { id: "demo-action-2", userId: user.id, mealId: meal.id, title: "Drink more water", completed: false, createdAt: new Date().toISOString(), completedAt: null },
];
Object.assign(db, { ...emptyDb(), users: [user], meals: [meal], actions, subscriptions: [{ id: "demo-subscription", userId: user.id, plan: "free", status: "active", createdAt: new Date().toISOString() }] });
await persist();
console.log(`Seeded ${dataFile}`);
