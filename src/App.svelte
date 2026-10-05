<script lang="ts">
  import { onMount } from "svelte";
  import { isTauri } from "@tauri-apps/api/core";
  import {
    isPermissionGranted,
    requestPermission,
    sendNotification,
  } from "@tauri-apps/plugin-notification";
  import Icon from "./components/Icon.svelte";
  import {
    emptyState,
    getPhaseDuration,
    getTodayFocusMinutes,
    getTodayFocusSessions,
    isSameDay,
    loadAppState,
    savePhaseCompletion,
    saveSettings,
    saveTasks,
    type AppSettings,
    type FocusTask,
    type Phase,
    type SavePhaseCompletionPayload,
  } from "./lib/appState";
  import { formatTime, nextPhase, remainingAt } from "./lib/timer";

  let state = emptyState();
  let view: "focus" | "insights" = "focus";
  let loading = true;
  let storageReady = false;
  let error = "";
  let notice = "";
  let storageWarning = "";
  let phase: Phase = "focus";
  let remaining = 1500;
  let duration = 1500;
  let running = false;
  let deadline: number | null = null;
  let startedAt: number | null = null;
  let sessionId: string | null = null;
  let completedCount = 0;
  let finishing = false;
  let intention = "";
  let activeTaskId: string | null = null;
  let runIntention = "";
  let runTaskId: string | null = null;
  let taskDraft = "";
  let addingTask = false;
  let taskInput: HTMLInputElement;
  let taskBusy = false;
  let showCompleted = false;
  let showSettings = false;
  let showHelp = false;
  let resetDialog = false;
  let pendingPhase: Phase | null = null;
  let settingsBusy = false;
  let settingsError = "";
  let focusMinutes = 25;
  let shortMinutes = 5;
  let longMinutes = 15;
  let longEvery = 4;
  let goalMinutes = 100;
  let autoStart = false;
  let soundEnabled = true;
  let notificationsEnabled = false;
  let draftSoundEnabled = true;
  let timeNow = new Date();
  let historyFilter = "all";
  let historyLimit = 12;
  let feedbackTimeout: ReturnType<typeof setTimeout>;
  const runtimeKey = "focusforge:active:v3";
  const phases: { id: Phase; label: string; icon: string }[] = [
    { id: "focus", label: "Focus", icon: "focus" },
    { id: "short_break", label: "Short break", icon: "coffee" },
    { id: "long_break", label: "Long break", icon: "leaf" },
  ];
  const phaseLabel = (value: Phase) =>
    phases.find((item) => item.id === value)?.label ?? "Focus";
  const minutesLabel = (seconds: number) =>
    seconds < 3600
      ? `${Math.floor(seconds / 60)}m`
      : `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;

  $: todayMinutes = getTodayFocusMinutes(state, timeNow);
  $: todaySessions = getTodayFocusSessions(state, timeNow);
  $: goalProgress = Math.min(
    100,
    (todayMinutes / state.settings.daily_goal_minutes) * 100,
  );
  $: activeTasks = state.tasks.filter((task) => !task.completed);
  $: doneTasks = state.tasks.filter((task) => task.completed);
  $: timerProgress = duration ? (duration - remaining) / duration : 0;
  $: displayPhase = phaseLabel(phase);
  $: next = nextPhase(
    phase,
    completedCount + (phase === "focus" ? 1 : 0),
    state.settings.long_break_every,
  );
  $: cycleNumber = (completedCount % state.settings.long_break_every) + 1;
  $: week = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(timeNow);
    day.setDate(day.getDate() - 6 + index);
    const minutes = Math.floor(
      state.sessions
        .filter(
          (session) =>
            session.phase === "focus" && isSameDay(session.ended_at, day),
        )
        .reduce((total, session) => total + session.duration_seconds, 0) / 60,
    );
    return {
      day,
      minutes,
      label: day.toLocaleDateString("en", { weekday: "short" }),
      today: index === 6,
    };
  });
  $: weekTotal = week.reduce((total, day) => total + day.minutes, 0);
  $: weekMax = Math.max(30, ...week.map((day) => day.minutes));
  $: activeDays = week.filter((day) => day.minutes > 0).length;
  $: history = [...state.sessions]
    .reverse()
    .filter(
      (session) => historyFilter === "all" || session.phase === historyFilter,
    );
  $: dayLabel = timeNow.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  $: if (!loading)
    document.title = running
      ? `${formatTime(remaining)} · ${displayPhase} — FocusForge`
      : "FocusForge — Make time for what matters";

  function feedback(message: string) {
    notice = message;
    clearTimeout(feedbackTimeout);
    feedbackTimeout = setTimeout(() => (notice = ""), 4200);
  }
  function rememberTimer() {
    try {
      if (!startedAt) {
        localStorage.removeItem(runtimeKey);
        return;
      }
      localStorage.setItem(
        runtimeKey,
        JSON.stringify({
          phase,
          remaining,
          duration,
          running,
          deadline,
          startedAt,
          sessionId,
          runIntention,
          runTaskId,
          completedCount,
        }),
      );
    } catch {
      storageWarning =
        "Timer recovery is unavailable in this browser. Keep this window open during your session.";
    }
  }
  function restoreTimer() {
    try {
      const raw = localStorage.getItem(runtimeKey);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (
        !phases.some((item) => item.id === saved.phase) ||
        !Number.isFinite(saved.duration) ||
        saved.duration < 60 ||
        saved.duration > 7200 ||
        !Number.isFinite(saved.remaining) ||
        saved.remaining < 0 ||
        saved.remaining > saved.duration ||
        typeof saved.sessionId !== "string" ||
        !Number.isFinite(saved.startedAt)
      )
        return;
      if (state.sessions.some((session) => session.id === saved.sessionId)) {
        localStorage.removeItem(runtimeKey);
        return;
      }
      phase = saved.phase;
      duration = saved.duration;
      remaining = saved.remaining;
      startedAt = saved.startedAt;
      sessionId = saved.sessionId;
      deadline = Number.isFinite(saved.deadline) ? saved.deadline : null;
      running = saved.running === true && deadline !== null;
      runIntention =
        typeof saved.runIntention === "string" ? saved.runIntention : "";
      runTaskId = typeof saved.runTaskId === "string" ? saved.runTaskId : null;
      intention = runIntention;
      activeTaskId = runTaskId;
      if (running && deadline !== null) remaining = remainingAt(deadline);
      feedback(
        running
          ? "Your focus session is restored."
          : "Your paused session is ready when you are.",
      );
      if (remaining === 0) void finish(true);
    } catch {
      storageWarning =
        "The previous timer could not be restored. Your saved history is safe.";
    }
  }
  async function load() {
    try {
      const response = await loadAppState();
      state = response.state;
      storageWarning = response.warning ?? "";
      completedCount = state.totals.total_focus_sessions;
      duration = state.settings.focus_seconds;
      remaining = duration;
      soundEnabled = localStorage.getItem("focusforge:sound") !== "false";
      notificationsEnabled =
        localStorage.getItem("focusforge:notifications") === "true";
      storageReady = true;
      loading = false;
      restoreTimer();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
      loading = false;
    }
  }
  function startPause() {
    if (loading || !storageReady || finishing || remaining === 0) return;
    error = "";
    if (running) {
      remaining = remainingAt(deadline!);
      if (remaining === 0) {
        void finish(true);
        return;
      }
      running = false;
      deadline = null;
    } else {
      if (startedAt === null) {
        startedAt = Math.floor(Date.now() / 1000);
        sessionId = crypto.randomUUID();
        runIntention = phase === "focus" ? intention.trim() : "";
        runTaskId = phase === "focus" ? activeTaskId : null;
      }
      deadline = Date.now() + remaining * 1000;
      running = true;
    }
    rememberTimer();
  }
  function setPhase(value: Phase) {
    phase = value;
    duration = getPhaseDuration(state.settings, phase);
    remaining = duration;
    running = false;
    deadline = null;
    startedAt = null;
    sessionId = null;
    runIntention = "";
    runTaskId = null;
    rememberTimer();
  }
  function requestReset(value: Phase | null = null) {
    if (finishing || loading) return;
    if (startedAt !== null && duration - remaining > 0) {
      if (running) startPause();
      pendingPhase = value;
      resetDialog = true;
    } else setPhase(value ?? phase);
  }
  async function notify(completedPhase: Phase) {
    if (soundEnabled) {
      try {
        const context = new AudioContext();
        for (const [index, frequency] of [523.25, 659.25].entries()) {
          const oscillator = context.createOscillator();
          const gain = context.createGain();
          oscillator.connect(gain);
          gain.connect(context.destination);
          oscillator.frequency.value = frequency;
          const time = context.currentTime + index * 0.16;
          gain.gain.setValueAtTime(0, time);
          gain.gain.linearRampToValueAtTime(0.07, time + 0.015);
          gain.gain.exponentialRampToValueAtTime(0.001, time + 0.38);
          oscillator.start(time);
          oscillator.stop(time + 0.4);
        }
        setTimeout(() => void context.close(), 850);
      } catch {
        /* Audio is optional; persistence and phase transition still succeed. */
      }
    }
    if (!notificationsEnabled) return;
    const title =
      completedPhase === "focus"
        ? "A little progress, well earned."
        : "Ready for a fresh start?";
    const body =
      completedPhase === "focus"
        ? "Your focus session is saved. Take a moment to recharge."
        : "Your break is over. Choose your next intention.";
    try {
      if (isTauri()) {
        if (await isPermissionGranted()) sendNotification({ title, body });
      } else if (
        "Notification" in window &&
        Notification.permission === "granted"
      )
        new Notification(title, { body });
    } catch {
      /* Notifications must never prevent a timer from finishing. */
    }
  }
  async function finish(completed: boolean) {
    if (finishing || startedAt === null || sessionId === null) return;
    const finishedPhase = phase;
    if (running && deadline !== null) remaining = remainingAt(deadline);
    running = false;
    deadline = null;
    finishing = true;
    const elapsed = completed ? duration : Math.max(0, duration - remaining);
    if (elapsed < 1) {
      finishing = false;
      setPhase(pendingPhase ?? phase);
      resetDialog = false;
      return;
    }
    const payload: SavePhaseCompletionPayload = {
      id: sessionId,
      phase,
      started_at: startedAt,
      ended_at: Math.floor(Date.now() / 1000),
      duration_seconds: elapsed,
      completed,
      intention: runIntention,
      task_id: runTaskId,
    };
    rememberTimer();
    try {
      const response = await savePhaseCompletion(payload);
      state = response.state;
      storageWarning = response.warning ?? "";
      completedCount = state.totals.total_focus_sessions;
      const following = completed
        ? nextPhase(
            finishedPhase,
            completedCount,
            state.settings.long_break_every,
          )
        : (pendingPhase ?? phase);
      resetDialog = false;
      pendingPhase = null;
      setPhase(following);
      error = "";
      feedback(
        completed
          ? `${phaseLabel(finishedPhase)} complete. ${finishedPhase === "focus" ? "Your break is ready." : "Time for a fresh intention."}`
          : `${minutesLabel(elapsed)} saved to your history.`,
      );
      finishing = false;
      if (completed) {
        void notify(finishedPhase);
        if (state.settings.auto_start_next_phase) startPause();
      }
    } catch (cause) {
      error = `Your session hasn’t been saved. ${cause instanceof Error ? cause.message : String(cause)}`;
      finishing = false;
    }
  }
  async function updateTasks(tasks: FocusTask[]) {
    taskBusy = true;
    try {
      await saveTasks(tasks);
      state = { ...state, tasks };
      error = "";
      return true;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
      return false;
    } finally {
      taskBusy = false;
    }
  }
  async function addTask(title = taskDraft) {
    const cleaned = title.trim().slice(0, 160);
    if (!cleaned || taskBusy) return;
    const task: FocusTask = {
      id: crypto.randomUUID(),
      title: cleaned,
      completed: false,
      created_at: Math.floor(Date.now() / 1000),
    };
    if (await updateTasks([...state.tasks, task])) {
      taskDraft = "";
      addingTask = false;
      if (!startedAt) selectTask(task);
      feedback("Intention added to your list.");
    }
  }
  function selectTask(task: FocusTask) {
    if (startedAt !== null) {
      feedback("Finish or reset your current session to change its intention.");
      return;
    }
    activeTaskId = task.id;
    intention = task.title;
  }
  async function toggleTask(task: FocusTask) {
    if (taskBusy) return;
    if (
      await updateTasks(
        state.tasks.map((item) =>
          item.id === task.id ? { ...item, completed: !item.completed } : item,
        ),
      )
    ) {
      if (activeTaskId === task.id && !startedAt && !task.completed) {
        activeTaskId = null;
        intention = "";
      }
      feedback(
        task.completed
          ? "Intention returned to your list."
          : "One more thing, done. Nicely focused.",
      );
    }
  }
  async function deleteTask(task: FocusTask) {
    if (
      (await updateTasks(state.tasks.filter((item) => item.id !== task.id))) &&
      activeTaskId === task.id &&
      !startedAt
    ) {
      activeTaskId = null;
      intention = "";
    }
  }
  function openSettings() {
    const settings = state.settings;
    focusMinutes = settings.focus_seconds / 60;
    shortMinutes = settings.short_break_seconds / 60;
    longMinutes = settings.long_break_seconds / 60;
    longEvery = settings.long_break_every;
    goalMinutes = settings.daily_goal_minutes;
    autoStart = settings.auto_start_next_phase;
    settingsError = "";
    draftSoundEnabled = soundEnabled;
    showSettings = true;
  }
  async function applySettings() {
    settingsBusy = true;
    settingsError = "";
    const settings: AppSettings = {
      focus_seconds: focusMinutes * 60,
      short_break_seconds: shortMinutes * 60,
      long_break_seconds: longMinutes * 60,
      long_break_every: longEvery,
      daily_goal_minutes: goalMinutes,
      auto_start_next_phase: autoStart,
    };
    try {
      await saveSettings(settings);
      state = { ...state, settings };
      if (!startedAt) {
        duration = getPhaseDuration(settings, phase);
        remaining = duration;
      }
      soundEnabled = draftSoundEnabled;
      localStorage.setItem("focusforge:sound", String(soundEnabled));
      showSettings = false;
      feedback(
        startedAt
          ? "Preferences saved. Timer lengths apply to your next session."
          : "Your focus rhythm is updated.",
      );
    } catch (cause) {
      settingsError = cause instanceof Error ? cause.message : String(cause);
    } finally {
      settingsBusy = false;
    }
  }
  async function enableNotifications() {
    try {
      const granted = isTauri()
        ? (await isPermissionGranted()) ||
          (await requestPermission()) === "granted"
        : "Notification" in window &&
          (await Notification.requestPermission()) === "granted";
      notificationsEnabled = granted;
      localStorage.setItem("focusforge:notifications", String(granted));
      settingsError = granted
        ? ""
        : "Notifications are blocked. You can enable them in your system or browser settings.";
    } catch {
      settingsError = "Notifications are unavailable on this device.";
    }
  }
  function exportHistory() {
    const rows = [
      ["Phase", "Intention", "Started", "Ended", "Minutes", "Completed"],
      ...state.sessions.map((session) => [
        phaseLabel(session.phase),
        session.intention,
        new Date(session.started_at * 1000).toISOString(),
        new Date(session.ended_at * 1000).toISOString(),
        (session.duration_seconds / 60).toFixed(2),
        String(session.completed),
      ]),
    ];
    const csv = rows
      .map((row) =>
        row
          .map(
            (cell) =>
              `"${(/^\s*[=+\-@\t\r]/.test(cell) ? "'" + cell : cell).replace(/"/g, '""')}"`,
          )
          .join(","),
      )
      .join("\r\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8;" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `focusforge-history-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    feedback("Your session history has been exported.");
  }
  function keydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      showSettings = false;
      showHelp = false;
      resetDialog = false;
      addingTask = false;
      return;
    }
    const target = event.target as HTMLElement;
    if (
      target.matches("input, textarea, select, button") ||
      target.isContentEditable ||
      showSettings ||
      showHelp ||
      resetDialog ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey
    )
      return;
    if (event.code === "Space") {
      event.preventDefault();
      startPause();
    }
    if (event.key.toLowerCase() === "r") requestReset();
    if (event.key.toLowerCase() === "s") openSettings();
    if (event.key === "?") showHelp = true;
  }
  function modalFocus(node: HTMLElement) {
    const previous = document.activeElement as HTMLElement;
    const elements = () =>
      Array.from(
        node.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input, select, [tabindex="0"]',
        ),
      );
    elements()[0]?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = elements();
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    node.addEventListener("keydown", trap);
    return {
      destroy() {
        node.removeEventListener("keydown", trap);
        previous?.focus();
      },
    };
  }
  onMount(() => {
    void load();
    const interval = setInterval(() => {
      timeNow = new Date();
      if (running && deadline !== null) {
        remaining = remainingAt(deadline);
        if (remaining === 0) void finish(true);
      }
    }, 250);
    const onVisibility = () => {
      if (running && deadline !== null) {
        remaining = remainingAt(deadline);
        if (remaining === 0) void finish(true);
      }
    };
    const onStorage = (event: StorageEvent) => {
      if (!isTauri() && event.key === "focusforge:state:v3")
        void loadAppState()
          .then((response) => (state = response.state))
          .catch(() => {});
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("storage", onStorage);
    return () => {
      clearInterval(interval);
      clearTimeout(feedbackTimeout);
      rememberTimer();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("storage", onStorage);
    };
  });
</script>

<svelte:window on:keydown={keydown} />
<div class="workspace">
  <aside class="sidebar">
    <a
      href="/"
      class="brand"
      on:click|preventDefault={() => (view = "focus")}
      aria-label="FocusForge home"
      ><span class="brand-mark"><Icon name="focus" size={23} /></span><span
        >FocusForge<span class="brand-caption">MAKE ROOM FOR FOCUS</span></span
      ></a
    >
    <span class="nav-heading">YOUR WORKSPACE</span>
    <nav aria-label="Main navigation">
      <button class:chosen={view === "focus"} on:click={() => (view = "focus")}
        ><Icon name="focus" />Focus space<span class="nav-dot"></span></button
      >
      <button
        class:chosen={view === "insights"}
        on:click={() => (view = "insights")}
        ><Icon name="chart" />Insights</button
      >
    </nav>
    <div class="sidebar-note">
      <span class="little-leaf"><Icon name="leaf" size={26} /></span>
      <p>Great things happen<br />one session at a time.</p>
      <span>Find your rhythm. Keep going.</span>
    </div>
    <div class="sidebar-bottom">
      <button on:click={openSettings}
        ><Icon name="settings" />Preferences</button
      ><button on:click={() => (showHelp = true)}
        ><Icon name="keyboard" />Keyboard shortcuts</button
      >
      <div class="local-status">
        <span></span>{isTauri()
          ? "Saved on your device"
          : "Saved in this browser"}
      </div>
    </div>
  </aside>
  <main>
    <header class="topbar">
      <div class="breadcrumb">
        Your workspace <span>/</span>
        <strong>{view === "focus" ? "Focus space" : "Insights"}</strong>
      </div>
      <span class="date"><Icon name="sun" size={17} />{dayLabel}</span><button
        class="mobile-settings icon-button"
        aria-label="Preferences"
        on:click={openSettings}><Icon name="settings" /></button
      >
    </header>
    <div class="page-content">
      <section class="page-heading">
        <div>
          <p class="eyebrow">
            {view === "focus"
              ? "A LITTLE FOCUS, EVERY DAY"
              : "THE BIGGER PICTURE"}
          </p>
          <h1>
            {view === "focus"
              ? "Make time for what matters."
              : "Small sessions. Real progress."}
          </h1>
          <p>
            {view === "focus"
              ? "One intention. One session. A little closer to where you want to be."
              : "Look back at your rhythm, and make room for what comes next."}
          </p>
        </div>
        <span class="heading-tag"
          ><span></span>{running ? "In your flow" : "Your space to focus"}</span
        >
      </section>
      {#if error}<div class="message error" role="alert">
          <Icon name="spark" /><span>{error}</span
          >{#if remaining === 0 && startedAt}<button
              on:click={() => finish(true)}
              disabled={finishing}>Retry save</button
            >{/if}
        </div>{/if}
      {#if storageWarning}<div class="message warning" role="status">
          {storageWarning}
        </div>{/if}
      {#if view === "focus"}
        <div class="focus-layout">
          <section class="timer-card" aria-label="Focus timer">
            <div class="mode-tabs" aria-label="Timer phase">
              {#each phases as item}<button
                  class:active={phase === item.id}
                  aria-pressed={phase === item.id}
                  disabled={finishing || loading || !storageReady}
                  on:click={() => requestReset(item.id)}
                  ><Icon name={item.icon} size={16} />{item.label}</button
                >{/each}
            </div>
            <div
              class="timer-display"
              class:break-mode={phase !== "focus"}
              class:running
            >
              <svg class="timer-ring" viewBox="0 0 320 320" aria-hidden="true"
                ><circle class="ring-track" cx="160" cy="160" r="146" /><circle
                  class="ring-progress"
                  cx="160"
                  cy="160"
                  r="146"
                  stroke-dasharray="917.35"
                  stroke-dashoffset={917.35 * (1 - timerProgress)}
                /><circle class="ring-dot" cx="160" cy="14" r="5" /></svg
              >
              <div class="timer-content">
                <span class="timer-eyebrow"
                  >{running
                    ? phase === "focus"
                      ? "STAY WITH THIS MOMENT"
                      : "TAKE A LITTLE BREATHER"
                    : startedAt
                      ? "A MOMENT TO PAUSE"
                      : phase === "focus"
                        ? "A FRESH START AWAITS"
                        : "YOU’VE EARNED A BREAK"}</span
                >
                <div
                  class="timer-time"
                  role="timer"
                  aria-label={`${displayPhase}, ${formatTime(remaining)} remaining`}
                >
                  {formatTime(remaining)}
                </div>
                <span class="timer-subtitle"
                  >{phase === "focus"
                    ? `Session ${cycleNumber} of ${state.settings.long_break_every}`
                    : phase === "short_break"
                      ? "Stretch. Breathe. Reset."
                      : "Step away. Come back fresh."}</span
                >
                <div
                  class="cycle-dots"
                  aria-label={`${cycleNumber} of ${state.settings.long_break_every} sessions`}
                >
                  {#each Array(state.settings.long_break_every) as _, index}<span
                      class:done={index <
                        completedCount % state.settings.long_break_every}
                      class:current={phase === "focus" &&
                        index ===
                          completedCount % state.settings.long_break_every}
                    ></span>{/each}
                </div>
              </div>
            </div>
            <div class="timer-controls">
              <button
                class="reset-button"
                on:click={() => requestReset()}
                aria-label="Reset timer"
                title="Reset (R)"
                disabled={finishing || loading || !storageReady}
                ><Icon name="reset" size={19} /></button
              ><button
                class="start-button"
                on:click={startPause}
                disabled={finishing ||
                  loading ||
                  !storageReady ||
                  remaining === 0}
                ><Icon name={running ? "pause" : "play"} size={19} />{finishing
                  ? "Saving session…"
                  : running
                    ? "Pause session"
                    : startedAt
                      ? "Resume session"
                      : phase === "focus"
                        ? "Start focusing"
                        : "Start your break"}</button
              ><span class="shortcut-hint"
                ><kbd>space</kbd> to {running ? "pause" : "start"}</span
              >
            </div>
            <div class="timer-footer">
              <span
                ><span class="mini-dot"></span>{running
                  ? "Every minute is a little progress."
                  : phase === "focus"
                    ? "Clear your desk. Take a breath. You’ve got this."
                    : "A good break is part of good work."}</span
              ><span
                >Up next <strong>{phaseLabel(next)}</strong><Icon
                  name="arrow"
                  size={14}
                /></span
              >
            </div>
          </section>
          <section class="intentions-card" aria-labelledby="intentions-title">
            <div class="card-heading">
              <div>
                <span class="eyebrow">A LITTLE DIRECTION</span>
                <h2 id="intentions-title">What’s on your mind?</h2>
              </div>
              <span class="soft-icon"><Icon name="list" size={20} /></span>
            </div>
            <p class="card-intro">Give this session one clear intention.</p>
            <label class="intention-label" for="intention">THIS SESSION</label>
            <div class="intention-input">
              <Icon name="focus" size={17} /><input
                id="intention"
                placeholder="What would you like to work on?"
                maxlength="160"
                bind:value={intention}
                disabled={startedAt !== null}
                on:input={() => (activeTaskId = null)}
              />
            </div>
            <div class="list-heading">
              <span>Up next <small>{activeTasks.length}</small></span><button
                class="text-button"
                on:click={() => {
                  addingTask = !addingTask;
                  setTimeout(() => taskInput?.focus(), 0);
                }}
                disabled={taskBusy}
                ><Icon name="plus" size={15} />Add intention</button
              >
            </div>
            {#if addingTask}<form
                class="add-task"
                on:submit|preventDefault={() => addTask()}
              >
                <input
                  bind:this={taskInput}
                  bind:value={taskDraft}
                  maxlength="160"
                  aria-label="New intention"
                  placeholder="Something you’d like to make progress on"
                /><button
                  class="icon-button"
                  aria-label="Save intention"
                  disabled={!taskDraft.trim() || taskBusy}
                  ><Icon name="arrow" size={18} /></button
                >
              </form>{/if}
            <div class="task-list">
              {#each activeTasks as task (task.id)}<div
                  class="task-row"
                  class:selected={activeTaskId === task.id}
                >
                  <button
                    class="task-check"
                    aria-label={`Complete ${task.title}`}
                    on:click={() => toggleTask(task)}
                    disabled={taskBusy}
                  ></button><button
                    class="task-title"
                    on:click={() => selectTask(task)}
                    >{task.title}{#if activeTaskId === task.id}<span
                        >ON YOUR RADAR</span
                      >{/if}</button
                  ><button
                    class="task-delete"
                    aria-label={`Delete ${task.title}`}
                    on:click={() => deleteTask(task)}
                    disabled={taskBusy}><Icon name="close" size={15} /></button
                  >
                </div>{/each}
              {#if activeTasks.length === 0 && !addingTask}<div
                  class="empty-intentions"
                >
                  <div class="empty-art">
                    <span></span><span></span><span></span><Icon
                      name="leaf"
                      size={23}
                    />
                  </div>
                  <h3>A clear mind starts here.</h3>
                  <p>
                    Add a few intentions, then take them<br />one focused
                    session at a time.
                  </p>
                  <button
                    class="text-button"
                    on:click={() => {
                      addingTask = true;
                      setTimeout(() => taskInput?.focus(), 0);
                    }}
                    ><Icon name="plus" size={15} />Add your first intention</button
                  >
                </div>{/if}
            </div>
            {#if doneTasks.length}<button
                class="completed-toggle"
                on:click={() => (showCompleted = !showCompleted)}
                ><Icon name="check" size={14} />{doneTasks.length} intention{doneTasks.length ===
                1
                  ? ""
                  : "s"} completed<span>{showCompleted ? "Hide" : "Show"}</span
                ></button
              >{#if showCompleted}<div class="completed-list">
                  {#each doneTasks as task}<div class="task-row completed">
                      <button
                        class="task-check"
                        aria-label={`Reopen ${task.title}`}
                        on:click={() => toggleTask(task)}
                        ><Icon name="check" size={12} /></button
                      ><span class="task-title">{task.title}</span><button
                        class="task-delete"
                        aria-label={`Delete ${task.title}`}
                        on:click={() => deleteTask(task)}
                        ><Icon name="close" size={15} /></button
                      >
                    </div>{/each}
                </div>{/if}{/if}
            <div class="intention-note">
              <Icon name="spark" size={15} />Progress over perfection. Always.
            </div>
          </section>
        </div>
        <div class="overview-grid">
          <section class="goal-card">
            <div class="small-heading">
              <span>TODAY’S PROGRESS</span><Icon name="sun" size={19} />
            </div>
            <div class="goal-number">
              {todayMinutes}<span
                >/ {state.settings.daily_goal_minutes} min</span
              >
            </div>
            <div
              class="goal-track"
              role="progressbar"
              aria-label="Daily focus goal"
              aria-valuemin="0"
              aria-valuemax={state.settings.daily_goal_minutes}
              aria-valuenow={todayMinutes}
            >
              <span style={`width:${goalProgress}%`}></span>
            </div>
            <p>
              {goalProgress >= 100
                ? "Daily goal reached. Make room to recharge."
                : `${Math.max(0, state.settings.daily_goal_minutes - todayMinutes)} minutes to your daily goal.`}
            </p>
            <div class="goal-foot">
              <Icon name="check" size={15} />{todaySessions} focus session{todaySessions ===
              1
                ? ""
                : "s"} completed
            </div>
          </section>
          <section class="rhythm-card">
            <div class="small-heading">
              <span>YOUR FOCUS RHYTHM</span><button
                class="text-button"
                on:click={() => (view = "insights")}
                >View insights<Icon name="arrow" size={14} /></button
              >
            </div>
            <div class="rhythm-body">
              <div>
                <div class="week-number">{minutesLabel(weekTotal * 60)}</div>
                <p>focused this week</p>
                <span class="week-caption"
                  >{activeDays
                    ? `A little progress on ${activeDays} of 7 days`
                    : "Your next session starts your story"}</span
                >
              </div>
              <div
                class="week-chart"
                aria-label="Focus minutes over the last seven days"
              >
                {#each week as day}<div
                    class="chart-column"
                    title={`${day.label}: ${day.minutes} minutes`}
                  >
                    <span class="bar-value">{day.minutes}m</span>
                    <div class="bar-space">
                      <span
                        class:today={day.today}
                        style={`height:${Math.max(4, (day.minutes / weekMax) * 64)}px`}
                      ></span>
                    </div>
                    <span class:today-label={day.today}>{day.label}</span>
                  </div>{/each}
              </div>
            </div>
          </section>
        </div>
        <div class="page-foot">
          <span
            ><Icon name="leaf" size={15} />A calmer way to get things done.</span
          ><span
            >FocusForge <span class="footer-dot">·</span> Your time, well spent.</span
          >
        </div>
      {:else}
        <div class="insight-metrics">
          <section>
            <span class="eyebrow">THIS WEEK</span><strong
              >{minutesLabel(weekTotal * 60)}</strong
            ><span>Time spent on what matters</span>
          </section>
          <section>
            <span class="eyebrow">YOUR CONSISTENCY</span><strong
              >{activeDays}<small> / 7 days</small></strong
            ><span>Days with a little progress</span>
          </section>
          <section>
            <span class="eyebrow">ALL TIME</span><strong
              >{state.totals.total_focus_sessions}<small>
                sessions</small
              ></strong
            ><span
              >{minutesLabel(state.totals.total_focus_seconds)} of focused time</span
            >
          </section>
        </div>
        <section class="insight-chart panel">
          <div class="card-heading">
            <div>
              <span class="eyebrow">ONE DAY AT A TIME</span>
              <h2>Your last seven days</h2>
            </div>
            <span class="chart-key"><span></span>Focused minutes</span>
          </div>
          <div class="large-chart">
            {#each week as day}<div class="large-column">
                <strong>{day.minutes}<small> min</small></strong>
                <div class="large-bar-space">
                  <span
                    class:today={day.today}
                    style={`height:${Math.max(4, (day.minutes / weekMax) * 150)}px`}
                  ></span>
                </div>
                <span class:today-label={day.today}>{day.label}</span><small
                  >{day.day.toLocaleDateString("en", {
                    month: "short",
                    day: "numeric",
                  })}</small
                >
              </div>{/each}
          </div>
        </section>
        <section class="history-card panel">
          <div class="card-heading">
            <div>
              <span class="eyebrow">LOOK HOW FAR YOU’VE COME</span>
              <h2>Session history</h2>
            </div>
            <button
              class="secondary-button"
              on:click={exportHistory}
              disabled={!state.sessions.length}
              ><Icon name="download" size={16} />Export CSV</button
            >
          </div>
          <div class="history-filter">
            <label for="history-filter">Show</label><select
              id="history-filter"
              bind:value={historyFilter}
              on:change={() => (historyLimit = 12)}
              ><option value="all">All sessions</option><option value="focus"
                >Focus sessions</option
              ><option value="short_break">Short breaks</option><option
                value="long_break">Long breaks</option
              ></select
            ><span
              >{history.length} session{history.length === 1 ? "" : "s"}</span
            >
          </div>
          {#if history.length}<div class="history-table">
              <div class="history-header">
                <span>Intention / session</span><span>When</span><span
                  >Duration</span
                ><span>Result</span>
              </div>
              {#each history.slice(0, historyLimit) as session}<div
                  class="history-row"
                >
                  <div class="history-name">
                    <span
                      class:break-icon={session.phase !== "focus"}
                      class="soft-icon"
                      ><Icon
                        name={session.phase === "focus" ? "focus" : "coffee"}
                        size={18}
                      /></span
                    >
                    <div>
                      <strong
                        >{session.intention ||
                          phaseLabel(session.phase)}</strong
                      ><small
                        >{phaseLabel(session.phase)}{session.completed
                          ? ""
                          : " · Ended early"}</small
                      >
                    </div>
                  </div>
                  <span
                    >{new Date(session.ended_at * 1000).toLocaleDateString(
                      "en",
                      { month: "short", day: "numeric" },
                    )}<small
                      >{new Date(session.ended_at * 1000).toLocaleTimeString(
                        "en",
                        { hour: "numeric", minute: "2-digit" },
                      )}</small
                    ></span
                  ><span>{minutesLabel(session.duration_seconds)}</span><span
                    class:partial={!session.completed}
                    class="result-badge"
                    >{session.completed ? "Completed" : "Ended early"}</span
                  >
                </div>{/each}
            </div>
            {#if history.length > historyLimit}<button
                class="secondary-button load-more"
                on:click={() => (historyLimit += 12)}>Show more sessions</button
              >{/if}{:else}<div class="history-empty">
              <span class="soft-icon"><Icon name="clock" size={27} /></span>
              <h3>
                {historyFilter === "all"
                  ? "Every session has a story."
                  : "No sessions in this view yet."}
              </h3>
              <p>
                {historyFilter === "all"
                  ? "Start your first focus session and your progress will appear here."
                  : "Try another filter or make a little time for this phase."}
              </p>
              <button class="secondary-button" on:click={() => (view = "focus")}
                >Go to your focus space<Icon name="arrow" size={16} /></button
              >
            </div>{/if}
        </section>
      {/if}
    </div>
  </main>
</div>
{#if notice}<div class="toast" role="status">
    <span><Icon name="check" size={17} /></span>{notice}
  </div>{/if}
{#if showSettings}
  <div class="modal-backdrop">
    <div
      class="modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
      tabindex="-1"
      use:modalFocus
    >
      <div class="modal-heading">
        <div>
          <span class="eyebrow">MAKE IT YOURS</span>
          <h2 id="settings-title">Find your rhythm.</h2>
        </div>
        <button
          class="icon-button"
          aria-label="Close preferences"
          on:click={() => (showSettings = false)}><Icon name="close" /></button
        >
      </div>
      <p class="modal-intro">Build a focus routine that works for you.</p>
      <form on:submit|preventDefault={applySettings}>
        <div class="settings-grid">
          <label
            >Focus session<span>5–120 minutes</span>
            <div>
              <input
                type="number"
                min="5"
                max="120"
                step="1"
                required
                bind:value={focusMinutes}
              /><span>min</span>
            </div></label
          ><label
            >Short break<span>1–30 minutes</span>
            <div>
              <input
                type="number"
                min="1"
                max="30"
                step="1"
                required
                bind:value={shortMinutes}
              /><span>min</span>
            </div></label
          ><label
            >Long break<span>5–60 minutes</span>
            <div>
              <input
                type="number"
                min="5"
                max="60"
                step="1"
                required
                bind:value={longMinutes}
              /><span>min</span>
            </div></label
          ><label
            >Long break after<span>2–8 focus sessions</span>
            <div>
              <input
                type="number"
                min="2"
                max="8"
                step="1"
                required
                bind:value={longEvery}
              /><span>sessions</span>
            </div></label
          ><label class="wide"
            >Daily focus goal<span
              >A little ambition, with room to breathe.</span
            >
            <div>
              <input
                type="number"
                min="10"
                max="1440"
                step="1"
                required
                bind:value={goalMinutes}
              /><span>min / day</span>
            </div></label
          >
        </div>
        <div class="setting-toggle">
          <div>
            <strong>Keep the rhythm going</strong><span
              >Automatically start the next focus or break phase.</span
            >
          </div>
          <input
            type="checkbox"
            class="switch"
            bind:checked={autoStart}
            aria-label="Automatically start next phase"
          />
        </div>
        <div class="setting-toggle">
          <div>
            <strong>A gentle completion sound</strong><span
              >A small chime when your session is done.</span
            >
          </div>
          <input
            type="checkbox"
            class="switch"
            bind:checked={draftSoundEnabled}
            aria-label="Completion sound"
          />
        </div>
        <div class="setting-toggle">
          <div>
            <strong>Session notifications</strong><span
              >{notificationsEnabled
                ? "Notifications are enabled on this device."
                : "Get a nudge, even when you’re in another window."}</span
            >
          </div>
          <button
            type="button"
            class="small-button"
            on:click={enableNotifications}
            >{notificationsEnabled ? "Enabled" : "Enable"}</button
          >
        </div>
        {#if settingsError}<p class="form-error" role="alert">
            {settingsError}
          </p>{/if}
        <p class="settings-note">
          {startedAt
            ? "Your current session keeps its original length. New lengths apply next time."
            : "All your intentions, preferences, and session history stay local."}
        </p>
        <div class="modal-actions">
          <button
            type="button"
            class="secondary-button"
            on:click={() => (showSettings = false)}>Cancel</button
          ><button class="primary-button" disabled={settingsBusy}
            >{settingsBusy ? "Saving…" : "Save preferences"}<Icon
              name="check"
              size={17}
            /></button
          >
        </div>
      </form>
    </div>
  </div>
{/if}
{#if resetDialog}
  <div class="modal-backdrop">
    <div
      class="modal compact-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reset-title"
      tabindex="-1"
      use:modalFocus
    >
      <div class="modal-heading">
        <h2 id="reset-title">Keep your little progress?</h2>
        <button
          class="icon-button"
          aria-label="Continue session"
          on:click={() => (resetDialog = false)}><Icon name="close" /></button
        >
      </div>
      <p>
        You’ve spent {minutesLabel(duration - remaining)} in this {phaseLabel(
          phase,
        ).toLowerCase()} session. Save it to your history before {pendingPhase
          ? "switching phases"
          : "starting fresh"}.
      </p>
      <div class="reset-actions">
        <button
          class="primary-button"
          on:click={() => finish(false)}
          disabled={finishing}
          >Save & {pendingPhase ? "switch" : "reset"}<Icon
            name="check"
            size={16}
          /></button
        ><button
          class="secondary-button"
          on:click={() => {
            setPhase(pendingPhase ?? phase);
            pendingPhase = null;
            resetDialog = false;
          }}>Discard this session</button
        ><button class="text-button" on:click={() => (resetDialog = false)}
          >Keep my session</button
        >
      </div>
    </div>
  </div>
{/if}
{#if showHelp}
  <div class="modal-backdrop">
    <div
      class="modal compact-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="help-title"
      tabindex="-1"
      use:modalFocus
    >
      <div class="modal-heading">
        <h2 id="help-title">A few handy shortcuts.</h2>
        <button
          class="icon-button"
          aria-label="Close shortcuts"
          on:click={() => (showHelp = false)}><Icon name="close" /></button
        >
      </div>
      <div class="shortcut-row">
        <span>Start or pause a session</span><kbd>Space</kbd>
      </div>
      <div class="shortcut-row"><span>Reset the timer</span><kbd>R</kbd></div>
      <div class="shortcut-row"><span>Open preferences</span><kbd>S</kbd></div>
      <div class="shortcut-row"><span>Show shortcuts</span><kbd>?</kbd></div>
      <div class="shortcut-row"><span>Close a dialog</span><kbd>Esc</kbd></div>
      <p class="settings-note">
        Shortcuts pause while you’re typing. Your space stays yours.
      </p>
    </div>
  </div>
{/if}

<style>
  :global(*) {
    box-sizing: border-box;
  }
  :global(body) {
    margin: 0;
    background: #f7f8f5;
    color: #273c35;
    font-family: "Avenir Next", Avenir, "Segoe UI", sans-serif;
    font-size: 14px;
    -webkit-font-smoothing: antialiased;
  }
  :global(button),
  :global(input),
  :global(select) {
    font: inherit;
  }
  :global(button) {
    cursor: pointer;
  }
  :global(button:disabled) {
    opacity: 0.5;
    cursor: not-allowed;
  }
  :global(button) {
    transition:
      background 0.16s,
      color 0.16s,
      transform 0.16s;
  }
  :global(button:focus-visible),
  :global(a:focus-visible),
  :global(input:focus-visible),
  :global(select:focus-visible) {
    outline: 3px solid #91b79a;
    outline-offset: 3px;
  }
  :global(button:hover:enabled) {
    filter: brightness(0.97);
  }
  :global(input),
  :global(select) {
    min-width: 0;
  }
  :global(h1),
  :global(h2),
  :global(h3),
  :global(p) {
    margin: 0;
  }
  :global(svg) {
    flex-shrink: 0;
  }
  :global(button svg) {
    pointer-events: none;
  }
  :global(kbd) {
    font-family: inherit;
  }
  .workspace {
    display: flex;
    min-height: 100vh;
  }
  .sidebar {
    width: 226px;
    flex: 0 0 226px;
    background: #fff;
    border-right: 1px solid #e6eae2;
    padding: 34px 21px 24px;
    display: flex;
    flex-direction: column;
    position: fixed;
    height: 100vh;
    z-index: 5;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 11px;
    color: #233c30;
    text-decoration: none;
    font-weight: 730;
    font-size: 19px;
    letter-spacing: -0.7px;
  }
  .brand-mark {
    width: 37px;
    height: 37px;
    background: #274736;
    color: #e8f1e4;
    display: grid;
    place-items: center;
    border-radius: 11px;
    box-shadow: 0 2px 4px #1b36241a;
  }
  .brand-caption {
    display: block;
    font-size: 9px;
    letter-spacing: 1.75px;
    color: #6f7972;
    font-weight: 650;
    margin-top: 5px;
  }
  .nav-heading {
    font-size: 9px;
    color: #727871;
    letter-spacing: 1.7px;
    font-weight: 650;
    margin: 54px 12px 16px;
  }
  nav {
    display: grid;
    gap: 8px;
  }
  nav button,
  .sidebar-bottom > button {
    display: flex;
    align-items: center;
    gap: 12px;
    border: 0;
    background: transparent;
    text-align: left;
    color: #6e7771;
    padding: 12px 13px;
    border-radius: 8px;
    font-size: 12px;
    font-weight: 600;
  }
  nav button.chosen {
    background: #edf3e8;
    color: #3d6244;
  }
  .nav-dot {
    margin-left: auto;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: #6c9265;
    display: none;
  }
  .chosen .nav-dot {
    display: block;
  }
  .sidebar-note {
    margin-top: auto;
    margin-bottom: auto;
    padding: 58px 13px 48px;
  }
  .little-leaf {
    color: #6c7a5c;
  }
  .sidebar-note p {
    font-size: 15px;
    line-height: 1.75;
    font-weight: 600;
    letter-spacing: -0.3px;
    margin-top: 15px;
  }
  .sidebar-note > span:last-child {
    display: block;
    color: #717871;
    font-size: 10px;
    margin-top: 12px;
  }
  .sidebar-bottom {
    display: grid;
    gap: 3px;
  }
  .sidebar-bottom > button {
    font-size: 11px;
    font-weight: 500;
  }
  .local-status {
    border-top: 1px solid #edf0e9;
    margin: 19px 10px 0;
    padding-top: 19px;
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 9px;
    color: #71786c;
  }
  .local-status span {
    width: 5px;
    height: 5px;
    background: #95a87f;
    border-radius: 50%;
  }
  main {
    flex: 1;
    min-width: 0;
    margin-left: 226px;
  }
  .topbar {
    height: 79px;
    border-bottom: 1px solid #e5e9e1;
    padding: 0 47px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .breadcrumb {
    font-size: 11px;
    color: #727873;
    display: flex;
    gap: 13px;
  }
  .breadcrumb span {
    color: #727670;
  }
  .breadcrumb strong {
    color: #6d786c;
    font-weight: 550;
  }
  .date {
    display: flex;
    align-items: center;
    gap: 9px;
    color: #70786c;
    font-size: 10px;
  }
  .date :global(svg) {
    color: #727962;
  }
  .mobile-settings {
    display: none !important;
  }
  .page-content {
    max-width: 1350px;
    margin: 0 auto;
    padding: 41px 47px 25px;
  }
  .page-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
    margin-bottom: 31px;
  }
  .eyebrow {
    font-size: 9px;
    letter-spacing: 1.7px;
    font-weight: 650;
    color: #717966;
  }
  h1 {
    font-weight: 600;
    font-size: 32px;
    letter-spacing: -1.3px;
    line-height: 1.3;
    margin-top: 11px;
  }
  .page-heading p:last-child {
    font-size: 11px;
    color: #70776e;
    line-height: 1.7;
    margin-top: 11px;
  }
  .heading-tag {
    display: flex;
    align-items: center;
    gap: 8px;
    background: #edf1e7;
    border: 1px solid #e1e8da;
    color: #6e7a5c;
    border-radius: 18px;
    padding: 9px 13px;
    font-size: 9px;
    white-space: nowrap;
  }
  .heading-tag span {
    height: 5px;
    width: 5px;
    background: #86a369;
    border-radius: 50%;
  }
  .focus-layout {
    display: grid;
    grid-template-columns: minmax(0, 1.5fr) minmax(295px, 1fr);
    gap: 22px;
  }
  .timer-card,
  .intentions-card,
  .goal-card,
  .rhythm-card,
  .panel {
    border: 1px solid #e2e8dd;
    background: white;
    border-radius: 13px;
  }
  .timer-card {
    padding: 23px 22px 0;
    background: linear-gradient(145deg, #fefefb, #fff);
    overflow: hidden;
  }
  .mode-tabs {
    display: flex;
    margin: auto;
    justify-content: center;
    gap: 4px;
    width: fit-content;
    border: 1px solid #edf0e7;
    padding: 4px;
    border-radius: 9px;
    background: #f8f9f4;
  }
  .mode-tabs button {
    border: 0;
    background: transparent;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    padding: 9px 13px;
    font-size: 10px;
    font-weight: 600;
    color: #70786c;
    border-radius: 6px;
    white-space: nowrap;
  }
  .mode-tabs button.active {
    background: #fff;
    color: #547a52;
    box-shadow: 0 1px 5px #2540230c;
    border: 1px solid #e9edde;
    padding: 8px 12px;
  }
  .timer-display {
    position: relative;
    width: 288px;
    height: 288px;
    margin: 25px auto 18px;
  }
  .timer-ring {
    position: absolute;
    width: 100%;
    height: 100%;
    overflow: visible;
  }
  .ring-track {
    fill: none;
    stroke: #eaf0e2;
    stroke-width: 2;
  }
  .ring-progress {
    fill: none;
    stroke: #769863;
    stroke-width: 3;
    stroke-linecap: round;
    transform: rotate(-90deg);
    transform-origin: 50%;
    transition: stroke-dashoffset 0.5s linear;
  }
  .ring-dot {
    fill: #749063;
    stroke: #fff;
    stroke-width: 2;
  }
  .break-mode .ring-progress {
    stroke: #8dada4;
  }
  .break-mode .ring-dot {
    fill: #8dada4;
  }
  .timer-content {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  }
  .timer-eyebrow {
    font-size: 9px;
    letter-spacing: 1.7px;
    color: #707868;
    font-weight: 650;
    margin-top: 9px;
  }
  .timer-time {
    font-size: 69px;
    line-height: 1.05;
    letter-spacing: -4px;
    color: #2c4937;
    font-weight: 450;
    margin-top: 18px;
    font-variant-numeric: tabular-nums;
  }
  .running .timer-time {
    color: #4b713e;
  }
  .timer-subtitle {
    font-size: 10px;
    color: #72776c;
    margin-top: 12px;
  }
  .cycle-dots {
    display: flex;
    gap: 7px;
    margin-top: 18px;
  }
  .cycle-dots span {
    width: 5px;
    height: 5px;
    background: #e5eadf;
    border-radius: 50%;
  }
  .cycle-dots span.current {
    background: #91a474;
    box-shadow: 0 0 0 3px #f0f3e9;
  }
  .cycle-dots span.done {
    background: #78965f;
  }
  .timer-controls {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 12px;
    margin-bottom: 25px;
  }
  .reset-button {
    width: 39px;
    height: 39px;
    background: #f9faf6;
    border: 1px solid #e7ecdf;
    border-radius: 8px;
    color: #72796a;
    display: grid;
    place-items: center;
  }
  .start-button,
  .primary-button {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 11px;
    background: #294b35;
    color: #f2f6eb;
    border: 1px solid #294b35;
    border-radius: 8px;
    font-size: 11px;
    font-weight: 600;
    padding: 12px 24px;
  }
  .start-button {
    min-width: 170px;
  }
  .start-button :global(svg) {
    stroke-width: 1.5;
  }
  .shortcut-hint {
    font-size: 9px;
    color: #747870;
    width: 61px;
    line-height: 1.5;
    display: none;
  }
  .shortcut-hint kbd {
    border: 1px solid #e8ecdf;
    border-radius: 3px;
    padding: 2px 3px;
  }
  .timer-footer {
    margin: 0 -22px;
    padding: 16px 20px;
    border-top: 1px solid #edf0e7;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    font-size: 9px;
    color: #72776c;
    background: #fafbf7;
  }
  .timer-footer > span {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .timer-footer strong {
    color: #707966;
    font-weight: 600;
  }
  .mini-dot {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: #9eb17f;
  }
  .intentions-card {
    padding: 26px 24px 0;
    display: flex;
    flex-direction: column;
  }
  .card-heading {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 15px;
  }
  .card-heading .eyebrow {
    font-size: 9px;
    letter-spacing: 1.5px;
  }
  .card-heading h2 {
    font-size: 19px;
    font-weight: 600;
    letter-spacing: -0.6px;
    margin-top: 8px;
  }
  .soft-icon {
    width: 35px;
    height: 35px;
    display: grid;
    place-items: center;
    border-radius: 9px;
    background: #f0f4e8;
    color: #707a61;
    flex-shrink: 0;
  }
  .card-intro {
    font-size: 10px;
    color: #72776c;
    margin-top: 10px;
  }
  .intention-label {
    font-size: 9px;
    color: #72796b;
    letter-spacing: 1.25px;
    margin-top: 28px;
    display: block;
    font-weight: 600;
  }
  .intention-input {
    display: flex;
    gap: 9px;
    border: 1px solid #e2e9d9;
    border-radius: 8px;
    align-items: center;
    padding: 11px 12px;
    margin-top: 9px;
    color: #707865;
    background: #fcfdf8;
  }
  .intention-input input {
    background: transparent;
    border: 0;
    font-size: 10px;
    width: 100%;
    outline: none;
    color: #536847;
  }
  .intention-input input::placeholder {
    color: #717869;
  }
  .intention-input input:disabled {
    opacity: 1;
    color: #5b704e;
  }
  .intention-input:focus-within {
    outline: 2px solid #adc096;
    outline-offset: 1px;
  }
  .list-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-top: 24px;
    color: #707962;
    font-size: 10px;
    font-weight: 600;
  }
  .list-heading small {
    font-size: 9px;
    color: #707860;
    background: #f0f4e8;
    border-radius: 4px;
    padding: 2px 5px;
    margin-left: 4px;
    font-weight: 500;
  }
  .text-button {
    border: 0;
    background: transparent;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    color: #6e7962;
    font-size: 9px;
  }
  .add-task {
    display: flex;
    gap: 7px;
    border: 1px solid #dce6d3;
    border-radius: 6px;
    padding: 5px;
    margin-top: 11px;
  }
  .add-task input {
    flex: 1;
    min-width: 0;
    border: 0;
    background: transparent;
    font-size: 10px;
    padding: 5px;
    outline: none;
  }
  .icon-button {
    width: 30px;
    height: 30px;
    display: grid;
    place-items: center;
    border: 0;
    background: transparent;
    color: #6f7869;
    border-radius: 6px;
  }
  .task-list {
    flex: 1;
    min-height: 169px;
  }
  .task-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 2px;
    border-bottom: 1px solid #f0f3e9;
  }
  .task-check {
    border: 1px solid #d8e0cc;
    background: white;
    width: 14px;
    height: 14px;
    border-radius: 4px;
    flex-shrink: 0;
    padding: 0;
    display: grid;
    place-items: center;
    color: #6a7a52;
  }
  .task-title {
    background: transparent;
    border: 0;
    flex: 1;
    text-align: left;
    font-size: 11px;
    line-height: 1.6;
    font-weight: 500;
    color: #707962;
    overflow-wrap: anywhere;
    padding: 0;
  }
  .task-title > span {
    display: block;
    font-size: 9px;
    letter-spacing: 1px;
    color: #717a61;
    margin-top: 2px;
  }
  .selected .task-title {
    color: #456637;
  }
  .task-delete {
    border: 0;
    background: transparent;
    color: #72776a;
    padding: 3px;
    display: grid;
    place-items: center;
    opacity: 0;
  }
  .task-row:hover .task-delete,
  .task-delete:focus-visible {
    opacity: 1;
  }
  .empty-intentions {
    text-align: center;
    padding: 22px 0 21px;
  }
  .empty-art {
    width: 53px;
    position: relative;
    height: 39px;
    margin: auto;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 7px 8px;
    background: #f3f6ed;
    border-radius: 5px;
    transform: rotate(-5deg);
  }
  .empty-art span {
    height: 2px;
    width: 30px;
    background: #e0e8d4;
    border-radius: 2px;
  }
  .empty-art span:nth-child(2) {
    width: 23px;
  }
  .empty-art span:nth-child(3) {
    width: 16px;
  }
  .empty-art :global(svg) {
    position: absolute;
    right: -7px;
    bottom: -5px;
    color: #6a7d51;
    transform: rotate(15deg);
  }
  .empty-intentions h3 {
    font-size: 11px;
    font-weight: 500;
    color: #707a66;
    margin-top: 15px;
  }
  .empty-intentions p {
    font-size: 9px;
    color: #73786c;
    line-height: 1.8;
    margin-top: 7px;
  }
  .empty-intentions button {
    margin: 12px auto 0;
    font-size: 9px;
  }
  .intention-note {
    margin: 0 -24px;
    padding: 16px 24px;
    border-top: 1px solid #edf0e6;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 9px;
    color: #727968;
    background: #fbfcf8;
    border-radius: 0 0 13px 13px;
  }
  .completed-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 9px;
    background: transparent;
    border: 0;
    color: #707a62;
    padding: 11px 0;
  }
  .completed-toggle span {
    margin-left: auto;
  }
  .completed .task-title {
    text-decoration: line-through;
    color: #72786a;
  }
  .completed .task-check {
    background: #ecf2e3;
  }
  .completed-list {
    max-height: 145px;
    overflow: auto;
  }
  .overview-grid {
    display: grid;
    grid-template-columns: 1fr 1.68fr;
    gap: 22px;
    margin-top: 22px;
  }
  .goal-card {
    padding: 23px 24px;
  }
  .small-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    color: #717965;
  }
  .small-heading > span {
    font-size: 9px;
    font-weight: 650;
    letter-spacing: 1.5px;
  }
  .goal-number {
    font-size: 34px;
    font-weight: 500;
    letter-spacing: -1px;
    line-height: 1;
    margin-top: 18px;
    color: #47643b;
  }
  .goal-number > span {
    font-size: 12px;
    font-weight: 400;
    color: #717867;
    letter-spacing: 0;
    margin-left: 6px;
  }
  .goal-track {
    height: 4px;
    background: #eef2e7;
    border-radius: 3px;
    margin-top: 19px;
    overflow: hidden;
  }
  .goal-track span {
    height: 100%;
    background: #8fae69;
    display: block;
    border-radius: 3px;
  }
  .goal-card > p {
    font-size: 9px;
    color: #727969;
    margin-top: 10px;
  }
  .goal-foot {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 9px;
    color: #6f7a63;
    border-top: 1px solid #edf1e5;
    margin-top: 18px;
    padding-top: 13px;
  }
  .rhythm-card {
    padding: 23px 25px;
  }
  .rhythm-body {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 25px;
    margin-top: 30px;
  }
  .week-number {
    font-size: 29px;
    font-weight: 500;
    letter-spacing: -1px;
    color: #526e43;
  }
  .rhythm-body p {
    font-size: 10px;
    color: #707866;
    margin-top: 5px;
  }
  .week-caption {
    font-size: 9px;
    color: #74786d;
    display: block;
    margin-top: 17px;
  }
  .week-chart {
    display: flex;
    justify-content: space-between;
    gap: 13px;
    flex: 1;
    max-width: 260px;
    padding-top: 10px;
  }
  .chart-column {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    font-size: 9px;
    color: #72776a;
  }
  .bar-space {
    height: 67px;
    display: flex;
    align-items: flex-end;
    width: 100%;
    justify-content: center;
    margin-bottom: 12px;
  }
  .bar-space > span {
    width: 14px;
    display: block;
    background: #e5ecd9;
    border-radius: 3px 3px 0 0;
  }
  .bar-space > span.today {
    background: #a3b987;
  }
  .bar-value {
    font-size: 9px;
    color: #73786c;
    margin-bottom: 4px;
    opacity: 0;
  }
  .chart-column:hover .bar-value {
    opacity: 1;
  }
  .today-label {
    color: #6c7c53 !important;
    font-weight: 600;
  }
  .page-foot {
    display: flex;
    justify-content: space-between;
    gap: 15px;
    margin-top: 27px;
    color: #74786e;
    font-size: 9px;
  }
  .page-foot > span {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .footer-dot {
    color: #74786d;
    margin: 0 2px;
  }
  .message {
    margin-bottom: 20px;
    padding: 13px 15px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 11px;
    line-height: 1.6;
  }
  .message.error {
    background: #fcf0e9;
    color: #a06748;
    border: 1px solid #ecd6c7;
  }
  .message button {
    margin-left: auto;
    border: 1px solid #d3ab94;
    border-radius: 5px;
    padding: 5px 8px;
    background: transparent;
    color: inherit;
  }
  .message.warning {
    background: #f5f2df;
    color: #827448;
    border: 1px solid #e6dec0;
  }
  .insight-metrics {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 20px;
  }
  .insight-metrics section {
    border: 1px solid #e2e8dd;
    background: white;
    border-radius: 12px;
    padding: 25px;
  }
  .insight-metrics strong {
    font-size: 32px;
    color: #557041;
    display: block;
    margin-top: 17px;
    font-weight: 500;
    letter-spacing: -1px;
  }
  .insight-metrics strong small {
    font-size: 13px;
    letter-spacing: 0;
    color: #707967;
    font-weight: 400;
  }
  .insight-metrics section > span:last-child {
    font-size: 10px;
    color: #71776a;
    display: block;
    margin-top: 9px;
  }
  .panel {
    margin-top: 22px;
    padding: 26px;
  }
  .chart-key {
    font-size: 9px;
    color: #707865;
    display: flex;
    align-items: center;
    gap: 7px;
  }
  .chart-key > span {
    height: 6px;
    width: 6px;
    background: #afc590;
    border-radius: 2px;
  }
  .large-chart {
    display: flex;
    gap: 24px;
    justify-content: space-around;
    margin-top: 28px;
  }
  .large-column {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    font-size: 10px;
    color: #707964;
    max-width: 110px;
  }
  .large-column > strong {
    font-size: 12px;
    font-weight: 500;
  }
  .large-column > strong small {
    font-size: 9px;
    font-weight: 400;
  }
  .large-bar-space {
    height: 150px;
    width: 100%;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    margin-top: 12px;
    border-bottom: 1px solid #e8eddf;
    margin-bottom: 13px;
  }
  .large-bar-space > span {
    display: block;
    width: 40%;
    background: #e4edd7;
    border-radius: 5px 5px 0 0;
  }
  .large-bar-space > span.today {
    background: #a6be88;
  }
  .large-column > small {
    font-size: 9px;
    color: #73786d;
    margin-top: 6px;
  }
  .secondary-button {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    padding: 9px 13px;
    background: white;
    border: 1px solid #e1e8d8;
    border-radius: 7px;
    color: #6e7a5f;
    font-size: 10px;
    font-weight: 500;
  }
  .history-filter {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 10px;
    color: #727867;
    border-top: 1px solid #eef1e7;
    padding-top: 22px;
    margin-top: 25px;
  }
  .history-filter select {
    border: 1px solid #e0e7d7;
    color: #6e7a5d;
    background: #fbfcf8;
    border-radius: 6px;
    padding: 7px 9px;
    font-size: 10px;
  }
  .history-filter > span {
    margin-left: auto;
    font-size: 9px;
  }
  .history-table {
    margin-top: 21px;
  }
  .history-header,
  .history-row {
    display: grid;
    grid-template-columns: minmax(0, 2fr) 1fr 0.7fr 0.8fr;
    gap: 15px;
    align-items: center;
    font-size: 10px;
  }
  .history-header {
    font-size: 9px;
    color: #72776a;
    text-transform: uppercase;
    letter-spacing: 1px;
    border-bottom: 1px solid #edf1e4;
    padding: 0 0 10px;
  }
  .history-row {
    padding: 14px 0;
    border-bottom: 1px solid #edf1e4;
    color: #707965;
  }
  .history-name {
    display: flex;
    gap: 12px;
    align-items: center;
    min-width: 0;
  }
  .history-name strong {
    font-size: 11px;
    font-weight: 500;
    color: #697c54;
    display: block;
    overflow-wrap: anywhere;
  }
  .history-row small {
    display: block;
    color: #72776a;
    font-size: 9px;
    margin-top: 4px;
  }
  .history-name .soft-icon {
    width: 32px;
    height: 32px;
  }
  .history-name .break-icon {
    background: #eef4f0;
    color: #6c7871;
  }
  .result-badge {
    display: block;
    background: #eef4e7;
    color: #6d7b59;
    padding: 5px 7px;
    width: fit-content;
    border-radius: 4px;
    font-size: 9px;
    white-space: nowrap;
  }
  .result-badge.partial {
    background: #f4f1e5;
    color: #807456;
  }
  .history-empty {
    display: flex;
    align-items: center;
    flex-direction: column;
    padding: 36px 0 25px;
    text-align: center;
  }
  .history-empty .soft-icon {
    width: 54px;
    height: 54px;
    border-radius: 15px;
  }
  .history-empty h3 {
    font-size: 16px;
    font-weight: 500;
    color: #6d7a59;
    margin-top: 19px;
  }
  .history-empty p {
    font-size: 11px;
    color: #727866;
    margin-top: 10px;
  }
  .history-empty button {
    margin-top: 20px;
  }
  .load-more {
    margin: 20px auto 0;
  }
  .toast {
    position: fixed;
    z-index: 30;
    bottom: 26px;
    left: calc(50% + 113px);
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 12px;
    color: #677b51;
    background: #fff;
    border: 1px solid #dce7cd;
    box-shadow: 0 7px 30px #23422b18;
    padding: 13px 20px;
    border-radius: 10px;
    font-size: 11px;
    max-width: min(90vw, 540px);
  }
  .toast > span {
    background: #eef4e6;
    border-radius: 50%;
    width: 25px;
    height: 25px;
    display: grid;
    place-items: center;
    flex-shrink: 0;
  }
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: #23352955;
    backdrop-filter: blur(5px);
    z-index: 20;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    overflow: auto;
  }
  .modal {
    width: 520px;
    background: #fff;
    border: 1px solid #e0e7d6;
    border-radius: 17px;
    padding: 30px;
    box-shadow: 0 20px 100px #18321f25;
    max-height: calc(100dvh - 48px);
    overflow: auto;
    outline: none;
  }
  .modal-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 15px;
  }
  .modal h2 {
    font-weight: 550;
    letter-spacing: -0.7px;
    font-size: 25px;
    margin-top: 7px;
  }
  .modal-intro {
    font-size: 11px;
    color: #707865;
    margin-top: 11px;
  }
  .settings-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 19px;
    margin-top: 27px;
  }
  .settings-grid label {
    font-size: 11px;
    color: #6d7a55;
    font-weight: 550;
  }
  .settings-grid label > span {
    display: block;
    color: #727869;
    font-size: 9px;
    font-weight: 400;
    margin-top: 5px;
  }
  .settings-grid label > div {
    display: flex;
    align-items: center;
    gap: 5px;
    border: 1px solid #e0e8d4;
    border-radius: 7px;
    background: #fcfdf9;
    margin-top: 9px;
    padding: 10px 11px;
  }
  .settings-grid input {
    border: 0;
    background: transparent;
    width: 100%;
    color: #6b7b53;
    outline: none;
    font-size: 12px;
  }
  .settings-grid label > div > span {
    font-size: 9px;
    color: #727866;
    white-space: nowrap;
  }
  .settings-grid label.wide {
    grid-column: 1/-1;
  }
  .setting-toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 15px;
    padding-top: 18px;
    margin-top: 18px;
    border-top: 1px solid #edf1e5;
  }
  .setting-toggle strong {
    font-size: 11px;
    font-weight: 550;
    color: #6e7a58;
  }
  .setting-toggle span {
    font-size: 9px;
    color: #727866;
    display: block;
    margin-top: 5px;
    line-height: 1.5;
  }
  .switch {
    appearance: none;
    height: 21px;
    width: 37px;
    background: #e7eddf;
    border-radius: 20px;
    position: relative;
    border: 0;
    cursor: pointer;
    flex-shrink: 0;
  }
  .switch::after {
    content: "";
    width: 15px;
    height: 15px;
    position: absolute;
    top: 3px;
    left: 3px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 4px #223f2520;
    transition: left 0.2s;
  }
  .switch:checked {
    background: #92ad71;
  }
  .switch:checked::after {
    left: 19px;
  }
  .small-button {
    font-size: 9px;
    background: #f3f7ec;
    border: 1px solid #e1ead6;
    color: #697c4f;
    border-radius: 6px;
    padding: 7px 10px;
  }
  .settings-note {
    font-size: 9px;
    color: #727868;
    line-height: 1.7;
    margin-top: 22px;
  }
  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 11px;
    margin-top: 25px;
  }
  .modal-actions .secondary-button {
    padding: 11px 16px;
  }
  .form-error {
    font-size: 10px;
    line-height: 1.6;
    color: #9b6a4c;
    background: #fcf3ea;
    padding: 10px;
    border-radius: 6px;
    margin-top: 17px;
  }
  .compact-modal {
    width: 430px;
    padding: 30px;
  }
  .compact-modal h2 {
    font-size: 21px;
  }
  .compact-modal > p {
    font-size: 12px;
    color: #707866;
    line-height: 1.9;
    margin-top: 17px;
  }
  .reset-actions {
    display: flex;
    flex-direction: column;
    gap: 11px;
    margin-top: 24px;
  }
  .reset-actions .text-button {
    padding: 9px;
  }
  .shortcut-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid #edf1e5;
    padding: 18px 0;
    font-size: 12px;
    color: #6f7862;
  }
  .shortcut-row kbd {
    border: 1px solid #dfe7d4;
    background: #f8faf3;
    border-radius: 5px;
    font-size: 10px;
    padding: 5px 8px;
    color: #6e7960;
  }
  @media (min-width: 1500px) {
    .shortcut-hint {
      display: block;
    }
    .timer-display {
      width: 310px;
      height: 310px;
    }
    .timer-time {
      font-size: 77px;
    }
    .page-content {
      padding-top: 50px;
    }
    .timer-controls {
      margin-bottom: 28px;
    }
    .empty-intentions {
      padding-top: 32px;
    }
    .rhythm-body {
      margin-top: 33px;
    }
    .timer-card {
      padding-top: 26px;
    }
  }
  @media (max-width: 1170px) {
    .sidebar {
      width: 190px;
      flex-basis: 190px;
      padding-left: 16px;
      padding-right: 16px;
    }
    .brand {
      font-size: 17px;
      gap: 8px;
    }
    .brand-caption {
      font-size: 9px;
    }
    .brand-mark {
      width: 33px;
      height: 33px;
    }
    main {
      margin-left: 190px;
    }
    .topbar {
      padding: 0 30px;
    }
    .page-content {
      padding: 32px 30px 24px;
    }
    h1 {
      font-size: 27px;
    }
    .heading-tag {
      display: none;
    }
    .focus-layout {
      grid-template-columns: minmax(0, 1.35fr) minmax(270px, 1fr);
      gap: 17px;
    }
    .timer-display {
      width: 260px;
      height: 260px;
    }
    .timer-time {
      font-size: 64px;
    }
    .timer-card {
      padding: 20px 17px 0;
    }
    .timer-footer {
      margin: 0 -17px;
      padding: 15px 13px;
      font-size: 9px;
    }
    .timer-footer > span:first-child {
      max-width: 150px;
      line-height: 1.5;
    }
    .timer-footer > span:last-child {
      gap: 4px;
    }
    .mode-tabs button {
      padding: 8px 9px;
      font-size: 9px;
      gap: 4px;
    }
    .mode-tabs button.active {
      padding: 7px 8px;
    }
    .intentions-card {
      padding: 23px 19px 0;
    }
    .card-heading h2 {
      font-size: 17px;
    }
    .intention-note {
      margin: 0 -19px;
      padding: 15px 19px;
    }
    .overview-grid {
      gap: 17px;
    }
    .goal-card {
      padding: 20px;
    }
    .rhythm-card {
      padding: 20px;
    }
    .rhythm-body {
      gap: 10px;
    }
    .week-chart {
      gap: 8px;
    }
    .week-caption {
      font-size: 9px;
    }
    .toast {
      left: calc(50% + 95px);
    }
  }
  @media (max-width: 970px) {
    .sidebar {
      width: 78px;
      flex-basis: 78px;
      padding: 27px 15px;
    }
    .brand > span:last-child,
    .nav-heading,
    .sidebar-note,
    .sidebar-bottom > button,
    .local-status {
      display: none;
    }
    .brand {
      justify-content: center;
    }
    .brand-mark {
      width: 36px;
      height: 36px;
    }
    nav {
      margin-top: 43px;
    }
    nav button {
      font-size: 0;
      gap: 0;
      justify-content: center;
      padding: 12px;
    }
    .nav-dot {
      display: none !important;
    }
    main {
      margin-left: 78px;
    }
    .topbar {
      height: 67px;
    }
    .page-content {
      padding-top: 30px;
    }
    .focus-layout {
      grid-template-columns: minmax(0, 1.3fr) minmax(270px, 1fr);
    }
    .mobile-settings {
      display: grid !important;
    }
    .date {
      margin-left: auto;
      margin-right: 13px;
    }
    .overview-grid {
      grid-template-columns: 1fr 1.45fr;
    }
    .rhythm-body {
      gap: 12px;
    }
    .week-chart {
      gap: 6px;
    }
    .week-caption {
      display: none;
    }
    .toast {
      left: calc(50% + 39px);
    }
  }
  @media (max-width: 780px) {
    .page-content {
      padding: 28px 23px 22px;
    }
    .topbar {
      padding: 0 23px;
    }
    .focus-layout {
      grid-template-columns: 1fr;
    }
    .timer-card {
      padding-top: 22px;
    }
    .timer-display {
      width: 290px;
      height: 290px;
      margin: 22px auto;
    }
    .timer-time {
      font-size: 73px;
    }
    .timer-controls {
      margin-bottom: 25px;
    }
    .timer-footer {
      padding: 16px 21px;
      font-size: 9px;
    }
    .timer-footer > span:first-child {
      max-width: none;
    }
    .mode-tabs button {
      font-size: 10px;
      padding: 9px 13px;
      gap: 6px;
    }
    .mode-tabs button.active {
      padding: 8px 12px;
    }
    .intentions-card {
      padding: 24px 24px 0;
    }
    .card-heading h2 {
      font-size: 20px;
    }
    .card-intro {
      font-size: 11px;
    }
    .intention-input input {
      font-size: 12px;
    }
    .intention-note {
      margin: 0 -24px;
      padding: 16px 24px;
    }
    .task-list {
      min-height: 155px;
    }
    .empty-intentions {
      padding: 20px;
    }
    .overview-grid {
      grid-template-columns: 1fr 1.25fr;
    }
    .rhythm-body {
      display: block;
      margin-top: 20px;
    }
    .week-chart {
      margin-top: 8px;
      max-width: none;
    }
    .week-number {
      font-size: 24px;
    }
    .goal-foot {
      margin-top: 26px;
    }
    .insight-metrics {
      gap: 12px;
    }
    .insight-metrics section {
      padding: 18px;
    }
    .insight-metrics strong {
      font-size: 26px;
    }
    .insight-metrics section > span:last-child {
      font-size: 9px;
      line-height: 1.8;
    }
    .insight-metrics strong small {
      font-size: 10px;
    }
    .history-header,
    .history-row {
      grid-template-columns: minmax(0, 1.8fr) 1fr 0.7fr;
      gap: 10px;
    }
    .history-header > span:last-child,
    .history-row > .result-badge {
      display: none;
    }
    .large-chart {
      gap: 12px;
    }
    .history-name strong {
      font-size: 10px;
    }
    .chart-key {
      display: none;
    }
  }
  @media (max-width: 540px) {
    .sidebar {
      width: 60px;
      flex-basis: 60px;
      padding: 23px 8px;
    }
    main {
      margin-left: 60px;
    }
    .brand-mark {
      width: 33px;
      height: 33px;
      border-radius: 9px;
    }
    nav {
      margin-top: 30px;
    }
    nav button {
      padding: 11px 8px;
    }
    .page-content {
      padding: 25px 15px 20px;
    }
    .topbar {
      height: 60px;
      padding: 0 15px;
    }
    .breadcrumb {
      font-size: 9px;
      gap: 8px;
    }
    .date {
      display: none;
    }
    h1 {
      font-size: 24px;
      letter-spacing: -0.9px;
    }
    .page-heading {
      margin-bottom: 23px;
    }
    .page-heading p:last-child {
      font-size: 10px;
      max-width: 270px;
    }
    .eyebrow {
      font-size: 9px;
      letter-spacing: 1.4px;
    }
    .timer-card {
      padding: 16px 11px 0;
    }
    .mode-tabs button {
      font-size: 9px;
      padding: 8px 8px;
      gap: 4px;
    }
    .mode-tabs button.active {
      padding: 7px 7px;
    }
    .mode-tabs :global(svg) {
      width: 13px;
      height: 13px;
    }
    .timer-display {
      width: 232px;
      height: 232px;
      margin: 24px auto;
    }
    .timer-time {
      font-size: 60px;
    }
    .timer-eyebrow {
      font-size: 9px;
      letter-spacing: 1.3px;
    }
    .timer-subtitle {
      font-size: 9px;
    }
    .timer-footer {
      margin: 0 -11px;
      padding: 13px 12px;
      font-size: 9px;
      gap: 10px;
    }
    .timer-footer > span:first-child {
      max-width: 155px;
    }
    .timer-footer > span:last-child {
      gap: 3px;
      white-space: nowrap;
    }
    .timer-footer > span:last-child :global(svg) {
      display: none;
    }
    .timer-controls {
      gap: 10px;
    }
    .start-button {
      min-width: 155px;
      font-size: 10px;
      padding: 11px 18px;
    }
    .reset-button {
      height: 36px;
      width: 36px;
    }
    .intentions-card {
      padding: 23px 19px 0;
    }
    .card-heading h2 {
      font-size: 18px;
    }
    .intention-note {
      margin: 0 -19px;
      padding: 15px 19px;
    }
    .overview-grid {
      grid-template-columns: 1fr;
      gap: 15px;
      margin-top: 15px;
    }
    .rhythm-body {
      display: flex;
      margin-top: 17px;
    }
    .week-chart {
      margin-top: 0;
      gap: 9px;
    }
    .goal-card {
      padding: 20px;
    }
    .goal-foot {
      margin-top: 18px;
    }
    .page-foot {
      font-size: 9px;
      justify-content: center;
    }
    .page-foot > span:last-child {
      display: none;
    }
    .toast {
      left: calc(50% + 30px);
      max-width: calc(100vw - 85px);
      width: max-content;
      bottom: 17px;
      font-size: 10px;
      padding: 12px;
    }
    .insight-metrics {
      grid-template-columns: 1fr;
      gap: 10px;
    }
    .insight-metrics section {
      padding: 18px;
      display: grid;
      grid-template-columns: 1fr 1fr;
    }
    .insight-metrics strong {
      grid-row: 1/3;
      grid-column: 2;
      justify-self: end;
      margin-top: 0;
      font-size: 27px;
    }
    .insight-metrics section > span:last-child {
      font-size: 9px;
    }
    .panel {
      padding: 20px 15px;
    }
    .large-chart {
      gap: 7px;
    }
    .large-column {
      font-size: 9px;
    }
    .large-column > small {
      font-size: 9px;
    }
    .large-bar-space {
      height: 130px;
    }
    .large-column strong {
      font-size: 9px;
    }
    .large-column strong small {
      display: none;
    }
    .history-card .card-heading {
      align-items: flex-start;
    }
    .history-card h2 {
      font-size: 17px;
    }
    .history-card .secondary-button {
      font-size: 9px;
      padding: 8px;
    }
    .history-card .secondary-button :global(svg) {
      width: 12px;
    }
    .history-header,
    .history-row {
      grid-template-columns: minmax(0, 1fr) 0.65fr;
      gap: 8px;
    }
    .history-header > span:nth-child(2),
    .history-row > span:nth-child(2) {
      display: none;
    }
    .history-name {
      gap: 7px;
    }
    .history-name .soft-icon {
      width: 27px;
      height: 27px;
    }
    .history-name strong {
      font-size: 9px;
    }
    .history-name small {
      font-size: 9px;
    }
    .history-row {
      font-size: 9px;
    }
    .history-empty h3 {
      font-size: 14px;
    }
    .history-empty p {
      font-size: 10px;
      line-height: 1.8;
    }
    .modal-backdrop {
      padding: 15px;
    }
    .modal {
      padding: 23px;
      max-height: calc(100dvh - 30px);
    }
    .modal h2 {
      font-size: 23px;
    }
    .settings-grid {
      gap: 14px;
    }
    .settings-grid label {
      font-size: 10px;
    }
    .settings-grid label > span {
      font-size: 9px;
    }
    .settings-grid label > div {
      padding: 9px;
    }
    .settings-grid label > div > span {
      font-size: 9px;
    }
    .setting-toggle span {
      font-size: 9px;
    }
    .modal-actions {
      gap: 8px;
    }
    .primary-button {
      font-size: 10px;
      padding: 11px 16px;
    }
    .compact-modal h2 {
      font-size: 20px;
    }
    .card-heading .eyebrow {
      font-size: 9px;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    :global(*) {
      transition: none !important;
      animation: none !important;
    }
  }
</style>
