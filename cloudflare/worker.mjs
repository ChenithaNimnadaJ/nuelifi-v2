const ratings = new Set(["Excellent", "Good", "Reasonable", "Needs Adjustment"]);
// Gemini currently rejects the 2.5 Flash identifiers for new users; keep the live fallback list on supported Flash models.
const DEFAULT_GEMINI_MODELS = ["gemini-3.5-flash-lite", "gemini-3.6-flash", "gemini-3.7-flash", "gemini-3.5-flash"];
const GEMINI_MODELS_BY_KEY = { GEMINI_API_KEY: DEFAULT_GEMINI_MODELS, GEMINI_API_KEY_2: DEFAULT_GEMINI_MODELS };
const geminiHealth = new Map();
const geminiInFlight = new Set();
const DEFAULT_ALLOWED_ORIGINS = new Set(["https://neulifi.online"]);
const LOCAL_ALLOWED_ORIGINS = new Set(["http://localhost:5173", "http://localhost:4173"]);
const MAX_REMOTE_IMAGE_BYTES = 12_000_000;
const MAX_PERSISTED_ANALYSIS_BYTES = 200_000;
const ALLOWED_REMOTE_IMAGE_HOSTS = new Set(["images.unsplash.com"]);
class GeminiError extends Error { constructor(message, kind = "transient", status = 0) { super(message); this.name = "GeminiError"; this.kind = kind; this.status = status; } }
function geminiHealthKey(keyName, model) { return `${keyName}:${model}`; }
function geminiCoolingDown(keyName, model) { const entry = geminiHealth.get(geminiHealthKey(keyName, model)); return Boolean(entry && entry.until > Date.now()); }
function markGeminiHealth(keyName, model, kind) { const ttl = kind === "model_unavailable" ? 24 * 60 * 60 * 1000 : kind === "invalid_key" ? 30 * 60 * 1000 : kind === "quota" ? 60 * 1000 : kind === "malformed" ? 2 * 60 * 1000 : 15 * 1000; geminiHealth.set(geminiHealthKey(keyName, model), { kind, until: Date.now() + ttl }); }
function geminiModels(env, keyName) { const validated = GEMINI_MODELS_BY_KEY[keyName] || DEFAULT_GEMINI_MODELS; const configured = keyName === "GEMINI_API_KEY_2" ? env.GEMINI_KEY_2_MODELS : env.GEMINI_KEY_1_MODELS || env.GEMINI_MODEL; const requested = String(configured || "").split(",").map((item) => String(item || "").trim()).filter(Boolean); const models = [...new Set([...requested, ...validated])].filter((model) => validated.includes(model)); return models.length ? models : validated; }
function geminiProviders(env) { return [{ keyName: "GEMINI_API_KEY", apiKey: String(env.GEMINI_API_KEY || "").trim() }, { keyName: "GEMINI_API_KEY_2", apiKey: String(env.GEMINI_API_KEY_2 || "").trim() }].filter((provider) => provider.apiKey); }
function classifyGeminiStatus(status) { if (status === 401 || status === 403) return "invalid_key"; if (status === 404) return "model_unavailable"; if (status === 429) return "quota"; if ([408, 425, 500, 502, 503, 504].includes(status)) return "transient"; if (status >= 400 && status < 500) return "invalid_request"; return "transient"; }
function validateAnalysisRequest(body) { if (!body || typeof body !== "object") throw new GeminiError("Analysis input is missing.", "invalid_request", 400); const rawImageUrls = Array.isArray(body.imageUrls) ? body.imageUrls : [body.imageUrl]; const normalizedImageUrls = rawImageUrls.map((value) => typeof value === "string" ? value.trim() : "").filter(Boolean); if (!normalizedImageUrls.length) throw new GeminiError("A valid meal image is required.", "invalid_request", 400); if (normalizedImageUrls.length > 1) throw new GeminiError("Choose one meal photo per scan.", "invalid_request", 400); const imageUrls = []; let totalImageSize = 0; for (const imageUrl of normalizedImageUrls) { if (!imageUrl.startsWith("data:image/") && !/^https?:\/\//i.test(imageUrl)) throw new GeminiError("A valid meal image is required.", "invalid_request", 400); if (imageUrl.length > 14_000_000) throw new GeminiError("This image is too large. Choose a smaller photo and try again.", "invalid_request", 413); if (imageUrl.startsWith("data:")) { const match = imageUrl.match(/^data:([^;]+);base64,(.+)$/i); if (!match || !["image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"].includes(match[1].toLowerCase()) || !match[2]) throw new GeminiError("That file is not a supported meal image.", "invalid_request", 400); } else { try { const parsedUrl = new URL(imageUrl); if (!["http:", "https:"].includes(parsedUrl.protocol)) throw new Error("invalid protocol"); } catch { throw new GeminiError("That meal image URL is not valid.", "invalid_request", 400); } } totalImageSize += imageUrl.length; imageUrls.push(imageUrl); } if (totalImageSize > 18_000_000) throw new GeminiError("These images are too large together. Choose fewer or smaller photos.", "invalid_request", 413); const mealName = typeof body.mealName === "string" && body.mealName.trim() ? body.mealName.trim().slice(0, 120) : "Meal"; const context = body.context && typeof body.context === "object" ? body.context : {}; const analysisLevel = body.analysisLevel === "complete" || body.analysisLevel === "enhanced" ? body.analysisLevel : "basic"; const prompt = mealPrompt(mealName, context, analysisLevel); if (prompt.length > 18_000) throw new GeminiError("This analysis context is too large. Please shorten it and try again.", "invalid_request", 413); const eventKey = typeof body.eventKey === "string" ? body.eventKey.trim().slice(0, 120) : ""; if (!/^[A-Za-z0-9:_-]{8,120}$/.test(eventKey)) throw new GeminiError("Analysis needs a valid idempotency key.", "invalid_request", 400); return { imageUrls, imageUrl: imageUrls[0], mealName, context, analysisLevel, eventKey }; }

function number(value, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function bounded(value, minimum, maximum, fallback = minimum) { return Math.max(minimum, Math.min(maximum, number(value, fallback))); }
function portionScale(value) { const parsed = number(value, 2); return parsed > 3 ? bounded(parsed / 100 * 3, 0, 3, 2) : bounded(parsed, 0, 3, 2); }
function cleanList(value, limit = 12) { return Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean).slice(0, limit) : []; }
const baselineDailyTaskFallbacks = ["Keep water nearby and drink regularly through your day.", "Take a short movement break when it fits your day.", "Choose a realistic time to wind down later, if it suits your routine.", "Set aside one small planning step for tomorrow."];
function isNextMealNutritionTask(text) { return /\bnext\s+meal\b/i.test(text) && /\b(?:vegetable|vegetables|greens|fruit|fibre|fiber|balanced|balance)\b/i.test(text) && /\b(?:add|include|build|make|plan|choose)\b/i.test(text); }
function isSafeDailyTask(item) { const text = String(item).trim(); const nextMealNutrition = isNextMealNutritionTask(text); if (!text || text.length > 110 || (!nextMealNutrition && !/water|hydrate|walk|movement|move|break|sleep|bedtime|stretch|schedule|routine|habit|breathe|mindful|rest|goal|priority|today|tomorrow|wind down|planning/i.test(text))) return false; if (/\b(?:at|by|before|around)\s+(?:[01]?\d|2[0-3])(?::[0-5]\d)?\s*(?:am|pm)?\b|\b(?:[01]?\d|2[0-3]):[0-5]\d\b/i.test(text)) return false; if (/\b(?:compensate|compensation|burn off|make up for|earn|punish|undo|offset|repay|medication|insulin|dose|blood pressure|blood sugar|diagnos|treatment)\b/i.test(text)) return false; if (/\b(?:serving|portion|cup|gram|grams|ounce|ounces|tablespoon|teaspoon|handful|bowl|amount|quantity)\b/i.test(text)) return false; if (nextMealNutrition) return true; if (/\bmeal\b/i.test(text) && !/\b(?:after|following)\s+(?:this|your)\s+meal\b/i.test(text)) return false; if (/\bgoal\b/i.test(text) && !/\bmeal\b/i.test(text)) return false; if (/\b(food|plate|ingredient|vegetable|greens|fruit|protein|fibre|fiber|sodium|salt|sugar|sauce|dressing|carbohydrate|calorie|portion|snack|allerg|label|dietary|recipe|cook|eat|consume|add|remove|reduce|increase|choose|swap|replace|include|serve|limit|avoid|measure|count|soup|bowl|rice|chicken|tofu|yoga|squat|lunge|push-up|plank|jog|run|cycling|medication|insulin|dose|blood pressure|blood sugar)\b/i.test(text)) return false; return true; }
function contextualDailyTaskFallbacks(context = {}) { const preferences = context?.preferences && typeof context.preferences === "object" ? context.preferences : context; const list = (value) => Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 3) : []; const goals = list(context?.goals || preferences?.goals); const activityLevel = String(preferences?.activityLevel || "").trim(); const tasks = []; if (/mostly sitting/i.test(activityLevel)) tasks.push("Take a short movement break during your next long sitting period."); else if (activityLevel) tasks.push("Make room for one short movement window today."); if (goals[0]) tasks.push("Set aside one small step today that supports your saved goal."); return tasks; }
function localTaskContext(context = {}) { const preferences = context?.preferences && typeof context.preferences === "object" ? context.preferences : context; const timezone = String(preferences?.timezone || "").trim(); const parsedReference = Date.parse(String(context?.capturedAt || "")); const referenceDate = Number.isFinite(parsedReference) ? new Date(parsedReference) : new Date(); let period = "the day"; let weekday = "today"; try { const parts = new Intl.DateTimeFormat("en", { timeZone: timezone || undefined, weekday: "long", hour: "numeric", hour12: false }).formatToParts(referenceDate); const hour = Number(parts.find((part) => part.type === "hour")?.value || 12); weekday = parts.find((part) => part.type === "weekday")?.value || "today"; period = hour < 5 ? "overnight" : hour < 12 ? "morning" : hour < 17 ? "afternoon" : hour < 22 ? "evening" : "late evening"; } catch { /* use a broad neutral fallback when a saved timezone is invalid */ } const activity = String(preferences?.activityLevel || "").trim(); const goals = Array.isArray(context?.goals || preferences?.goals) ? (context?.goals || preferences?.goals).map(String).map((item) => item.trim()).filter(Boolean).slice(0, 1) : []; return `For dailyTasks only: the analysis reference time is ${referenceDate.toISOString()}; it is ${period} on ${weekday} in the user's local day${activity ? `; activity context is ${activity}` : ""}${goals[0] ? `; the user's broad goal is ${goals[0]}` : ""}. Use this only to choose a fitting general action.`; }
function taskFamily(value) { const text = String(value || ""); if (/next\s+meal/i.test(text) && /vegetable|greens|fruit|fibre|fiber|balanced|balance/i.test(text)) return "next-meal-nutrition"; if (/walk|movement|move|break/i.test(text)) return "movement"; if (/water|hydrate/i.test(text)) return "hydration"; if (/sleep|bedtime|rest|wind down/i.test(text)) return "rest"; if (/planning|schedule|routine|priority|goal/i.test(text)) return "planning"; return ""; }
function existingActionRecords(context = {}) { const raw = Array.isArray(context?.existingActions) ? context.existingActions : []; return raw.map((item) => { if (typeof item === "string") return { title: item.trim(), status: "upcoming", dueAt: null }; if (!item || typeof item !== "object") return null; const record = item; return { title: String(record.title || "").trim(), status: String(record.status || "upcoming").trim(), dueAt: typeof record.dueAt === "string" ? record.dueAt : null }; }).filter((item) => item && item.title && item.status !== "missed").slice(0, 8); }
function equivalentExistingAction(task, existing) { const family = taskFamily(task); const normalized = String(task || "").trim().toLowerCase(); return existing.find((item) => item.title.toLowerCase() === normalized || (family && taskFamily(item.title) === family)) || null; }
function completeDailyTasks(items, context = {}, mealName = "", indicators = {}) { const selected = cleanList(items, 4).filter(isSafeDailyTask); const existing = existingActionRecords(context); return [...new Set(selected)].filter((task) => !equivalentExistingAction(task, existing)).slice(0, 2); }
function coveredDailyTasks(items, context = {}) { const selected = cleanList(items, 4).filter(isSafeDailyTask); const existing = existingActionRecords(context); return [...new Set(selected)].map((task) => equivalentExistingAction(task, existing)).filter(Boolean).map((item) => `Your existing “${item.title}” already covers that opportunity.`).slice(0, 2); }
function normalizeExistingPlanSignals(items, context = {}) { const existing = existingActionRecords(context); return cleanList(items, 4).map((item) => { const lower = item.toLowerCase(); const family = taskFamily(item); const match = existing.find((record) => lower.includes(record.title.toLowerCase()) || (family && taskFamily(record.title) === family)); return match ? `Your existing “${match.title}” already covers that opportunity.` : null; }).filter(Boolean).slice(0, 2); }
function fallbackDailyTasks(recommendations, context = {}, mealName = "", indicators = {}) { return completeDailyTasks(recommendations, context, mealName, indicators); }
function reasonForDailyTask(task, context = {}) { const preferences = context?.preferences && typeof context.preferences === "object" ? context.preferences : context; const goals = Array.isArray(context?.goals || preferences?.goals) ? (context?.goals || preferences?.goals).map(String).map((item) => item.trim()).filter(Boolean) : []; const text = String(task).trim(); if (/next\s+meal/i.test(text)) return "This keeps the next choice practical without changing the photographed meal."; if (/movement|walk|stretch|break/i.test(text)) return "A short movement window is an easy day-level habit to repeat."; if (/water|hydrate/i.test(text)) return "A simple hydration anchor is easier to remember when attached to the day."; if (/sleep|bedtime|rest/i.test(text)) return "A planned rest routine supports a steadier daily rhythm."; if (/goal/i.test(text) && goals[0]) return `This connects to your saved goal: ${goals[0]}.`; return "This is a general, practical action for today rather than an instruction to change the photographed meal."; }
function normalizeMealAnalysis(input, context = {}, mealName = "") {
  let raw = typeof input === "string" ? input : JSON.stringify(input);
  const thinkEnd = raw.lastIndexOf("</think>");
  if (thinkEnd >= 0) raw = raw.slice(thinkEnd + "</think>".length);
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) raw = raw.slice(firstBrace, lastBrace + 1);
  const parsed = typeof input === "string" ? JSON.parse(raw.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim()) : input;
  if (!parsed || typeof parsed !== "object") throw new Error("AI returned an invalid analysis object");
  const indicators = parsed.indicators && typeof parsed.indicators === "object" ? parsed.indicators : {};
  const legacy = cleanList(parsed.recommendations, 4);
  const mealGuidance = cleanList(parsed.mealGuidance ?? parsed.meal_guidance ?? legacy, 4);
  const dailyTasks = cleanList(parsed.dailyTasks ?? parsed.daily_tasks ?? parsed.dayTasks, 6);
  const safeMealGuidance = mealGuidance.slice(0, 4);
  const candidateDailyTasks = dailyTasks.length ? dailyTasks : legacy; const safeDailyTasks = completeDailyTasks(candidateDailyTasks, context, mealName, indicators); const modelAlreadyOnPlan = normalizeExistingPlanSignals(parsed.alreadyOnPlan ?? parsed.already_on_plan, context); const alreadyOnPlan = [...new Set([...modelAlreadyOnPlan, ...coveredDailyTasks(candidateDailyTasks, context)])].slice(0, 2);
  return {
    rating: ratings.has(parsed.rating) ? parsed.rating : "Reasonable",
    score: Math.round(bounded(parsed.score, 0, 100, 60)),
    indicators: { calories: bounded(indicators.calories, 0, 3000), protein: bounded(indicators.protein, 0, 250), carbohydrates: bounded(indicators.carbohydrates, 0, 400), fats: bounded(indicators.fats, 0, 200), vegetables: bounded(indicators.vegetables, 0, 10), fibre: bounded(indicators.fibre, 0, 100), sugar: bounded(indicators.sugar, 0, 200), sodium: bounded(indicators.sodium, 0, 5000), portionBalance: portionScale(indicators.portionBalance) },
    explanation: String(parsed.explanation || "This meal has a few strengths and a few practical opportunities to improve."),
    mealGuidance: safeMealGuidance,
    dailyTasks: safeDailyTasks,
    dailyTaskReasons: safeDailyTasks.map((task) => reasonForDailyTask(task, context, mealName, indicators)),
    alreadyOnPlan,
    recommendations: safeMealGuidance,
  };
}

function base64FromBytes(buffer) { const bytes = new Uint8Array(buffer); let binary = ""; const chunk = 0x8000; for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length))); return btoa(binary); }
async function fetchWithTimeout(input, init = {}, timeoutMs = 12000) { const controller = new AbortController(); let timer; const timeout = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error(`Upstream request timed out after ${Math.round(timeoutMs / 1000)} seconds`)); }, timeoutMs); }); try { return await Promise.race([fetch(input, { ...init, signal: controller.signal }), timeout]); } finally { clearTimeout(timer); } }
async function upstreamFetch(input, init = {}, timeoutMs = 12000) { return fetchWithTimeout(input, init, timeoutMs); }
function isBlockedRemoteHost(hostname) { const host = String(hostname || '').toLowerCase().replace(/[.]$/, ''); if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host === 'metadata.google.internal') return true; if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) return true; const parts = host.split('.').map(Number); if (parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) { const [a, b] = parts; if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return true; } return false; }
function validateRemoteImageUrl(imageUrl) { let parsed; try { parsed = new URL(imageUrl); } catch { throw new GeminiError("That meal image URL is not valid.", "invalid_request", 400); } if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || isBlockedRemoteHost(parsed.hostname) || !ALLOWED_REMOTE_IMAGE_HOSTS.has(parsed.hostname.toLowerCase())) throw new GeminiError("That meal image URL is not allowed.", "invalid_request", 400); return parsed; }
async function readCappedBody(response, maxBytes) { if (!response.body) { const buffer = await response.arrayBuffer(); if (buffer.byteLength > maxBytes) throw new GeminiError("This image is too large. Choose a smaller photo and try again.", "invalid_request", 413); return buffer; } const reader = response.body.getReader(); const chunks = []; let total = 0; try { while (true) { const next = await reader.read(); if (next.done) break; total += next.value.byteLength; if (total > maxBytes) { await reader.cancel(); throw new GeminiError("This image is too large. Choose a smaller photo and try again.", "invalid_request", 413); } chunks.push(next.value); } } finally { reader.releaseLock(); } const output = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; } return output.buffer; }
async function imageDataUrl(imageUrl) { if (imageUrl.startsWith("data:")) { const match = imageUrl.match(/^data:([^;]+);base64,(.+)$/i); if (!match) throw new GeminiError("That meal image is not valid.", "invalid_request", 400); const mimeType = match[1].toLowerCase(); if (!["image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"].includes(mimeType)) throw new GeminiError("That file is not a supported meal image.", "invalid_request", 400); if (match[2].length > 18_000_000) throw new GeminiError("This image is too large. Choose a smaller photo and try again.", "invalid_request", 413); return `data:${mimeType};base64,${match[2]}`; } validateRemoteImageUrl(imageUrl); const response = await fetchWithTimeout(imageUrl, { redirect: "manual" }, 10000); if (response.status >= 300 && response.status < 400) throw new GeminiError("Redirected meal image URLs are not supported. Upload the image directly instead.", "invalid_request", 400); if (!response.ok) throw new GeminiError("Meal image could not be fetched.", "transient", response.status); const mimeType = response.headers.get("content-type")?.split(";")[0]?.toLowerCase() || ""; if (!["image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"].includes(mimeType)) throw new GeminiError("That file is not a supported meal image.", "invalid_request", 415); const contentLength = Number(response.headers.get("content-length") || 0); if (contentLength > MAX_REMOTE_IMAGE_BYTES) throw new GeminiError("This image is too large. Choose a smaller photo and try again.", "invalid_request", 413); const data = base64FromBytes(await readCappedBody(response, MAX_REMOTE_IMAGE_BYTES)); if (data.length > 18_000_000) throw new GeminiError("This image is too large. Choose a smaller photo and try again.", "invalid_request", 413); return `data:${mimeType};base64,${data}`; }
async function geminiImagePart(imageUrl) { const match = imageUrl.match(/^data:([^;]+);base64,(.+)$/); if (!match) throw new Error("Invalid meal image data"); return { inline_data: { mime_type: match[1], data: match[2] } }; }
function contextSummary(context = {}) { const preferences = context?.preferences && typeof context.preferences === "object" ? context.preferences : context; const health = preferences?.healthContext && typeof preferences.healthContext === "object" ? preferences.healthContext : {}; const list = (value) => Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 12) : []; const lines = []; const goals = list(context?.goals || preferences?.goals); const conditions = list(health.conditions); const allergies = list(health.allergies); if (goals.length) lines.push(`Health goals supplied by the user: ${goals.join(", ")}.`); if (conditions.length) lines.push(`Known health conditions supplied by the user: ${conditions.join(", ")}.`); if (allergies.length) lines.push(`Food allergies or intolerances supplied by the user: ${allergies.join(", ")}.`); if (preferences?.dietaryPreference) lines.push(`Dietary preference: ${String(preferences.dietaryPreference)}.`); if (preferences?.activityLevel) lines.push(`Activity level: ${String(preferences.activityLevel)}.`); if (typeof health.notes === "string" && health.notes.trim()) lines.push(`Additional user context: ${health.notes.trim().slice(0, 600)}.`); const existingActions = existingActionRecords(context); if (existingActions.length) lines.push(`Existing open daily actions already covered by the user: ${existingActions.map((item) => `${item.title}${item.dueAt ? ` (scheduled at ${item.dueAt})` : ""}`).join(" | ")}. Do not repeat an existing action family; connect to the existing action instead.`); const completedActions = cleanList(context?.completedActions, 4); if (completedActions.length) lines.push(`Recently completed daily actions: ${completedActions.join(" | ")}. Use these only as background and do not create a duplicate.`); return lines.length ? lines.join(" ") : "No personal health context was supplied."; }
function analysisDepth(level = "basic") { if (level === "complete") return "Provide a complete single-meal assessment: use the available indicators, explain the reasoning in fuller detail, and connect the guidance carefully to the supplied context without diagnosing."; if (level === "enhanced") return "Provide an enhanced assessment: use the available indicators, explain the main trade-offs, and connect the guidance to the supplied context with a little more detail."; return "Provide a clear general assessment with concise explanations and practical guidance." }
function mealPrompt(mealName, context = {}, analysisLevel = "basic") { return `You are Neulifi, a calm food and lifestyle companion. The output is machine-read and persisted by the application. Analyse the meal called "${mealName}" from this one photo. ${contextSummary(context)} ${analysisDepth(analysisLevel)} Treat this as user-provided context only: never infer a diagnosis, prescribe treatment, recommend medication changes, or overrule a clinician. Avoid known allergens and respect dietary preferences. Nutrition values are estimates. Return only JSON. Keep mealGuidance and dailyTasks strictly separate: mealGuidance is about this photographed meal or a future similar meal and may mention ingredients, portions, nutrients, substitutions, or preparation; dailyTasks are at most two small actions for the person’s day and may be connected to this meal when genuinely useful, such as a short walk after this meal, but must not tell them to edit, add to, remove from, swap, portion, inspect, label-check, or otherwise change the photographed meal. A daily task may include one explicit forward-looking next-meal nutrition action only when this photo reveals a relevant opportunity, such as “Add vegetables to the next meal,” “Add fruit or fibre to the next meal,” or “Make the next meal more balanced.” That exception must refer to the next meal, never the current photographed meal, and must not prescribe a recipe, exact food quantity, exact clock time, medical action, or compensation. ${localTaskContext(context)} For dailyTasks only, return 0 to 2 short, broad actions for the person’s day. Answer what the user should do next and normally return one action at most. Keep them useful but non-specific: hydration, a movement break, rest or wind-down, planning, or the one explicit next-meal nutrition action above. If no action is genuinely warranted, return an empty dailyTasks array. A reasonably balanced meal should usually produce no daily task. Do not invent generic tasks for a balanced meal, and do not repeat or paraphrase an equivalent existing open action; the application will show an equivalent opportunity as already on the user’s plan. When an existing open action directly covers an opportunity, return one short explanation in alreadyOnPlan and do not repeat it in dailyTasks; otherwise return an empty alreadyOnPlan array. Never suggest eating, cooking, or changing the photographed/current meal, a recipe, exact food quantity, portion, or meal time. Never use an exact clock time, medical action, medication instruction, diagnosis, condition-specific treatment, or compensation language. If it is overnight, prefer rest, hydration, or planning for later rather than suggesting food or movement now. Use cautious, non-judgmental language. Return rating, score, indicators, explanation, mealGuidance (0 to 4 strings), dailyTasks (0 to 2 short action strings), dailyTaskReasons (one short reason for each dailyTasks item), and alreadyOnPlan (0 to 2 short strings).`; }

function geminiBody(images, mealName, context, analysisLevel = "basic") { return { contents: [{ role: "user", parts: [{ text: mealPrompt(mealName, context, analysisLevel) }, ...images] }], generationConfig: { temperature: 0.2, responseMimeType: "application/json", responseSchema: { type: "OBJECT", properties: { rating: { type: "STRING", enum: ["Excellent", "Good", "Reasonable", "Needs Adjustment"] }, score: { type: "INTEGER", minimum: 0, maximum: 100 }, indicators: { type: "OBJECT", properties: { calories: { type: "NUMBER" }, protein: { type: "NUMBER" }, carbohydrates: { type: "NUMBER" }, fats: { type: "NUMBER" }, vegetables: { type: "NUMBER" }, fibre: { type: "NUMBER" }, sugar: { type: "NUMBER" }, sodium: { type: "NUMBER" }, portionBalance: { type: "NUMBER" } }, required: ["calories", "protein", "carbohydrates", "fats", "vegetables", "fibre", "sugar", "portionBalance"] }, explanation: { type: "STRING" }, mealGuidance: { type: "ARRAY", items: { type: "STRING" }, minItems: 0, maxItems: 4 }, dailyTasks: { type: "ARRAY", items: { type: "STRING" }, minItems: 0, maxItems: 2 }, alreadyOnPlan: { type: "ARRAY", items: { type: "STRING" }, minItems: 0, maxItems: 2 } }, required: ["rating", "score", "indicators", "explanation", "mealGuidance", "dailyTasks"] } } }; }
async function requestGeminiModel(env, provider, model, images, mealName, context, analysisLevel = "basic") {
  if (geminiCoolingDown(provider.keyName, model)) throw new GeminiError("Gemini model is cooling down.", "model_unavailable");
  let attempt = 0;
  while (attempt < 2) {
    try {
      const response = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(provider.apiKey)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(geminiBody(images, mealName, context, analysisLevel)) }, attempt === 0 ? 15000 : 9000);
      if (response.ok) {
        let payload;
        try { payload = await response.json(); } catch { throw new GeminiError("Gemini returned an unreadable response.", "malformed", response.status); }
        const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("");
        if (!text) throw new GeminiError("Gemini returned no analysis.", "malformed", response.status);
        try { return { analysis: normalizeMealAnalysis(text, context, mealName), model, keyName: provider.keyName }; } catch { throw new GeminiError("Gemini returned an invalid analysis.", "malformed", response.status); }
      }
      throw new GeminiError(`Gemini request was not accepted (${response.status}).`, classifyGeminiStatus(response.status), response.status);
    } catch (error) {
      const failure = error instanceof GeminiError ? error : new GeminiError("Gemini request was interrupted.", "transient");
      if (failure.kind === "transient" && attempt === 0) { attempt += 1; await new Promise((resolve) => setTimeout(resolve, 250)); continue; }
      throw failure;
    }
  }
  throw new GeminiError("Gemini request was interrupted.", "transient");
}
async function analyzeGemini(env, imageUrls, mealName, context, analysisLevel = "basic") {
  const providers = geminiProviders(env);
  if (!providers.length) throw new GeminiError("Gemini is not configured.", "configuration", 503);
  const images = await Promise.all(imageUrls.map(async (imageUrl) => geminiImagePart(await imageDataUrl(imageUrl))));
  const errors = [];
  for (const provider of providers) {
    let stopThisKey = false;
    for (const model of geminiModels(env, provider.keyName)) {
      if (stopThisKey || geminiCoolingDown(provider.keyName, model)) continue;
      try { return await requestGeminiModel(env, provider, model, images, mealName, context, analysisLevel); }
      catch (error) {
        const failure = error instanceof GeminiError ? error : new GeminiError("Gemini request was interrupted.", "transient");
        errors.push(failure);
        markGeminiHealth(provider.keyName, model, failure.kind);
        if (["invalid_key", "quota"].includes(failure.kind)) stopThisKey = true;
        if (failure.kind === "invalid_request") throw failure;
      }
    }
  }
  const kind = errors.some((error) => error.kind === "quota") ? "quota" : errors.some((error) => error.kind === "invalid_key") ? "invalid_key" : errors.some((error) => error.kind === "transient") ? "transient" : "malformed";
  throw new GeminiError("Gemini is temporarily unavailable.", kind, kind === "quota" ? 429 : 503);
}

async function verifyUser(request, env) { if (String(env.REQUIRE_AUTH ?? "true").toLowerCase() === "false" && String(env.ALLOW_PREVIEW_AUTH_BYPASS || "false").toLowerCase() === "true") return { id: "preview-user" }; const header = request.headers.get("authorization") || ""; const token = header.match(/^Bearer\s+(.+)$/i)?.[1]; if (!token) throw new Error("Authentication required"); const supabaseUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL; const publishableKey = env.SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY; if (!supabaseUrl || !publishableKey) throw new Error("Supabase authentication is not configured"); const response = await upstreamFetch(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/user`, { headers: { apikey: publishableKey, authorization: `Bearer ${token}` } }, 8000); if (!response.ok) throw new Error("Your session is not valid. Please sign in again."); return response.json(); }
function usageToken(request) { return request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] || ""; }
function hex(buffer) { return [...new Uint8Array(buffer)].map((value) => value.toString(16).padStart(2, "0")).join(""); }
function safeEqual(left, right) { if (left.length !== right.length) return false; let result = 0; for (let index = 0; index < left.length; index += 1) result |= left.charCodeAt(index) ^ right.charCodeAt(index); return result === 0; }
async function verifyStripeSignature(payload, signature, secret) { const parts = String(signature || "").split(","); const timestamp = parts.find((item) => item.startsWith("t="))?.slice(2); const signatures = parts.filter((item) => item.startsWith("v1=")).map((item) => item.slice(3)); if (!timestamp || !signatures.length || Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) > 300) throw new Error("Invalid Stripe webhook timestamp."); const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const expected = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${payload}`))); if (!signatures.some((candidate) => safeEqual(candidate, expected))) throw new Error("Invalid Stripe webhook signature."); }
async function verifyLemonSignature(payload, signature, secret) { if (!secret) throw new Error("Lemon Squeezy webhook signing is not configured."); const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const expected = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))); const provided = String(signature || "").trim().toLowerCase(); if (!provided || !safeEqual(provided, expected)) throw new Error("Invalid Lemon Squeezy webhook signature."); }
function paddleEnvironment(env) { const value = String(env.PADDLE_ENVIRONMENT || "").trim().toLowerCase(); if (value !== "production" && value !== "sandbox") throw new Error("Paddle environment is not configured. Set PADDLE_ENVIRONMENT to production or sandbox."); return value; }
function paddleApiBase(env) { return paddleEnvironment(env) === "sandbox" ? "https://sandbox-api.paddle.com" : "https://api.paddle.com"; }
async function paddleFetch(env, path, options = {}) { if (!env.PADDLE_API_KEY) throw new Error("Paddle server API key is not configured."); return upstreamFetch(`${paddleApiBase(env)}${path}`, { ...options, headers: { accept: "application/json", authorization: `Bearer ${env.PADDLE_API_KEY}`, ...(options.headers || {}) } }, 10000); }
async function paddleClientToken(env) { const environment = paddleEnvironment(env); const prefix = environment === "sandbox" ? "test_" : "live_"; const configured = String(env.PADDLE_CLIENT_TOKEN || "").trim(); if (new RegExp(`^${prefix}[A-Za-z0-9]{27}$`).test(configured)) return configured; const response = await paddleFetch(env, "/client-tokens?status=active&per_page=200"); if (!response.ok) throw new Error("Paddle client-side token could not be loaded."); const payload = await response.json().catch(() => ({})); const token = (Array.isArray(payload.data) ? payload.data : []).map((item) => typeof item === "object" && item ? String(item.token || "").trim() : "").find((value) => new RegExp(`^${prefix}[A-Za-z0-9]{27}$`).test(value)); if (!token) throw new Error("Paddle client-side token is not configured."); return token; }
function paddleCountryCode(request) { const candidates = [request.headers.get("CF-IPCountry"), request.headers.get("x-vercel-ip-country")]; return candidates.map((value) => String(value || "").trim().toUpperCase()).find((value) => /^[A-Z]{2}$/.test(value) && value !== "XX" && value !== "T1"); }
function paddleCustomData(event) { const data = event?.data && typeof event.data === "object" ? event.data : {}; return data.custom_data && typeof data.custom_data === "object" ? data.custom_data : {}; }
function paddleEventType(event) { return String(event?.event_type || event?.type || "").trim(); }
function paddleEventAt(event) { const candidates = [event?.occurred_at, event?.data?.updated_at, event?.data?.created_at]; const timestamp = candidates.map((value) => Date.parse(String(value || ""))).find((value) => Number.isFinite(value)); return new Date(timestamp ?? Date.now()).toISOString(); }
function paddleItems(data) { return Array.isArray(data?.items) ? data.items : []; }
function paddlePaidAmount(event) { const data = event?.data && typeof event.data === "object" ? event.data : {}; const candidates = [data?.details?.totals?.total, data?.details?.totals?.grand_total, data?.totals?.total, data?.total]; const minorUnits = candidates.map((value) => Number(value)).find((value) => Number.isFinite(value) && value >= 0); return minorUnits === undefined ? null : minorUnits / 100; }
function paddlePriceId(event) { const data = event?.data && typeof event.data === "object" ? event.data : {}; for (const item of paddleItems(data)) { const id = String(item?.price?.id || item?.price_id || "").trim(); if (id) return id; } return ""; }
function paddlePlan(event, env) { const data = event?.data && typeof event.data === "object" ? event.data : {}; const priceIds = paddleItems(data).map((item) => String(item?.price?.id || item?.price_id || "").trim()).filter(Boolean); const premiumIds = [env.PADDLE_PRICE_PREMIUM_MONTH, env.PADDLE_PRICE_PREMIUM_YEAR].map((value) => String(value || "").trim()).filter(Boolean); const proIds = [env.PADDLE_PRICE_PRO_MONTH, env.PADDLE_PRICE_PRO_YEAR].map((value) => String(value || "").trim()).filter(Boolean); if (priceIds.some((priceId) => premiumIds.includes(priceId))) return "premium"; if (priceIds.some((priceId) => proIds.includes(priceId))) return "pro"; return null; }
function appSubscriptionStatus(status) { const normalized = String(status || "").trim().toLowerCase(); if (["canceled", "cancelled", "expired"].includes(normalized)) return "cancelled"; if (["past_due", "paused", "payment_failed"].includes(normalized)) return "past_due"; return "active"; }
async function paddleLinkedUserId(env, customerId) { const id = String(customerId || "").trim(); if (!id) return null; const response = await supabaseAdminFetch(env, `/rest/v1/paddle_customers?paddle_customer_id=eq.${encodeURIComponent(id)}&select=user_id&limit=1`); if (!response.ok) throw new Error("Could not resolve the Paddle customer account."); const rows = await response.json(); const userId = String(Array.isArray(rows) ? rows[0]?.user_id || "" : "").trim(); return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId) ? userId : null; }
async function paddleCustomerData(env, customerId) { const id = String(customerId || "").trim(); const environment = String(env.PADDLE_ENVIRONMENT || "").trim().toLowerCase(); if (!id || !env.PADDLE_API_KEY || !["production", "sandbox"].includes(environment)) return {}; const response = await paddleFetch(env, `/customers/${encodeURIComponent(id)}`); if (!response.ok) return {}; const payload = await response.json().catch(() => ({})); return payload?.data && typeof payload.data === "object" ? payload.data : {}; }
async function paddleHasKnownSubscription(env, userId, subscriptionId) { const response = await supabaseAdminFetch(env, `/rest/v1/subscriptions?user_id=eq.${encodeURIComponent(userId)}&provider_subscription_id=eq.${encodeURIComponent(subscriptionId)}&select=user_id&limit=1`); if (!response.ok) throw new Error("Could not verify the existing Paddle subscription."); const rows = await response.json(); return Array.isArray(rows) && rows.length > 0; }
function paddleCustomerId(event) { const data = event?.data && typeof event.data === "object" ? event.data : {}; return String(data.id && paddleEventType(event).startsWith("customer.") ? data.id : data.customer_id || "").trim(); }
function paddleSubscriptionId(event) { const data = event?.data && typeof event.data === "object" ? event.data : {}; const type = paddleEventType(event); return String(type.startsWith("subscription.") ? data.id || "" : data.subscription_id || "").trim(); }
function paddleTransactionId(event) { const data = event?.data && typeof event.data === "object" ? event.data : {}; const type = paddleEventType(event); return String(type.startsWith("transaction.") ? data.id || "" : data.transaction_id || "").trim(); }
function paddleEmail(event, data = event?.data && typeof event.data === "object" ? event.data : event && typeof event === "object" ? event : {}) { return String(data.email || data.customer?.email || "").trim().slice(0, 320); }
function paddleBillingInterval(event) { const data = event?.data && typeof event.data === "object" ? event.data : {}; return String(data.billing_cycle?.interval || paddleItems(data)[0]?.price?.billing_cycle?.interval || "").toLowerCase() === "year" ? "year" : String(data.billing_cycle?.interval || paddleItems(data)[0]?.price?.billing_cycle?.interval || "").toLowerCase() === "month" ? "month" : null; }
function paddleAppStatus(status) { return appSubscriptionStatus(String(status || "active")); }
async function verifyPaddleSignature(payload, signature, secret) { if (!secret) throw new Error("Paddle webhook signing is not configured."); const parts = String(signature || "").split(";").map((part) => part.trim()); const timestamp = parts.find((part) => part.startsWith("ts="))?.slice(3); const provided = parts.find((part) => part.startsWith("h1="))?.slice(3); if (!timestamp || !provided || Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) > 300) throw new Error("Invalid Paddle webhook signature."); const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const expected = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}:${payload}`))); if (!safeEqual(provided.toLowerCase(), expected)) throw new Error("Invalid Paddle webhook signature."); }
async function handlePaddleConfig(request, env) { const environment = paddleEnvironment(env); const countryCode = paddleCountryCode(request); const clientToken = await paddleClientToken(env); return json(countryCode ? { environment, countryCode, clientToken } : { environment, clientToken }, 200, request, env); }
function paddleSubscriptionStatus(eventType, data) { const type = String(eventType).toLowerCase(); if (type.includes("canceled") || type.includes("cancelled") || type.includes("expired")) return "cancelled"; if (type.includes("past_due") || type.includes("payment_failed") || type.includes("paused")) return "past_due"; if (type.includes("completed") || type.includes("recovered")) return "active"; return paddleAppStatus(data?.status); }
async function hydratePaddleSubscription(env, event, subscriptionId) { const response = await paddleFetch(env, `/subscriptions/${encodeURIComponent(subscriptionId)}`); if (!response.ok) throw new Error(`Could not retrieve Paddle subscription (${response.status}).`); const payload = await response.json(); return { ...event, data: { ...(event.data && typeof event.data === "object" ? event.data : {}), ...(payload.data && typeof payload.data === "object" ? payload.data : {}) } }; }
async function syncPaddleCustomerFromEvent(env, event, userId = null) { const data = event?.data && typeof event.data === "object" ? event.data : {}; const customerId = paddleCustomerId(event); if (!customerId) throw new Error("Paddle customer event did not include a customer ID."); const linkedUserId = userId || await paddleLinkedUserId(env, customerId); const eventEmail = paddleEmail(event, data); const providerCustomer = eventEmail ? {} : await paddleCustomerData(env, customerId); const customerEmail = eventEmail || paddleEmail(providerCustomer); const response = await supabaseAdminFetch(env, "/rest/v1/rpc/sync_paddle_customer", { method: "POST", body: JSON.stringify({ p_user_id: linkedUserId, p_paddle_customer_id: customerId, p_email: customerEmail || null, p_name: typeof data.name === "string" ? data.name.slice(0, 300) : typeof providerCustomer.name === "string" ? providerCustomer.name.slice(0, 300) : null, p_locale: typeof data.locale === "string" ? data.locale.slice(0, 32) : typeof providerCustomer.locale === "string" ? providerCustomer.locale.slice(0, 32) : null, p_status: typeof data.status === "string" ? data.status.slice(0, 32) : typeof providerCustomer.status === "string" ? providerCustomer.status.slice(0, 32) : null, p_marketing_consent: typeof data.marketing_consent === "boolean" ? data.marketing_consent : typeof providerCustomer.marketing_consent === "boolean" ? providerCustomer.marketing_consent : null, p_custom_data: Object.keys(paddleCustomData(event)).length ? paddleCustomData(event) : providerCustomer.custom_data && typeof providerCustomer.custom_data === "object" ? providerCustomer.custom_data : {}, p_event_at: paddleEventAt(event) }) }); if (!response.ok) throw new Error(`Could not synchronize Paddle customer (${response.status}).`); }
async function createPaddleCustomerPortalSession(env, userId) { const userFilter = encodeURIComponent(userId); const subscriptionResponse = await supabaseAdminFetch(env, `/rest/v1/subscriptions?user_id=eq.${userFilter}&select=provider_customer_id,provider_subscription_id,status&limit=1`); if (!subscriptionResponse.ok) throw new Error("Could not load your billing record."); const subscriptions = await subscriptionResponse.json(); const subscription = Array.isArray(subscriptions) ? subscriptions[0] : null; let customerId = String(subscription?.provider_customer_id || "").trim(); let subscriptionId = String(subscription?.provider_subscription_id || "").trim(); if (!/^ctm_[a-z\d]{26}$/.test(customerId)) { const customerResponse = await supabaseAdminFetch(env, `/rest/v1/paddle_customers?user_id=eq.${userFilter}&select=paddle_customer_id&limit=1`); if (!customerResponse.ok) throw new Error("Could not load your billing record."); const customers = await customerResponse.json(); customerId = String(Array.isArray(customers) ? customers[0]?.paddle_customer_id || "" : "").trim(); }
  if (!/^ctm_[a-z\d]{26}$/.test(customerId)) throw new Error("No active billing account is linked to this Neulifi profile yet.");
  const body = /^sub_[a-z\d]{26}$/.test(subscriptionId) ? { subscription_ids: [subscriptionId] } : {};
  const response = await paddleFetch(env, `/customers/${encodeURIComponent(customerId)}/portal-sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`Paddle could not open billing management (${response.status}).`);
  const payload = await response.json(); const url = payload?.data?.urls?.general?.overview;
  if (typeof url !== "string" || !/^https:\/\/customer-portal\.paddle\.com\//.test(url)) throw new Error("Paddle returned no billing-management link.");
  return { url };
}
async function stagePaddlePendingPurchase(env, event, data, plan, subscriptionId, status, priceId, interval, eventAt) {
  const customerId = String(data.customer_id || "").trim() || null;
  let email = paddleEmail(event, data);
  if (!email && customerId) {
    email = paddleEmail(await paddleCustomerData(env, customerId));
  }
  const response = await supabaseAdminFetch(env, "/rest/v1/rpc/stage_paddle_pending_purchase", { method: "POST", body: JSON.stringify({ p_paddle_customer_id: customerId, p_paddle_subscription_id: subscriptionId, p_paddle_transaction_id: paddleTransactionId(event) || null, p_email: email || null, p_plan: plan, p_billing_interval: interval || "year", p_price_id: priceId || null, p_provider_status: typeof data.status === "string" ? data.status : status, p_provider_data: data, p_event_at: eventAt }) });
  if (!response.ok) throw new Error(`Could not stage Paddle purchase (${response.status}).`);
}
async function updateSubscriptionFromPaddle(env, event) {
  const type = paddleEventType(event);
  let sourceEvent = event;
  let data = event?.data && typeof event.data === "object" ? event.data : {};
  const subscriptionId = paddleSubscriptionId(event);
  if (!subscriptionId) { if (type.startsWith("transaction.")) return; throw new Error("Paddle event did not include a subscription."); }
  let plan = paddlePlan(sourceEvent, env);
  if (!plan || type === "transaction.completed") {
    sourceEvent = await hydratePaddleSubscription(env, sourceEvent, subscriptionId);
    data = sourceEvent.data;
    plan ||= paddlePlan(sourceEvent, env);
  }
  if (!plan) throw new Error("Paddle event did not include a recognized Neulifi price.");
  const status = paddleSubscriptionStatus(type, data);
  const priceId = paddlePriceId(sourceEvent) || null;
  const interval = paddleBillingInterval(sourceEvent) || "year";
  const eventAt = paddleEventAt(event);
  const customerId = String(data.customer_id || "").trim() || null;
  const userId = customerId ? await paddleLinkedUserId(env, customerId) : null;
  const isLegacyMonthlyPrice = [env.PADDLE_PRICE_PRO_MONTH, env.PADDLE_PRICE_PREMIUM_MONTH].map((value) => String(value || "").trim()).filter(Boolean).includes(String(priceId || ""));
  const knownLegacySubscription = Boolean(userId && isLegacyMonthlyPrice && await paddleHasKnownSubscription(env, userId, subscriptionId));
  if (interval !== "year" && !knownLegacySubscription) {
    if (customerId) await syncPaddleCustomerFromEvent(env, { ...sourceEvent, data: { ...data, customer_id: customerId } }, null);
    return;
  }
  if (!userId) {
    if (interval === "year" && (status === "active" || status === "trialing")) await stagePaddlePendingPurchase(env, sourceEvent, data, plan, subscriptionId, status, priceId, interval, eventAt);
    else if (status !== "active" && status !== "trialing") { const inactiveResponse = await supabaseAdminFetch(env, "/rest/v1/rpc/mark_paddle_pending_purchase_inactive", { method: "POST", body: JSON.stringify({ p_paddle_subscription_id: subscriptionId, p_provider_status: typeof data.status === "string" ? data.status : status, p_provider_data: data, p_event_at: eventAt }) }); if (!inactiveResponse.ok) throw new Error(`Could not invalidate pending Paddle purchase (${inactiveResponse.status}).`); }
    if (customerId) await syncPaddleCustomerFromEvent(env, { ...sourceEvent, data: { ...data, customer_id: customerId } }, null);
    return;
  }
  const response = await supabaseAdminFetch(env, "/rest/v1/rpc/sync_paddle_subscription", { method: "POST", body: JSON.stringify({ p_user_id: userId, p_plan: plan, p_status: status, p_provider_customer_id: customerId, p_provider_subscription_id: subscriptionId, p_billing_interval: interval, p_price_id: priceId, p_provider_status: typeof data.status === "string" ? data.status : null, p_current_billing_period: data.current_billing_period || null, p_scheduled_change: data.scheduled_change || null, p_provider_data: data, p_event_at: eventAt }) });
  if (!response.ok) throw new Error(`Could not synchronize Paddle subscription (${response.status}).`);
  if (customerId) await syncPaddleCustomerFromEvent(env, { ...sourceEvent, data: { ...data, customer_id: customerId } }, userId);
  if (status === "active") { const reward = await supabaseAdminFetch(env, "/rest/v1/rpc/record_paid_referral_reward", { method: "POST", body: JSON.stringify({ p_referred_user_id: userId, p_subscription_key: `paddle:${subscriptionId}`, p_plan: plan, ...(type === "transaction.completed" && paddlePaidAmount(event) !== null ? { p_paid_amount: paddlePaidAmount(event) } : {}) }) }); if (!reward.ok) throw new Error("Could not synchronize the verified referral reward."); }
}
async function processPaddleEvent(env, event) { const type = paddleEventType(event); const supported = ["customer.created", "customer.updated", "transaction.completed", "transaction.payment_failed", "subscription.created", "subscription.updated", "subscription.activated", "subscription.resumed", "subscription.paused", "subscription.canceled", "subscription.cancelled", "subscription.past_due", "subscription.expired"]; if (!supported.includes(type)) return; if (type === "customer.created" || type === "customer.updated") { await syncPaddleCustomerFromEvent(env, event); return; } await updateSubscriptionFromPaddle(env, event); }
async function handlePaddleWebhook(request, env) { const payload = await request.text(); try { await verifyPaddleSignature(payload, request.headers.get("paddle-signature"), env.PADDLE_NOTIFICATION_WEBHOOK_SECRET); } catch (error) { return json({ error: error instanceof Error ? error.message : "Invalid Paddle signature." }, 400, request, env); } let event; try { event = JSON.parse(payload); } catch { return json({ error: "Invalid Paddle event payload." }, 400, request, env); } const digest = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload))); const eventId = `paddle:${String(event.event_id || digest)}`; const ledgerEvent = { id: eventId, type: `paddle.${paddleEventType(event) || "unknown"}` }; try { if (!(await claimPaymentEvent(env, ledgerEvent))) return json({ received: true, duplicate: true }, 200, request, env); await processPaddleEvent(env, event); await finishPaymentEvent(env, eventId, "processed"); return json({ received: true }, 200, request, env); } catch (error) { const message = error instanceof Error ? error.message : "Paddle event processing failed."; await finishPaymentEvent(env, eventId, "failed", message).catch(() => undefined); return json({ error: message }, 500, request, env); } }
async function supabaseAdminFetch(env, path, options = {}) { if (!env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Payment database synchronization is not configured."); const supabaseUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL; if (!supabaseUrl) throw new Error("Supabase database synchronization is not configured."); return upstreamFetch(`${supabaseUrl.replace(/\/$/, "")}${path}`, { ...options, headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json", ...(options.headers || {}) } }, 10000); }
async function claimPaymentEvent(env, event) { const response = await supabaseAdminFetch(env, "/rest/v1/rpc/claim_payment_event", { method: "POST", body: JSON.stringify({ p_event_id: event.id, p_event_type: event.type }) }); if (!response.ok) throw new Error("Could not claim payment event."); const result = await response.json(); return Boolean(Array.isArray(result) ? result[0] : result); }
async function finishPaymentEvent(env, eventId, status, errorMessage = null) { const response = await supabaseAdminFetch(env, `/rest/v1/payment_events?event_id=eq.${encodeURIComponent(eventId)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status, error_message: errorMessage, processed_at: status === "processed" ? new Date().toISOString() : null }) }); if (!response.ok) throw new Error("Could not finalize payment event ledger state."); }
async function usageRpc(_request, env, rpc, userId) { const response = await supabaseAdminFetch(env, `/rest/v1/rpc/${rpc}`, { method: "POST", body: JSON.stringify({ p_user_id: userId }) }); if (!response.ok) throw new Error("Could not verify your AI usage allowance."); const rows = await response.json(); return Array.isArray(rows) ? rows[0] : rows; }
async function reserveAiUsage(request, env, userId) { if (String(env.REQUIRE_AUTH ?? "true").toLowerCase() === "false") return { allowed: true, plan: "free", status: "active", used: 0, usage_limit: 0, analysis_level: "basic" }; const usage = await usageRpc(request, env, "reserve_ai_usage", userId); if (!usage?.allowed) throw new GeminiError("You’ve reached today’s meal analysis limit.", "quota", 429); return usage; }
async function currentAiUsage(request, env, userId) { if (String(env.REQUIRE_AUTH ?? "true").toLowerCase() === "false") return { plan: "free", status: "active", used: 0, usage_limit: 0, analysis_level: "basic" }; return usageRpc(request, env, "current_ai_usage", userId); }
async function persistMealAnalysis(request, env, userId) {
  const body = await request.json();
  const rawImageUrls = Array.isArray(body.imageUrls) ? body.imageUrls : [body.imageUrl];
  const input = validateAnalysisRequest({ ...body, imageUrl: rawImageUrls[0], imageUrls: rawImageUrls });
  const eventKey = typeof body.eventKey === "string" ? body.eventKey.trim().slice(0, 120) : "";
  const capturedAt = typeof body.capturedAt === "string" ? body.capturedAt : new Date().toISOString();
  const provider = typeof body.provider === "string" ? body.provider.slice(0, 40) : "unknown";
  const analysis = body.analysis && typeof body.analysis === "object" && !Array.isArray(body.analysis) ? body.analysis : null;
  if (!eventKey || !analysis) throw new Error("Meal data is incomplete or too large to save.");
  if (provider !== "gemini") throw new Error("Meal data did not come from a verified analysis.");
  if (new TextEncoder().encode(JSON.stringify(analysis)).byteLength > MAX_PERSISTED_ANALYSIS_BYTES) throw new Error("Meal analysis is too large to save.");
  if (!analysis.rating || !Number.isFinite(Number(analysis.score)) || !Array.isArray(analysis.mealGuidance) || !Array.isArray(analysis.dailyTasks)) throw new Error("Meal analysis is incomplete or invalid.");
  const response = await supabaseAdminFetch(env, "/rest/v1/rpc/persist_meal_analysis", { method: "POST", body: JSON.stringify({ p_user_id: userId, p_event_key: eventKey, p_image_url: input.imageUrl, p_image_urls: input.imageUrls, p_meal_name: input.mealName, p_captured_at: capturedAt, p_provider: provider, p_analysis: analysis }) });
  if (!response.ok) throw new Error("Could not save this meal to your history.");
  return { id: String(await response.json()) };
}
async function releaseAiUsage(request, env, userId) { if (String(env.REQUIRE_AUTH ?? "true").toLowerCase() === "false") return; await usageRpc(request, env, "release_ai_usage", userId); }
function base64UrlFromBytes(input) { const bytes = input instanceof Uint8Array ? input : new Uint8Array(input); let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, ""); }
function bytesFromBase64Url(value) { const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/"); if (!normalized || normalized.length % 4 === 1) throw new Error("Payout encryption is not configured."); const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4); const binary = atob(padded); return Uint8Array.from(binary, (character) => character.charCodeAt(0)); }
async function payoutCryptoKey(env) { const raw = bytesFromBase64Url(env.PAYOUT_ENCRYPTION_KEY); if (raw.byteLength !== 32) throw new Error("Payout encryption is not configured."); return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]); }
async function encryptPayoutSecret(env, value) { const key = await payoutCryptoKey(env); const iv = crypto.getRandomValues(new Uint8Array(12)); const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(value))); const packed = new Uint8Array(iv.length + ciphertext.length); packed.set(iv); packed.set(ciphertext, iv.length); return `v1.${base64UrlFromBytes(packed)}`; }
async function decryptPayoutSecret(env, value) { const encoded = String(value || ""); if (!encoded.startsWith("v1.")) throw new Error("Payout encryption is not configured."); const packed = bytesFromBase64Url(encoded.slice(3)); if (packed.byteLength <= 12) throw new Error("Payout encryption is not configured."); const key = await payoutCryptoKey(env); return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: packed.slice(0, 12) }, key, packed.slice(12))); }
function payoutText(value, limit) { return String(value || "").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, limit); }
function validatePayoutWallet(value) { const walletAddress = String(value || "").trim(); if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(walletAddress)) throw new Error("Enter a valid USDT TRC20 wallet address."); return walletAddress; }
function validatePayoutMemo(value) { const memoTag = payoutText(value, 128); if (memoTag && !/^[A-Za-z0-9 .:_/@#-]+$/.test(memoTag)) throw new Error("Memo or tag contains unsupported characters."); return memoTag; }
function payoutAmount(value) { const amount = Number(value); if (!Number.isFinite(amount) || amount < 5 || amount > 1000000) throw new Error("Enter a payout amount of at least $5.00."); return Math.round(amount * 1_000_000) / 1_000_000; }
function payoutRequestPathId(pathname, prefix) { const match = pathname.match(new RegExp(`^${prefix}/([^/]+?)/?$`)); if (!match?.[1]) return null; try { return uuidPath(decodeURIComponent(match[1])); } catch { return null; } }
function payoutMethodView(row) {
  if (!row || typeof row !== "object") return null;
  const methodType = row.method_type ?? row.methodType;
  const destinationLast4 = row.destination_last4 ?? row.destinationLast4 ?? row.wallet_address_last4 ?? row.walletAddressLast4 ?? null;
  const destinationPreview = row.destination_preview ?? row.destinationPreview ?? (destinationLast4 ? `Wallet ending ••••${destinationLast4}` : "");
  return {
    id: row.id,
    countryCode: row.country_code ?? row.countryCode ?? "XX",
    methodType,
    currency: row.currency,
    network: row.network || "",
    destinationPreview,
    destinationLast4,
    hasMemoTag: Boolean(row.memo_tag_ciphertext ?? row.hasMemoTag),
    createdAt: row.created_at ?? row.createdAt,
    updatedAt: row.updated_at ?? row.updatedAt,
  };
}
function payoutRequestView(row) {
  if (!row || typeof row !== "object") return null;
  const methodType = row.method_type ?? row.methodType;
  const destinationLast4 = row.destination_last4 ?? row.destinationLast4 ?? row.wallet_address_last4 ?? row.walletAddressLast4 ?? null;
  const destinationPreview = row.destination_preview ?? row.destinationPreview ?? (destinationLast4 ? `Wallet ending ••••${destinationLast4}` : "");
  return {
    id: row.id,
    requestedAmount: Number(row.requested_amount ?? row.requestedAmount ?? 0),
    currency: "USD",
    status: row.status,
    availableBalanceSnapshot: Number(row.available_balance_snapshot ?? row.availableBalanceSnapshot ?? 0),
    countryCode: row.country_code ?? row.countryCode ?? "XX",
    methodType,
    methodCurrency: row.method_currency ?? row.methodCurrency,
    network: row.network || "",
    destinationPreview,
    destinationLast4,
    hasMemoTag: Boolean(row.memo_tag_ciphertext ?? row.hasMemoTag),
    userMessage: typeof (row.user_message ?? row.userMessage) === "string" ? (row.user_message ?? row.userMessage) : null,
    createdAt: row.created_at ?? row.createdAt,
    reviewedAt: row.reviewed_at ?? row.reviewedAt ?? null,
    paidAt: row.paid_at ?? row.paidAt ?? null,
    paymentReference: row.payment_reference ?? row.paymentReference ?? null,
  };
}
function payoutOptionView(row, countryCodes = []) {
  if (!row || typeof row !== "object") return null;
  return { methodType: row.method_type, currency: row.currency, network: row.network || "", displayName: row.display_name || "Payout method", memoRequired: Boolean(row.memo_required), countryCodes };
}
function payoutOptionKey(row) { return [row?.method_type || row?.methodType || "", row?.currency || "", row?.network || ""].join("|"); }
async function callPayoutRpc(env, rpc, body) { const response = await supabaseAdminFetch(env, `/rest/v1/rpc/${rpc}`, { method: "POST", body: JSON.stringify(body) }); if (!response.ok) { const payload = await response.json().catch(() => ({})); const upstream = String(payload?.message || payload?.hint || ""); const safe = /already pending|Add a crypto payout method|minimum payout|available balance|Unsupported cryptocurrency|Unsupported payout method|not configured for this country|wallet address|Memo or tag|Payout method data|Affiliate account|Payout request was not found|already closed|Invalid payout status|status transition|payment reference|manual payment|allowed payout status|valid two-letter country/i.test(upstream) ? upstream.slice(0, 240) : "Could not complete that payout action."; throw new Error(safe); } return response.json(); }

function uuidPath(value) { const candidate = String(value || "").trim(); return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate) ? candidate : null; }
function routeUserId(pathname, prefix) { const match = pathname.match(new RegExp(`^${prefix}/([^/]+)(?:/|$)`)); return uuidPath(match?.[1]); }
async function requireRouteUser(request, env, pathname, prefix) { const verifiedUser = await verifyUser(request, env); const requestedUserId = routeUserId(pathname, prefix); if (!requestedUserId || requestedUserId !== verifiedUser.id) throw new Error("Not allowed"); return verifiedUser; }
async function callUserRpc(env, rpc, body) { const response = await supabaseAdminFetch(env, `/rest/v1/rpc/${rpc}`, { method: "POST", body: JSON.stringify(body) }); if (!response.ok) throw new Error("Could not complete that account action."); const text = await response.text(); if (!text.trim()) return null; try { return JSON.parse(text); } catch { throw new Error("Could not read that account response."); } }
async function listUserRows(env, table, userId, select, extra = "") { const response = await supabaseAdminFetch(env, `/rest/v1/${table}?user_id=eq.${encodeURIComponent(userId)}&select=${encodeURIComponent(select)}${extra}`); if (!response.ok) throw new Error("Could not load your account data."); return response.json(); }
async function markOverdueTasksBestEffort(env, userId) {
  const userFilter = encodeURIComponent(userId);
  const now = encodeURIComponent(new Date().toISOString());
  const response = await supabaseAdminFetch(env, `/rest/v1/actions?user_id=eq.${userFilter}&completed=eq.false&status=eq.upcoming&due_at=lt.${now}&select=id&limit=100`);
  if (!response.ok) return;
  const rows = await response.json().catch(() => []);
  for (const row of Array.isArray(rows) ? rows : []) {
    const actionId = uuidPath(row?.id);
    if (!actionId) continue;
    await supabaseAdminFetch(env, `/rest/v1/actions?id=eq.${encodeURIComponent(actionId)}&user_id=eq.${userFilter}&completed=eq.false&status=eq.upcoming`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "missed" }) }).catch(() => undefined);
  }
}
async function listAffiliatePayouts(env, affiliateId) {
  const id = encodeURIComponent(affiliateId);
  const [optionsResponse, countryResponse, methodResponse, requestsResponse] = await Promise.all([
    supabaseAdminFetch(env, "/rest/v1/affiliate_payout_method_options?active=eq.true&select=method_type,currency,network,display_name,memo_required&order=currency.asc,network.asc"),
    supabaseAdminFetch(env, "/rest/v1/affiliate_payout_country_methods?active=eq.true&select=country_code,method_type,currency,network&order=country_code.asc,method_type.asc,currency.asc,network.asc"),
    supabaseAdminFetch(env, "/rest/v1/affiliate_payout_methods?affiliate_id=eq." + id + "&is_active=eq.true&select=id,country_code,method_type,currency,network,destination_preview,destination_last4,wallet_address_last4,memo_tag_ciphertext,created_at,updated_at&order=updated_at.desc&limit=1"),
    supabaseAdminFetch(env, "/rest/v1/affiliate_payout_requests?affiliate_id=eq." + id + "&select=id,requested_amount,currency,status,available_balance_snapshot,country_code,method_type,method_currency,network,destination_preview,destination_last4,wallet_address_last4,memo_tag_ciphertext,user_message,created_at,reviewed_at,paid_at,payment_reference&order=created_at.desc&limit=50"),
  ]);
  if (!optionsResponse.ok || !countryResponse.ok || !methodResponse.ok || !requestsResponse.ok) throw new Error("Could not load your payout settings.");
  const [options, countryRows, methods, requests] = await Promise.all([optionsResponse.json(), countryResponse.json(), methodResponse.json(), requestsResponse.json()]);
  const countryCodes = new Map();
  for (const row of Array.isArray(countryRows) ? countryRows : []) { const key = payoutOptionKey(row); const current = countryCodes.get(key) || []; if (row.country_code && !current.includes(row.country_code)) current.push(row.country_code); countryCodes.set(key, current); }
  return {
    method: payoutMethodView(Array.isArray(methods) ? methods[0] : null),
    options: (Array.isArray(options) ? options : []).map((row) => payoutOptionView(row, countryCodes.get(payoutOptionKey(row)) || [])).filter(Boolean),
    requests: (Array.isArray(requests) ? requests : []).map(payoutRequestView).filter(Boolean),
  };
}
function payoutValidationError(message) { return /already pending|Add a crypto payout method|minimum payout|available balance|Only crypto transfer payouts are supported|Unsupported cryptocurrency|Unsupported payout method|not configured for this country|wallet address|Memo or tag|Payout method data|Affiliate account was not found|already closed|Invalid payout status|status transition|payment reference|manual payment|allowed payout status|valid two-letter country/i.test(String(message || "")); }
function payoutConfigError(message) { return /Payout encryption is not configured/i.test(String(message || "")); }
async function adminPayoutRequestView(env, row) {
  const view = payoutRequestView(row);
  if (!view) return null;
  let walletAddress = "";
  let memoTag = "";
  let walletAddressStatus = view.methodType === "crypto_transfer" ? "missing" : "unavailable";
  let memoTagStatus = "none";
  const isSyntheticQa = /\bSYNTHETIC QA ONLY\b/i.test(String(row.request_note || ""));
  try {
    if (view.methodType === "crypto_transfer" && row.wallet_address_ciphertext) {
      walletAddress = await decryptPayoutSecret(env, row.wallet_address_ciphertext);
      walletAddressStatus = "decrypted";
    } else if (isSyntheticQa) {
      walletAddressStatus = "synthetic_placeholder";
    }
    if (row.memo_tag_ciphertext) {
      memoTag = await decryptPayoutSecret(env, row.memo_tag_ciphertext);
      memoTagStatus = "decrypted";
    }
  } catch {
    walletAddressStatus = isSyntheticQa ? "synthetic_placeholder" : "unavailable";
    if (row.memo_tag_ciphertext) memoTagStatus = "unavailable";
  }
  return {
    ...view,
    affiliateId: row.affiliate_id,
    affiliateName: row.affiliate_name || "Affiliate",
    affiliateEmail: row.affiliate_email || null,
    payoutMethodId: row.payout_method_id,
    requestNote: row.request_note || "",
    adminNotes: row.admin_notes || null,
    reviewerId: row.reviewer_id || null,
    paidBy: row.paid_by || null,
    walletAddress,
    walletAddressStatus,
    memoTag,
    memoTagStatus,
    isSyntheticQa,
  };
}
async function requirePayoutAdmin(request, env) { const user = await verifyUser(request, env); const configuredId = uuidPath(env.PAYOUT_ADMIN_USER_ID || env.ADMIN_USER_ID); if (!configuredId || configuredId !== user.id) throw new Error("Not allowed"); return user; }
async function handleAdminPayoutEndpoint(request, env) {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const adminCollectionPath = "/api/admin/payout-requests";
  const isAdminRequestPath = pathname.startsWith(`${adminCollectionPath}/`);
  const adminRequestId = payoutRequestPathId(pathname, adminCollectionPath);
  if (pathname !== adminCollectionPath && !isAdminRequestPath) return null;
  try {
    const reviewer = await requirePayoutAdmin(request, env);
    if (isAdminRequestPath && !adminRequestId) return json({ error: "That payout request identifier is not valid." }, 400, request, env);
    if (pathname === adminCollectionPath && request.method !== "GET") return json({ error: "Method not allowed" }, 405, request, env);
    if (adminRequestId && request.method !== "PATCH") return json({ error: "Method not allowed" }, 405, request, env);
    if (pathname === "/api/admin/payout-requests" && request.method === "GET") {
      const status = payoutText(url.searchParams.get("status"), 32).toLowerCase();
      const search = payoutText(url.searchParams.get("search"), 120);
      const raw = await callPayoutRpc(env, "list_affiliate_payout_requests_admin", { p_status: status, p_search: search });
      const payload = Array.isArray(raw) ? raw[0] : raw;
      const rows = Array.isArray(payload?.requests) ? payload.requests : [];
      return json({ summary: payload?.summary || { pendingCount: 0, pendingAmount: 0, paidCount: 0, paidAmount: 0 }, requests: (await Promise.all(rows.map((row) => adminPayoutRequestView(env, row)))).filter(Boolean) }, 200, request, env);
    }
    if (adminRequestId && request.method === "PATCH") {
      const body = await request.json().catch(() => ({}));
      const status = payoutText(body.status, 32).toLowerCase();
      if (!["approved", "paid", "rejected", "cancelled"].includes(status)) return json({ error: "Choose an allowed payout status." }, 400, request, env);
      const adminNotes = payoutText(body.adminNotes, 2000);
      const userMessage = payoutText(body.userMessage, 500);
      const paymentReference = payoutText(body.paymentReference, 200);
      if (status === "rejected" && !adminNotes) return json({ error: "A rejection reason is required." }, 400, request, env);
      if (status === "paid" && (!paymentReference || body.confirmManualPayment !== true)) return json({ error: !paymentReference ? "A payment reference is required before marking a request paid." : "Confirm the manual payment before marking as paid." }, 400, request, env);
      const raw = await callPayoutRpc(env, "update_affiliate_payout_request_status", { p_request_id: adminRequestId, p_status: status, p_reviewer_id: reviewer.id, p_admin_notes: adminNotes || null, p_user_message: userMessage || null, p_payment_reference: paymentReference || null });
      const result = Array.isArray(raw) ? raw[0] : raw;
      return json(result || {}, 200, request, env);
    }
    return json({ error: "Method not allowed" }, 405, request, env);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not complete that admin action.";
    const status = /Authentication|required|session/i.test(message) ? 401 : /Not allowed/i.test(message) ? 403 : payoutConfigError(message) ? 503 : payoutValidationError(message) ? 400 : 500;
    return json({ error: message }, status, request, env);
  }
}
function actionView(row) { const completed = row?.status === "completed" || Boolean(row?.completed); return { id: row?.id, userId: row?.user_id, mealId: row?.meal_id || null, title: row?.title || "", description: row?.description || "", completed, status: completed ? "completed" : row?.status === "missed" ? "missed" : "upcoming", dueAt: row?.due_at || null, createdAt: row?.created_at, completedAt: row?.completed_at || null }; }
function emptyAnalyticsEntitlements() { return { performanceHeatmap: { buckets: [] }, optimalBlueprint: { top: { proteinG: null, carbsG: null, fatG: null, fiberG: null, sampleCount: 0 }, bottom: { proteinG: null, carbsG: null, fatG: null, fiberG: null, sampleCount: 0 }, sampleCount: 0 }, intervalPenalty: { longGap: { averageScore: null, mealCount: 0 }, shortGap: { averageScore: null, mealCount: 0 } }, nutrientVolatility: { series: [], latest: { scoreStddev: null, proteinStddev: null } } }; }
function restrictAnalyticsEntitlements(raw, plan, status) { const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}; const empty = emptyAnalyticsEntitlements(); const activePaid = status === "active" && (plan === "pro" || plan === "premium"); const activePremium = activePaid && plan === "premium"; return { ...source, performanceHeatmap: activePaid ? source.performanceHeatmap || empty.performanceHeatmap : empty.performanceHeatmap, optimalBlueprint: activePremium ? source.optimalBlueprint || empty.optimalBlueprint : empty.optimalBlueprint, intervalPenalty: activePremium ? source.intervalPenalty || empty.intervalPenalty : empty.intervalPenalty, nutrientVolatility: activePremium ? source.nutrientVolatility || empty.nutrientVolatility : empty.nutrientVolatility }; }
async function handleUserEndpoint(request, env) {
  const pathname = new URL(request.url).pathname;
  const actionMatch = pathname.match(/^\/api\/user\/actions\/([^/]+)$/);
  const isUserEndpoint = pathname === "/api/user/ensure-records" || pathname === "/api/user/referral/attribute" || pathname === "/api/user/actions" || pathname === "/api/user/referral-code" || pathname === "/api/user/referral-summary" || pathname === "/api/user/analytics" || pathname === "/api/user/payouts" || pathname === "/api/user/payout-method" || pathname === "/api/user/payout-request" || Boolean(actionMatch);
  if (!isUserEndpoint) return null;
  try {
    if (pathname === "/api/user/ensure-records" && request.method === "POST") {
      const user = await verifyUser(request, env);
      const body = await request.json().catch(() => ({}));
      const name = typeof body?.name === "string" ? body.name.trim().slice(0, 120) : "";
      await callUserRpc(env, "ensure_user_records", { p_user_id: user.id, p_name: name });
      return json({ ok: true }, 200, request, env);
    }
    if (pathname === "/api/user/referral/attribute" && request.method === "POST") {
      const user = await verifyUser(request, env);
      const body = await request.json().catch(() => ({}));
      const code = typeof body?.code === "string" ? body.code.trim().slice(0, 32) : "";
      if (code && !/^[A-Z0-9_-]{4,32}$/i.test(code)) return json({ error: "That referral code is not valid." }, 400, request, env);
      const raw = code ? await callUserRpc(env, "attribute_referral", { p_user_id: user.id, p_code: code }) : false;
      return json({ attributed: Boolean(Array.isArray(raw) ? raw[0] : raw) }, 200, request, env);
    }
    if (pathname === "/api/user/actions" && request.method === "GET") {
      const user = await verifyUser(request, env);
      await markOverdueTasksBestEffort(env, user.id);
      const rows = await listUserRows(env, "actions", user.id, "id,user_id,meal_id,title,description,completed,status,due_at,created_at,completed_at", "&order=status.asc,due_at.asc.nullslast&limit=100");
      return json((Array.isArray(rows) ? rows : []).map(actionView), 200, request, env);
    }
    if (actionMatch && request.method === "PATCH") {
      const actionId = uuidPath(decodeURIComponent(actionMatch[1]));
      if (!actionId) return json({ error: "That task identifier is not valid." }, 400, request, env);
      const user = await verifyUser(request, env);
      const body = await request.json().catch(() => ({}));
      if (typeof body?.completed !== "boolean") return json({ error: "Task completion must be true or false." }, 400, request, env);
      const ownershipResponse = await supabaseAdminFetch(env, "/rest/v1/actions?id=eq." + encodeURIComponent(actionId) + "&user_id=eq." + encodeURIComponent(user.id) + "&select=id&limit=1");
      if (!ownershipResponse.ok) throw new Error("Could not verify that task.");
      const ownedRows = await ownershipResponse.json();
      if (!Array.isArray(ownedRows) || !ownedRows[0]) return json({ error: "Task not found." }, 404, request, env);
      await callUserRpc(env, "complete_action", { p_action_id: actionId, p_completed: body.completed });
      const response = await supabaseAdminFetch(env, "/rest/v1/actions?id=eq." + encodeURIComponent(actionId) + "&user_id=eq." + encodeURIComponent(user.id) + "&select=id,user_id,meal_id,title,description,completed,status,due_at,created_at,completed_at&limit=1");
      if (!response.ok) throw new Error("Could not reload that task.");
      const rows = await response.json();
      if (!Array.isArray(rows) || !rows[0]) return json({ error: "Task not found." }, 404, request, env);
      return json(actionView(rows[0]), 200, request, env);
    }
    if (pathname === "/api/user/referral-code" && request.method === "GET") {
      const user = await verifyUser(request, env);
      const raw = await callUserRpc(env, "ensure_referral_code", { p_user_id: user.id });
      const code = Array.isArray(raw) ? raw[0] : raw;
      if (!code) throw new Error("Could not create your referral link.");
      return json({ code: String(code) }, 200, request, env);
    }
    if (pathname === "/api/user/referral-summary" && request.method === "GET") {
      const user = await verifyUser(request, env);
      const raw = await callUserRpc(env, "get_referral_summary", { p_user_id: user.id });
      return json(Array.isArray(raw) ? raw[0] || {} : raw || {}, 200, request, env);
    }
    if (pathname === "/api/user/analytics" && request.method === "GET") {
      const user = await verifyUser(request, env);
      const subscriptionResponse = await supabaseAdminFetch(env, `/rest/v1/subscriptions?user_id=eq.${encodeURIComponent(user.id)}&select=plan,status&limit=1`);
      if (!subscriptionResponse.ok) throw new Error("Could not load your subscription for analytics.");
      const subscriptionRows = await subscriptionResponse.json();
      const subscriptionRow = Array.isArray(subscriptionRows) ? subscriptionRows[0] : null;
      const plan = subscriptionRow?.plan === "premium" ? "premium" : subscriptionRow?.plan === "pro" ? "pro" : "free";
      const status = typeof subscriptionRow?.status === "string" ? subscriptionRow.status : "unavailable";
      const raw = await callUserRpc(env, "get_user_analytics", { p_user_id: user.id });
      return json(restrictAnalyticsEntitlements(Array.isArray(raw) ? raw[0] || {} : raw || {}, plan, status), 200, request, env);
    }
    if (pathname === "/api/user/payouts" && request.method === "GET") {
      const user = await verifyUser(request, env);
      return json(await listAffiliatePayouts(env, user.id), 200, request, env);
    }
    if (pathname === "/api/user/payout-method" && request.method === "POST") {
      const user = await verifyUser(request, env);
      const body = await request.json().catch(() => ({}));
      const countryCode = payoutText(body.countryCode, 8).toUpperCase();
      const methodType = payoutText(body.methodType, 32).toLowerCase();
      const currency = payoutText(body.currency, 12).toUpperCase();
      const network = payoutText(body.network, 24).toUpperCase();
      if (!/^[A-Z]{2}$/.test(countryCode)) throw new Error("Enter a valid two-letter country code.");
      if (methodType !== "crypto_transfer") throw new Error("Only crypto transfer payouts are supported.");
      const walletAddress = validatePayoutWallet(body.walletAddress);
      const memoTag = validatePayoutMemo(body.memoTag);
      const walletCiphertext = await encryptPayoutSecret(env, walletAddress);
      const destinationLast4 = walletAddress.slice(-4).toUpperCase();
      const memoCiphertext = memoTag ? await encryptPayoutSecret(env, memoTag) : null;
      const raw = await callPayoutRpc(env, "save_affiliate_payout_method", { p_affiliate_id: user.id, p_country_code: countryCode, p_method_type: "crypto_transfer", p_currency: currency, p_network: network, p_wallet_address_ciphertext: walletCiphertext, p_wallet_address_last4: destinationLast4, p_memo_tag_ciphertext: memoCiphertext });
      const result = Array.isArray(raw) ? raw[0] : raw;
      return json(payoutMethodView({ id: result?.id, country_code: result?.countryCode, method_type: result?.methodType, currency: result?.currency, network: result?.network, destination_preview: result?.destinationPreview, destination_last4: result?.destinationLast4, hasMemoTag: result?.hasMemoTag, created_at: result?.createdAt, updated_at: result?.updatedAt }), 200, request, env);
    }
    if (pathname === "/api/user/payout-method" && request.method === "DELETE") {
      const user = await verifyUser(request, env);
      const raw = await callPayoutRpc(env, "remove_affiliate_payout_method", { p_affiliate_id: user.id });
      return json(Array.isArray(raw) ? raw[0] || {} : raw || {}, 200, request, env);
    }
    if (pathname === "/api/user/payout-request" && request.method === "POST") {
      const user = await verifyUser(request, env);
      const body = await request.json().catch(() => ({}));
      const amount = payoutAmount(body.requestedAmount);
      const requestNote = payoutText(body.requestNote, 500);
      const raw = await callPayoutRpc(env, "create_affiliate_payout_request", { p_affiliate_id: user.id, p_requested_amount: amount, p_request_note: requestNote });
      const row = Array.isArray(raw) ? raw[0] : raw;
      if (!row?.id) throw new Error("Could not create the payout request.");
      return json(payoutRequestView(row), 201, request, env);
    }
    return json({ error: "Method not allowed" }, 405, request, env);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not complete that request.";
    const status = /Authentication|required|session/i.test(message) ? 401 : payoutConfigError(message) ? 503 : payoutValidationError(message) ? 400 : 500;
    return json({ error: message }, status, request, env);
  }
}
function allowedOrigin(request, env) { const origin = String(request.headers.get("origin") || "").trim(); if (!origin) return null; const configured = String(env.FRONTEND_ORIGIN || "https://neulifi.online").trim().replace(/\/$/, ""); const allowed = new Set([...DEFAULT_ALLOWED_ORIGINS, configured]); if (String(env.ALLOW_LOCAL_ORIGINS || "false").toLowerCase() === "true") for (const local of LOCAL_ALLOWED_ORIGINS) allowed.add(local); return allowed.has(origin) ? origin : null; }
function securityHeaders(headers, request) { headers.set("x-content-type-options", "nosniff"); headers.set("referrer-policy", "strict-origin-when-cross-origin"); headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()"); headers.set("x-frame-options", "DENY"); headers.set("content-security-policy", "frame-ancestors 'none'; base-uri 'self'; object-src 'none'"); if (new URL(request.url).protocol === "https:") headers.set("strict-transport-security", "max-age=31536000; includeSubDomains"); return headers; }
function json(body, status, request, env) { const headers = new Headers({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "access-control-allow-headers": "authorization, content-type", "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS" }); const origin = allowedOrigin(request, env); if (origin) { headers.set("access-control-allow-origin", origin); headers.set("vary", "Origin"); } return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: securityHeaders(headers, request) }); }
const PUBLIC_SEO = { "/": { title: "Neulifi — AI Meal & Nutrition Scanner", description: "Neulifi helps you understand your meals, make practical next choices, and notice food, movement, and lifestyle patterns over time.", canonical: "https://neulifi.online/" }, "/how-it-works": { title: "How Neulifi Works — AI Meal & Nutrition Insights", description: "See how Neulifi turns a meal photo into useful observations and practical next steps, then helps you track patterns over time.", canonical: "https://neulifi.online/how-it-works" }, "/plans": { title: "Neulifi Plans — Free, Pro & Premium", description: "Explore Neulifi’s Free, Pro and Premium plans and see what each plan includes.", canonical: "https://neulifi.online/plans" }, "/privacy": { title: "Privacy Policy — Neulifi", description: "Learn how Neulifi handles account information, meal photos, health context, and service usage.", canonical: "https://neulifi.online/privacy" }, "/terms": { title: "Terms & Conditions — Neulifi", description: "Read the terms for using Neulifi’s nutrition and lifestyle companion, including AI limitations and account responsibilities.", canonical: "https://neulifi.online/terms" }, "/refund-policy": { title: "Refund Policy — Neulifi", description: "Review Neulifi’s refund, cancellation, renewal, and payment-issue request process for future paid plans.", canonical: "https://neulifi.online/refund-policy" } };
function assetContentType(pathname, fallback) { if (pathname === "/" || pathname === "/checkout" || pathname.endsWith(".html")) return "text/html; charset=utf-8"; if (pathname.endsWith(".js")) return "application/javascript; charset=utf-8"; if (pathname.endsWith(".css")) return "text/css; charset=utf-8"; if (pathname.endsWith(".txt")) return "text/plain; charset=utf-8"; if (pathname.endsWith(".xml")) return "application/xml; charset=utf-8"; if (pathname.endsWith(".svg")) return "image/svg+xml; charset=utf-8"; if (pathname.endsWith(".webmanifest") || pathname.endsWith(".json")) return "application/manifest+json; charset=utf-8"; return fallback || "application/octet-stream"; }
function seoEscape(value) { return String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function renderPrivateSeo(html, title = "Neulifi — Private space") { return html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${title}</title>`).replace(/<meta name="robots"[^>]*>/i, `<meta name="robots" content="noindex, nofollow">`).replace(/<link rel="canonical"[^>]*>\s*/i, "").replace(/<meta property="og:url"[^>]*>\s*/i, "").replace(/<meta property="og:title"[^>]*>\s*/i, "").replace(/<meta property="og:description"[^>]*>\s*/i, "").replace(/<meta name="twitter:title"[^>]*>\s*/i, "").replace(/<meta name="twitter:description"[^>]*>\s*/i, "").replace(/<script type="application\/ld\+json"[^>]*>[\s\S]*?<\/script>\s*/i, ""); }
function renderPublicSeo(html, definition) { const title = seoEscape(definition.title); const description = seoEscape(definition.description); const canonical = seoEscape(definition.canonical); return html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${title}</title>`).replace(/<meta name="description"[^>]*>/i, `<meta name="description" content="${description}">`).replace(/<meta name="robots"[^>]*>/i, `<meta name="robots" content="index, follow">`).replace(/<link rel="canonical"[^>]*>/i, `<link rel="canonical" href="${canonical}">`).replace(/<meta property="og:url"[^>]*>/i, `<meta property="og:url" content="${canonical}">`).replace(/<meta property="og:title"[^>]*>/i, `<meta property="og:title" content="${title}">`).replace(/<meta property="og:description"[^>]*>/i, `<meta property="og:description" content="${description}">`).replace(/<meta name="twitter:title"[^>]*>/i, `<meta name="twitter:title" content="${title}">`).replace(/<meta name="twitter:description"[^>]*>/i, `<meta name="twitter:description" content="${description}">`); }
async function serveAsset(request, env) { const requestedUrl = new URL(request.url); let response = await env.ASSETS.fetch(request); let servedPath = requestedUrl.pathname; if (response.status === 404 && (request.method === "GET" || request.method === "HEAD") && (request.headers.get("accept") || "").includes("text/html")) { const fallbackUrl = new URL("/", request.url); response = await env.ASSETS.fetch(new Request(fallbackUrl, request)); servedPath = fallbackUrl.pathname; } const headers = new Headers(response.headers); headers.set("content-type", assetContentType(servedPath, headers.get("content-type"))); headers.set("cache-control", /\.(?:js|css|png|jpg|jpeg|webp|svg|woff2?)$/i.test(servedPath) ? "public, max-age=31536000, immutable" : "no-cache"); securityHeaders(headers, request); const definition = PUBLIC_SEO[requestedUrl.pathname]; const privateRoute = /^\/(?:app|login|signup|checkout|auth\/confirm|adminneu)(?:\/|$)/.test(requestedUrl.pathname); if (request.method === "GET" && response.ok && headers.get("content-type")?.includes("text/html")) { const html = await response.text(); const body = definition ? renderPublicSeo(html, definition) : privateRoute ? renderPrivateSeo(html, requestedUrl.pathname === "/adminneu" ? "Neulifi — Private payout review" : undefined) : html; if (privateRoute) headers.set("x-robots-tag", "noindex, nofollow"); headers.delete("content-length"); headers.delete("etag"); return new Response(body, { status: response.status, statusText: response.statusText, headers }); } if (privateRoute) headers.set("x-robots-tag", "noindex, nofollow"); return new Response(response.body, { status: response.status, statusText: response.statusText, headers }); }
function redirectLegacyPublicHost(request) { const incoming = new URL(request.url); const isObsoleteWorkersHost = incoming.hostname === "nuelifi.chenithanimnadaj.workers.dev"; if (!isObsoleteWorkersHost) return null; if (request.method !== "GET" && request.method !== "HEAD") return new Response("Not Found", { status: 404 }); const target = new URL("https://neulifi.online/"); const authKeys = ["code", "token_hash", "error", "error_code", "error_description", "type", "access_token", "refresh_token", "expires_in", "token_type"]; const hasAuthCallback = authKeys.some((key) => incoming.searchParams.has(key)); if (hasAuthCallback && ["/", "/app", "/welcome", "/login", "/signup"].includes(incoming.pathname)) target.pathname = incoming.pathname; for (const key of authKeys) { const value = incoming.searchParams.get(key); if (value) target.searchParams.set(key, value); } const referral = incoming.searchParams.get("ref"); if (!hasAuthCallback && referral && /^[A-Z0-9_-]{4,32}$/i.test(referral)) target.searchParams.set("ref", referral.toUpperCase()); return Response.redirect(target.toString(), 308); }

export default { async fetch(request, env) { const url = new URL(request.url); const legacyRedirect = redirectLegacyPublicHost(request); if (legacyRedirect) return legacyRedirect; if (request.method === "OPTIONS") return json({}, 204, request, env); if (url.pathname === "/admin") { const headers = securityHeaders(new Headers({ "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" }), request); return new Response("Not Found", { status: 404, headers }); } if (url.pathname === "/health") return json({ status: "ok", service: "neulifi-cloudflare" }, 200, request, env);   if (url.pathname === "/api/auth/me") {
    if (request.method !== "GET") return json({ error: "Method not allowed" }, 405, request, env);
    try {
      const verifiedUser = await verifyUser(request, env);
      return json({ id: verifiedUser.id, email: verifiedUser.email || "" }, 200, request, env);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Authentication required";
      const status = /Authentication|required|session/i.test(message) ? 401 : /configured/i.test(message) ? 503 : 500;
      return json({ error: message }, status, request, env);
    }
  }
  if (url.pathname.startsWith("/api/users/") && url.pathname.endsWith("/subscription")) {
    if (request.method !== "GET") return json({ error: "Method not allowed" }, 405, request, env);
    try {
      const verifiedUser = await requireRouteUser(request, env, url.pathname, "/api/users");
      const response = await supabaseAdminFetch(env, `/rest/v1/subscriptions?user_id=eq.${encodeURIComponent(verifiedUser.id)}&select=plan,status&limit=1`);
      if (!response.ok) throw new Error("Could not load your subscription.");
      const rows = await response.json();
      const row = Array.isArray(rows) ? rows[0] : null;
      const plan = row?.plan === "premium" ? "premium" : row?.plan === "pro" ? "pro" : "free";
      return json({ plan, status: row?.status || "unavailable" }, 200, request, env);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not load your subscription.";
      const status = /Authentication|required|session/i.test(message) ? 401 : /Not allowed/i.test(message) ? 403 : 500;
      return json({ error: message }, status, request, env);
    }
  }
  if (url.pathname.startsWith("/api/user/")) { const userResponse = await handleUserEndpoint(request, env); if (userResponse) return userResponse; } if (url.pathname.startsWith("/api/admin/payout-requests")) { const adminResponse = await handleAdminPayoutEndpoint(request, env); if (adminResponse) return adminResponse; } if (url.pathname === "/api/paddle/config" && request.method === "GET") { try { return await handlePaddleConfig(request, env); } catch (error) { return json({ error: error instanceof Error ? error.message : "Paddle is not configured." }, 503, request, env); } } if (url.pathname === "/api/paddle/webhook" && request.method === "POST") return handlePaddleWebhook(request, env); if (url.pathname === "/api/paddle/customer-portal" && request.method === "POST") { try { const verifiedUser = await verifyUser(request, env); return json(await createPaddleCustomerPortalSession(env, verifiedUser.id), 200, request, env); } catch (error) { const message = error instanceof Error ? error.message : "Could not open billing management."; const status = /Authentication|required|session/i.test(message) ? 401 : /No active billing account/i.test(message) ? 404 : /not configured|could not open billing management/i.test(message) ? 503 : 500; return json({ error: message }, status, request, env); } } if (url.pathname === "/api/paddle/claim-pending-purchase" && request.method === "POST") {
    let verifiedUser;
    try { verifiedUser = await verifyUser(request, env); } catch (error) { const message = error instanceof Error ? error.message : "Authentication required"; return json({ error: message }, 401, request, env); }
    try { const response = await supabaseAdminFetch(env, "/rest/v1/rpc/claim_paddle_pending_purchases", { method: "POST", body: JSON.stringify({ p_user_id: verifiedUser.id }) }); if (!response.ok) throw new Error("Could not link your verified purchase."); const raw = await response.json(); const result = Array.isArray(raw) ? raw[0] || {} : raw || {}; const claimed = Math.max(0, Number(result.claimed || 0)); const plan = result.plan === "premium" ? "premium" : result.plan === "pro" ? "pro" : null; if (claimed > 0 && plan) { const subscriptionResponse = await supabaseAdminFetch(env, `/rest/v1/subscriptions?user_id=eq.${encodeURIComponent(verifiedUser.id)}&select=provider_subscription_id&limit=1`); if (subscriptionResponse.ok) { const subscriptions = await subscriptionResponse.json(); const subscriptionId = String(Array.isArray(subscriptions) ? subscriptions[0]?.provider_subscription_id || "" : "").trim(); if (/^sub_[a-z\d]{26}$/.test(subscriptionId)) await supabaseAdminFetch(env, "/rest/v1/rpc/record_paid_referral_reward", { method: "POST", body: JSON.stringify({ p_referred_user_id: verifiedUser.id, p_subscription_key: `paddle:${subscriptionId}`, p_plan: plan }) }).catch(() => undefined); } } return json({ claimed, plan }, 200, request, env); } catch (error) { const message = error instanceof Error ? error.message : "Could not link your verified purchase."; return json({ error: message }, 500, request, env); }
  } if (url.pathname === "/api/persist-meal" && request.method === "POST") { try { const verifiedUser = await verifyUser(request, env); return json(await persistMealAnalysis(request, env, verifiedUser.id), 200, request, env); } catch (error) { const message = error instanceof Error ? error.message : "Could not save meal"; return json({ error: message }, /Authentication|required|session/i.test(message) ? 401 : 400, request, env); } } if (url.pathname === "/api/usage" && request.method === "GET") { try { const verifiedUser = await verifyUser(request, env); return json(await currentAiUsage(request, env, verifiedUser.id), 200, request, env); } catch (error) { const message = error instanceof Error ? error.message : "Could not load AI usage"; return json({ error: message }, /Authentication|required|session/i.test(message) ? 401 : 500, request, env); } } if (url.pathname === "/api/analyze" && request.method === "POST") { let reservedUserId = ""; let lockKey = ""; try { const verifiedUser = await verifyUser(request, env); const body = await request.json().catch(() => { throw new GeminiError("Analysis request is not valid JSON.", "invalid_request", 400); }); const input = validateAnalysisRequest(body); lockKey = `${verifiedUser.id}:${input.eventKey}`; if (lockKey && geminiInFlight.has(lockKey)) throw new GeminiError("This analysis is already being processed. Please wait a moment.", "duplicate", 409); if (lockKey) geminiInFlight.add(lockKey); const usage = await reserveAiUsage(request, env, verifiedUser.id); reservedUserId = verifiedUser.id; let analysis; let provider = ""; const providerErrors = []; try { const result = await analyzeGemini(env, input.imageUrls, input.mealName, input.context, usage.analysis_level || input.analysisLevel); analysis = result.analysis; provider = "gemini"; } catch (error) { const failure = error instanceof GeminiError ? error : new GeminiError("Gemini is temporarily unavailable.", "transient"); if (failure.kind === "invalid_request" || failure.kind === "duplicate") throw failure; providerErrors.push(failure.kind); } if (!analysis) { console.error("meal_analysis_provider_failure", JSON.stringify({ kinds: [...new Set(providerErrors)], providers: { gemini: Boolean(geminiProviders(env).length) } })); await releaseAiUsage(request, env, reservedUserId).catch(() => undefined); reservedUserId = ""; const unavailableKind = providerErrors.includes("configuration") ? "configuration" : providerErrors.includes("invalid_key") ? "invalid_key" : providerErrors.includes("quota") ? "quota" : "transient"; throw new GeminiError("Meal analysis is temporarily unavailable. Please try again shortly.", unavailableKind, unavailableKind === "quota" ? 429 : 503); } return json({ id: `cloudflare-meal-${Date.now()}`, userId: "", imageUrl: input.imageUrls[0], imageUrls: input.imageUrls, mealName: input.mealName, capturedAt: new Date().toISOString(), status: "analysed", provider, analysis }, 200, request, env); } catch (error) { if (reservedUserId) await releaseAiUsage(request, env, reservedUserId).catch(() => undefined); const failure = error instanceof GeminiError ? error : null; const authFailure = error instanceof Error && /^(Authentication required|Your session is not valid)/i.test(error.message); const message = authFailure ? "Please sign in again to analyse a meal." : failure?.kind === "duplicate" ? failure.message : failure?.kind === "invalid_request" ? failure.message : failure?.kind === "quota" ? "You’ve reached your daily meal analysis limit. It resets at midnight; upgrade for more scans." : failure?.kind === "configuration" ? "The meal scanner is still being configured. Please try again later." : failure?.kind === "invalid_key" ? "The meal scanner is temporarily unavailable. Please try again later." : "Meal analysis could not be completed. Please try again shortly."; const status = authFailure ? 401 : failure?.kind === "duplicate" ? 409 : failure?.status === 413 ? 413 : failure?.kind === "invalid_request" ? 400 : /today.?s meal analysis limit|daily meal analysis limit/i.test(error instanceof Error ? error.message : "") ? 429 : 503; return json({ error: message }, status, request, env); } finally { if (lockKey) geminiInFlight.delete(lockKey); } } if (env.ASSETS) return serveAsset(request, env); return new Response("Neulifi", { status: 200, headers: { "content-type": "text/plain" } }); } };
