import assert from "node:assert/strict";
import test from "node:test";
import { currentGreeting, getTimeOfDay, greetingForHour } from "../src/lib/timeGreeting.ts";

test("uses morning from 5:00 through 11:59", () => {
  assert.equal(getTimeOfDay(5), "morning");
  assert.equal(getTimeOfDay(11.99), "morning");
  assert.equal(greetingForHour(8, "Neulifi QA"), "Good morning, Neulifi QA");
});

test("uses afternoon from 12:00 through 16:59", () => {
  assert.equal(getTimeOfDay(12), "afternoon");
  assert.equal(getTimeOfDay(16.99), "afternoon");
  assert.equal(greetingForHour(14, "Neulifi QA"), "Good afternoon, Neulifi QA");
});

test("uses evening from 17:00 through 04:59", () => {
  assert.equal(getTimeOfDay(17), "evening");
  assert.equal(getTimeOfDay(23), "evening");
  assert.equal(getTimeOfDay(0), "evening");
  assert.equal(getTimeOfDay(4.99), "evening");
  assert.equal(greetingForHour(20, "Neulifi QA"), "Good evening, Neulifi QA");
});

test("currentGreeting reads the local hour from the supplied browser Date", () => {
  assert.equal(currentGreeting("Neulifi QA", new Date(2026, 7, 25, 15, 0)), "Good afternoon, Neulifi QA");
});
