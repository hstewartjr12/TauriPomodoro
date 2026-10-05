import type { Phase } from "./appState.ts";
export function remainingAt(deadline: number, now = Date.now()): number {
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}
export function nextPhase(
  phase: Phase,
  completedFocusCount: number,
  longBreakEvery: number,
): Phase {
  return phase === "focus"
    ? completedFocusCount % longBreakEvery === 0
      ? "long_break"
      : "short_break"
    : "focus";
}
export function formatTime(seconds: number): string {
  const safe = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(safe / 60)
    .toString()
    .padStart(2, "0")}:${(safe % 60).toString().padStart(2, "0")}`;
}
