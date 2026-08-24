import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [supabase, recovery, authConfirm, authScreen, authErrors, productScreens, admin, worker, paddle, paddlePricing, app, robots] = await Promise.all([
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
  read("public/robots.txt"),
]);

const typescript = await import("typescript");
const authErrorsModule = await import(`data:text/javascript;base64,${Buffer.from(typescript.transpileModule(authErrors, { compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ES2022 } }).outputText).toString("base64")}`);

test("ordinary auth remains PKCE while password-reset requests use the recovery client", () => {
  assert.match(supabase, /flowType: "pkce"/);
  assert.match(supabase, /recoverySupabase/);
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
