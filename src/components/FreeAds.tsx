import { useEffect, useState } from "react";

type AdSlot = "responsive" | "rectangle";
type AdOptions = {
  key: string;
  format: "iframe";
  height: number;
  width: number;
  params: Record<string, never>;
};

type WindowWithAdOptions = Window & { atOptions?: AdOptions };
const ADS_CONSENT_KEY = "neulifi-ads-consent";
let adLoadQueue: Promise<void> = Promise.resolve();

const rectangleOptions: AdOptions = { key: "1c09d4ea208a7363f4640e680e72f2da", format: "iframe", height: 250, width: 300, params: {} };
const compactOptions: AdOptions = { key: "bf0e160e0990c84b01282775c25440c7", format: "iframe", height: 50, width: 320, params: {} };
const wideOptions: AdOptions = { key: "90f7b98a4c5030b0a4ecb5567325020d", format: "iframe", height: 90, width: 728, params: {} };
const rectangleScript = "https://www.highrevenueformat.com/1c09d4ea208a7363f4640e680e72f2da/invoke.js";
const responsiveScripts = {
  compact: "https://www.highrevenueformat.com/bf0e160e0990c84b01282775c25440c7/invoke.js",
  wide: "https://www.highrevenueformat.com/90f7b98a4c5030b0a4ecb5567325020d/invoke.js",
};

function appendScript(slot: HTMLElement, src: string, options: AdOptions) {
  const loadOne = () => new Promise<void>((resolve) => {
    const win = window as WindowWithAdOptions;
    const previous = win.atOptions;
    win.atOptions = options;
    const script = document.createElement("script");
    script.async = true;
    script.dataset.neulifiAd = "true";
    script.dataset.cfasync = "false";
    script.src = src;
    const finish = () => {
      if (previous === undefined) delete win.atOptions;
      else win.atOptions = previous;
      resolve();
    };
    script.onload = finish;
    script.onerror = finish;
    slot.appendChild(script);
  });
  const next = adLoadQueue.then(loadOne, loadOne);
  adLoadQueue = next.catch(() => undefined);
  return next;
}

export function FreeAds({ slot = "responsive" }: { slot?: AdSlot }) {
  const responsive = slot === "responsive";
  const [consent, setConsent] = useState(() => typeof window !== "undefined" && window.localStorage.getItem(ADS_CONSENT_KEY) === "granted");
  const [responsiveKey, setResponsiveKey] = useState(() => typeof window !== "undefined" && window.matchMedia("(min-width: 760px)").matches ? wideOptions.key : compactOptions.key);
  const slotId = responsive ? "neulifi-ad-responsive" : "neulifi-ad-rectangle";

  useEffect(() => {
    const target = document.getElementById(slotId);
    if (!target || !consent) return;
    let active = true;
    const media = responsive ? window.matchMedia("(min-width: 760px)") : null;
    const load = async () => {
      target.replaceChildren();
      const wide = media?.matches ?? false;
      await appendScript(target, responsive ? (wide ? responsiveScripts.wide : responsiveScripts.compact) : rectangleScript, responsive ? (wide ? wideOptions : compactOptions) : rectangleOptions);
      if (!active) target.replaceChildren();
    };
    const updateResponsive = () => { if (!media) return; setResponsiveKey(media.matches ? wideOptions.key : compactOptions.key); void load(); };
    media?.addEventListener?.("change", updateResponsive);
    void load();
    return () => {
      active = false;
      media?.removeEventListener?.("change", updateResponsive);
      target.replaceChildren();
    };
  }, [consent, responsive, slotId]);

  return <aside className={`free-ad-placement free-ad-placement-${slot}`} aria-label="Sponsored content">
    <div className="free-ad-heading"><span>SUPPORTED BY ADS</span><small>Free plan</small></div>
    {consent ? <div className={`free-ad-slot ${responsive ? "free-ad-responsive" : "free-ad-rectangle"}`}><div id={slotId} data-ad-variant={responsive ? responsiveKey : "rectangle"} /></div> : <div className="free-ad-consent"><p>Optional ads help keep the Free plan available.</p><button className="text-button" type="button" onClick={() => { window.localStorage.setItem(ADS_CONSENT_KEY, "granted"); setConsent(true); }}>Allow sponsored content</button></div>}
  </aside>;
}
