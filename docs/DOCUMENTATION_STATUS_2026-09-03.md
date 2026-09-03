# Documentation status and cleanup ledger

**Checked:** 2026-09-03 (MYT)

**Code baseline:** `be94f376930cadd288b987183ee3486c6d36abbd` plus the current uncommitted worktree
**Purpose:** distinguish durable project documentation from historical/generated material, and record whether audit findings have source-level evidence of remediation. This is a documentation inventory, not a release sign-off.

## Status labels

| Label | Meaning |
|---|---|
| **Current** | A maintained product, architecture, or contributor reference. |
| **Roadmap** | Intentional future work; unchecked tasks are not defects. |
| **Historical** | A dated snapshot or handoff; do not treat its finding list as the current release verdict. |
| **Superseded** | A newer, scoped record supplies the current assessment. Keep for traceability. |
| **Generated** | Rebuildable tool output; retain only the newest dated snapshot unless history is needed. |
| **Local-only** | Agent/workflow material, not product documentation. |

## Documentation inventory

| Location | Status | Use |
|---|---|---|
| `README.md` | Current | Public project entry point and setup. |
| `AGENTS.md`, `GEMINI.md` | Current | Contributor/agent operating rules and graph-tool guide. |
| `PRODUCT.md`, `DESIGN.md` | Current | Product voice and visual-system reference. |
| `docs/ARCHITECTURE.md`, `docs/AI_CONTEXT.md`, `docs/prd.md`, `docs/srs.md`, `handler.md` | Current | Technical/product and IPC-reference material. Review command lists when Rust commands change. |
| `AIDEO_ROADMAP.md` | Roadmap | Plugin/platform plan. Its unchecked items remain planned work. |
| `docs/RELEASE_NOTES_v0.9.5.md`, `docs/RELEASE_NOTES_v0.9.6.md`, `docs/RELEASE_NOTES_v0.9.7.md` | Historical | Versioned change records. The v0.9.7 notes include claims still requiring release-grade verification; see the reconciliation below. |
| `handoff.md` | Historical | Emergency playback-crash handoff. It must not be used as evidence that later-reverted tests still exist. |
| `AUDIT_REPORT.md`, `codebase_audit_report.md`, `WEB_STREAM_AUDIT.md`, `audits/AUDIT_VERIFICATION_REPORT.md` | Superseded | Earlier audit snapshots. Retain for provenance, but use the dated audit pack below for the current audit baseline. |
| `audits/2026-09-03/00_INDEX_AND_EVIDENCE.md` through `08_LEGAL_LICENSING_AND_TERMS.md` | Current audit record | The authoritative evidence ledger and release-blocker set for the audited commit. Findings remain open unless this ledger says otherwise. |
| `graphify-out/2026-09-03/GRAPH_REPORT.md` | Generated | Current dated code-review-graph snapshot; useful for navigation only. |
| `graphify-out/GRAPH_REPORT.md` | Generated / older duplicate | Retain only if the undated snapshot is needed for comparison; otherwise it is a cleanup candidate after confirming no external process reads it. |

## Audit-finding reconciliation

The following check is deliberately narrow: it verifies current source and test presence, not device, provider, installer, legal, or end-to-end behavior. “Implemented” therefore never changes a finding into a release pass by itself.

| Finding area | Source-level status | Evidence inspected |
|---|---|---|
| DSP input bounds (`AUD-DSP-06`) | **Implemented and unit-tested** | `DSPState::sanitize` is called at the command boundary; `test_dsp_state_sanitize_guards_nan_and_extremes` covers invalid values. |
| Multichannel downmix (`AUD-AUD-06`) | **Implemented and unit-tested** | `downmix_to_stereo` plus 3.0, 5.1, and 7.1 regression tests. |
| High-resolution RAM-cache guard (`AUD-AUD-05`) | **Implemented and unit-tested** | `should_bypass_ram_cache` computes decoded-size risk; regression cases cover large/high-rate inputs. |
| Device-name selection (`AUD-HW-06`) | **Implemented and unit-tested** | `find_best_matching_device_name` and targeted matching tests are present. |
| DSD marketing label (`AUD-AUD-02`) | **Copy corrected; native DSD remains unimplemented** | The fullscreen badge now says `DSD`, not `DSD NATIVE`; the PCM-transcode finding still applies. |
| Lyrics cache conflict (`AUD-PERF-08`) | **Implemented and unit-tested** | `clean_stale_lyrics_cache` is called on save and has a conflicting-extension test. |
| UPnP playback path (`AUD-NET-05`, `AUD-P0-07`) | **Implemented and frontend-tested** | `librarySlice` invokes registered `upnp_play`; `aideoConnect.test.ts` asserts the routing. Physical renderer compatibility remains untested. |
| Chromecast local-file allow-list | **Implemented but not sufficiently tested** | `is_path_safe` builds a canonical allowed-path set, but graph change analysis identifies this server path as untested. |
| Exclusive WASAPI start failure (`AUD-CON-10`, `AUD-HW-03`) | **Error path added; hardware result unverified** | `start_stream` failure now calls `on_error`; no physical device test proves lifecycle/recovery behavior. |
| Player shutdown (`AUD-CON-11`) | **Implemented and unit-tested** | `PlayerCommand::Shutdown` is handled across loops and is covered by a command test. Full worker-join behavior remains an integration concern. |
| FFmpeg fallback rate/channel mismatch (`AUD-AUD-04`, `AUD-P0-06`) | **Remediation present; integration proof still required** | The current worktree contains the related player/DSP changes and release-note claim, but no end-to-end DSD/high-res cache fixture was established in this review. |
| True-gapless/session handoff (`AUD-CON-01`–`05`) | **Open / not proven** | Helper tests exist, but the dated audit correctly notes they do not prove old-audio absence, cursor correctness, pre-readiness, or hardware continuity. |
| Webview `navigator.onLine` playback block (`WEB_STREAM_AUDIT` 1 and 8) | **Open** | Blocking guards remain in `librarySlice.ts` and `playbackSlice.ts`; discovery also reads the flag in `AideoView.tsx`. |
| Missing Rust commands (`H-02`) | **Open** | Frontend still invokes `download_playlist_batch` and `qobuz_open_login_window`; neither command is present in `src-tauri/`. |
| Lyrics translation concurrency (`M-03`) | **Open** | `translate_lyrics_batch` still uses unbounded `join_all(tasks)`. |
| Arbitrary text-file write (`M-07`) | **Partially mitigated, still open** | `write_text_file` restricts extensions but writes the caller-supplied path, so it does not enforce an approved directory. |
| Updater sidecars (`H-01`) | **Parser/test remediation present; release contract unproven** | SHA-256 parsing and validation tests exist and `.sig` is excluded, but no release workflow here creates the updater’s required installer sidecars or proves clean-VM update behavior. |
| GitHub Action pinning (`H-05`, `AUD-UPD-07`) | **Open** | Only the FFmpeg workflow action shown in this review is SHA-pinned; `check.yml` and `publish.yml` retain mutable tags. |
| Tidal/Qobuz, credentials, signed installers, ASIO, native DSD, legal rights, and rendered accessibility QA | **Open / external verification required** | These depend on provider approval, hardware, certificates, licences, or rendered testing and cannot be closed by source inspection. |

## Cleanup boundary

- `.agents/` contains **415** Markdown coordination records. They are local-only agent artifacts, not application documentation. They are reasonable cleanup candidates, but should be removed only after confirming no active/local workflow needs their handoffs.
- The untracked `audits/` and `graphify-out/` folders are useful evidence/generated outputs for the current review. Do not delete the dated audit pack.
- This review does **not** delete files or change existing historical reports. That preserves audit provenance and avoids overwriting the already-modified release notes and source worktree.

## Before changing an audit status to resolved

Require all of the following: a code correction, a focused regression test at the affected boundary, the four repository checks in `AGENTS.md`, and any physical/account/VM/legal evidence required by the claim. Update the dated audit record with that evidence rather than retroactively rewriting historical reports.

## Fresh verification record

The following commands were run against the worktree examined by this ledger on 2026-09-03:

| Command | Result |
|---|---|
| `npx tsc --noEmit` | Passed (exit 0). |
| `npx vitest run src/test` | Passed: 67 files, 438 tests (exit 0). The run still logs the known null `.startsWith`/`.map` paths, React `act(...)` warnings, and duplicate-key warnings; passing status does not close those findings. |
| `cargo check --manifest-path src-tauri/Cargo.toml` | Passed (exit 0). |
| `cargo test --manifest-path src-tauri/Cargo.toml` | Passed: 239 tests, 1 ignored (exit 0). It emits one unused-variable warning in `src-tauri/src/youtube/mod.rs`. |
| `git diff --check HEAD` | Failed on seven trailing-whitespace lines in already-modified `chromecast.rs`, `lyrics.rs`, and `LibraryView.tsx`; this ledger introduces none. |
