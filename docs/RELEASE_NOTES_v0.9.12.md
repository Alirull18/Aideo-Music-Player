# Aideo Music Player v0.9.12

Prepared on 6 October 2026. This version collects the adaptive recommendation and reliability work saved in checkpoint `be3a72e`. Publication and live acceptance remain pending.

## Changes

- Adaptive recommendations share a native ranker across Home, radio and mixes, using qualified listening, recording identity, favorites and exclusions. Discovery deduplicates equivalent recordings, keeps distinct versions and retains the visible feed during playback. Online radio includes local files only when enabled.
- Playback recovery provides bounded retry and actionable reconnect, output and locate-file controls while retaining the queue and rejecting stale attempts.
- Local backup and restore provide category previews, credential exclusions, merge handling, rollback snapshots and durable settings replay. Library health scans are read-only and cancellable; moved-folder repair previews conflicts before updating references.
- Output profiles retain per-device volume, DSP, AutoEQ and requested playback modes, with guarded switching and fallback volume limits.
- Downloads provide independent source selection, shared progress/cancellation, explicit completion, durable Retry/Discard and validated resume for supported direct transfers.
- Stop after track and album listening sessions preserve manual queue choices and take precedence over repeat, radio and native handoff.
- Listening Insights records the native bit-perfect contract correctly and refreshes after playback events. Inspector Peak/Headroom readings poll only while visible; they measure sample peak.
- Playback restart diagnostics retain the recovery reason. Shared DSP shortcuts prevent duplicate handling. Frontend tests are included in the local CI workflow.

## Where work stands

Implementation and local validation were completed before this version bump. The 5 October verification record reports 1,372 frontend tests and 436 native tests passing, with five native tests ignored, plus successful typecheck, Cargo check and frontend build. See [the validation record](reliability-validation.md) for the checkpoint and evidence boundaries.

Hosted CI for this checkpoint, provider authentication/network recovery, physical DAC reconnect, Windows sleep/resume, long listening sessions, recommendation quality, installed-app crash recovery and native UI acceptance remain open. Changing the version does not publish an installer or certify these cases.

## Version-update verification: 6 October 2026

| Check | Result |
| --- | --- |
| `npx.cmd tsc --noEmit` | Passed, exit 0 |
| `npx.cmd vitest run src/test` | 135 files, 1,372 tests passed, exit 0 |
| `cargo check --manifest-path src-tauri/Cargo.toml` | Passed for v0.9.12, exit 0 |
| `cargo test --manifest-path src-tauri/Cargo.toml` | 436 passed, 0 failed, 5 ignored, exit 0 |
| `npm.cmd run build` | Passed for v0.9.12, exit 0; existing chunk-size and mixed-import warnings |

Version consistency assertions passed for npm/Cargo/Tauri metadata, both root lockfile entries, request headers, website structured data and release-note references. The NotebookLM export script syntax check and scoped whitespace check passed. Historical release notes and the existing 5 October validation edit were preserved. No commit, push or publication was made.

## Dependency refresh: 7 October 2026

- Updated Vitest from 2.1.9 to 4.1.11 and Vite from 7.3.3 to 7.3.7, with compatible npm updates for Supabase, Tauri, motion, icons, state and test tooling. The refreshed npm audit reports zero vulnerabilities, down from 12 affected packages.
- Updated native notification, opener, process and updater plugins to match their frontend companions; the dialog requirement is now 2.8.1. Audio-engine and SQLite crate versions are unchanged.
- Vitest uses its typed configuration API. Discovery playback tests clear spy history between cases so Vitest 4 assertions remain isolated.
- CI and release workflows now select Node 22 to meet Supabase's runtime requirement. Unrelated major package upgrades remain deferred.

Verification passed on Node 24.15.0 and Node 22.23.3: TypeScript, 135 frontend test files / 1,372 tests, and production frontend build. Locked Cargo check and tests passed with 436 tests, zero failures and five ignored tests. The scoped whitespace check passed. Existing build chunk-size/import warnings and jsdom canvas diagnostics remain. Hosted CI, installed-app plugin behavior and physical audio acceptance were not exercised; no commit or publication was made for this refresh.

## Upstream merge verification: 7 October 2026

Merged upstream dependency and workflow updates while retaining v0.9.12, the dependency refresh and Node 22 workflow settings. Resolved the Cargo lockfile conflict for zip 4.6.1 and added a regression test for deflated ZIP extraction and traversal-path rejection. Updater tests now wait for pending imports during teardown.

Node 22 TypeScript checks, 135 frontend test files / 1,372 tests and the production build passed. Locked Cargo check and tests passed with 437 tests, zero failures and five ignored tests. The merged npm audit reports zero vulnerabilities. Existing build warnings and jsdom canvas diagnostics remain; hosted CI and installed-app/audio acceptance are separate checks.
