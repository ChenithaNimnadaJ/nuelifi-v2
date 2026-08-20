import { useEffect, useState } from "react";
import { demoDashboard, nuelifiApi, type Action, type Dashboard, type Meal } from "./lib/api";

export default function App() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const load = () => nuelifiApi.dashboard("demo-user").then((data) => { setDashboard(data); setOffline(false); }).catch(() => { setDashboard(demoDashboard()); setOffline(true); });
  useEffect(() => { load(); }, []);
  const complete = async (id: string) => {
    setBusy(id);
    if (offline) {
      setDashboard((current) => current ? { ...current, actionsCompleted: current.actionsCompleted + 1, openActions: current.openActions.filter((action) => action.id !== id) } : current);
      setBusy(null);
      return;
    }
    try { await nuelifiApi.completeAction(id); await load(); } finally { setBusy(null); }
  };

  if (!dashboard) return <main className="shell"><p className="muted">Loading your day…</p></main>;
  return <main className="shell">
    {offline && <div className="preview-note">Preview mode · showing demo data. Start the API to load live data.</div>}
    <header><div><p className="eyebrow">NUELIFI / TODAY</p><h1>A better next choice.</h1><p className="muted">Understand your meals without judgement. Turn insight into one small action.</p></div><div className="score"><strong>{dashboard.averageMealScore || "—"}</strong><span>meal score</span></div></header>
    <section className="stats"><div><strong>{dashboard.mealsAnalysed}</strong><span>meals analysed</span></div><div><strong>{dashboard.actionsCompleted}/{dashboard.actionsTotal}</strong><span>actions complete</span></div><div><strong>{Math.round((dashboard.actionsCompleted / Math.max(1, dashboard.actionsTotal)) * 100)}%</strong><span>consistency</span></div></section>
    <section className="grid"><div className="card"><div className="card-heading"><div><p className="eyebrow">RECENT MEALS</p><h2>What you ate</h2></div><button onClick={load}>Refresh</button></div>{dashboard.recentMeals.map((meal: Meal) => <article className="meal" key={meal.id}><div><strong>{meal.mealName}</strong><p className="muted">{new Date(meal.capturedAt).toLocaleDateString()}</p></div><span className={`rating ${meal.analysis.rating.toLowerCase().replaceAll(" ", "-")}`}>{meal.analysis.rating}</span></article>)}</div><div className="card"><p className="eyebrow">NEXT ACTIONS</p><h2>Small steps</h2>{dashboard.openActions.length ? dashboard.openActions.map((action: Action) => <button className="action" key={action.id} disabled={busy === action.id} onClick={() => complete(action.id)}><span className="check">○</span><span>{action.title}</span></button>) : <p className="muted">You’re all caught up for today.</p>}</div></section>
  </main>;
}
