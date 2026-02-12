import { invoke } from "@tauri-apps/api/core";

export type Phase = "focus" | "short_break" | "long_break";

export interface AppSettings {
  focus_seconds: number;
  short_break_seconds: number;
  long_break_seconds: number;
  long_break_every: number;
  daily_goal_minutes: number;
  auto_start_next_phase: boolean;
}

export interface AppTotals {
  total_focus_sessions: number;
  total_focus_seconds: number;
  total_break_seconds: number;
}

export interface SessionRecord {
  id: string;
  phase: Phase;
  started_at: number;
  ended_at: number;
  duration_seconds: number;
  completed: boolean;
}

export interface AppState {
  schema_version: number;
  settings: AppSettings;
  totals: AppTotals;
  sessions: SessionRecord[];
}

export interface AppStateResponse {
  state: AppState;
  warning: string | null;
}

export interface SavePhaseCompletionPayload {
  phase: Phase;
  started_at: number;
  ended_at: number;
  duration_seconds: number;
  completed: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  focus_seconds: 1500,
  short_break_seconds: 300,
  long_break_seconds: 900,
  long_break_every: 4,
  daily_goal_minutes: 100,
  auto_start_next_phase: false,
};

export const DEFAULT_STATE: AppState = {
  schema_version: 2,
  settings: DEFAULT_SETTINGS,
  totals: {
    total_focus_sessions: 0,
    total_focus_seconds: 0,
    total_break_seconds: 0,
  },
  sessions: [],
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function normalizeNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizePhase(value: unknown): Phase {
  if (value === "focus" || value === "short_break" || value === "long_break") {
    return value;
  }

  return "focus";
}

function normalizeSettings(input: unknown): AppSettings {
  if (!isObject(input)) {
    return { ...DEFAULT_SETTINGS };
  }

  return {
    focus_seconds: normalizeNumber(input.focus_seconds, DEFAULT_SETTINGS.focus_seconds),
    short_break_seconds: normalizeNumber(
      input.short_break_seconds,
      DEFAULT_SETTINGS.short_break_seconds,
    ),
    long_break_seconds: normalizeNumber(
      input.long_break_seconds,
      DEFAULT_SETTINGS.long_break_seconds,
    ),
    long_break_every: normalizeNumber(input.long_break_every, DEFAULT_SETTINGS.long_break_every),
    daily_goal_minutes: normalizeNumber(
      input.daily_goal_minutes,
      DEFAULT_SETTINGS.daily_goal_minutes,
    ),
    auto_start_next_phase:
      typeof input.auto_start_next_phase === "boolean"
        ? input.auto_start_next_phase
        : DEFAULT_SETTINGS.auto_start_next_phase,
  };
}

function normalizeTotals(input: unknown): AppTotals {
  if (!isObject(input)) {
    return { ...DEFAULT_STATE.totals };
  }

  return {
    total_focus_sessions: normalizeNumber(
      input.total_focus_sessions,
      DEFAULT_STATE.totals.total_focus_sessions,
    ),
    total_focus_seconds: normalizeNumber(
      input.total_focus_seconds,
      DEFAULT_STATE.totals.total_focus_seconds,
    ),
    total_break_seconds: normalizeNumber(
      input.total_break_seconds,
      DEFAULT_STATE.totals.total_break_seconds,
    ),
  };
}

function normalizeSession(input: unknown): SessionRecord | null {
  if (!isObject(input)) {
    return null;
  }

  return {
    id: typeof input.id === "string" ? input.id : "",
    phase: normalizePhase(input.phase),
    started_at: normalizeNumber(input.started_at, 0),
    ended_at: normalizeNumber(input.ended_at, 0),
    duration_seconds: normalizeNumber(input.duration_seconds, 0),
    completed: typeof input.completed === "boolean" ? input.completed : false,
  };
}

function normalizeState(input: unknown): AppState {
  if (!isObject(input)) {
    return { ...DEFAULT_STATE, settings: { ...DEFAULT_SETTINGS }, sessions: [] };
  }

  const sessions = Array.isArray(input.sessions)
    ? input.sessions
        .map((session) => normalizeSession(session))
        .filter((session): session is SessionRecord => session !== null)
    : [];

  return {
    schema_version: normalizeNumber(input.schema_version, 2),
    settings: normalizeSettings(input.settings),
    totals: normalizeTotals(input.totals),
    sessions,
  };
}

function parseAppStateResponse(raw: string): AppStateResponse {
  try {
    const parsed = JSON.parse(raw) as unknown;

    if (!isObject(parsed)) {
      return { state: normalizeState(null), warning: null };
    }

    return {
      state: normalizeState(parsed.state),
      warning: typeof parsed.warning === "string" ? parsed.warning : null,
    };
  } catch {
    return { state: normalizeState(null), warning: "Unable to parse app state response." };
  }
}

export async function loadAppState(): Promise<AppStateResponse> {
  const raw = await invoke<string>("load_app_state");
  return parseAppStateResponse(raw);
}

export async function savePhaseCompletion(
  payload: SavePhaseCompletionPayload,
): Promise<AppStateResponse> {
  const raw = await invoke<string>("save_phase_completion", {
    payloadJson: JSON.stringify(payload),
  });
  return parseAppStateResponse(raw);
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await invoke("save_settings", {
    payloadJson: JSON.stringify(settings),
  });
}

export function getPhaseDuration(settings: AppSettings, phase: Phase): number {
  if (phase === "focus") {
    return settings.focus_seconds;
  }

  if (phase === "short_break") {
    return settings.short_break_seconds;
  }

  return settings.long_break_seconds;
}

function isDateToday(date: Date): boolean {
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

export function getTodayFocusSessions(state: AppState): number {
  return state.sessions.reduce((count, session) => {
    if (session.phase !== "focus" || !session.completed) {
      return count;
    }

    const date = new Date(session.ended_at * 1000);
    return isDateToday(date) ? count + 1 : count;
  }, 0);
}

export function getTodayFocusMinutes(state: AppState): number {
  const seconds = state.sessions.reduce((total, session) => {
    if (session.phase !== "focus" || !session.completed) {
      return total;
    }

    const date = new Date(session.ended_at * 1000);
    return isDateToday(date) ? total + session.duration_seconds : total;
  }, 0);

  return Math.floor(seconds / 60);
}
