# FocusForge

FocusForge is a Tauri + Svelte desktop focus timer with a smart Pomodoro cycle.

## What it does

- Focus / short break / long break cycle (25/5 with a long break every 4 focus sessions)
- Start / Pause / Reset timer controls
- Native desktop notifications when a phase completes
- Persistent local stats and settings
- Backward migration of older stats data to the current schema

## Tech stack

- Tauri v2 (Rust backend)
- Svelte + TypeScript (frontend)
- Local JSON persistence in the app data directory

## Requirements

- Node.js + npm
- Rust toolchain (`cargo`, `rustc`)
- Tauri prerequisites for your OS: https://tauri.app/start/prerequisites/

## Run locally

```bash
npm install
source "$HOME/.cargo/env"   # if cargo is not on PATH
npm run tauri dev
```

## Useful scripts

```bash
npm run check
npm run build
npm run tauri dev
```

## Project structure

- `src/` Svelte UI (timer, stats, settings)
- `src/lib/appState.ts` frontend app-state types and API helpers
- `src-tauri/src/lib.rs` Rust commands, persistence, migration, and tests
