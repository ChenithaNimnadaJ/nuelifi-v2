import { useEffect, useState } from "react";

type AdOptions = {
  key: string;
  format: "iframe";
  height: number;
  width: number;
  params: Record<string, never>;
};

type WindowWithAdOptions = Window & { atOptions?: AdOptions };

const nativeScriptUrl = "https://pl30969222.profitableratecpmnetwork.com/a9abe36d2dde8e621361b478d62d2697/invoke.js";
const nativeContainerId = "container-a9abe36d2dde8e621361b478d62d2697";
const rectangleOptions: AdOptions = { key: "1c09d4ea208a7363f4640e680e72f2da", format: "iframe", height: 250, width: 300, params: {} };
const compactOptions: AdOptions = { key: "bf0e160e0990c84b01282775c25440c7", format: "iframe", height: 50, width: 320, params: {} };
const wideOptions: AdOptions = { key: "90f7b98a4c5030b0a4ecb5567325020d", format: "iframe", height: 90, width: 728, params: {} };

function appendScript(slot: HTMLElement, src: string, options?: AdOptions) {
  return new Promise<void>((resolve) => {
    if (options) (window as WindowWithAdOptions).atOptions = options;
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

function loadResponsiveBanner(slot: HTMLElement) {
  const wide = window.matchMedia("(min-width: 760px)").matches;
  const options = wide ? wideOptions : compactOptions;
  const base = wide ? "https://www.highrevenueformat.com/90f7b98a4c5030b0a4ecb5567325020d/invoke.js" : "https://www.highrevenueformat.com/bf0e160e0990c84b01282775c25440c7/invoke.js";
  return appendScript(slot, base, options);
}

export function FreeAds() {
  const [responsiveKey, setResponsiveKey] = useState(() => (typeof window !== "undefined" && window.matchMedia("(min-width: 760px)").matches ? wideOptions.key : compactOptions.key));

  useEffect(() => {
    const nativeSlot = document.getElementById(nativeContainerId);
    const rectangleSlot = document.getElementById("neulifi-ad-rectangle");
    const responsiveSlot = document.getElementById("neulifi-ad-responsive");
    if (!nativeSlot || !rectangleSlot || !responsiveSlot) return;
    let active = true;
    let responsiveLoadId = 0;
    const media = window.matchMedia("(min-width: 760px)");
    const loadResponsive = async () => {
      const loadId = ++responsiveLoadId;
      responsiveSlot.replaceChildren();
      await loadResponsiveBanner(responsiveSlot);
      if (!active || loadId !== responsiveLoadId) responsiveSlot.replaceChildren();
    };
    const updateResponsiveKey = () => { setResponsiveKey(media.matches ? wideOptions.key : compactOptions.key); void loadResponsive(); };
    media.addEventListener?.("change", updateResponsiveKey);
    const load = async () => {
      await appendScript(nativeSlot, nativeScriptUrl);
      if (!active) return;
      await appendScript(rectangleSlot, "https://www.highrevenueformat.com/1c09d4ea208a7363f4640e680e72f2da/invoke.js", rectangleOptions);
      if (!active) return;
      await loadResponsive();
    };
    void load();
    return () => {
      active = false;
      media.removeEventListener?.("change", updateResponsiveKey);
      nativeSlot.replaceChildren();
      rectangleSlot.replaceChildren();
      responsiveSlot.replaceChildren();
    };
  }, []);

  return <aside className="free-ad-stack" aria-label="Sponsored content">
    <div className="free-ad-heading"><span>SUPPORTED BY ADS</span><small>Free plan</small></div>
    <div className="free-ad-slot free-ad-native"><div id={nativeContainerId} /></div>
    <div className="free-ad-slot free-ad-rectangle"><div id="neulifi-ad-rectangle" /></div>
    <div className="free-ad-slot free-ad-responsive"><div id="neulifi-ad-responsive" data-ad-variant={responsiveKey} /></div>
  </aside>;
}
