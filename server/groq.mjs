const model = process.env.GROQ_MODEL || "qwen/qwen3.6-27b";
const endpoint = process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1/chat/completions";
const ratings = new Set(["Excellent", "Good", "Reasonable", "Needs Adjustment"]);

async function imageUrlPart(imageUrl) {
  if (imageUrl.startsWith("data:")) return imageUrl;
  const response = await fetch(imageUrl, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Meal image could not be fetched (${response.status})`);
  const mimeType = response.headers.get("content-type")?.split(";")[0] || "image/jpeg";
  const data = Buffer.from(await response.arrayBuffer()).toString("base64");
  return `data:${mimeType};base64,${data}`;
}

function prompt(mealName) {
  return `Analyse this meal for Nuelifi, a consumer wellness app. The user calls it "${mealName}". Be practical, non-judgmental, and cautious. Do not diagnose disease or prescribe treatment. Nutrition values are estimates. Return only one JSON object with exactly these fields: rating (one of Excellent, Good, Reasonable, Needs Adjustment), score (integer 0-100), indicators (object with numeric calories, protein, carbohydrates, fats, vegetables, fibre, sugar, sodium, portionBalance), explanation (string), recommendations (array of 2 to 4 concise actionable strings).`;
}

function number(value, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function bounded(value, minimum, maximum, fallback = minimum) { return Math.max(minimum, Math.min(maximum, number(value, fallback))); }
function portionScale(value) { const parsed = number(value, 2); return parsed > 3 ? bounded(parsed / 100 * 3, 0, 3, 2) : bounded(parsed, 0, 3, 2); }

export function normalizeMealAnalysis(input) {
  let raw = typeof input === "string" ? input : JSON.stringify(input);
  const thinkEnd = raw.lastIndexOf("</think>");
  if (thinkEnd >= 0) raw = raw.slice(thinkEnd + "</think>".length);
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) raw = raw.slice(firstBrace, lastBrace + 1);
  const parsed = typeof input === "string" ? JSON.parse(raw.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim()) : input;
  if (!parsed || typeof parsed !== "object") throw new Error("Groq returned an invalid analysis object");
  const indicators = parsed.indicators && typeof parsed.indicators === "object" ? parsed.indicators : {};
  const recommendations = Array.isArray(parsed.recommendations) ? parsed.recommendations.map((item) => String(item).trim()).filter(Boolean).slice(0, 4) : [];
  if (recommendations.length < 2) throw new Error("AI returned too few recommendations");
  return {
    rating: ratings.has(parsed.rating) ? parsed.rating : "Reasonable",
    score: Math.round(bounded(parsed.score, 0, 100, 60)),
    indicators: { calories: bounded(indicators.calories, 0, 3000), protein: bounded(indicators.protein, 0, 250), carbohydrates: bounded(indicators.carbohydrates, 0, 400), fats: bounded(indicators.fats, 0, 200), vegetables: bounded(indicators.vegetables, 0, 10), fibre: bounded(indicators.fibre, 0, 100), sugar: bounded(indicators.sugar, 0, 200), sodium: bounded(indicators.sodium, 0, 5000), portionBalance: portionScale(indicators.portionBalance) },
    explanation: String(parsed.explanation || "This meal has a few strengths and a few practical opportunities for your next choice."),
    recommendations,
  };
}

export async function analyzeMealWithGroq({ imageUrl, mealName = "Meal" }) {
  if (!process.env.GROQ_API_KEY) return null;
  const image = await imageUrlPart(imageUrl);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    signal: AbortSignal.timeout(60000),
    body: JSON.stringify({ model, temperature: 0.2, top_p: 0.8, max_completion_tokens: 2200, reasoning_format: "hidden", reasoning_effort: "none", response_format: { type: "json_object" }, messages: [{ role: "user", content: [{ type: "text", text: `You are Nuelifi, a calm food and lifestyle companion. Your output is machine-read and persisted by the application. Never address the user directly and never invent a diagnosis. ${prompt(mealName)}` }, { type: "image_url", image_url: { url: image } }] }] }),
  });
  if (!response.ok) { const detail = await response.text().catch(() => ""); throw new Error(`Groq analysis failed (${response.status})${detail ? `: ${detail.slice(0, 180)}` : ""}`); }
  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("Groq returned no analysis");
  return normalizeMealAnalysis(content);
}
