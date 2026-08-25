import { useEffect, useState } from "react";
import { fetchPaddleRuntimeConfig, getPaddle } from "../lib/paddle";

function productionSuccessUrl() {
  return import.meta.env.MODE === "production" ? "https://neulifi.online/welcome" : new URL("/welcome", window.location.origin).toString();
}

export function PaddleCheckoutLink() {
  const [error, setError] = useState("");

  useEffect(() => {
    const transactionId = new URLSearchParams(window.location.search).get("_ptxn")?.trim() || "";
    if (!/^txn_[a-z\d]{26}$/.test(transactionId)) {
      setError("This checkout link is incomplete. Return to plans and start again.");
      return;
    }

    let active = true;
    document.title = "Secure checkout — Neulifi";
    document.documentElement.querySelector('meta[name="robots"]')?.setAttribute("content", "noindex, nofollow");
    void fetchPaddleRuntimeConfig().then((config) => getPaddle(config)).then((paddle) => {
      if (!active) return;
      paddle.Checkout.open({
        transactionId,
        settings: { displayMode: "overlay", variant: "one-page", theme: "light", locale: "en", successUrl: productionSuccessUrl() },
      });
    }).catch((value) => {
      if (active) setError(value instanceof Error ? value.message : "Secure checkout could not be opened.");
    });
    return () => { active = false; };
  }, []);

  return <main className="public-main checkout-link-page"><section className="checkout-link-card" aria-live="polite"><span className="public-kicker">NEULIFI CHECKOUT</span><h1>{error ? "Checkout needs a fresh link" : "Preparing your secure checkout"}</h1><p>{error || "Your purchase details are loading. You will complete checkout in the secure payment window."}</p>{error && <a className="button button-green" href="/plans">Return to plans</a>}</section></main>;
}
