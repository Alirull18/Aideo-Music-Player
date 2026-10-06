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
