import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Action, AnalyticsPayload, Meal, UserPreferences } from "../lib/api";
import type { PlanId } from "../lib/plans";

type Subscription = { plan: PlanId; status: string };
type DataState = "loading" | "ready" | "error";
type TimingPeriod = "Morning" | "Afternoon" | "Evening" | "Night";
type HistoryRange = "7" | "30" | "90" | "all";
type HistorySort = "newest" | "oldest" | "highest" | "lowest";
type HistoryTime = "all" | TimingPeriod;
type GoalType = "above_score" | "balanced_meals" | "tracked_days";

type InsightsProps = {
  meals: Meal[];
  actions: Action[];
  analytics: AnalyticsPayload | null;
  subscription: Subscription;
  preferences: UserPreferences;
  onUpdatePreferences: (patch: { preferences: UserPreferences }) => Promise<unknown>;
  dataState: DataState;
  dataError: string;
  onUpgrade: (reason: "analytics") => void;
  onOpenMeal: (meal: Meal) => void;
  showFreeAds: boolean;
};

type GoalConfig = { type: GoalType; target: number; scoreTarget: number };

type MealRow = Meal & { period: TimingPeriod; localDate: string; label: string; score: number; protein: number | null; fiber: number | null };

const PERIODS: TimingPeriod[] = ["Morning", "Afternoon", "Evening", "Night"];
const DEFAULT_GOAL: GoalConfig = { type: "above_score", target: 5, scoreTarget: 75 };

function activePaid(subscription: Subscription) { return subscription.status === "active" && (subscription.plan === "pro" || subscription.plan === "premium"); }
function activePremium(subscription: Subscription) { return subscription.status === "active" && subscription.plan === "premium"; }
function validDate(value: string) { const date = new Date(value); return Number.isFinite(date.getTime()); }
function timezoneOrUtc(value?: string) { try { if (value) new Intl.DateTimeFormat("en-US", { timeZone: value }).format(); return value || "UTC"; } catch { return "UTC"; } }
function dateParts(value: string, timezone: string) { const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).formatToParts(new Date(value)); const get = (type: string) => parts.find((part) => part.type === type)?.value || ""; return { year: Number(get("year")), month: Number(get("month")), day: Number(get("day")), weekday: get("weekday") }; }
function hourInTimezone(value: string, timezone: string) { const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "2-digit", hour12: false }).formatToParts(new Date(value)); return Number(parts.find((part) => part.type === "hour")?.value || 0) % 24; }
function periodFor(value: string, timezone: string): TimingPeriod { const hour = hourInTimezone(value, timezone); if (hour >= 5 && hour <= 10) return "Morning"; if (hour >= 11 && hour <= 15) return "Afternoon"; if (hour >= 16 && hour <= 21) return "Evening"; return "Night"; }
function formatDate(value: string, timezone: string, withTime = true) { try { return new Intl.DateTimeFormat(undefined, { timeZone: timezone, month: "short", day: "numeric", ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}) }).format(new Date(value)); } catch { return "Date unavailable"; } }
function localDateKey(value: string, timezone: string) { const parts = dateParts(value, timezone); return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`; }
function todayLocalDate(timezone: string) { const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()); const get = (type: string) => parts.find((part) => part.type === type)?.value || ""; return `${get("year")}-${get("month")}-${get("day")}`; }
function shortLabel(value: string, timezone: string) { return formatDate(value, timezone, false); }
function numeric(value: unknown) { const number = Number(value); return Number.isFinite(number) ? number : null; }
function indicator(meal: Meal, keys: string[]) { for (const key of keys) { const value = numeric(meal.analysis.indicators?.[key]); if (value !== null) return value; } return null; }
function readGoal(preferences: UserPreferences): GoalConfig { const raw = preferences.insightsWeeklyGoal; if (!raw || typeof raw !== "object" || Array.isArray(raw)) return DEFAULT_GOAL; const value = raw as Record<string, unknown>; const type = value.type === "balanced_meals" || value.type === "tracked_days" || value.type === "above_score" ? value.type : DEFAULT_GOAL.type; const target = Math.max(1, Math.min(30, Math.round(Number(value.target) || DEFAULT_GOAL.target))); const scoreTarget = Math.max(1, Math.min(100, Math.round(Number(value.scoreTarget) || DEFAULT_GOAL.scoreTarget))); return { type, target, scoreTarget }; }
function weekStart(key: string) { const [year, month, day] = key.split("-").map(Number); const date = new Date(Date.UTC(year, month - 1, day)); const weekday = date.getUTCDay() || 7; date.setUTCDate(date.getUTCDate() - weekday + 1); return date.toISOString().slice(0, 10); }
function average(values: number[]) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null; }
function numberLabel(value: number | null, suffix = "") { return value === null || !Number.isFinite(value) ? "—" : `${Math.round(value * 10) / 10}${suffix}`; }

function LockedFeature({ tier, title, question, copy, onUpgrade }: { tier: "pro" | "premium"; title: string; question: string; copy: string; onUpgrade: () => void }) {
  return <section className={`insights-card insights-locked insights-locked-${tier}`}><span className="insights-kicker">{tier === "pro" ? "PRO FEATURE" : "PREMIUM FEATURE"}</span><h3>{title}</h3><p className="insights-question">{question}</p><div className="insights-blur-lines" aria-hidden="true"><span/><span/><span/></div><p>{copy}</p><button className="button button-soft" type="button" onClick={onUpgrade}>Unlock {tier === "pro" ? "Pro" : "Premium"}</button></section>;
}

function TrendTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload?: { fullDate?: string; score?: number; period?: string } }> }) {
  if (!active || !payload?.length || !payload[0]?.payload) return null;
  const point = payload[0].payload;
  return <div className="insights-tooltip"><strong>{point.fullDate}</strong><span>Meal balance: <b>{numberLabel(point.score ?? null, "/100")}</b></span><span>{point.period}</span></div>;
}

export function Insights({ meals, actions, analytics, subscription, preferences, onUpdatePreferences, dataState, dataError, onUpgrade, onOpenMeal, showFreeAds: _showFreeAds }: InsightsProps) {
  const timezone = timezoneOrUtc(typeof preferences.timezone === "string" ? preferences.timezone : undefined);
  const isPro = activePaid(subscription);
  const isPremium = activePremium(subscription);
  const [historyRange, setHistoryRange] = useState<HistoryRange>("all");
  const [historyTime, setHistoryTime] = useState<HistoryTime>("all");
  const [historySort, setHistorySort] = useState<HistorySort>("newest");
  const [goal, setGoal] = useState<GoalConfig>(() => readGoal(preferences));
  const [goalSaving, setGoalSaving] = useState(false);
  const [goalMessage, setGoalMessage] = useState("");

  const rows = useMemo<MealRow[]>(() => meals.filter((meal) => meal.status === "analysed" && validDate(meal.capturedAt) && Number.isFinite(Number(meal.analysis.score))).map((meal) => ({ ...meal, score: Number(meal.analysis.score), period: periodFor(meal.capturedAt, timezone), localDate: localDateKey(meal.capturedAt, timezone), label: shortLabel(meal.capturedAt, timezone), protein: indicator(meal, ["protein", "protein_g"]), fiber: indicator(meal, ["fibre", "fiber", "fiber_g"]) })).sort((a, b) => new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime()), [meals, timezone]);

  const serverChart = useMemo(() => new Map((analytics?.chart.series || []).map((point) => [point.capturedAt, point])), [analytics]);
  const hasSevenMealAverage = rows.length >= 7;
  const chartRows = useMemo(() => rows.map((row, index) => { const windowStart = Math.max(0, index - 6); const windowRows = rows.slice(windowStart, index + 1); const serverPoint = serverChart.get(row.capturedAt); const label = serverPoint?.label && /^[A-Za-z]{3,9}\\s+\\d{1,2}$/.test(serverPoint.label) ? serverPoint.label : row.label; const previous = index > 0 ? rows[index - 1] : null; const previousLabel = previous ? (serverChart.get(previous.capturedAt)?.label || previous.label) : ""; return { id: row.id, label, axisLabel: index === 0 || label !== previousLabel ? label : "", fullDate: formatDate(row.capturedAt, timezone), score: serverPoint?.score ?? row.score, rollingAverage: serverPoint?.rollingAverage ?? Math.round((windowRows.reduce((total, item) => total + item.score, 0) / windowRows.length) * 10) / 10, period: row.period }; }), [rows, serverChart, timezone]);

  const timing = useMemo(() => PERIODS.map((period) => { const periodRows = rows.filter((row) => row.period === period); return { period, count: periodRows.length, average: average(periodRows.map((row) => row.score)) }; }), [rows]);
  const timingCompared = timing.filter((item) => item.count > 0 && item.average !== null);
  const strongest = timingCompared.length >= 2 ? timingCompared.reduce((best, item) => (item.average! > best.average! ? item : best)) : null;
  const weakest = timingCompared.length >= 2 ? timingCompared.reduce((worst, item) => (item.average! < worst.average! ? item : worst)) : null;
  const focusDelta = strongest && weakest ? Math.round((strongest.average! - weakest.average!) * 10) / 10 : null;
  const hasReliableTimingBaseline = timingCompared.length >= 2 && timingCompared.every((item) => item.count >= 2);

  const currentWeekRows = useMemo(() => { const current = weekStart(todayLocalDate(timezone)); return rows.filter((row) => weekStart(row.localDate) === current); }, [rows, timezone]);
  const goalProgress = goal.type === "above_score" ? currentWeekRows.filter((row) => row.score >= goal.scoreTarget).length : goal.type === "balanced_meals" ? currentWeekRows.filter((row) => row.score >= goal.scoreTarget).length : new Set(currentWeekRows.map((row) => row.localDate)).size;
  const goalPercent = Math.min(100, Math.round((goalProgress / goal.target) * 100));
  const goalText = goal.type === "above_score" ? `Get ${goal.target} meals above ${goal.scoreTarget}/100` : goal.type === "balanced_meals" ? `Log ${goal.target} balanced meals` : `Track meals on ${goal.target} days`;

  const historyRows = useMemo(() => { const now = Date.now(); const cutoff = historyRange === "all" ? 0 : now - Number(historyRange) * 24 * 60 * 60 * 1000; return rows.filter((row) => new Date(row.capturedAt).getTime() >= cutoff && (historyTime === "all" || row.period === historyTime)).sort((a, b) => historySort === "highest" ? b.score - a.score : historySort === "lowest" ? a.score - b.score : historySort === "oldest" ? new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime() : new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime()); }, [rows, historyRange, historyTime, historySort]);
  const historyUsesDefaults = historyRange === "all" && historyTime === "all" && historySort === "newest";
  const historyCountLabel = historyUsesDefaults ? `${historyRows.length} meal${historyRows.length === 1 ? "" : "s"}` : `${historyRows.length} of ${rows.length} meal${rows.length === 1 ? "" : "s"}`;

  const saveGoal = async () => { setGoalSaving(true); setGoalMessage(""); try { await onUpdatePreferences({ preferences: { ...preferences, insightsWeeklyGoal: goal } }); setGoalMessage("Weekly goal saved."); } catch (error) { setGoalMessage(error instanceof Error ? error.message : "Could not save this goal."); } finally { setGoalSaving(false); } };

  return <div className="insights-page"><div className="insights-page-heading"><div><span className="eyebrow">INSIGHTS</span><h1>Your insights</h1><p>Make your meal history useful. Clear patterns from the meals you actually save.</p></div><div className="insights-data-status">{dataState === "loading" ? "Loading your data…" : dataState === "error" ? dataError || "Some data is unavailable." : `${rows.length} meal${rows.length === 1 ? "" : "s"} in your history`}</div></div>
    <section className="insights-card insights-chart-card"><div className="insights-card-heading"><div><span className="insights-kicker">MEAL BALANCE TREND</span><h2>Your meal scores over time</h2><p>Every saved meal is shown. {hasSevenMealAverage ? "The dashed line is your seven-meal rolling average." : "The trend is shown as saved; a rolling average appears after seven meals."}</p></div><span className="insights-target-chip">Target {numberLabel(analytics?.chart.target.min ?? 70)}–{numberLabel(analytics?.chart.target.max ?? 100)}</span></div>{chartRows.length ? <div className="insights-chart" aria-label="Meal balance trend chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={chartRows} margin={{ top: 12, right: 12, left: -14, bottom: 4 }}><ReferenceArea y1={analytics?.chart.target.min ?? 70} y2={analytics?.chart.target.max ?? 100} fill="var(--chart-target)" fillOpacity={0.12} /><CartesianGrid stroke="var(--border)" strokeDasharray="3 5" vertical={false}/><XAxis dataKey="axisLabel" axisLine={false} tickLine={false} interval={chartRows.length > 8 ? Math.ceil(chartRows.length / 7) - 1 : 0} tick={{ fill: "var(--muted)", fontSize: 11 }}/><YAxis domain={[0, 100]} axisLine={false} tickLine={false} ticks={[0, 50, 70, 100]} tick={{ fill: "var(--muted)", fontSize: 11 }}/><Tooltip content={<TrendTooltip/>}/><Line type="monotone" dataKey="score" stroke="var(--chart-line)" strokeWidth={2.5} dot={{ r: 3, fill: "var(--chart-line)" }} activeDot={{ r: 5 }} name="Meal balance"/><Line type="monotone" dataKey="rollingAverage" stroke="var(--brand)" strokeWidth={2} strokeDasharray="6 5" dot={false} name="Rolling average"/></LineChart></ResponsiveContainer></div> : <div className="insights-empty"><strong>No meal trend yet</strong><span>Save a few meals and your score history will appear here.</span></div>}<div className="insights-chart-legend"><span><i className="legend-score"/>Meal balance</span>{hasSevenMealAverage && <span><i className="legend-average"/>7-meal average</span>}<span><i className="legend-target"/>Target zone</span></div></section>
    <div className="insights-section-heading"><span className="insights-kicker">YOUR PATTERNS</span><h2>Patterns worth noticing</h2><p>Personal signals become clearer as your meal history grows.</p></div><div className="insights-grid insights-premium-grid">{isPremium ? <section className="insights-card"><div className="insights-card-heading"><div><span className="insights-kicker">PREMIUM · 1</span><h2>Meal timing patterns</h2><p>When do you tend to eat better? This compares your own saved meals, not a universal rule.</p></div></div>{timingCompared.length >= 2 ? <><div className="timing-list">{timing.map((item) => <div className={`timing-row ${strongest?.period === item.period ? "timing-best" : ""}`} key={item.period}><span>{item.period}</span><div className="timing-track"><i style={{ width: `${item.average === null ? 0 : Math.max(4, Math.min(100, item.average))}%` }}/></div><strong>{numberLabel(item.average, "/100")}</strong><small>{item.count} meal{item.count === 1 ? "" : "s"}</small></div>)}</div><p className="insights-supporting-copy">{hasReliableTimingBaseline ? <>Your strongest period is <strong>{strongest?.period.toLowerCase()}</strong>. This is an observed pattern, not proof that timing causes the difference.</> : <>Early signal only. Keep logging meals across more time periods to reveal a stronger personal pattern.</>}</p></> : <div className="insights-empty"><strong>Building your timing pattern</strong><span>This compares your meal scores by time of day. Log meals in at least two periods so Neulifi has something meaningful to compare.</span></div>}</section> : <LockedFeature tier="premium" title="Meal timing patterns" question="When do I tend to eat better?" copy="Compare your own meal scores by time of day when enough history exists." onUpgrade={() => onUpgrade("analytics")}/>}
      {isPremium ? <section className="insights-card"><span className="insights-kicker">PREMIUM · 2</span><h2>My focus</h2><p>One clear area to work on, based on where your own saved meals are weakest.</p>{weakest && strongest && hasReliableTimingBaseline && focusDelta && focusDelta >= 5 ? <><div className="focus-callout"><span>FOCUS</span><strong>{weakest.period} meals</strong><p>{numberLabel(weakest.average, "/100")} average compared with {numberLabel(strongest.average, "/100")} in the {strongest.period.toLowerCase()}.</p></div><p className="insights-supporting-copy">Review the suggestions from your recent {weakest.period.toLowerCase()} meals and look for one small change to repeat.</p></> : <div className="insights-empty"><strong>Building your baseline</strong><span>Neulifi needs more meal history across time periods before identifying a reliable focus area.</span></div>}</section> : <LockedFeature tier="premium" title="My focus" question="What should I work on?" copy="See one clear, data-backed focus area instead of a wall of statistics." onUpgrade={() => onUpgrade("analytics")}/>}
      {isPremium ? <section className="insights-card"><span className="insights-kicker">PREMIUM · 3</span><h2>Weekly goal</h2><p>A lightweight target that updates from this week’s saved meals.</p><div className="goal-editor"><label>Goal<select value={goal.type} onChange={(event) => setGoal((current) => ({ ...current, type: event.target.value as GoalType }))}><option value="above_score">Meals above a score</option><option value="balanced_meals">Balanced meals</option><option value="tracked_days">Days with meals</option></select></label>{goal.type !== "tracked_days" && <label>Score target<input type="number" min="1" max="100" value={goal.scoreTarget} onChange={(event) => setGoal((current) => ({ ...current, scoreTarget: Math.max(1, Math.min(100, Number(event.target.value) || 1)) }))}/></label>}<label>Weekly target<input type="number" min="1" max="30" value={goal.target} onChange={(event) => setGoal((current) => ({ ...current, target: Math.max(1, Math.min(30, Number(event.target.value) || 1)) }))}/></label><button className="button button-soft" type="button" onClick={() => { void saveGoal(); }} disabled={goalSaving}>{goalSaving ? "Saving…" : "Save goal"}</button></div><div className="goal-progress"><div><strong>{goalText}</strong><span>{goalProgress} / {goal.target} complete</span></div><div className="goal-progress-track"><i style={{ width: `${goalPercent}%` }}/></div><strong className="goal-percent">{goalPercent}%</strong></div>{goalMessage && <p className="insights-status" role="status">{goalMessage}</p>}</section> : <LockedFeature tier="premium" title="Weekly goal" question="What am I trying to accomplish this week?" copy="Set one measurable target that updates automatically from your saved meals." onUpgrade={() => onUpgrade("analytics")}/>}</div>
    <div className="insights-section-heading"><span className="insights-kicker">EXPLORE YOUR DATA</span><h2>From history to next steps</h2><p>Keep the full record close so every insight stays grounded.</p></div><div className="insights-grid insights-lower-grid">{isPro ? <section className="insights-card insights-history-card"><div className="insights-card-heading"><div><span className="insights-kicker">PRO · ADVANCED MEAL HISTORY</span><h2>Explore your meals</h2><p>Filter, sort, and revisit the data behind your patterns.</p></div><strong className="history-count">{historyCountLabel}</strong></div><div className="history-controls"><label>Range<select value={historyRange} onChange={(event) => setHistoryRange(event.target.value as HistoryRange)}><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="all">All time</option></select></label><label>Time<select value={historyTime} onChange={(event) => setHistoryTime(event.target.value as HistoryTime)}><option value="all">All times</option>{PERIODS.map((period) => <option value={period} key={period}>{period}</option>)}</select></label><label>Sort<select value={historySort} onChange={(event) => setHistorySort(event.target.value as HistorySort)}><option value="newest">Newest</option><option value="oldest">Oldest</option><option value="highest">Highest score</option><option value="lowest">Lowest score</option></select></label></div>{historyRows.length ? <div className="history-list">{historyRows.map((meal) => <button className="history-row" type="button" key={meal.id} onClick={() => onOpenMeal(meal)}><span className="history-score">{Math.round(meal.score)}</span><span className="history-main"><strong>{meal.mealName || "Saved meal"}</strong><small>{meal.period} · {formatDate(meal.capturedAt, timezone)}</small></span><span className="history-macro">{meal.protein === null ? "" : `${Math.round(meal.protein)}g protein`}{meal.fiber === null ? "" : ` · ${Math.round(meal.fiber)}g fiber`}</span><span aria-hidden="true">→</span></button>)}</div> : <div className="insights-empty"><strong>No meals match these filters</strong><span>Try a wider date range or another time period.</span></div>}</section> : <LockedFeature tier="pro" title="Advanced meal history" question="Let me explore my data." copy="Filter and sort your saved meals by date, time of day, and score." onUpgrade={() => onUpgrade("analytics")}/>}<section className="insights-card insights-next-card"><span className="insights-kicker">KEEP BUILDING YOUR HISTORY</span><h2>More useful with more meals</h2><p>Neulifi keeps the raw history visible and waits for enough evidence before showing a personal pattern.</p><div className="history-summary"><span><strong>{rows.length}</strong> saved meals</span><span><strong>{new Set(rows.map((row) => row.localDate)).size}</strong> days tracked</span><span><strong>{actions.filter((action) => action.completed).length}</strong> actions completed</span></div></section></div>
  </div>;
}
