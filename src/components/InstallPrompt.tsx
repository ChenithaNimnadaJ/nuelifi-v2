import { useEffect, useRef, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

const DISMISSED_KEY = "neulifi-install-prompt-dismissed-at";
const DISMISS_COOLDOWN_MS = 24 * 60 * 60 * 1000;

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
}

function isAndroid() {
  return /Android/i.test(navigator.userAgent);
}

function wasRecentlyDismissed() {
  const dismissedAt = Number(window.localStorage.getItem(DISMISSED_KEY) || 0);
  return Number.isFinite(dismissedAt) && dismissedAt > 0 && Date.now() - dismissedAt < DISMISS_COOLDOWN_MS;
}

export function InstallPrompt({ active }: { active: boolean }) {
  const deferredPrompt = useRef<BeforeInstallPromptEvent | null>(null);
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isAndroid() || isStandalone()) return;

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      deferredPrompt.current = event as BeforeInstallPromptEvent;
      if (window.location.pathname === "/app" && !wasRecentlyDismissed()) setAvailable(true);
    };
    const handleAppInstalled = () => {
      deferredPrompt.current = null;
      setAvailable(false);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  useEffect(() => {
    if (!active) setAvailable(false);
    else if (deferredPrompt.current && !isStandalone() && !wasRecentlyDismissed()) setAvailable(true);
  }, [active]);

  if (!active || !available || !deferredPrompt.current) return null;

  const install = async () => {
    const event = deferredPrompt.current;
    if (!event) return;
    setBusy(true);
    await event.prompt();
    const choice = await event.userChoice;
    deferredPrompt.current = null;
    setBusy(false);
    setAvailable(false);
    if (choice.outcome === "dismissed") window.localStorage.setItem(DISMISSED_KEY, String(Date.now()));
  };

  const dismiss = () => {
    window.localStorage.setItem(DISMISSED_KEY, String(Date.now()));
    setAvailable(false);
  };

  return <aside className="install-prompt" role="dialog" aria-labelledby="install-prompt-title" aria-describedby="install-prompt-copy">
    <div className="install-prompt-icon" aria-hidden="true">↓</div>
    <div className="install-prompt-copy"><strong id="install-prompt-title">Install Neulifi</strong><p id="install-prompt-copy">Keep your meal scanner and insights one tap away on your phone.</p></div>
    <div className="install-prompt-actions"><button className="button button-green" type="button" onClick={() => { void install(); }} disabled={busy}>{busy ? "Opening…" : "Install"}</button><button className="install-prompt-dismiss" type="button" onClick={dismiss} disabled={busy}>Not now</button></div>
  </aside>;
}
