import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SETTINGS,
  loadAppState,
  savePhaseCompletion,
  saveSettings,
  saveTasks,
} from "../src/lib/appState.ts";
const data = new Map<string, string>();
Object.defineProperty(globalThis, "window", { value: {}, configurable: true });
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
  },
  configurable: true,
});
test("browser persistence retains intentions and settings across reloads", async () => {
  data.clear();
  await saveTasks([
    {
      id: "task-1",
      title: "Write my next chapter",
      completed: false,
      created_at: 1000,
    },
  ]);
  await saveSettings({
    ...DEFAULT_SETTINGS,
    focus_seconds: 3000,
    auto_start_next_phase: true,
  });
  const { state } = await loadAppState();
  assert.equal(state.tasks[0].title, "Write my next chapter");
  assert.equal(state.settings.focus_seconds, 3000);
  assert.equal(state.settings.auto_start_next_phase, true);
});
test("recovered completions are idempotent and partial work counts as time", async () => {
  data.clear();
  const payload = {
    id: "session-1",
    phase: "focus" as const,
    started_at: 1000,
    ended_at: 2500,
    duration_seconds: 1500,
    completed: true,
    intention: "My intention",
    task_id: null,
  };
  await savePhaseCompletion(payload);
  await savePhaseCompletion(payload);
  const result = await savePhaseCompletion({
    ...payload,
    id: "session-2",
    completed: false,
    duration_seconds: 120,
  });
  assert.equal(result.state.sessions.length, 2);
  assert.equal(result.state.totals.total_focus_sessions, 1);
  assert.equal(result.state.totals.total_focus_seconds, 1620);
});
test("invalid settings and corrupt browser data fail without overwriting history", async () => {
  data.clear();
  await assert.rejects(
    saveSettings({ ...DEFAULT_SETTINGS, focus_seconds: 0 }),
    /Focus must/,
  );
  data.set("focusforge:state:v3", "malformed");
  await assert.rejects(loadAppState(), /unreadable/);
  assert.equal(data.get("focusforge:state:v3"), "malformed");
});
