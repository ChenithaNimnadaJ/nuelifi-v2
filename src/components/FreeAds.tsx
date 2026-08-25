import { useEffect, useState } from "react";

type AdSlot = "responsive" | "analysis" | "insights";
type AdsenseWindow = Window & {
  adsbygoogle?: unknown[];
  __neulifiAdsenseLoader?: Promise<void>;
};

const ADS_CONSENT_KEY = "neulifi-ads-consent";
const ADSENSE_CLIENT = "ca-pub-7297802357104625";
const ADSENSE_SLOTS: Record<AdSlot, string> = {
  responsive: "3398954371",
  analysis: "5852787976",
  insights: "3745499387",
};

function loadAdsenseScript(): Promise<void> {
  const win = window as AdsenseWindow;
  if (win.__neulifiAdsenseLoader) return win.__neulifiAdsenseLoader;
  const existing = document.querySelector<HTMLScriptElement>('script[src*="adsbygoogle.js"]');
  if (existing) {
    win.__neulifiAdsenseLoader = Promise.resolve();
    return win.__neulifiAdsenseLoader;
  }
  win.__neulifiAdsenseLoader = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.async = true;
    script.crossOrigin = "anonymous";
    script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Google AdSense could not be loaded."));
    document.head.appendChild(script);
  }).catch((error) => {
    delete win.__neulifiAdsenseLoader;
    throw error;
  });
  return win.__neulifiAdsenseLoader;
}

export function FreeAds({ slot = "responsive" }: { slot?: AdSlot }) {
  const [consent, setConsent] = useState(() => typeof window !== "undefined" && window.localStorage.getItem(ADS_CONSENT_KEY) === "granted");
  const [error, setError] = useState(false);
  const slotId = `neulifi-adsense-${slot}`;
  const adSlot = ADSENSE_SLOTS[slot];

  useEffect(() => {
    const target = document.getElementById(slotId);
    if (!target || !consent) return;
    let active = true;
    const ad = document.createElement("ins");
    ad.className = "adsbygoogle";
    ad.style.display = "block";
    ad.dataset.adClient = ADSENSE_CLIENT;
    ad.dataset.adSlot = adSlot;
    ad.dataset.adFormat = "auto";
    ad.dataset.fullWidthResponsive = "true";
    target.replaceChildren(ad);
    setError(false);

    void loadAdsenseScript().then(() => {
      if (!active) return;
      const win = window as AdsenseWindow;
      (win.adsbygoogle ||= []).push({});
    }).catch(() => {
      if (active) setError(true);
    });

    return () => {
      active = false;
      target.replaceChildren();
    };
  }, [adSlot, consent, slotId]);

  return <aside className={`free-ad-placement free-ad-placement-${slot}`} aria-label="Sponsored content">
    <div className="free-ad-heading"><span>SUPPORTED BY ADS</span><small>Free plan</small></div>
    {consent ? <div className="free-ad-slot free-ad-responsive">
      <div id={slotId} aria-live="polite" />
      {error && <small className="free-ad-fallback">Sponsored content helps keep the Free plan available.</small>}
    </div> : <div className="free-ad-consent"><p>Optional ads help keep the Free plan available.</p><button className="text-button" type="button" onClick={() => { window.localStorage.setItem(ADS_CONSENT_KEY, "granted"); setConsent(true); }}>Allow sponsored content</button></div>}
  </aside>;
}
