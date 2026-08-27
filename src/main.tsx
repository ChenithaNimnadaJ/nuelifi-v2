import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { getPartneroCustomerKey } from "./lib/partnero";

type BoundaryState = { error: Error | null };

class AppErrorBoundary extends React.Component<React.PropsWithChildren, BoundaryState> {
  state: BoundaryState = { error: null };
  static getDerivedStateFromError(error: Error): BoundaryState { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    return <main className="auth-loading"><section className="error-boundary-card"><strong>Neulifi could not open this screen.</strong><p>Refresh the page and try again. If the problem continues, contact support.</p><details><summary>Technical details</summary><pre>{this.state.error.message}</pre></details></section></main>;
  }
}

if (import.meta.env.MODE === "production" && "serviceWorker" in navigator) window.addEventListener("load", () => { void navigator.serviceWorker.register("/sw.js").catch(() => undefined); });

getPartneroCustomerKey();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>,
);
