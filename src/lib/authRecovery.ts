export const PASSWORD_RECOVERY_CONTEXT_KEY = "neulifi-password-recovery-ready";

export function hasPasswordRecoveryContext() {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(PASSWORD_RECOVERY_CONTEXT_KEY) === "1";
  } catch {
    return false;
  }
}

export function markPasswordRecoveryContext() {
  if (typeof window === "undefined") return false;
  try {
    window.sessionStorage.setItem(PASSWORD_RECOVERY_CONTEXT_KEY, "1");
    return hasPasswordRecoveryContext();
  } catch {
    // If session storage is unavailable, the callback still has to fail closed.
    return false;
  }
}

export function clearPasswordRecoveryContext() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(PASSWORD_RECOVERY_CONTEXT_KEY);
  } catch {
    // Best-effort cleanup only; no authentication data is stored here.
  }
}
