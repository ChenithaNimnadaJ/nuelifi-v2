const model = process.env.GEMINI_MODEL || "gemini-3.7-flash";
const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

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

export async function analyzeMealWithGemini({ imageUrl, mealName = "Meal" }) {
  if (!process.env.GEMINI_API_KEY) return null;
  const image = await imagePart(imageUrl);
  const response = await fetch(`${endpoint}?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(45000),
    body: JSON.stringify({
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
            indicators: { type: "OBJECT", properties: { calories: { type: "NUMBER" }, protein: { type: "NUMBER" }, carbohydrates: { type: "NUMBER" }, fats: { type: "NUMBER" }, vegetables: { type: "NUMBER" }, fibre: { type: "NUMBER" }, sugar: { type: "NUMBER" }, portionBalance: { type: "NUMBER" } }, required: ["calories", "protein", "carbohydrates", "fats", "vegetables", "fibre", "sugar", "portionBalance"] },
            explanation: { type: "STRING" },
            recommendations: { type: "ARRAY", items: { type: "STRING" }, minItems: 2, maxItems: 4 },
          },
          required: ["rating", "score", "indicators", "explanation", "recommendations"],
        },
      },
    }),
  });
  if (!response.ok) throw new Error(`Gemini analysis failed (${response.status})`);
  const payload = await response.json();
  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("");
  if (!text) throw new Error("Gemini returned no analysis");
  return JSON.parse(text);
}
