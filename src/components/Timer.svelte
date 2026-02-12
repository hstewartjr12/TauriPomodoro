<script lang="ts">
  import {
    isPermissionGranted,
    requestPermission,
    sendNotification,
  } from "@tauri-apps/plugin-notification";
  import { createEventDispatcher, onDestroy, onMount } from "svelte";
  import {
    DEFAULT_SETTINGS,
    getPhaseDuration,
    getTodayFocusMinutes,
    loadAppState,
    savePhaseCompletion,
    type AppSettings,
    type Phase,
  } from "../lib/appState";

  export let refreshKey = 0;

  const dispatch = createEventDispatcher<{ sessionCompleted: undefined }>();

  let settings: AppSettings = { ...DEFAULT_SETTINGS };
  let currentPhase: Phase = "focus";
  let focusCountInCycle = 0;
  let activePhaseDuration = settings.focus_seconds;

  let remaining = activePhaseDuration;
  let isRunning = false;
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let phaseStartedAt: number | null = null;

  let displayTime = "25:00";
  let progress = 0;
  let currentPhaseLabel = "Focus";
  let cycleText = "Focus 1/4";
  let nextPhaseText = "Short break";

  let todayFocusMinutes = 0;
  let dailyGoalMinutes = settings.daily_goal_minutes;
  let dailyGoalProgressPercent = 0;

  let errorMessage = "";
  let warningMessage = "";

  let mounted = false;
  let lastRefreshKey = refreshKey;

  function nowSeconds(): number {
    return Math.floor(Date.now() / 1000);
  }

  function formatTime(totalSeconds: number): string {
    const safeSeconds = Math.max(totalSeconds, 0);
    const minutes = Math.floor(safeSeconds / 60)
      .toString()
      .padStart(2, "0");
    const seconds = (safeSeconds % 60).toString().padStart(2, "0");
    return `${minutes}:${seconds}`;
  }

  function phaseLabel(phase: Phase): string {
    if (phase === "focus") return "Focus";
    if (phase === "short_break") return "Short Break";
    return "Long Break";
  }

  function predictedNextPhase(): Phase {
    const interval = Math.max(settings.long_break_every, 1);

    if (currentPhase === "focus") {
      const nextFocusCount = (focusCountInCycle + 1) % interval;
      return nextFocusCount === 0 ? "long_break" : "short_break";
    }

    return "focus";
  }

  function applyGoalMetrics() {
    dailyGoalMinutes = Math.max(settings.daily_goal_minutes, 1);
    dailyGoalProgressPercent = Math.min(
      100,
      Math.round((todayFocusMinutes / dailyGoalMinutes) * 100),
    );
  }

  async function loadState(initializePhase: boolean) {
    try {
      const response = await loadAppState();
      settings = response.state.settings;
      warningMessage = response.warning ?? "";

      const interval = Math.max(settings.long_break_every, 1);
      focusCountInCycle = response.state.totals.total_focus_sessions % interval;
      todayFocusMinutes = getTodayFocusMinutes(response.state);
      applyGoalMetrics();

      if (initializePhase) {
        currentPhase = "focus";
        activePhaseDuration = getPhaseDuration(settings, currentPhase);
        remaining = activePhaseDuration;
        phaseStartedAt = null;
      } else if (!isRunning) {
        activePhaseDuration = getPhaseDuration(settings, currentPhase);
        remaining = activePhaseDuration;
        phaseStartedAt = null;
      }
    } catch (error) {
      errorMessage =
        error instanceof Error ? error.message : "Failed to load app state.";
    }
  }

  function start() {
    if (isRunning) return;

    errorMessage = "";
    isRunning = true;

    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }

    if (phaseStartedAt === null) {
      phaseStartedAt = nowSeconds();
    }

    intervalId = setInterval(() => {
      remaining = Math.max(remaining - 1, 0);
      if (remaining === 0) {
        void completeSession();
      }
    }, 1000);
  }

  function pause() {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
    isRunning = false;
  }

  function reset() {
    pause();
    remaining = activePhaseDuration;
    phaseStartedAt = null;
    errorMessage = "";
  }

  async function notifyPhaseComplete(phase: Phase) {
    let granted = await isPermissionGranted();
    if (!granted) {
      granted = (await requestPermission()) === "granted";
    }

    if (!granted) return;

    if (phase === "focus") {
      sendNotification({
        title: "Focus complete",
        body: "Great work. Start your break when you're ready.",
      });
      return;
    }

    sendNotification({
      title: "Break complete",
      body: "Ready to jump back into focus.",
    });
  }

  async function completeSession() {
    pause();

    const endedAt = nowSeconds();
    const startedAt =
      phaseStartedAt ?? Math.max(endedAt - activePhaseDuration, 0);

    try {
      const response = await savePhaseCompletion({
        phase: currentPhase,
        started_at: startedAt,
        ended_at: endedAt,
        duration_seconds: activePhaseDuration,
        completed: true,
      });

      settings = response.state.settings;
      warningMessage = response.warning ?? "";
      todayFocusMinutes = getTodayFocusMinutes(response.state);
      applyGoalMetrics();

      if (currentPhase === "focus") {
        focusCountInCycle =
          (focusCountInCycle + 1) % Math.max(settings.long_break_every, 1);
      }

      const nextPhase = predictedNextPhase();
      await notifyPhaseComplete(currentPhase);

      currentPhase = nextPhase;
      activePhaseDuration = getPhaseDuration(settings, currentPhase);
      remaining = activePhaseDuration;
      phaseStartedAt = null;
      errorMessage = "";

      dispatch("sessionCompleted");
    } catch (error) {
      remaining = activePhaseDuration;
      phaseStartedAt = null;
      errorMessage =
        error instanceof Error
          ? error.message
          : "Failed to save completed session.";
    }
  }

  onMount(() => {
    mounted = true;
    void loadState(true);
  });

  onDestroy(() => {
    pause();
  });

  $: if (mounted && refreshKey !== lastRefreshKey) {
    lastRefreshKey = refreshKey;
    void loadState(false);
  }

  $: currentPhaseLabel = phaseLabel(currentPhase);
  $: cycleText =
    currentPhase === "focus"
      ? `Focus ${Math.min(focusCountInCycle + 1, Math.max(settings.long_break_every, 1))}/${Math.max(settings.long_break_every, 1)}`
      : `Next Focus ${(focusCountInCycle % Math.max(settings.long_break_every, 1)) + 1}/${Math.max(settings.long_break_every, 1)}`;
  $: nextPhaseText = phaseLabel(predictedNextPhase());
  $: displayTime = formatTime(remaining);
  $: progress =
    activePhaseDuration > 0
      ? ((activePhaseDuration - remaining) / activePhaseDuration) * 100
      : 0;
</script>

<div class="timer-wrap">
  <p class="label">{currentPhaseLabel}</p>
  <p class="meta">{cycleText}</p>

  <p class:active={isRunning} class="time">{displayTime}</p>

  <p class="goal-progress">
    Today's focus: {todayFocusMinutes} / {dailyGoalMinutes} min ({dailyGoalProgressPercent}%)
  </p>

  <p class="next-phase">Next phase: {nextPhaseText}</p>

  <div class="progress-track" role="progressbar" aria-valuenow={progress}>
    <span class="progress-fill" style={`width: ${progress}%`}></span>
  </div>

  <div class="controls">
    <button on:click={start} disabled={isRunning}>Start</button>
    <button on:click={pause} disabled={!isRunning}>Pause</button>
    <button on:click={reset}>Reset</button>
  </div>

  {#if warningMessage}
    <p class="warning">{warningMessage}</p>
  {/if}

  {#if errorMessage}
    <p class="error">{errorMessage}</p>
  {/if}
</div>

<style>
  .timer-wrap {
    display: flex;
    flex-direction: column;
    gap: clamp(0.65rem, 1.8vh, 0.95rem);
  }

  .label {
    margin: 0;
    font-size: 0.9rem;
    color: #95a3b8;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  .meta {
    margin: -0.25rem 0 0;
    color: #87a7c4;
    font-size: 0.86rem;
  }

  .time {
    margin: 0;
    font-size: clamp(2.7rem, 11vw, 5.6rem);
    line-height: 1;
    font-weight: 700;
    letter-spacing: 0.03em;
    color: #f5f8ff;
    transition: color 0.2s ease;
  }

  .time.active {
    color: #4dd7b1;
  }

  .goal-progress {
    margin: 0;
    color: #9dc0df;
    font-size: 0.9rem;
  }

  .next-phase {
    margin: -0.25rem 0 0;
    color: #b1c0d3;
    font-size: 0.85rem;
  }

  .progress-track {
    height: 10px;
    border-radius: 999px;
    background: #252f40;
    overflow: hidden;
  }

  .progress-fill {
    display: block;
    height: 100%;
    border-radius: 999px;
    background: linear-gradient(90deg, #24c6a9, #7ef2cd);
    transition: width 0.25s ease;
  }

  .controls {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.6rem;
  }

  button {
    border: none;
    border-radius: 12px;
    width: 100%;
    padding: clamp(0.55rem, 1.5vh, 0.75rem) 0.8rem;
    background: #202a3a;
    color: #e7edf8;
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
    transition: transform 0.15s ease, background-color 0.15s ease;
  }

  button:hover:enabled {
    background: #2b3850;
    transform: translateY(-1px);
  }

  button:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }

  .warning {
    margin: 0;
    color: #ffd88a;
    font-size: 0.85rem;
  }

  .error {
    margin: 0;
    color: #ff9f9f;
    font-size: 0.9rem;
  }

  @media (max-width: 420px) {
    .time {
      font-size: clamp(2.4rem, 18vw, 3.2rem);
    }
  }

  @media (max-height: 760px) {
    .time {
      font-size: clamp(2.4rem, 8vh, 4rem);
    }
  }
</style>
