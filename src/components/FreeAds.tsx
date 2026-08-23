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

const rectangleOptions: AdOptions = { key: "1c09d4ea208a7363f4640e680e72f2da", format: "iframe", height: 250, width: 300, params: {} };
const compactOptions: AdOptions = { key: "bf0e160e0990c84b01282775c25440c7", format: "iframe", height: 50, width: 320, params: {} };
const wideOptions: AdOptions = { key: "90f7b98a4c5030b0a4ecb5567325020d", format: "iframe", height: 90, width: 728, params: {} };
const rectangleScript = "https://www.highrevenueformat.com/1c09d4ea208a7363f4640e680e72f2da/invoke.js";
const responsiveScripts = {
  compact: "https://www.highrevenueformat.com/bf0e160e0990c84b01282775c25440c7/invoke.js",
  wide: "https://www.highrevenueformat.com/90f7b98a4c5030b0a4ecb5567325020d/invoke.js",
};

function appendScript(slot: HTMLElement, src: string, options: AdOptions) {
  return new Promise<void>((resolve) => {
    (window as WindowWithAdOptions).atOptions = options;
    const script = document.createElement("script");
    script.async = true;
    script.dataset.neulifiAd = "true";
    script.dataset.cfasync = "false";
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => resolve();
    slot.appendChild(script);
  });
}

export function FreeAds({ slot = "responsive" }: { slot?: AdSlot }) {
  const responsive = slot === "responsive";
  const [responsiveKey, setResponsiveKey] = useState(() => typeof window !== "undefined" && window.matchMedia("(min-width: 760px)").matches ? wideOptions.key : compactOptions.key);
  const slotId = responsive ? "neulifi-ad-responsive" : "neulifi-ad-rectangle";

  useEffect(() => {
    const target = document.getElementById(slotId);
    if (!target) return;
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
  }, [responsive, slotId]);

  return <aside className={`free-ad-placement free-ad-placement-${slot}`} aria-label="Sponsored content">
    <div className="free-ad-heading"><span>SUPPORTED BY ADS</span><small>Free plan</small></div>
    <div className={`free-ad-slot ${responsive ? "free-ad-responsive" : "free-ad-rectangle"}`}><div id={slotId} data-ad-variant={responsive ? responsiveKey : "rectangle"} /></div>
  </aside>;
}
