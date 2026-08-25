import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [supabase, recovery, authConfirm, authScreen, authErrors, productScreens, admin, worker, paddle, paddlePricing, app, mealFlow, robots, supabaseData, notifications, manifest, logo, indexHtml, freeAds, sitemap] = await Promise.all([
  read("src/lib/supabase.ts"),
  read("src/lib/authRecovery.ts"),
  read("src/components/AuthConfirm.tsx"),
  read("src/components/AuthScreen.tsx"),
  read("src/lib/authErrors.ts"),
  read("src/components/ProductScreens.tsx"),
  read("src/components/AdminPayoutDashboard.tsx"),
  read("cloudflare/worker.mjs"),
  read("src/lib/paddle.ts"),
  read("src/components/PaddlePricing.tsx"),
  read("src/App.tsx"),
  read("src/components/MealFlow.tsx"),
  read("public/robots.txt"),
  read("src/lib/supabaseData.ts"),
  read("src/lib/notifications.ts"),
  read("public/manifest-v2.webmanifest"),
  read("public/neulifi-logo-v2.svg"),
  read("index.html"),
  read("src/components/FreeAds.tsx"),
  read("public/sitemap.xml"),
]);

const typescript = await import("typescript");
const authErrorsModule = await import(`data:text/javascript;base64,${Buffer.from(typescript.transpileModule(authErrors, { compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ES2022 } }).outputText).toString("base64")}`);

test("ordinary auth remains PKCE while password-reset requests use the recovery client", () => {
  assert.match(supabase, /flowType: "pkce"/);
  assert.match(supabase, /recoverySupabase/);
  assert.match(supabase, /storageKey: "neulifi-recovery-auth"/);
  assert.match(supabase, /flowType: "implicit"/);
  assert.match(authScreen, /recoverySupabase\.auth\.resetPasswordForEmail/);
  assert.doesNotMatch(authScreen, /supabase\.auth\.resetPasswordForEmail/);
});

test("recovery callback establishes a session for each supported payload shape", () => {
  assert.match(authConfirm, /client\.auth\.setSession\(\{ access_token: accessToken, refresh_token: refreshToken \}\)/);
  assert.match(authConfirm, /client\.auth\.exchangeCodeForSession\(code\)/);
  assert.match(authConfirm, /client\.auth\.verifyOtp\(\{ token_hash: tokenHash, type \}\)/);
  assert.match(authConfirm, /markPasswordRecoveryContext\(\)/);
  assert.match(authConfirm, /useLayoutEffect/);
  assert.match(authConfirm, /clearCallbackUrl/);
  assert.match(authScreen, /getHealthySession\(\)\.catch/);
  assert.match(authScreen, /hasPasswordRecoveryContext\(\)/);
});

test("recovery update validates confirmation and clears the context after success", () => {
  assert.match(authScreen, /password !== confirmPassword/);
  assert.match(authScreen, /supabase\.auth\.updateUser\(\{ password \}\)/);
  assert.match(authScreen, /clearPasswordRecoveryContext\(\)/);
  assert.match(recovery, /PASSWORD_RECOVERY_CONTEXT_KEY/);
});

test("provider rate limits become safe, actionable messages", () => {
  const { friendlyAuthError } = authErrorsModule;
  assert.match(authScreen, /friendlyAuthError/);
  assert.match(authErrors, /wait a few minutes/);
  assert.match(friendlyAuthError(new Error("over_email_send_rate_limit"), "fallback"), /wait a few minutes/);
  assert.match(friendlyAuthError(new Error("Auth session missing!"), "fallback"), /recovery session is no longer active/);
  assert.equal(friendlyAuthError(new Error("Unexpected end of JSON input"), "fallback"), "fallback");
});

test("successful empty account RPC responses do not leak a JSON parse error", () => {
  assert.match(worker, /async function callUserRpc[\s\S]*?const text = await response\.text\(\); if \(!text\.trim\(\)\) return null;[\s\S]*?JSON\.parse\(text\)/);
  assert.match(worker, /pathname === "\/api\/user\/ensure-records"[\s\S]*?await callUserRpc\(env, "ensure_user_records"/);
});

test("authenticated auth routes use private dashboard metadata", () => {
  assert.match(app, /const authGuardRoute = Boolean\(sessionUser && authMode/);
  assert.match(app, /applySeoMetadata\(publicPage, authGuardRoute \? null : authMode, privateRoute\)/);
  assert.match(app, /\[publicPage, authMode, sessionUser\?\.id\]/);
});

test("admin review uses the private /adminneu path and retires /admin", () => {
  assert.ok(app.includes('window.location.pathname === "/adminneu"'));
  assert.ok(app.includes('window.history.replaceState(null, "", "/adminneu")'));
  assert.ok(!app.includes('window.location.pathname === "/admin"'));
  assert.ok(!app.includes('window.history.replaceState(null, "", "/admin")'));
  assert.ok(worker.includes('if (url.pathname === "/admin")'));
  assert.ok(worker.includes('status: 404'));
});

test("private admin HTML is noindex and excluded from the sitemap", () => {
  assert.match(worker, /function renderPrivateSeo\(html, title = "Neulifi — Private space"\)/);
  assert.ok(worker.includes('requestedUrl.pathname === "/adminneu" ? "Neulifi — Private payout review"'));
  assert.match(worker, /const privateRoute =/);
  assert.ok(worker.includes("adminneu"));
  assert.ok(worker.includes('x-robots-tag", "noindex, nofollow"'));
  assert.match(robots, /Disallow: \/adminneu/);
  assert.doesNotMatch(robots, /Sitemap:.*adminneu/);
});

test("Paddle unavailable states do not expose internal configuration names", () => {
  assert.doesNotMatch(paddle, /Set VITE_PADDLE_ENVIRONMENT|Set VITE_PADDLE_CLIENT_TOKEN/);
  assert.match(paddle, /Paid plan checkout is temporarily unavailable/);
  assert.match(paddlePricing, /price === "Unavailable" \? "button-soft"/);
});

test("payout copy and active surfaces remain crypto-only", () => {
  assert.match(productScreens, /Where should we send your payout\?/);
  assert.match(productScreens, /Payout request saved for Neulifi review/);
  assert.doesNotMatch(productScreens, /\bowner\b/i);
  for (const source of [productScreens, admin]) {
    assert.doesNotMatch(source, /PayPal|Wise|bank transfer|Other payout method|other payout method/i);
    assert.doesNotMatch(source, /\bowner\b/i);
  }
});

test("admin wallet details distinguish decrypted addresses from synthetic QA placeholders", () => {
  assert.match(worker, /walletAddressStatus = "decrypted"/);
  assert.match(worker, /walletAddressStatus = isSyntheticQa \? "synthetic_placeholder" : "unavailable"/);
  assert.match(worker, /isSyntheticQa/);
  assert.match(admin, /selected\.walletAddressStatus === "decrypted"/);
  assert.match(admin, /QA placeholder — no real wallet address stored/);
  assert.match(admin, /Encrypted wallet details could not be opened\./);
});

test("meal recommendations stay bounded and require explicit per-action task adds", () => {
  assert.match(worker, /const DEFAULT_GEMINI_MODELS = \["gemini-3\.5-flash-lite", "gemini-3\.6-flash", "gemini-3\.7-flash", "gemini-3\.5-flash"\]/);
  assert.match(worker, /For dailyTasks only, return 0 to 2 short/);
  assert.match(worker, /dailyTasks: \{ type: "ARRAY", items: \{ type: "STRING" \}, minItems: 0, maxItems: 2 \}/);
  assert.match(worker, /function taskFamily\(value\)/);
  assert.match(worker, /existingActions/);
  assert.match(worker, /return \[\.\.\.new Set\(selected\)\]/);
  assert.match(app, /const addRecommendedTask = async \(actionId: string\)/);
  assert.doesNotMatch(app, /const addRecommendedTasks = async/);
  assert.match(mealFlow, /onAddTask: \(id: string\)/);
  assert.match(mealFlow, /\+ Add to Tasks/);
  assert.match(mealFlow, /Nothing specific is needed right now/);
  assert.match(worker, /short walk after this meal/);
  assert.match(worker, /Do not invent generic tasks for a balanced meal/);
  assert.match(worker, /analysis reference time/);
  assert.match(worker, /scheduled at/);
  assert.match(worker, /function coveredDailyTasks\(items, context = \{\}\)/);
  assert.match(worker, /alreadyOnPlan/);
  assert.match(worker, /alreadyOnPlan: \{ type: "ARRAY", items: \{ type: "STRING" \}, minItems: 0, maxItems: 2 \}/);
  assert.match(worker, /function isNextMealNutritionTask\(text\)/);
  assert.match(worker, /next-meal-nutrition/);
  assert.match(worker, /normalizeExistingPlanSignals/);
  assert.match(supabaseData, /function isNextMealNutritionTask\(text: string\)/);
  assert.match(app, /const completedActions = actions\.filter/);
  assert.match(app, /const capturedAt = new Date\(\)\.toISOString\(\)/);
  assert.match(mealFlow, /Your next best step/);
  assert.match(mealFlow, /Already on your plan/);
  assert.match(mealFlow, /Nothing specific is needed right now/);
  assert.match(mealFlow, /Nothing to fix right now/);
});

test("asset MIME mappings protect install metadata and the transparent logo", () => {
  assert.ok(worker.includes('pathname.endsWith(".svg")) return "image/svg+xml; charset=utf-8"'));
  assert.ok(worker.includes('pathname.endsWith(".webmanifest") || pathname.endsWith(".json")) return "application/manifest+json; charset=utf-8"'));
  assert.match(manifest, /"start_url": "\/app"/);
  assert.match(manifest, /"src": "\/neulifi-logo-v2\.svg"/);
  assert.match(logo, /<svg[\s\S]*fill="#05b866"/);
  assert.match(indexHtml, /manifest-v2\.webmanifest/);
  assert.match(indexHtml, /neulifi-logo-v2\.svg/);
});

test("free-plan ad fallback stays neutral while preserving the real AdSense slot", () => {
  assert.match(freeAds, /script\[src\*="adsbygoogle\.js"\]/);
  assert.match(freeAds, /Sponsored content helps keep the Free plan available\./);
  assert.doesNotMatch(freeAds, /Ads are temporarily unavailable\./);
  assert.match(freeAds, /dataset\.adClient/);
  assert.match(freeAds, /dataset\.adSlot/);
});

test("public sitemap contains only public pages and excludes admin paths", () => {
  assert.match(sitemap, /https:\/\/neulifi\.online\//);
  assert.doesNotMatch(sitemap, /adminneu|\/admin(?:[^a-z]|$)/i);
});

test("notifications remain optional, permission-safe, and deterministic", () => {
  assert.match(app, /Stay on track with Neulifi/);
  assert.match(app, /requestBrowserNotificationPermission/);
  assert.match(app, /notificationDayHistoryKey/);
  assert.match(app, /notificationWeekHistoryKey/);
  assert.match(app, /Not now/);
  assert.match(app, /Browser notifications are blocked/);
  assert.match(app, /does not request permission automatically/);
  assert.match(notifications, /localHour/);
  assert.match(notifications, /sentToday/);
  assert.match(notifications, /sentThisWeek/);
  assert.match(notifications, /status !== "missed"/);
  assert.match(notifications, /category: "action"/);
  assert.match(notifications, /category: "meal"/);
  assert.match(notifications, /category: "weekly"/);
});
