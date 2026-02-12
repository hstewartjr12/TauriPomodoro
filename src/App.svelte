<script lang="ts">
  import Timer from "./components/Timer.svelte";
  import StatsPanel from "./components/StatsPanel.svelte";
  import SettingsPanel from "./components/SettingsPanel.svelte";

  let statsRefreshKey = 0;

  function refreshAppState() {
    statsRefreshKey += 1;
  }
</script>

<main class="app-shell">
  <h1>FocusForge</h1>

  <section class="panel timer-panel">
    <Timer
      refreshKey={statsRefreshKey}
      on:sessionCompleted={refreshAppState}
    />
  </section>

  <section class="panel stats-panel">
    <StatsPanel refreshKey={statsRefreshKey} />
  </section>

  <section class="panel settings-panel">
    <SettingsPanel
      refreshKey={statsRefreshKey}
      on:settingsSaved={refreshAppState}
    />
  </section>
</main>

<style>
  :global(html, body) {
    margin: 0;
    min-height: 100%;
    height: 100%;
    font-family: "Avenir Next", "Segoe UI", sans-serif;
    background: radial-gradient(circle at top, #1f2633 0%, #10151f 65%);
    color: #edf2f7;
  }

  :global(#app) {
    min-height: 100dvh;
    width: 100%;
    display: flex;
    justify-content: center;
    align-items: center;
    padding-top: max(1rem, env(safe-area-inset-top));
    padding-right: max(1rem, env(safe-area-inset-right));
    padding-bottom: max(1rem, env(safe-area-inset-bottom));
    padding-left: max(1rem, env(safe-area-inset-left));
    box-sizing: border-box;
  }

  .app-shell {
    width: min(700px, 100%);
    display: flex;
    flex-direction: column;
    gap: clamp(0.75rem, 1.6vh, 1.25rem);
  }

  h1 {
    margin: 0;
    font-size: clamp(1.35rem, 1.6vw, 1.75rem);
    font-weight: 700;
    letter-spacing: 0.04em;
  }

  .panel {
    border-radius: 18px;
    background: linear-gradient(145deg, #161d2a, #101723);
    box-shadow: 0 10px 30px rgba(3, 8, 20, 0.55);
    padding: clamp(1rem, 2.2vw, 1.35rem);
  }

  @media (max-width: 640px) {
    :global(#app) {
      align-items: flex-start;
      padding-top: max(0.85rem, env(safe-area-inset-top));
      padding-right: max(0.85rem, env(safe-area-inset-right));
      padding-bottom: max(0.85rem, env(safe-area-inset-bottom));
      padding-left: max(0.85rem, env(safe-area-inset-left));
    }
  }

  @media (min-width: 1200px) {
    .app-shell {
      width: min(760px, 75vw);
    }
  }

  @media (max-height: 760px) {
    .panel {
      padding: 0.9rem 1rem;
    }
  }
</style>
