export function friendlyAuthError(value: unknown, fallback: string) {
  const raw = value instanceof Error
    ? value.message.trim()
    : value && typeof value === "object" && "message" in value
      ? String((value as { message?: unknown }).message || "").trim()
      : "";
  const code = value && typeof value === "object" && "code" in value
    ? String((value as { code?: unknown }).code || "").trim()
    : "";
  const normalized = `${raw} ${code}`.toLowerCase();
  if ((!raw && !code) || /unexpected(?: end)? of json|json input|unexpected token/i.test(raw)) return fallback;
  if (/rate.?limit|too many requests|over_email_send_rate_limit\b|429\b|email.*limit/i.test(normalized)) return "Too many emails have been requested recently. Please wait a few minutes before trying again, then request a new link.";
  if (/signups?\s+(?:are\s+)?not\s+allowed\s+for\s+otp|signups?\s+not\s+allowed\s+for\s+otp|\botp_disabled\b/i.test(normalized)) return "Passwordless sign-up is not enabled right now. Use password sign-up below, or sign in if you already have an account.";
  if (/\bsignup_disabled\b/i.test(normalized)) return "New account creation is currently disabled. Please try again later or sign in if you already have an account.";
  if (/email_not_confirmed|email.*not.*confirm|confirm.*email/i.test(normalized)) return "Your email is not confirmed yet. Check your inbox or request a new verification email.";
  if (/user_already_exists|already.*registered|email.*already.*exists/i.test(normalized)) return "An account already exists for this email. Sign in instead, or use Forgot password if you need to reset it.";
  if (/invalid_credentials|invalid.*login|wrong.*password/i.test(normalized)) return "The email or password did not match. Check them and try again.";
  if (/weak_password|password.*too.*short|password.*should.*be/i.test(normalized)) return "Choose a stronger password with at least 6 characters.";
  if (/\bemail_provider_disabled\b/i.test(normalized)) return "Email-and-password sign-up is not enabled right now. Use the secure email link instead, or sign in if you already have an account.";
  if (/auth session missing|session.*missing|no valid session|not authenticated/i.test(normalized)) return "Your recovery session is no longer active. Request a fresh password-reset link and open it in the same browser.";
  if (/failed to fetch|network/i.test(normalized)) return "We could not reach the account service. Check your connection and try again.";
  if (/expired|invalid.*token|invalid.*link/i.test(normalized)) return "This link has expired or is no longer valid. Request a fresh link and try again.";
  return raw || code || fallback;
}
