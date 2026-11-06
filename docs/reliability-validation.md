# Reliability validation

## Addon migration checkpoint — 26 October 2026

Checked HEAD `320fdeb681d0a73b15713ebdd10aec8c3f696052` plus the existing uncommitted addon/provider migration; this is not a clean-checkout or release certification. The original staged deletions and untracked migration files were preserved.

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | Passed, exit 0 |
| `npx vitest run src/test` | Root-only rerun: 120 files, 1,244 tests passed, exit 0 |
| `node --test addons-sdk/cloud/server.test.mjs addons-sdk/cloud/premium.test.mjs` | 22 passed, 0 failed, exit 0 (local Node 24.15.0) |
| `cargo check --manifest-path src-tauri/Cargo.toml` | Passed, exit 0; 15 warnings |
| `cargo test --manifest-path src-tauri/Cargo.toml` | 368 passed, 0 failed, 4 ignored, exit 0 |
| `npm run build` | Passed, exit 0; large-chunk warning remains |
| `git diff --check` | Passed; line-ending conversion warnings remain |

The first frontend run's four failures came from `.claude/worktrees/.../src/test`, not this checkout's test files. Vitest now has an explicit `src/test/**/*.test.{ts,tsx}` include, preserving TS/TSX coverage without collecting stale nested checkouts.

The Ubuntu Node 22 workflow now also runs the cloud-addon Node tests; hosted execution of this change remains pending. Review of the added CI command, test-discovery boundary and roadmap checkpoint found no actionable issue. The addon tests use mocked upstream responses and loopback fixtures, not live provider credentials. No native app, real library, provider account or audio hardware was exercised, and no commit or push was made.

Next acceptance: run a native addon install/search/playback cycle with an authorized account or personal server; verify disable/re-enable, restart persistence, local-only isolation and clear handling of legacy Tidal/Qobuz saved entries. This migration is the next completion boundary, not a reason to start the future UI-slot/theme/Wasm phases.

### Continuation: addon reload failure

A rejected `addon_list` previously replaced the last known registry with an empty list. `loadAddons` now preserves that registry and emits a generic error toast. The added regression failed before the fix and passed afterward (2 focused tests). Final rechecks passed: TypeScript; 1,245 frontend tests in 120 files; production build; Cargo check; 368 Rust tests (4 ignored); and 22 cloud-addon tests. Scoped code review found no concrete bug. Rust warnings and the Vite large-chunk warning remain.

Native acceptance was attempted with a temporary configuration using a separate app identifier and webview data directory. The first launch stopped because port 1420 was occupied; reusing the existing frontend server reached Cargo but failed to replace `target/debug/aideo.exe` with Windows access error 5. An existing Aideo process held that executable. It was not terminated, and no native UI interaction or acceptance pass is claimed. The temporary configuration is outside the repository; no production configuration was changed.

### Continuation: audit fixes — 26 October 2026

Source-verified defects fixed, each with a regression test: external translation addons were never dispatched (`"translation"` vs manifest `"translate"`); desktop OAuth ignored the PKCE `?code=` callback (`src/utils/oauthCallback.ts`); cloud playlist push could empty a playlist and still report success (now restores the previous rows and reports failure); addon stream redirects to hostnames resolving to private/link-local/CGNAT addresses are refused (lookup failure fails closed); vitest raised to 4.1.12+ (`npm audit` 0 vulnerabilities).

Addon tracks are deliberately not synced to the cloud: the cloud `playlist_tracks` table has no `source_context`/`metadata_json` columns, and a path-only pull creates rows the library hides. Add those columns, then sync them.

Rechecked: TypeScript; 1,252 frontend tests in 121 files; Cargo check; 370 Rust tests (4 ignored); 22 cloud-addon tests; production build (run before the final sync edit). Not exercised: a real OAuth login, native addon install/playback/restart, hosted CI. Redirect hostnames are resolved once before connecting, so DNS rebinding between check and connect is not covered. Unverified audit candidates, not fixed: stale auto-lyric result writing to a different track, `playPrev` cancelling before its `isSkipping` guard, cancelled enrichment promises left in `inFlightEnrichments`.

## Verification refresh — 5 October 2026

Checked checkpoint `be3a72eceb3f4cd43048cc8895afcedf95fad9d4` (0.9.11). The working tree was clean before verification; this record is the only source change from this run.

| Check | Result |
| --- | --- |
| `npx.cmd tsc --noEmit` | Passed, exit 0 |
| `npx.cmd vitest run src/test` | 135 files, 1,372 tests passed, exit 0 |
| `cargo check --manifest-path src-tauri/Cargo.toml` | Passed, exit 0 |
| `cargo test --manifest-path src-tauri/Cargo.toml` | 436 passed, 0 failed, 5 ignored, exit 0 |
| `npm.cmd run build` | Passed, exit 0; large-chunk and mixed static/dynamic import warnings remain |

The initial frontend invocation could not read the parent directory while esbuild loaded the config. The initial Rust suite passed 433 tests but three M3U fixture writes failed with Windows permission errors. Full reruns outside the sandbox passed without source changes. Frontend failure-path mocks, React act and jsdom canvas diagnostics still appear in successful test output.

Hosted CI was inspected through the public GitHub Actions API. The [latest successful CI Check run](https://github.com/Alirull18/Aideo-Music-Player/actions/runs/37251612136), created on 5 October at 09:29 MYT, tested `6bac9a53859e9d4954b5791ab35887eadd08a02d`: Windows Cargo check/test and Ubuntu frontend typecheck passed. Its frontend job did **not** run frontend tests. The current local workflow contains `npm test`, but no Actions run was found for the checked local SHA. Hosted execution of that step and the disposable failing-assertion demonstration remain pending; the remote success does not certify this checkpoint.

The user deferred live checks for now. Provider authentication/network recovery, physical DAC unplug/replug, Windows sleep/resume, extended listening/recommendation sessions, installed-app crash recovery and native UI acceptance remain unverified. No app was launched, no real library maintenance was performed, and no commit, push or publication was made.

## Baseline — 2 October 2026

Baseline HEAD: `3555d3ad514f5aa15f664c001d45f5743d7a4f03` (0.9.11), with existing uncommitted download, recommendation, playback, and audio-inspector work preserved. The checkout is active; refresh status and check affected diffs before each change.

| Check | Result |
| --- | --- |
| `npx.cmd tsc --noEmit` | Passed |
| `npx.cmd vitest run src/test` | 123 files, 1,286 tests passed |
| `cargo check --manifest-path src-tauri/Cargo.toml` | Passed |
| `cargo test --manifest-path src-tauri/Cargo.toml` | 400 passed, 5 ignored |

Vitest initially could not access the parent directory while loading its config in the sandbox. Three existing M3U tests initially could not overwrite their temporary files. Reruns outside the sandbox passed; these are environmental failures, not fixed product bugs. Full-suite assertions still print existing mocked-error, React act, and jsdom canvas warnings.

This baseline is local automated evidence. Hosted Ubuntu CI, authenticated providers, physical DAC unplug/replug, Windows sleep/resume, and multi-hour listening are pending.

## Isolated data fixtures

Backup, restore, and relocation tests must create a unique temporary directory and in-memory or temporary SQLite database. Seed a two-disc local album, a missing file, a permission/unavailable-root case, a possible duplicate with distinct version evidence, a mixed local/provider playlist, favorites, canonical recommendation aliases, and qualified listening records. No test may use the running app's library database or real music folders. Inject failures before commit and after durable commit/before frontend replay.

## Execution status

The task ledger is `.superpowers/sdd/2026-10-02-reliability-and-library-plan/progress.md`. The approved plan is `docs/superpowers/plans/2026-10-02-reliability-and-library-plan.md`. Mark implementation and automated validation separately from the external acceptance gates below.

## External acceptance

- Hosted frontend CI: test step runs on Ubuntu and a temporary failing assertion rejects the disposable branch.
- Listening: two hours local, two hours for each available provider, overnight mixed session; memory/worker trend recorded.
- Rapid skip: 100 next/previous actions without stale playback.
- Network: 30-second and two-minute interruption, then reconnection.
- Authentication: expired URL, renewable session, revoked provider login.
- Devices: shared/exclusive DAC unplug/replug, fallback and profile/volume behavior.
- Power: three playing sleep/resume cycles and one paused cycle.
- Recommendations: three 45-minute familiar/discovery/exclusion listening sessions.

Record device, Windows version, provider, mode, expected/actual behavior, elapsed time, and redacted logs for every exercised case. Pending cases are not release certification.

## Final local verification — 2 October 2026

| Check on the completed implementation | Result |
| --- | --- |
| `npx.cmd tsc --noEmit` | Passed, exit 0 |
| `npx.cmd vitest run src/test` | 134 files, 1,348 tests passed, exit 0 |
| `cargo check --manifest-path src-tauri/Cargo.toml` | Passed, exit 0 |
| `cargo test --manifest-path src-tauri/Cargo.toml` | 435 passed, 5 ignored, exit 0 |
| `npm.cmd run build` | Passed, exit 0; Vite reports the existing large-chunk warning |

The first final Rust run hit the same three M3U temporary-file sandbox permissions as the baseline (432 passed, three permission failures). The authorized full rerun outside the sandbox passed all 435 tests. No product change was made for that environmental failure. Frontend mocks still emit expected failure-path, React act and canvas diagnostics.

## Implemented behavior

| Plan tasks | Current implementation |
| --- | --- |
| 1: Frontend CI | The frontend Ubuntu job runs `npm test` after typecheck and fails on test failure. A hosted run and deliberate-failure demonstration remain pending. |
| 2–3: Playback recovery | Bounded source retry, permanent-auth recovery, stale-attempt/history guards, retained queue and actionable Retry/reconnect/output/locate controls. Automated IPC cases passed; live listening matrix remains pending. |
| 4: Local backup | Bounded versioned JSON, category preview, credential exclusions, merge/idempotency, rollback snapshot, atomic database apply, durable settings replay and explicit cloud reconciliation. Profiles accept local impulse-response paths only. Rollback JSON imports use merge semantics; this is recovery evidence, not an exact whole-database undo. |
| 5–6: Health and moved folders | Cancellable read-only health scan, conflict preview, verified mapping, atomic reference update, durable runtime replay and guarded inverse relocation. Unresolved entries keep their original references. |
| 7: Output profiles | Per-device volume, DSP/EQ, AutoEQ identity and requested modes; serialized muted routing, truthful effective state and capped fallback gain. Duplicate output names are refused with guidance. Physical output tests remain pending. |
| 8: Recommendations | Searchable canonical exclusion list, Allow again and selective learned-taste reset with preview/rollback. Visible history is preserved. Reset evidence survives portable backup through canonical history signatures. Actual listening evaluation remains pending. |
| 9–10: Downloads | Durable Retry/Discard, no automatic restart, fingerprint validation even for completed output, idempotent import and strong-ETag byte-range resume for supported direct transfers. Unsupported or incompatible transfers restart safely. Installed-app process-kill and live provider behavior remain pending. |
| 11–12: Track/album stopping | One-shot boundaries precede repeat/radio/native handoff; late arming purges reserved output. Album sessions preserve captured order, unrelated queue/global preferences, paused restart and relocation references. Recovery offers Retry/Skip; remote cast routes remain unavailable for boundary stopping. Audible output still needs native listening validation. |

Final independent source reviews found no further actionable issue after the reported alias, backup target, restored queue, completed download, stop-arm, history and device-switch races were fixed. Reports are retained in the plan's `.superpowers/sdd` workspace.

## UI evidence boundary

The isolated browser preview rendered backup/recommendation settings in dark and light themes at a 1280×720 desktop viewport. Category controls expose labels; keyboard Tab moved from export to restore and from restore to preference search, with theme-aware focus styling. A failed recommendation load shows a readable error and Retry. Browser-only IPC failure was expected: no native dialogs, database operations or audio were exercised. Complete native keyboard/focus/error-state acceptance remains pending. The narrow browser sidebar viewport is not desktop-layout certification.

The existing dirty baseline was preserved. No staging, commit, push, installer publication or real-library maintenance was performed. Implementation/local verification are complete; the external acceptance list above remains open.
