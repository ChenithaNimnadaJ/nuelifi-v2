const ratings = new Set(["Excellent", "Good", "Reasonable", "Needs Adjustment"]);

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
  if (!parsed || typeof parsed !== "object") throw new Error("AI returned an invalid analysis object");
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
