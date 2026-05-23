import { test } from "node:test";
import assert from "node:assert/strict";
import { formatSavedAgo } from "./save-status";

const BASE = 1_700_000_000_000;

test("formatSavedAgo: under 5s reads as 'just now'", () => {
  assert.equal(formatSavedAgo(BASE + 0, BASE), "Saved just now");
  assert.equal(formatSavedAgo(BASE + 4_000, BASE), "Saved just now");
});

test("formatSavedAgo: 5s..59s tick in seconds", () => {
  assert.equal(formatSavedAgo(BASE + 5_000, BASE), "Saved 5s ago");
  assert.equal(formatSavedAgo(BASE + 42_000, BASE), "Saved 42s ago");
  assert.equal(formatSavedAgo(BASE + 59_999, BASE), "Saved 59s ago");
});

test("formatSavedAgo: minutes, hours, days", () => {
  assert.equal(formatSavedAgo(BASE + 60_000, BASE), "Saved 1m ago");
  assert.equal(formatSavedAgo(BASE + 17 * 60_000, BASE), "Saved 17m ago");
  assert.equal(formatSavedAgo(BASE + 3 * 3_600_000, BASE), "Saved 3h ago");
  assert.equal(formatSavedAgo(BASE + 2 * 86_400_000, BASE), "Saved 2d ago");
});

test("formatSavedAgo: clock skew (now < lastSavedAt) clamps to 'just now'", () => {
  assert.equal(formatSavedAgo(BASE - 5_000, BASE), "Saved just now");
});
