import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [supabase, recovery, authConfirm, authScreen, authErrors, productScreens, admin, worker, paddle, paddlePricing, paddleCheckout, app, mealFlow, robots, supabaseData, notifications, manifest, logo, indexHtml, freeAds, sitemap, api, sw, paymentMigration, welcome, analyticsMigration] = await Promise.all([
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
  read("src/components/PaddleCheckoutLink.tsx"),
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
  read("src/lib/api.ts"),
  read("public/sw.js"),
  read("supabase/migrations/202608260001_reconcile_paddle_entitlements.sql"),
  read("src/components/Welcome.tsx"),
  read("supabase/migrations/202608270002_user_analytics.sql"),
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
  assert.match(authConfirm, /Please log in to continue to onboarding and verify your Premium purchase/);
  assert.match(authConfirm, /Please log in to continue to your private Neulifi space/);
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
  assert.match(friendlyAuthError(new Error("Signups are not allowed for OTP"), "fallback"), /Passwordless sign-up is not enabled right now/);
  assert.match(friendlyAuthError({ code: "otp_disabled" }, "fallback"), /Passwordless sign-up is not enabled right now/);
  assert.match(friendlyAuthError({ code: "signup_disabled" }, "fallback"), /New account creation is currently disabled/);
  assert.equal(friendlyAuthError(new Error("Unexpected end of JSON input"), "fallback"), "fallback");
});

test("field-specific auth errors remain actionable", () => {
  const { friendlyAuthError } = authErrorsModule;
  assert.match(authScreen, /name\.trim\(\)\.length < 2/);
  assert.match(authScreen, /Enter your name before creating your account/);
  assert.match(authScreen, /result\.error\.code === "email_not_confirmed"/);
  assert.match(authErrors, /email_not_confirmed/);
  assert.match(friendlyAuthError({ code: "email_not_confirmed" }, "fallback"), /email is not confirmed/);
  assert.match(friendlyAuthError({ code: "user_already_exists" }, "fallback"), /account already exists/);
});

test("Paddle errors and existing paid accounts have recovery paths", () => {
  assert.match(paddle, /export function friendlyPaddleError/);
  assert.match(paddlePricing, /friendlyPaddleError/);
  assert.match(paddlePricing, /Retry loading prices/);
  assert.match(paddleCheckout, /friendlyPaddleError/);
  assert.match(app, /friendlyPaddleError\(value/);
  assert.match(welcome, /neulifiApi\.subscription\(userId\)/);
  assert.match(welcome, /activeLinkedPlan/);
  assert.match(app, /userId=\{sessionUser\?\.id\}/);
  assert.match(worker, /url\.pathname\.startsWith\("\/api\/users\/"\) && url\.pathname\.endsWith\("\/subscription"\)/);
  assert.match(worker, /requireRouteUser\(request, env, url\.pathname, "\/api\/users"\)/);
  assert.match(worker, /select=plan,status&limit=1/);
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

test("Paddle checkout receives a runtime public token from the Worker", () => {
  assert.match(worker, /async function paddleClientToken/);
  assert.match(worker, /env\.PADDLE_CLIENT_TOKEN/);
  assert.match(worker, /\/client-tokens\?status=active&per_page=200/);
  assert.match(worker, /clientToken/);
  assert.match(paddle, /clientToken: string/);
  assert.match(paddle, /getPaddle\(runtimeConfig\?: PaddleRuntimeConfig\)/);
  assert.match(paddle, /fetchPaddleRuntimeConfig/);
  assert.match(paddlePricing, /fetchPaddleRuntimeConfig/);
  assert.match(paddlePricing, /getPaddle\(config\)/);
  assert.match(paddlePricing, /getPaddle\(runtimeConfig\)/);
  assert.match(paddleCheckout, /fetchPaddleRuntimeConfig/);
  assert.match(paddleCheckout, /getPaddle\(config\)/);
});

test("Paddle webhook status mapping is defined and app-compatible", () => {
  assert.match(worker, /function appSubscriptionStatus\(status\)/);
  assert.match(worker, /\["canceled", "cancelled", "expired"\]/);
  assert.match(worker, /\["past_due", "paused", "payment_failed"\]/);
  assert.match(worker, /function paddleAppStatus\(status\) \{ return appSubscriptionStatus/);
});

test("Paddle entitlements reconcile by exact provider email and run during app bootstrap", () => {
  assert.match(paymentMigration, /create or replace function public\.sync_paddle_customer/);
  assert.match(paymentMigration, /lower\(btrim\(email\)\) = normalized_email/);
  assert.match(paymentMigration, /create or replace function public\.claim_paddle_pending_purchases\(p_user_id uuid\)/);
  assert.match(paymentMigration, /from public\.paddle_customers c/);
  assert.match(paymentMigration, /lower\(btrim\(c\.email\)\) = account_email/);
  assert.match(paymentMigration, /status = 'pending'/);
  assert.match(paymentMigration, /provider_status in \('active', 'trialing'\)/);
  assert.match(worker, /\/api\/paddle\/claim-pending-purchase/);
  assert.match(worker, /async function paddleCustomerData\(env, customerId\)/);
  assert.match(worker, /const providerCustomer = eventEmail \? \{\} : await paddleCustomerData\(env, customerId\)/);
  assert.match(worker, /email = paddleEmail\(await paddleCustomerData\(env, customerId\)\)/);
  assert.match(worker, /function paddleEmail\(event, data = event\?\.data && typeof event\.data === "object" \? event\.data : event && typeof event === "object" \? event/);
  assert.match(app, /await neulifiApi\.claimPendingPurchase\(\)\.catch/);
});

test("SQL-backed analytics uses bounded windows, real persisted indicators, and no AI provider", () => {
  assert.match(analyticsMigration, /create or replace function public\.get_user_analytics\(p_user_id uuid\)/);
  assert.match(analyticsMigration, /avg\(b\.score\) over \([\s\S]*rows between 6 preceding and current row/);
  assert.match(analyticsMigration, /ntile\(10\) over/);
  assert.match(analyticsMigration, /lag\(b\.captured_at\)/);
  assert.match(analyticsMigration, /stddev_samp\(b\.score\)/);
  assert.match(analyticsMigration, /stddev_samp\(b\.protein_g\)/);
  assert.match(analyticsMigration, /between 5 and 10/);
  assert.match(analyticsMigration, /between 11 and 15/);
  assert.match(analyticsMigration, /between 16 and 21/);
  assert.match(analyticsMigration, /'target', jsonb_build_object\('min', 70, 'max', 100\)/);
  assert.match(analyticsMigration, /indicators ->> 'protein'/);
  assert.match(analyticsMigration, /indicators ->> 'carbohydrates'/);
  assert.match(analyticsMigration, /indicators ->> 'fats'/);
  assert.match(analyticsMigration, /indicators ->> 'fibre'/);
  assert.doesNotMatch(analyticsMigration, /gemini|openai|groq/i);
});

test("analytics endpoint and frontend contract are wired to the real dashboard", () => {
  assert.match(worker, /pathname === "\/api\/user\/analytics" && request\.method === "GET"/);
  assert.match(worker, /callUserRpc\(env, "get_user_analytics"/);
  assert.match(worker, /function restrictAnalyticsEntitlements\(raw, plan, status\)/);
  assert.match(worker, /status === "active" && \(plan === "pro" \|\| plan === "premium"\)/);
  assert.match(worker, /const activePremium = activePaid && plan === "premium"/);
  assert.match(api, /analytics: \(\) => request<AnalyticsPayload>\("\/api\/user\/analytics"\)/);
  assert.match(supabaseData, /export async function fetchAnalytics/);
  assert.match(app, /fetchAnalytics\(userId\)/);
  assert.match(app, /analytics=\{analytics\}/);
  assert.match(app, /SQL rolling average/);
  assert.match(app, /Target 70–100/);
});

test("the Worker implements the declared read-only auth identity endpoint", () => {
  assert.ok(worker.includes('url.pathname === "/api/auth/me"'));
  assert.ok(worker.includes("verifiedUser.email"));
  assert.ok(api.includes("authMe: () => request"));
});

test("service worker does not intercept Cloudflare challenge assets", () => {
  assert.match(sw, /const CACHE_NAME = "neulifi-static-v4"/);
  assert.ok(sw.includes('url.pathname === "/cdn-cgi"'));
  assert.ok(sw.includes('url.pathname.startsWith("/cdn-cgi/")'));
});

test("payout API transport errors stay feature-neutral and selected crypto options are submitted", () => {
  assert.ok(api.includes('const isMealAnalysisRequest = path === "/api/analyze";'));
  assert.match(api, /Neulifi request timed out/);
  assert.match(api, /Neulifi could not reach the backend/);
  assert.match(productScreens, /const option = activeOption;/);
  assert.doesNotMatch(productScreens, /item\.currency === "USDT" && item\.network === "TRC20"/);
  assert.match(worker, /Only crypto transfer payouts are supported/);
  assert.match(worker, /That payout request identifier is not valid/);
  assert.match(worker, /async function markOverdueTasksBestEffort\(env, userId\)/);
  assert.match(worker, /await markOverdueTasksBestEffort\(env, user\.id\)/);
  assert.doesNotMatch(worker, /callUserRpc\(env, "mark_missed_tasks"/);
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


test("Partnero tracking and Paddle attribution are wired without monkey-patching checkout", async () => {
  const partnero = await read("src/lib/partnero.ts");
  assert.match(indexHtml, /https:\/\/app\.partnero\.com\/js\/universal\.js/);
  assert.match(indexHtml, /po\("program", "JRHP7SUP", "load"\)/);
  assert.match(partnero, /URLSearchParams\(window\.location\.search\)\.get\(PARTNERO_QUERY_PARAM\)/);
  assert.match(partnero, /partnero_partner/);
  assert.match(partnero, /customer_key: customerKey/);
  assert.match(paddlePricing, /withPartneroCustomData\(\{ billing_interval: "year", source: "neulifi" \}\)/);
  assert.match(paddleCheckout, /withPartneroCustomData\(\{ source: "neulifi" \}\)/);
  assert.doesNotMatch(partnero, /Paddle\.Checkout\.open\s*=/);
});

test("Partnero helper persists a referral and merges customer_key into Paddle data", async () => {
  const partnero = await read("src/lib/partnero.ts");
  const partneroModule = await import(`data:text/javascript;base64,${Buffer.from(typescript.transpileModule(partnero, { compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ES2022 } }).outputText).toString("base64")}`);
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  let cookie = "";
  globalThis.window = { location: { search: "?aff=TEST_PARTNER" } };
  globalThis.document = {
    get cookie() { return cookie; },
    set cookie(value) { cookie = cookie ? `${cookie}; ${value.split(";")[0]}` : value.split(";")[0]; },
  };

  try {
    assert.deepEqual(partneroModule.withPartneroCustomData({ billing_interval: "year" }), { billing_interval: "year", customer_key: "TEST_PARTNER" });
    globalThis.window.location.search = "";
    assert.deepEqual(partneroModule.withPartneroCustomData({ source: "neulifi" }), { source: "neulifi", customer_key: "TEST_PARTNER" });
  } finally {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
  }
});
