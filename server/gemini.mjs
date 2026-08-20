const primaryModel = process.env.GEMINI_MODEL || "gemini-3.7-flash";
const fallbackModels = (process.env.GEMINI_FALLBACK_MODELS || "gemini-3.5-flash,gemini-2.5-flash").split(",").map((value) => value.trim()).filter(Boolean);

async function imagePart(imageUrl) {
  if (imageUrl.startsWith("data:")) {
    const match = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) throw new Error("Invalid data URL");
    return { inline_data: { mime_type: match[1], data: match[2] } };
  }
  const response = await fetch(imageUrl, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Meal image could not be fetched (${response.status})`);
  const mimeType = response.headers.get("content-type")?.split(";")[0] || "image/jpeg";
  const data = Buffer.from(await response.arrayBuffer()).toString("base64");
  return { inline_data: { mime_type: mimeType, data } };
}

function requestBody(image, mealName) {
  return {
    contents: [{ role: "user", parts: [image, { text: `Analyse this meal for a consumer wellness app. The user calls it ${mealName}. Be practical and non-judgmental. Do not diagnose disease or prescribe treatment. Return only JSON matching the requested schema.` }] }],
    systemInstruction: { parts: [{ text: "You are Nuelifi, a calm food and lifestyle companion. Convert visual observations into understandable, cautious, actionable feedback. Nutritional estimates are approximate." }] },
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          rating: { type: "STRING", enum: ["Excellent", "Good", "Reasonable", "Needs Adjustment"] },
          score: { type: "INTEGER", minimum: 0, maximum: 100 },
          indicators: { type: "OBJECT", properties: { calories: { type: "NUMBER" }, protein: { type: "NUMBER" }, carbohydrates: { type: "NUMBER" }, fats: { type: "NUMBER" }, vegetables: { type: "NUMBER" }, fibre: { type: "NUMBER" }, sugar: { type: "NUMBER" }, sodium: { type: "NUMBER" }, portionBalance: { type: "NUMBER" } }, required: ["calories", "protein", "carbohydrates", "fats", "vegetables", "fibre", "sugar", "portionBalance"] },
          explanation: { type: "STRING" },
          recommendations: { type: "ARRAY", items: { type: "STRING" }, minItems: 2, maxItems: 4 },
        },
        required: ["rating", "score", "indicators", "explanation", "recommendations"],
      },
    },
  };
}

async function requestModel(model, image, mealName) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(`${endpoint}?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`, { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(45000), body: JSON.stringify(requestBody(image, mealName)) });
    if (response.ok) {
      const payload = await response.json();
      const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("");
      if (!text) throw new Error("Gemini returned no analysis");
      return JSON.parse(text);
    }
    if (response.status !== 503 || attempt === 1) throw new Error(`Gemini analysis failed (${response.status})`);
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
  return null;
}

export async function analyzeMealWithGemini({ imageUrl, mealName = "Meal" }) {
  if (!process.env.GEMINI_API_KEY) return null;
  const image = await imagePart(imageUrl);
  const models = [...new Set([primaryModel, ...fallbackModels])];
  let lastError;
  for (const model of models) {
    try { return await requestModel(model, image, mealName); } catch (error) { lastError = error; console.warn(`Gemini model ${model} unavailable: ${error.message}`); }
  }
  throw lastError || new Error("No Gemini model was available");
}
