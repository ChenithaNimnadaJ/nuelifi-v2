import type { StreakSnapshot } from "../lib/api";

const simpleDate = (value?: string | null) => value ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value)) : "No date";

export function StreakCard({ streak, loading = false }: { streak: StreakSnapshot; loading?: boolean }) {
  if (loading) return <section className="streak-card skeleton-card" aria-label="Loading streak"><span className="skeleton-line skeleton-short"/><span className="skeleton-line"/></section>;
  return <section className="streak-card"><div><span className="streak-kicker">YOUR STREAK</span><strong>{streak.currentStreak}<small>{streak.currentStreak === 1 ? " day" : " days"}</small></strong><p>{streak.currentStreak ? "One qualifying action keeps it moving." : "Scan a meal or complete a task to start."}</p></div><div className="streak-flame" aria-hidden="true">✦</div><div className="streak-meta"><span>Best: {streak.longestStreak} {streak.longestStreak === 1 ? "day" : "days"}</span><span>{streak.lastActivityDate ? `Last active ${simpleDate(streak.lastActivityDate)}` : "No activity yet"}</span></div></section>;
}
