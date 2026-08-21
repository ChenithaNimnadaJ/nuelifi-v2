import { analysisSchema, buildMealPrompt, normalizeMealAnalysis } from "./normalize.mjs";

const model = process.env.GROQ_MODEL || "qwen/qwen3.6-27b";
const endpoint = process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1/chat/completions";

async function imageUrlPart(imageUrl) { if (imageUrl.startsWith("data:")) return imageUrl; const response = await fetch(imageUrl, { signal: AbortSignal.timeout(15000) }); if (!response.ok) throw new Error(`Meal image could not be fetched (${response.status})`); const mimeType = response.headers.get("content-type")?.split(";")[0] || "image/jpeg"; const data = Buffer.from(await response.arrayBuffer()).toString("base64"); return `data:${mimeType};base64,${data}`; }

export { normalizeMealAnalysis };

export async function analyzeMealWithGroq({ imageUrl, mealName = "Meal", context = {} }) {
  if (!process.env.GROQ_API_KEY) return null;
  const image = await imageUrlPart(imageUrl);
  const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${process.env.GROQ_API_KEY}` }, signal: AbortSignal.timeout(60000), body: JSON.stringify({ model, temperature: 0.2, top_p: 0.8, max_completion_tokens: 2600, reasoning_format: "hidden", reasoning_effort: "none", response_format: { type: "json_object" }, messages: [{ role: "user", content: [{ type: "text", text: buildMealPrompt(mealName, context) }, { type: "image_url", image_url: { url: image } }] }] }) });
  if (!response.ok) { const detail = await response.text().catch(() => ""); throw new Error(`Groq analysis failed (${response.status})${detail ? `: ${detail.slice(0, 180)}` : ""}`); }
  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("Groq returned no analysis");
  return normalizeMealAnalysis(content);
}

export { analysisSchema };
