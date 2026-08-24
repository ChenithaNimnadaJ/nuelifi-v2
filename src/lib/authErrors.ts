export function friendlyAuthError(value: unknown, fallback: string) {
  const raw = value instanceof Error
    ? value.message.trim()
    : value && typeof value === "object" && "message" in value
      ? String((value as { message?: unknown }).message || "").trim()
      : "";
  const normalized = raw.toLowerCase();
  if (!raw || /unexpected(?: end)? of json|json input|unexpected token/i.test(raw)) return fallback;
  if (/rate.?limit|too many requests|over_email_send_rate_limit|\b429\b|email.*limit/i.test(normalized)) return "Too many emails have been requested recently. Please wait a few minutes before trying again, then request a new link.";
  if (/auth session missing|session.*missing|no valid session|not authenticated/i.test(normalized)) return "Your recovery session is no longer active. Request a fresh password-reset link and open it in the same browser.";
  if (/failed to fetch|network/i.test(normalized)) return "We could not reach the account service. Check your connection and try again.";
  if (/expired|invalid.*token|invalid.*link/i.test(normalized)) return "This link has expired or is no longer valid. Request a fresh link and try again.";
  return raw;
}
