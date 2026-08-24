import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [supabase, recovery, authConfirm, authScreen, authErrors, productScreens, admin] = await Promise.all([
  read("src/lib/supabase.ts"),
  read("src/lib/authRecovery.ts"),
  read("src/components/AuthConfirm.tsx"),
  read("src/components/AuthScreen.tsx"),
  read("src/lib/authErrors.ts"),
  read("src/components/ProductScreens.tsx"),
  read("src/components/AdminPayoutDashboard.tsx"),
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

test("payout copy and active surfaces remain crypto-only", () => {
  assert.match(productScreens, /Where should we send your payout\?/);
  assert.doesNotMatch(productScreens, /Where should the owner send it/);
  for (const source of [productScreens, admin]) {
    assert.doesNotMatch(source, /PayPal|Wise|bank transfer|Other payout method|other payout method/i);
  }
});
