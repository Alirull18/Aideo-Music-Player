# Contributing to Aideo Music Player

Thanks for helping. This is a Tauri 2 app (React + TypeScript frontend, Rust backend). The project is GPL-3.0; by
contributing you agree your changes are released under the same license.

## Set up

Requirements: Node 22, Rust stable, and `protoc` 25.1 on `PATH` (CI uses `step-security/setup-protoc`). Windows is the
supported target (`x86_64-pc-windows-msvc`).

```bash
npm ci
npm run tauri dev        # full desktop app
npm run dev              # frontend only, in a browser
```

The featured cloud addons run from a bundled sidecar. Debug builds do not need it: they fall back to
`node addons-sdk/cloud/server.mjs`, and `cargo check` / `cargo test` create a placeholder so the Tauri build passes.
Release builds need the real executable, which `tauri build` produces for you; to build it yourself:

```bash
npm run build:sidecar    # writes src-tauri/bin/aideo-addons-<target>.exe and smoke-tests it
```

Secrets live in `.env` and `src-tauri/.env`. Both are gitignored. Never commit them, and never hardcode keys,
tokens or client secrets.

## Where things live

| Area | Path |
|---|---|
| Frontend | `src/` (styling is custom CSS in `src/App.css`; Tailwind is not set up) |
| Backend | `src-tauri/src/` (the frontend only reaches it through Tauri commands/events) |
| Addons (host side) | `src-tauri/src/addons/` |
| Addons (servers, SDK, example) | `addons-sdk/` |
| Docs | `docs/` |

Two rules that regularly bite:

- **IPC**: do not delete a Tauri command because a plain-text search finds no caller. Some are invoked dynamically
  (for example ``invoke(`${provider}_resolve_source`)``).
- **Events**: DOM events (`window.dispatchEvent`) and Tauri events (`app.emit`) are separate buses. Use
  `window.addEventListener` for the first and `listen()` from `@tauri-apps/api/event` for the second.

## Building an addon

You can ship one without touching this repo. See [`docs/ADDON_DEVELOPMENT.md`](docs/ADDON_DEVELOPMENT.md) and the
working example in [`addons-sdk/example/`](addons-sdk/example/).

## Before you open a pull request

Run all of these; CI runs them too and they must pass.

```bash
npx tsc --noEmit
npx vitest run src/test
node --test addons-sdk/cloud/server.test.mjs addons-sdk/cloud/premium.test.mjs addons-sdk/example/server.test.mjs
cargo check --manifest-path src-tauri/Cargo.toml
cargo test  --manifest-path src-tauri/Cargo.toml
```

- A bug fix ships with a test that fails without it. Audio, DSP and parser fixes need a Rust unit test (see
  `src-tauri/src/player/dsp_tests.rs`). Single-node DSP tests do not prove a node is in the live chain; the
  `live_chain_*` tests do.
- Do not remove `src/test/setup.ts`.
- Follow the style of the file you are editing. Keep functions focused. Handle errors with useful messages; do not
  swallow them. No leftover debug logging.
- Validate input at boundaries (user input, IPC, network). Error messages must not leak secrets.

## Commits and pull requests

Commit message: `<type>: <description>` with an optional body. Types: `feat`, `fix`, `refactor`, `docs`, `test`,
`chore`, `perf`, `ci`.

In the PR, summarize the whole branch (not just the last commit) and include a short test plan. Keep PRs focused;
unrelated cleanups belong in their own PR.

## Reporting security issues

Do not open a public issue for a vulnerability or an exposed secret. Report it privately through
[GitHub's private vulnerability reporting](https://github.com/Alirull18/Aideo-Music-Player/security/advisories/new),
and rotate any credential that has been exposed.
