import { useEffect, useState } from "react";

type AdSlot = "responsive" | "rectangle";
type AdsenseWindow = Window & {
  adsbygoogle?: unknown[];
  __neulifiAdsenseLoader?: Promise<void>;
};

const ADS_CONSENT_KEY = "neulifi-ads-consent";
const ADSENSE_CLIENT = "ca-pub-7297802357104625";
const ADSENSE_SLOT = "3398954371";

function loadAdsenseScript(): Promise<void> {
  const win = window as AdsenseWindow;
  if (win.__neulifiAdsenseLoader) return win.__neulifiAdsenseLoader;
  const existing = document.querySelector<HTMLScriptElement>("script[data-neulifi-adsense]");
  if (existing) {
    win.__neulifiAdsenseLoader = Promise.resolve();
    return win.__neulifiAdsenseLoader;
  }
  win.__neulifiAdsenseLoader = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.async = true;
    script.crossOrigin = "anonymous";
    script.dataset.neulifiAdsense = "true";
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

  useEffect(() => {
    const target = document.getElementById(slotId);
    if (!target || !consent) return;
    let active = true;
    const ad = document.createElement("ins");
    ad.className = "adsbygoogle";
    ad.style.display = "block";
    ad.dataset.adClient = ADSENSE_CLIENT;
    ad.dataset.adSlot = ADSENSE_SLOT;
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
  }, [consent, slotId]);

  return <aside className={`free-ad-placement free-ad-placement-${slot}`} aria-label="Sponsored content">
    <div className="free-ad-heading"><span>SUPPORTED BY ADS</span><small>Free plan</small></div>
    {consent ? <div className={`free-ad-slot ${slot === "responsive" ? "free-ad-responsive" : "free-ad-rectangle"}`}>
      <div id={slotId} aria-live="polite" />
      {error && <small className="free-ad-error">Ads are temporarily unavailable.</small>}
    </div> : <div className="free-ad-consent"><p>Optional ads help keep the Free plan available.</p><button className="text-button" type="button" onClick={() => { window.localStorage.setItem(ADS_CONSENT_KEY, "granted"); setConsent(true); }}>Allow sponsored content</button></div>}
  </aside>;
}
