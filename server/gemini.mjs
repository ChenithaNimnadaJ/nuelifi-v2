import { analysisSchema, buildMealPrompt, normalizeMealAnalysis } from "./normalize.mjs";

const supportedModels = ["gemini-3.7-flash", "gemini-3.6-flash", "gemini-2.5-flash", "gemini-3.5-flash-lite"];
const defaultModels = (process.env.GEMINI_FALLBACK_MODELS || supportedModels.join(",")).split(",").map((value) => value.trim()).filter(Boolean);

function modelsFor(keyName) {
  const configured = keyName === "GEMINI_API_KEY_2"
    ? process.env.GEMINI_KEY_2_MODELS || process.env.GEMINI_FALLBACK_MODELS || process.env.GEMINI_MODEL
    : process.env.GEMINI_KEY_1_MODELS || process.env.GEMINI_MODEL || process.env.GEMINI_FALLBACK_MODELS;
  const requested = String(configured || "").split(",").map((value) => value.trim()).filter(Boolean);
  const models = [...new Set(requested.length ? requested : defaultModels)].filter((model) => supportedModels.includes(model));
  return models.length ? models : supportedModels;
}

async function imagePart(imageUrl) {
  if (imageUrl.startsWith("data:")) {
    const match = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) throw new Error("Invalid data URL");
    return { inline_data: { mime_type: match[1].toLowerCase(), data: match[2] } };
  }
  const response = await fetch(imageUrl, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Meal image could not be fetched (${response.status})`);
  const mimeType = response.headers.get("content-type")?.split(";")[0]?.toLowerCase() || "image/jpeg";
  const data = Buffer.from(await response.arrayBuffer()).toString("base64");
  return { inline_data: { mime_type: mimeType, data } };
}

function requestBody(image, mealName, context, analysisLevel = "basic") {
  return {
    contents: [{
      role: "user",
      parts: [{ text: buildMealPrompt(mealName, context, analysisLevel) }, image],
    }],
    systemInstruction: { parts: [{ text: "You are Neulifi, a calm food and lifestyle companion. Convert visual observations into understandable, cautious, actionable feedback. Never diagnose or prescribe. Keep mealGuidance separate from dailyTasks." }] },
    generationConfig: { temperature: 0.2, responseMimeType: "application/json", responseSchema: analysisSchema() },
  };
}

async function requestModel(apiKey, model, image, mealName, context, analysisLevel = "basic") {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(`${endpoint}?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(45000),
      body: JSON.stringify(requestBody(image, mealName, context, analysisLevel)),
    });
    if (response.ok) {
      const payload = await response.json();
      const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("");
      if (!text) throw new Error("Gemini returned no analysis");
      return JSON.parse(text);
    }
    const retryable = [408, 429, 500, 502, 503, 504].includes(response.status);
    if (!retryable || attempt === 1) throw new Error(`Gemini analysis failed (${response.status})`);
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
  throw new Error("Gemini analysis failed");
}

export async function analyzeMealWithGemini({ imageUrl, mealName = "Meal", context = {}, analysisLevel = "basic" }) {
  const providers = [
    ["GEMINI_API_KEY", process.env.GEMINI_API_KEY],
    ["GEMINI_API_KEY_2", process.env.GEMINI_API_KEY_2],
  ].filter(([, apiKey]) => Boolean(apiKey));
  if (!providers.length) return null;
  const image = await imagePart(imageUrl);
  let lastError;
  for (const [keyName, apiKey] of providers) {
    for (const model of modelsFor(keyName)) {
      try {
        return normalizeMealAnalysis(await requestModel(apiKey, model, image, mealName, context, analysisLevel));
      } catch (error) {
        lastError = error;
        console.warn(`Gemini ${keyName} model ${model} unavailable: ${error instanceof Error ? error.message : "unknown error"}`);
      }
    }
  }
  throw lastError || new Error("No Gemini model was available");
}
