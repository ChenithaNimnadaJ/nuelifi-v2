import { normalizeMealAnalysis } from "../../server/normalize.mjs";

const groqEndpoint = "https://api.groq.com/openai/v1/chat/completions";
const geminiEndpoint = "https://generativelanguage.googleapis.com/v1beta/models";

function env(name, fallback = "") { return Netlify.env.get(name) || fallback; }
function json(status, payload) { return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json; charset=utf-8" } }); }

async function imagePart(imageUrl) {
  if (imageUrl.startsWith("data:")) {
    const match = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) throw new Error("Invalid image data URL");
    return { mimeType: match[1], base64: match[2] };
  }
  const response = await fetch(imageUrl, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Meal image could not be fetched (${response.status})`);
  const mimeType = response.headers.get("content-type")?.split(";")[0] || "image/jpeg";
  return { mimeType, base64: Buffer.from(await response.arrayBuffer()).toString("base64") };
}

function prompt(mealName) {
  return `Analyse this meal for Nuelifi, a consumer wellness app. The user calls it "${mealName}". Be practical, non-judgmental, and cautious. Do not diagnose disease or prescribe treatment. Nutrition values are estimates. Return only one JSON object with exactly these fields: rating (one of Excellent, Good, Reasonable, Needs Adjustment), score (integer 0-100), indicators (object with numeric calories, protein, carbohydrates, fats, vegetables, fibre, sugar, sodium, portionBalance), explanation (string), recommendations (array of 2 to 4 concise actionable strings).`;
}

function schema() {
  return { type: "OBJECT", properties: { rating: { type: "STRING", enum: ["Excellent", "Good", "Reasonable", "Needs Adjustment"] }, score: { type: "INTEGER", minimum: 0, maximum: 100 }, indicators: { type: "OBJECT", properties: { calories: { type: "NUMBER" }, protein: { type: "NUMBER" }, carbohydrates: { type: "NUMBER" }, fats: { type: "NUMBER" }, vegetables: { type: "NUMBER" }, fibre: { type: "NUMBER" }, sugar: { type: "NUMBER" }, sodium: { type: "NUMBER" }, portionBalance: { type: "NUMBER" } }, required: ["calories", "protein", "carbohydrates", "fats", "vegetables", "fibre", "sugar", "portionBalance"] }, explanation: { type: "STRING" }, recommendations: { type: "ARRAY", items: { type: "STRING" }, minItems: 2, maxItems: 4 } }, required: ["rating", "score", "indicators", "explanation", "recommendations"] };
}

async function analyzeGroq(image, mealName, apiKey, model) {
  const response = await fetch(groqEndpoint, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(60000), body: JSON.stringify({ model, temperature: 0.2, top_p: 0.8, max_completion_tokens: 2200, reasoning_format: "hidden", reasoning_effort: "none", response_format: { type: "json_object" }, messages: [{ role: "user", content: [{ type: "text", text: `You are Nuelifi, a calm food and lifestyle companion. Your output is machine-read and persisted by the application. Never address the user directly and never invent a diagnosis. ${prompt(mealName)}` }, { type: "image_url", image_url: { url: `data:${image.mimeType};base64,${image.base64}` } }] }] }) });
  if (!response.ok) throw new Error(`Groq analysis failed (${response.status})`);
  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("Groq returned no analysis");
  return normalizeMealAnalysis(content);
}

async function analyzeGemini(image, mealName, apiKey, model) {
  const response = await fetch(`${geminiEndpoint}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(60000), body: JSON.stringify({ contents: [{ role: "user", parts: [{ inline_data: { mime_type: image.mimeType, data: image.base64 } }, { text: `Analyse this meal for a consumer wellness app. The user calls it ${mealName}. Return only JSON matching this schema.` }] }], systemInstruction: { parts: [{ text: "You are Nuelifi, a calm food and lifestyle companion. Nutritional estimates are approximate." }] }, generationConfig: { temperature: 0.2, responseMimeType: "application/json", responseSchema: schema() } }) });
  if (!response.ok) throw new Error(`Gemini analysis failed (${response.status})`);
  const payload = await response.json();
  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("");
  if (!text) throw new Error("Gemini returned no analysis");
  return normalizeMealAnalysis(text);
}

export default async function handler(request) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  if (request.method !== "POST") return json(405, { error: "Method not allowed" });
  try {
    const input = await request.json();
    if (!input?.imageUrl) return json(400, { error: "imageUrl is required" });
    const image = await imagePart(String(input.imageUrl));
    const mealName = String(input.mealName || "Meal");
    const groqKey = env("GROQ_API_KEY");
    const geminiKey = env("GEMINI_API_KEY");
    let analysis;
    let provider;
    let lastError;
    if (groqKey) { try { analysis = await analyzeGroq(image, mealName, groqKey, env("GROQ_MODEL", "qwen/qwen3.6-27b")); provider = "groq"; } catch (error) { lastError = error; } }
    if (!analysis && geminiKey) { for (const model of [...new Set([env("GEMINI_MODEL", "gemini-3.7-flash"), ...env("GEMINI_FALLBACK_MODELS", "gemini-3.5-flash,gemini-2.5-flash").split(",").map((value) => value.trim()).filter(Boolean)])]) { try { analysis = await analyzeGemini(image, mealName, geminiKey, model); provider = "gemini"; break; } catch (error) { lastError = error; } } }
    if (!analysis) throw lastError || new Error("No AI provider is configured");
    return json(200, { id: `analysis-${Date.now()}`, userId: input.userId || "", imageUrl: input.imageUrl, mealName, capturedAt: new Date().toISOString(), status: "analysed", analysis, provider });
  } catch (error) {
    return json(error?.name === "AbortError" ? 504 : 502, { error: error instanceof Error ? error.message : "Meal analysis failed" });
  }
}

export const config = { path: "/api/analyze" };
