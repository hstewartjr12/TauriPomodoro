<script lang="ts">
  import { createEventDispatcher, onMount } from "svelte";
  import {
    DEFAULT_SETTINGS,
    type AppSettings,
    loadAppState,
    saveSettings,
  } from "../lib/appState";

  export let refreshKey = 0;

  const dispatch = createEventDispatcher<{ settingsSaved: undefined }>();

  let focusMinutes = Math.floor(DEFAULT_SETTINGS.focus_seconds / 60);
  let shortBreakMinutes = Math.floor(DEFAULT_SETTINGS.short_break_seconds / 60);
  let longBreakMinutes = Math.floor(DEFAULT_SETTINGS.long_break_seconds / 60);
  let longBreakEvery = DEFAULT_SETTINGS.long_break_every;
  let dailyGoalMinutes = DEFAULT_SETTINGS.daily_goal_minutes;

  let isLoading = true;
  let isSaving = false;
  let errorMessage = "";
  let successMessage = "";
  let warningMessage = "";
  let mounted = false;
  let lastRefreshKey = refreshKey;

  function applySettings(settings: AppSettings) {
    focusMinutes = Math.round(settings.focus_seconds / 60);
    shortBreakMinutes = Math.round(settings.short_break_seconds / 60);
    longBreakMinutes = Math.round(settings.long_break_seconds / 60);
    longBreakEvery = settings.long_break_every;
    dailyGoalMinutes = settings.daily_goal_minutes;
  }

  async function fetchSettings() {
    isLoading = true;
    errorMessage = "";

    try {
      const response = await loadAppState();
      applySettings(response.state.settings);
      warningMessage = response.warning ?? "";
    } catch (error) {
      errorMessage =
        error instanceof Error ? error.message : "Unable to load settings.";
    } finally {
      isLoading = false;
    }
  }

  function validateForm(): string | null {
    if (focusMinutes < 5 || focusMinutes > 120) {
      return "Focus length must be between 5 and 120 minutes.";
    }

    if (shortBreakMinutes < 1 || shortBreakMinutes > 30) {
      return "Short break must be between 1 and 30 minutes.";
    }

    if (longBreakMinutes < 5 || longBreakMinutes > 60) {
      return "Long break must be between 5 and 60 minutes.";
    }

    if (longBreakEvery < 2 || longBreakEvery > 8) {
      return "Long break interval must be between 2 and 8 sessions.";
    }

    if (dailyGoalMinutes < 10 || dailyGoalMinutes > 1_440) {
      return "Daily goal must be between 10 and 1440 minutes.";
    }

    return null;
  }

  async function handleSave() {
    successMessage = "";
    errorMessage = "";

    const validationError = validateForm();
    if (validationError) {
      errorMessage = validationError;
      return;
    }

    isSaving = true;

    try {
      await saveSettings({
        focus_seconds: focusMinutes * 60,
        short_break_seconds: shortBreakMinutes * 60,
        long_break_seconds: longBreakMinutes * 60,
        long_break_every: longBreakEvery,
        daily_goal_minutes: dailyGoalMinutes,
        auto_start_next_phase: false,
      });

      successMessage = "Settings saved.";
      warningMessage = "";
      dispatch("settingsSaved");
    } catch (error) {
      errorMessage =
        error instanceof Error ? error.message : "Unable to save settings.";
    } finally {
      isSaving = false;
    }
  }

  onMount(() => {
    mounted = true;
    void fetchSettings();
  });

  $: if (mounted && refreshKey !== lastRefreshKey) {
    lastRefreshKey = refreshKey;
    void fetchSettings();
  }
</script>

<div class="settings-wrap">
  <h2>Settings</h2>

  {#if isLoading}
    <p class="status">Loading settings...</p>
  {:else}
    {#if warningMessage}
      <p class="status warning">{warningMessage}</p>
    {/if}

    {#if errorMessage}
      <p class="status error">{errorMessage}</p>
    {/if}

    {#if successMessage}
      <p class="status success">{successMessage}</p>
    {/if}

    <div class="grid">
      <label>
        <span>Focus (min)</span>
        <input type="number" bind:value={focusMinutes} min="5" max="120" />
      </label>

      <label>
        <span>Short Break (min)</span>
        <input type="number" bind:value={shortBreakMinutes} min="1" max="30" />
      </label>

      <label>
        <span>Long Break (min)</span>
        <input type="number" bind:value={longBreakMinutes} min="5" max="60" />
      </label>

      <label>
        <span>Long Break Every</span>
        <input type="number" bind:value={longBreakEvery} min="2" max="8" />
      </label>

      <label>
        <span>Daily Goal (min)</span>
        <input type="number" bind:value={dailyGoalMinutes} min="10" max="1440" />
      </label>
    </div>

    <div class="actions">
      <button on:click={handleSave} disabled={isSaving}>
        {isSaving ? "Saving..." : "Save Settings"}
      </button>
      <p class="hint">Auto-start is currently disabled by design.</p>
    </div>
  {/if}
</div>

<style>
  .settings-wrap {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
  }

  h2 {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
    color: #dbe6f6;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.7rem;
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    font-size: 0.8rem;
    color: #9aacc7;
  }

  input {
    border: 1px solid rgba(154, 172, 199, 0.35);
    border-radius: 10px;
    background: #1d2736;
    color: #f3f6fd;
    padding: 0.5rem 0.65rem;
    font-size: 0.95rem;
  }

  input:focus {
    outline: 2px solid rgba(77, 215, 177, 0.45);
    outline-offset: 1px;
    border-color: transparent;
  }

  .actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.8rem;
    flex-wrap: wrap;
  }

  button {
    border: none;
    border-radius: 12px;
    padding: 0.6rem 1rem;
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
    opacity: 0.6;
  }

  .hint {
    margin: 0;
    color: #95a3b8;
    font-size: 0.8rem;
  }

  .status {
    margin: 0;
    font-size: 0.9rem;
    color: #b8c7dc;
  }

  .status.error {
    color: #ff9f9f;
  }

  .status.success {
    color: #79e7c8;
  }

  .status.warning {
    color: #ffd88a;
  }

  @media (max-width: 560px) {
    .grid {
      grid-template-columns: 1fr;
    }
  }
</style>
