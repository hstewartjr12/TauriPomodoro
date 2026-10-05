<script lang="ts">
  export let name = "focus";
  export let size = 20;
  const paths: Record<string, string> = {
    focus:
      "M12 3v3m0 12v3M3 12h3m12 0h3M7 7l2 2m6 6 2 2M7 17l2-2m6-6 2-2M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
    chart: "M4 20V10m8 10V4m8 16v-7M2 20h20",
    settings:
      "M9 4h6l1 3 3 1 1 6-3 2-1 3H9l-1-3-3-2 1-6 3-1 1-3ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
    plus: "M12 5v14M5 12h14",
    check: "m5 12 4 4L19 6",
    play: "m8 5 11 7-11 7V5Z",
    pause: "M8 5v14M16 5v14",
    reset: "M4 9a8 8 0 1 1 0 6M4 3v6h6",
    arrow: "M5 12h14m-5-5 5 5-5 5",
    coffee:
      "M4 8h12v7a6 6 0 0 1-12 0V8Zm12 1h2a3 3 0 0 1 0 6h-2M7 2v3m5-3v3M3 22h16",
    leaf: "M20 3c-11-2-18 6-14 12 6 8 15 0 14-12ZM4 21 15 9",
    close: "m6 6 12 12M6 18 18 6",
    trash: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7",
    download: "M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5",
    clock: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 7v5l3 2",
    spark: "m12 3 2 7 7 2-7 2-2 7-2-7-7-2 7-2 2-7Z",
    sun: "M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1",
    list: "M9 6h12M9 12h12M9 18h12M3 6h1m-1 6h1m-1 6h1",
    keyboard: "M3 6h18v12H3V6Zm3 4h1m3 0h1m3 0h1m3 0h1M7 14h10",
    volume: "M4 9h4l5-4v14l-5-4H4V9Zm13-1a6 6 0 0 1 0 8",
  };
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.65"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"><path d={paths[name] ?? paths.focus} /></svg
>
