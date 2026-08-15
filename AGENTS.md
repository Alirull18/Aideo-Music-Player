# Aideo Music Player — AGENTS.md

Tauri v2 desktop music player. Two separately-built halves: a React 19 + TypeScript frontend (`src/`) and a Rust audio backend (`src-tauri/`).

## Architecture
- `src/` — React app. Entry: `src/main.tsx` → `src/App.tsx`. State is Zustand, split into slices in `src/store/*`. One file per view under `src/components/`.
- `src-tauri/` — Rust backend (audio DSP, WASAPI, SQLite), built with Cargo and bundled by Tauri.
- The frontend reaches the backend only through Tauri IPC/commands (`@tauri-apps/api`) — there is no direct import boundary. Don't add calls that bypass it.

## Developer commands
- `npm run dev` — Vite dev server on fixed port **1420** (`strictPort`: fails if busy). For the full desktop app with the Rust backend use `npm run tauri dev`.
- `npm run build` — runs `tsc` (typecheck, no emit) **then** `vite build` → `dist`. Type errors abort the build.
- `npm test` — `vitest run src/test` (jsdom, globals on, setup `src/test/setup.ts`).
- `npm run tauri` — passthrough to the Tauri CLI.
- **No `lint` script and no ESLint config.** "Linting" is TypeScript's `tsc` strict checks (`noUnusedLocals`, `noUnusedParameters`). Do not run `npm run lint`.

## Testing
- Tests live **only** in `src/test/*.test.ts`; Vitest is configured to run that directory exclusively.
- Single test: `npx vitest run src/test/<name>.test.ts`.
- `src/test/setup.ts` is required (globals + jsdom) — do not remove it.
- **CI does not run frontend tests.** `.github/workflows/check.yml` runs `npx tsc --noEmit` (frontend, Ubuntu) and `cargo check`/`cargo test` (backend, Windows) only. Run `npm test` yourself before relying on it.

## Rust backend build
- Requires **Rust stable** + **protoc 25.1**. `src-tauri/bin/bin/protoc.exe` is bundled locally but gitignored, so a fresh clone needs protoc installed (CI uses `step-security/setup-protoc@v3`).
- Check/test: `cargo check --manifest-path src-tauri/Cargo.toml` and `cargo test --manifest-path src-tauri/Cargo.toml`.
- Release builds target `x86_64-pc-windows-msvc` and need `TAURI_SIGNING_PRIVATE_KEY` (see `publish.yml`).

## Tauri / runtime quirks
- Dev URL must be exactly `http://localhost:1420` (matches `tauri.conf.json` `devUrl`). Vite ignores `src-tauri/` in its watcher.
- Deep-link scheme is `aideo://`; app identifier `com.alirul.music-player`.
- Styling is Tailwind v4 + daisyui v5 + custom CSS — there is no `tailwind.config.js`; configure via CSS, not a JS config.

## Secrets & env
- `.env` (root) and `src-tauri/.env` hold Supabase keys and signing material. Both are gitignored — never commit them. The Rust build reads `src-tauri/.env`.

## MCP tools: code-review-graph
This repo has a code-review-graph knowledge graph. Prefer its tools over Grep/Glob/Read for code discovery:
- `search_graph` / `semantic_search_nodes_tool` — find functions/classes by name or keyword.
- `query_graph_tool` — callers/callees/imports/tests (`pattern="tests_for"` for coverage).
- `get_impact_radius_tool` / `get_affected_flows_tool` — blast radius of a change.
- `detect_changes_tool` + `get_review_context_tool` — code review.
Fall back to Grep/Glob/Read only when the graph doesn't cover it.

## Engineering rules
- **Think before coding**: state assumptions; ask when unsure or ambiguous; surface simpler approaches.
- **Simplicity first**: minimal code, no speculative abstractions or unrequested config.
- **Surgical changes**: touch only what's asked; match existing style; remove only your own orphans.
- **Goal-driven**: turn tasks into verifiable goals and verify before declaring done.
