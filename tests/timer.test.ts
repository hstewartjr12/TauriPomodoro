import test from "node:test";
import assert from "node:assert/strict";
import { remainingAt, nextPhase, formatTime } from "../src/lib/timer.ts";
test("deadline timing catches up after sleeping or background throttling", () => {
  const deadline = 100000;
  assert.equal(remainingAt(deadline, 0), 100);
  assert.equal(remainingAt(deadline, 75001), 25);
  assert.equal(remainingAt(deadline, 110000), 0);
});
test("long breaks follow the completed fourth focus and breaks return to focus", () => {
  assert.equal(nextPhase("focus", 1, 4), "short_break");
  assert.equal(nextPhase("focus", 3, 4), "short_break");
  assert.equal(nextPhase("focus", 4, 4), "long_break");
  assert.equal(nextPhase("long_break", 4, 4), "focus");
});
test("time formatting stays nonnegative and supports long sessions", () => {
  assert.equal(formatTime(1500), "25:00");
  assert.equal(formatTime(7200), "120:00");
  assert.equal(formatTime(-5), "00:00");
});
