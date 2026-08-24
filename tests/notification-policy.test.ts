import assert from "node:assert/strict";
import { getNotificationCandidate, localDateKey, localHour, localWeekKey, notificationDayHistoryKey, notificationHistoryKey, notificationWeekHistoryKey } from "../src/lib/notifications.ts";

const timezone = "Asia/Colombo";
const at = (value: string) => new Date(value);
const base = at("2026-08-25T08:00:00.000Z");

assert.equal(localDateKey(base, timezone), "2026-08-25");
assert.equal(localHour(base, timezone), 13);
assert.match(localWeekKey(base, timezone), /^2026-08-24$/);

assert.equal(getNotificationCandidate({ now: base, timezone, notificationsEnabled: false, permission: "granted", meals: [], actions: [] }), null);
assert.equal(getNotificationCandidate({ now: at("2026-08-25T03:00:00.000Z"), timezone, notificationsEnabled: true, permission: "granted", meals: [], actions: [] }), null);
assert.equal(getNotificationCandidate({ now: base, timezone, notificationsEnabled: true, permission: "denied", meals: [], actions: [] }), null);
assert.equal(getNotificationCandidate({ now: base, timezone, notificationsEnabled: true, permission: "unsupported", meals: [], actions: [] }), null);

const actionCandidate = getNotificationCandidate({ now: base, timezone, notificationsEnabled: true, permission: "granted", meals: [], actions: [{ title: "Drink water", completed: false, status: "upcoming", dueAt: "2026-08-25T07:00:00.000Z" }] });
assert.equal(actionCandidate?.category, "action");
assert.equal(actionCandidate?.title, "Your Neulifi action is still waiting");
assert.equal(getNotificationCandidate({ now: base, timezone, notificationsEnabled: true, permission: "granted", meals: [], actions: [{ title: "Done", completed: true, status: "completed", dueAt: "2026-08-25T07:00:00.000Z" }] }), null);
assert.equal(getNotificationCandidate({ now: base, timezone, notificationsEnabled: true, permission: "granted", meals: [], actions: [{ title: "Missed", completed: false, status: "missed", dueAt: "2026-08-25T07:00:00.000Z" }] }), null);

const mealCandidate = getNotificationCandidate({ now: base, timezone, notificationsEnabled: true, permission: "granted", meals: [{ capturedAt: "2026-08-25T03:30:00.000Z" }], actions: [] });
assert.equal(mealCandidate?.category, "meal");
assert.equal(mealCandidate?.title, "Ready to log your next meal?");
assert.equal(getNotificationCandidate({ now: base, timezone, notificationsEnabled: true, permission: "granted", meals: [{ capturedAt: "2026-08-25T07:30:00.000Z" }], actions: [] }), null);

const weeklyCandidate = getNotificationCandidate({ now: base, timezone, notificationsEnabled: true, permission: "granted", meals: [{ capturedAt: "2026-08-25T07:30:00.000Z" }, { capturedAt: "2026-08-24T07:30:00.000Z" }, { capturedAt: "2026-08-23T07:30:00.000Z" }], actions: [] });
assert.equal(weeklyCandidate?.category, "weekly");
assert.equal(getNotificationCandidate({ now: base, timezone, notificationsEnabled: true, permission: "granted", meals: [{ capturedAt: "2026-08-25T07:30:00.000Z" }, { capturedAt: "2026-08-24T07:30:00.000Z" }, { capturedAt: "2026-08-23T07:30:00.000Z" }], actions: [], sentToday: 1 }), null);
assert.equal(getNotificationCandidate({ now: base, timezone, notificationsEnabled: true, permission: "granted", meals: [{ capturedAt: "2026-08-25T07:30:00.000Z" }, { capturedAt: "2026-08-24T07:30:00.000Z" }, { capturedAt: "2026-08-23T07:30:00.000Z" }], actions: [], sentThisWeek: 3 }), null);

assert.equal(notificationDayHistoryKey("user-1", timezone, base), "neulifi-notification-day:user-1:2026-08-25");
assert.equal(notificationWeekHistoryKey("user-1", timezone, base), "neulifi-notification-week:user-1:2026-08-24");
assert.equal(notificationHistoryKey("user-1", { category: "action", localDate: "2026-08-25" }), "neulifi-notification:user-1:action:2026-08-25");

console.log("notification-policy: all deterministic scenarios passed");
