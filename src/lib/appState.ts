import { invoke, isTauri } from "@tauri-apps/api/core";

export type Phase = "focus" | "short_break" | "long_break";
export interface AppSettings {
  focus_seconds: number;
  short_break_seconds: number;
  long_break_seconds: number;
  long_break_every: number;
  daily_goal_minutes: number;
  auto_start_next_phase: boolean;
}
export interface FocusTask {
  id: string;
  title: string;
  completed: boolean;
  created_at: number;
}
export interface SessionRecord {
  id: string;
  phase: Phase;
  started_at: number;
  ended_at: number;
  duration_seconds: number;
  completed: boolean;
  intention: string;
  task_id: string | null;
}
export interface AppState {
  schema_version: number;
  settings: AppSettings;
  totals: {
    total_focus_sessions: number;
    total_focus_seconds: number;
    total_break_seconds: number;
  };
  sessions: SessionRecord[];
  tasks: FocusTask[];
}
export interface AppStateResponse {
  state: AppState;
  warning: string | null;
}
export interface SavePhaseCompletionPayload extends Omit<SessionRecord, "id"> {
  id: string;
}
export const DEFAULT_SETTINGS: AppSettings = {
  focus_seconds: 1500,
  short_break_seconds: 300,
  long_break_seconds: 900,
  long_break_every: 4,
  daily_goal_minutes: 100,
  auto_start_next_phase: false,
};
export function emptyState(): AppState {
  return {
    schema_version: 3,
    settings: { ...DEFAULT_SETTINGS },
    totals: {
      total_focus_sessions: 0,
      total_focus_seconds: 0,
      total_break_seconds: 0,
    },
    sessions: [],
    tasks: [],
  };
}
export const DEFAULT_STATE = emptyState();
const STORAGE_KEY = "focusforge:state:v3";
const OLD_STORAGE_KEY = "focusforge:state:v2";
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}
function number(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback;
}
export function validateSettings(settings: AppSettings): void {
  const ranges: [keyof AppSettings, number, number, string][] = [
    ["focus_seconds", 300, 7200, "Focus must be 5–120 minutes."],
    ["short_break_seconds", 60, 1800, "Short breaks must be 1–30 minutes."],
    ["long_break_seconds", 300, 3600, "Long breaks must be 5–60 minutes."],
    ["long_break_every", 2, 8, "Take a long break every 2–8 focus sessions."],
    ["daily_goal_minutes", 10, 1440, "Daily goal must be 10–1,440 minutes."],
  ];
  for (const [key, min, max, message] of ranges) {
    const value = settings[key];
    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < min ||
      value > max
    )
      throw new Error(message);
  }
}
function normalize(input: unknown): AppState {
  if (!object(input)) return emptyState();
  const state = emptyState();
  if (object(input.settings)) {
    for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof AppSettings)[]) {
      if (key === "auto_start_next_phase")
        state.settings[key] = input.settings[key] === true;
      else
        state.settings[key] = number(
          input.settings[key],
          DEFAULT_SETTINGS[key],
        );
    }
    try {
      validateSettings(state.settings);
    } catch {
      state.settings = { ...DEFAULT_SETTINGS };
    }
  }
  if (object(input.totals)) {
    for (const key of Object.keys(state.totals) as (keyof AppState["totals"])[])
      state.totals[key] = number(input.totals[key]);
  }
  if (Array.isArray(input.sessions))
    state.sessions = input.sessions.filter(object).map((session) => ({
      id: typeof session.id === "string" ? session.id : crypto.randomUUID(),
      phase:
        session.phase === "long_break" || session.phase === "short_break"
          ? session.phase
          : "focus",
      started_at: number(session.started_at),
      ended_at: number(session.ended_at),
      duration_seconds: number(session.duration_seconds),
      completed: session.completed === true,
      intention: typeof session.intention === "string" ? session.intention : "",
      task_id: typeof session.task_id === "string" ? session.task_id : null,
    }));
  if (Array.isArray(input.tasks))
    state.tasks = input.tasks
      .filter(object)
      .filter(
        (task) => typeof task.id === "string" && typeof task.title === "string",
      )
      .map((task) => ({
        id: String(task.id),
        title: String(task.title).slice(0, 160),
        completed: task.completed === true,
        created_at: number(task.created_at),
      }));
  return state;
}
function parseResponse(raw: string): AppStateResponse {
  const value: unknown = JSON.parse(raw);
  if (!object(value)) throw new Error("The saved state could not be read.");
  return {
    state: normalize(value.state),
    warning: typeof value.warning === "string" ? value.warning : null,
  };
}
function loadBrowser(): AppStateResponse {
  const raw =
    localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(OLD_STORAGE_KEY);
  if (!raw) return { state: emptyState(), warning: null };
  try {
    return { state: normalize(JSON.parse(raw)), warning: null };
  } catch {
    throw new Error(
      "Saved browser data is unreadable. Export or clear it in your browser before continuing.",
    );
  }
}
function writeBrowser(state: AppState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    throw new Error(
      "Unable to save locally. Check available storage or private browsing settings.",
    );
  }
}
export async function loadAppState(): Promise<AppStateResponse> {
  return isTauri()
    ? parseResponse(await invoke<string>("load_app_state"))
    : loadBrowser();
}
export async function savePhaseCompletion(
  payload: SavePhaseCompletionPayload,
): Promise<AppStateResponse> {
  if (
    !payload.id ||
    payload.id.length > 128 ||
    !Number.isInteger(payload.duration_seconds) ||
    payload.duration_seconds < 1 ||
    payload.duration_seconds > 86400 ||
    payload.ended_at < payload.started_at ||
    payload.intention.length > 160
  )
    throw new Error(
      "The session could not be saved because its details are invalid.",
    );
  if (isTauri())
    return parseResponse(
      await invoke<string>("save_phase_completion", {
        payloadJson: JSON.stringify(payload),
      }),
    );
  const response = loadBrowser();
  if (!response.state.sessions.some((session) => session.id === payload.id)) {
    response.state.sessions.push(payload);
    const totals = response.state.totals;
    if (payload.phase === "focus") {
      totals.total_focus_seconds += payload.duration_seconds;
      if (payload.completed) totals.total_focus_sessions += 1;
    } else totals.total_break_seconds += payload.duration_seconds;
    writeBrowser(response.state);
  }
  return response;
}
export async function saveSettings(settings: AppSettings): Promise<void> {
  validateSettings(settings);
  if (isTauri())
    await invoke("save_settings", { payloadJson: JSON.stringify(settings) });
  else {
    const { state } = loadBrowser();
    state.settings = settings;
    writeBrowser(state);
  }
}
export async function saveTasks(tasks: FocusTask[]): Promise<void> {
  if (tasks.length > 500)
    throw new Error("Keep your list to 500 intentions or fewer.");
  const ids = new Set<string>();
  for (const task of tasks) {
    if (
      !task.id ||
      task.id.length > 128 ||
      ids.has(task.id) ||
      !task.title.trim() ||
      task.title.length > 160
    )
      throw new Error(
        "Intentions need unique IDs and a title of 1–160 characters.",
      );
    ids.add(task.id);
  }
  if (isTauri())
    await invoke("save_tasks", { payloadJson: JSON.stringify(tasks) });
  else {
    const { state } = loadBrowser();
    state.tasks = tasks;
    writeBrowser(state);
  }
}
export function getPhaseDuration(settings: AppSettings, phase: Phase): number {
  return phase === "focus"
    ? settings.focus_seconds
    : phase === "short_break"
      ? settings.short_break_seconds
      : settings.long_break_seconds;
}
export function isSameDay(timestamp: number, date = new Date()): boolean {
  return new Date(timestamp * 1000).toDateString() === date.toDateString();
}
export function getTodayFocusMinutes(
  state: AppState,
  date = new Date(),
): number {
  return Math.floor(
    state.sessions
      .filter(
        (session) =>
          session.phase === "focus" && isSameDay(session.ended_at, date),
      )
      .reduce((seconds, session) => seconds + session.duration_seconds, 0) / 60,
  );
}
export function getTodayFocusSessions(
  state: AppState,
  date = new Date(),
): number {
  return state.sessions.filter(
    (session) =>
      session.phase === "focus" &&
      session.completed &&
      isSameDay(session.ended_at, date),
  ).length;
}
