const PARTNERO_QUERY_PARAM = "aff";
const PARTNERO_COOKIE_NAME = "partnero_partner";

const PARTNERO_COOKIE_MAX_AGE = 60 * 60 * 24 * 90;

declare global {
  interface Window {
    __neulifiPartneroCustomerKey?: string;
  }
}

function readCookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;

  const encodedValue = document.cookie
    .split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${name}=`))
    ?.slice(name.length + 1);

  if (!encodedValue) return undefined;

  try {
    return decodeURIComponent(encodedValue).trim() || undefined;
  } catch {
    return undefined;
  }
}

function persistPartnerKey(value: string): void {
  if (typeof document === "undefined") return;

  document.cookie = [
    `${PARTNERO_COOKIE_NAME}=${encodeURIComponent(value)}`,
    `Max-Age=${PARTNERO_COOKIE_MAX_AGE}`,
    "Path=/",
    "SameSite=Lax",
  ].join("; ");
}

/**
 * Capture Partnero's `?aff=` value once and retain it for later checkout.
 * The head script normally performs this before React loads; this function is
 * intentionally idempotent so direct route entry and test environments work too.
 */
export function getPartneroCustomerKey(): string | undefined {
  if (typeof window === "undefined") return undefined;

  const queryValue = new URLSearchParams(window.location.search).get(PARTNERO_QUERY_PARAM)?.trim();
  if (queryValue) {
    window.__neulifiPartneroCustomerKey = queryValue;
    persistPartnerKey(queryValue);
    return queryValue;
  }

  const cachedValue = window.__neulifiPartneroCustomerKey?.trim();
  if (cachedValue) return cachedValue;

  const cookieValue = readCookie(PARTNERO_COOKIE_NAME);
  if (cookieValue) window.__neulifiPartneroCustomerKey = cookieValue;
  return cookieValue;
}

/**
 * Preserve existing Paddle custom data while adding Partnero's attribution
 * field when a partner key is available. The returned object is safe to pass
 * directly to Paddle.Checkout.open({ customData }).
 */
export function withPartneroCustomData(existing: Record<string, string> = {}): Record<string, string> {
  const customerKey = getPartneroCustomerKey();
  return customerKey ? { ...existing, customer_key: customerKey } : existing;
}

export { PARTNERO_COOKIE_NAME, PARTNERO_QUERY_PARAM };
