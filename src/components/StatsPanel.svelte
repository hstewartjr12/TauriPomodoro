<script lang="ts">
  import { onMount } from "svelte";
  import {
    getTodayFocusMinutes,
    getTodayFocusSessions,
    loadAppState,
    type AppState,
    DEFAULT_STATE,
  } from "../lib/appState";

  export let refreshKey = 0;

  let state: AppState = {
    ...DEFAULT_STATE,
    settings: { ...DEFAULT_STATE.settings },
    totals: { ...DEFAULT_STATE.totals },
    sessions: [],
  };

  let sessionsToday = 0;
  let totalFocusMinutes = 0;
  let dailyGoalProgressPercent = 0;
  let dailyGoalRemainingMinutes = 0;
  let dailyGoalMinutes = state.settings.daily_goal_minutes;

  let isLoading = true;
  let errorMessage = "";
  let warningMessage = "";
  let mounted = false;
  let lastRefreshKey = refreshKey;

  function updateDerivedState(nextState: AppState) {
    state = nextState;
    sessionsToday = getTodayFocusSessions(state);
    totalFocusMinutes = Math.floor(state.totals.total_focus_seconds / 60);

    const todayFocusMinutes = getTodayFocusMinutes(state);
    dailyGoalMinutes = Math.max(state.settings.daily_goal_minutes, 1);
    dailyGoalProgressPercent = Math.min(
      100,
      Math.round((todayFocusMinutes / dailyGoalMinutes) * 100),
    );
    dailyGoalRemainingMinutes = Math.max(dailyGoalMinutes - todayFocusMinutes, 0);
  }

  async function fetchStats() {
    isLoading = true;
    errorMessage = "";

    try {
      const response = await loadAppState();
      updateDerivedState(response.state);
      warningMessage = response.warning ?? "";
    } catch (error) {
      warningMessage = "";
      updateDerivedState({
        ...DEFAULT_STATE,
        settings: { ...DEFAULT_STATE.settings },
        totals: { ...DEFAULT_STATE.totals },
        sessions: [],
      });
      errorMessage =
        error instanceof Error ? error.message : "Failed to load stats.";
    } finally {
      isLoading = false;
    }
  }

  onMount(() => {
    mounted = true;
    void fetchStats();
  });

  $: if (mounted && refreshKey !== lastRefreshKey) {
    lastRefreshKey = refreshKey;
    void fetchStats();
  }
</script>

<div class="stats-wrap">
  <h2>Stats</h2>

  {#if warningMessage}
    <p class="status warning">{warningMessage}</p>
  {/if}

  {#if isLoading}
    <p class="status">Loading stats...</p>
  {:else if errorMessage}
    <div class="error-wrap">
      <p class="status error">{errorMessage}</p>
      <button class="retry" on:click={fetchStats}>Retry</button>
    </div>
  {:else}
    <div class="stat-grid">
      <article class="stat-card">
        <p class="stat-label">Focus Sessions</p>
        <p class="stat-value">{state.totals.total_focus_sessions}</p>
      </article>

      <article class="stat-card">
        <p class="stat-label">Focus Time</p>
        <p class="stat-value">{totalFocusMinutes} min</p>
      </article>

      <article class="stat-card">
        <p class="stat-label">Sessions Today</p>
        <p class="stat-value">{sessionsToday}</p>
      </article>

      <article class="stat-card">
        <p class="stat-label">Goal Progress</p>
        <p class="stat-value">{dailyGoalProgressPercent}%</p>
        <p class="stat-subvalue">
          {dailyGoalRemainingMinutes} min left of {dailyGoalMinutes}
        </p>
      </article>
    </div>
  {/if}
</div>

<style>
  .stats-wrap {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  h2 {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
    color: #dbe6f6;
  }

  .stat-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.6rem;
  }

  .stat-card {
    margin: 0;
    border-radius: 14px;
    background: #1d2736;
    padding: 0.75rem 0.6rem;
    box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.15);
  }

  .stat-label {
    margin: 0 0 0.45rem;
    color: #99a7bc;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .stat-value {
    margin: 0;
    color: #f3f6fd;
    font-size: clamp(1rem, 2.2vw, 1.2rem);
    font-weight: 600;
  }

  .stat-subvalue {
    margin: 0.35rem 0 0;
    color: #9aacc7;
    font-size: 0.78rem;
  }

  .status {
    margin: 0;
    color: #b8c7dc;
    font-size: 0.95rem;
  }

  .status.error {
    color: #ff9f9f;
  }

  .status.warning {
    color: #ffd88a;
  }

  .error-wrap {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.8rem;
    flex-wrap: wrap;
  }

  .retry {
    border: none;
    border-radius: 10px;
    padding: 0.45rem 0.8rem;
    background: #202a3a;
    color: #e7edf8;
    cursor: pointer;
    font-weight: 600;
  }

  .retry:hover {
    background: #2b3850;
  }

  @media (max-width: 440px) {
    .stat-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
