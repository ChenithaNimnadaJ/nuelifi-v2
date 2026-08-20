import { useEffect, useState } from "react";
import { nuelifiApi, type Action, type Meal } from "./lib/api";

interface Dashboard { mealsAnalysed: number; actionsCompleted: number; actionsTotal: number; averageMealScore: number; recentMeals: Meal[]; openActions: Action[]; }

export default function App() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const load = () => nuelifiApi.dashboard("demo-user").then(setDashboard).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  const complete = async (id: string) => { setBusy(id); try { await nuelifiApi.completeAction(id); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(null); } };

  if (error) return <main className="shell"><p className="eyebrow">NUELIFI</p><h1>Connect your health companion.</h1><p className="muted">Start the backend with <code>npm run backend:seed &amp;&amp; npm run backend</code>, then refresh this page.</p><p className="error">{error}</p></main>;
  if (!dashboard) return <main className="shell"><p className="muted">Loading your day…</p></main>;
  return <main className="shell">
    <header><div><p className="eyebrow">NUELIFI / TODAY</p><h1>A better next choice.</h1><p className="muted">Understand your meals without judgement. Turn insight into one small action.</p></div><div className="score"><strong>{dashboard.averageMealScore || "—"}</strong><span>meal score</span></div></header>
    <section className="stats"><div><strong>{dashboard.mealsAnalysed}</strong><span>meals analysed</span></div><div><strong>{dashboard.actionsCompleted}/{dashboard.actionsTotal}</strong><span>actions complete</span></div><div><strong>{Math.round((dashboard.actionsCompleted / Math.max(1, dashboard.actionsTotal)) * 100)}%</strong><span>consistency</span></div></section>
    <section className="grid"><div className="card"><div className="card-heading"><div><p className="eyebrow">RECENT MEALS</p><h2>What you ate</h2></div><button onClick={load}>Refresh</button></div>{dashboard.recentMeals.map((meal) => <article className="meal" key={meal.id}><div><strong>{meal.mealName}</strong><p className="muted">{new Date(meal.capturedAt).toLocaleDateString()}</p></div><span className={`rating ${meal.analysis.rating.toLowerCase().replaceAll(" ", "-")}`}>{meal.analysis.rating}</span></article>)}</div><div className="card"><p className="eyebrow">NEXT ACTIONS</p><h2>Small steps</h2>{dashboard.openActions.length ? dashboard.openActions.map((action) => <button className="action" key={action.id} disabled={busy === action.id} onClick={() => complete(action.id)}><span className="check">○</span><span>{action.title}</span></button>) : <p className="muted">You’re all caught up for today.</p>}</div></section>
  </main>;
}
