# Aideo Music Player — audit index and evidence ledger

**Audit date:** 2026-09-03 (MYT, UTC+08:00)  
**Repository:** `Alirull18/Aideo-Music-Player`  
**Branch:** `feat/phase-3-true-gapless-pipeline`  
**Commit:** `be94f376930cadd288b987183ee3486c6d36abbd`  
**Worktree at final verification:** clean except for this new `audits/2026-09-03/` report pack  
**Overall release verdict:** **NO-GO**

This pack supersedes the audio, hardware, streaming, updater, accessibility, and licensing conclusions in the older root-level `AUDIT_REPORT.md`, `codebase_audit_report.md`, and `WEB_STREAM_AUDIT.md`. Those files remain historical records; their line numbers and several conclusions do not describe the commit audited here.

## No-sugar-coating result

The project builds and its automated tests pass under the default Cargo feature set. That is not evidence that its audiophile claims are true. At this commit:

- the product's **bit-perfect**, **native DSD**, **pitch-preserved**, **EBU R128**, **ASIO**, **true gapless**, and **Hi-Res DLNA** labels exceed what the implementation or test evidence establishes;
- the newly committed gapless session handoff can preserve old-track samples on a manual track change, and its encoder-delay trim mutates a live cache after playback may have advanced into that cache;
- the release build does not enable ASIO, the optional ASIO build does not compile in the audited environment, and no ASIO stream was opened;
- the current public installers are not Authenticode-signed and the public release has no checksum/signature sidecar expected by the custom updater;
- UPnP/DLNA connection is exposed in the UI, but normal frontend playback never invokes the registered `upnp_play` command;
- Tidal and Qobuz playback implementations carry material service-terms and operational risk;
- codec/helper/lyrics distribution has unresolved notice, source-offer, provenance, and content-rights work;
- static accessibility defects are already sufficient to reject a conformance claim, while rendered visual/accessibility QA remains unperformed.

## Evidence levels

Every conclusion in this pack uses one of these labels:

| Label | Meaning |
|---|---|
| **REPRODUCED** | A command or inspection produced the result in the audited environment. |
| **AUTOMATED** | An existing test/build ran; this proves only the behavior asserted by that test. |
| **STATIC-HIGH** | Direct control/data-flow evidence makes the result highly likely, but it was not observed on physical output. |
| **STATIC-RISK** | A credible defect path exists, but a fixture/device run is still needed to determine occurrence or frequency. |
| **EXTERNAL** | A current primary/official source or live public release was inspected. |
| **UNTESTED** | The requested test was not performed. This is not a pass. |
| **BLOCKED** | The necessary device, account, certificate, VM, receiver, or renderer was not available. |

Static analysis is not relabelled as physical verification. A green test that never opens hardware is not relabelled as a hardware pass.

## Reports

| File | Scope | Verdict |
|---|---|---|
| [01_AUDIO_ARCHITECTURE_AND_PLAYBACK.md](01_AUDIO_ARCHITECTURE_AND_PLAYBACK.md) | Decode-to-device architecture, actual sample path, metadata and format claims | **NO-GO** |
| [02_AUDIO_CONCURRENCY_AND_GAPLESS.md](02_AUDIO_CONCURRENCY_AND_GAPLESS.md) | Command ordering, child-process ownership, cache races, new gapless commit | **NO-GO** |
| [03_DSP_AIDEO_LAB_SIGNAL_INTEGRITY.md](03_DSP_AIDEO_LAB_SIGNAL_INTEGRITY.md) | DSP graph, dither, resampling, loudness, convolution, multichannel | **NO-GO** |
| [04_HARDWARE_WASAPI_ASIO_DSD.md](04_HARDWARE_WASAPI_ASIO_DSD.md) | WASAPI exclusive, ASIO, DSD/DoP, local device evidence | **NO-GO / hardware unverified** |
| [05_STREAMING_CAST_TIDAL_QOBUZ.md](05_STREAMING_CAST_TIDAL_QOBUZ.md) | Chromecast, UPnP, Tidal, Qobuz, real-account status | **NO-GO** |
| [06_INSTALL_UPDATE_CLEAN_VM.md](06_INSTALL_UPDATE_CLEAN_VM.md) | Public artifacts, signing, updater, clean-VM status | **NO-GO** |
| [07_ACCESSIBILITY_AND_VISUAL_QA.md](07_ACCESSIBILITY_AND_VISUAL_QA.md) | Static accessibility and honest rendered-QA boundary | **NO-GO / rendered QA blocked** |
| [08_LEGAL_LICENSING_AND_TERMS.md](08_LEGAL_LICENSING_AND_TERMS.md) | Third-party software, service terms, lyrics provenance | **HOLD FOR COUNSEL** |

## Release-blocker ledger

| ID | Finding | Evidence | Owner area |
|---|---|---|---|
| AUD-P0-01 | Manual `Play` can hand an active session containing old-track ring-buffer audio to the new track. | STATIC-HIGH | Audio concurrency |
| AUD-P0-02 | Background encoder-delay/padding trim shifts a shared cache after `ram_cursor` may already have advanced. | STATIC-HIGH | Gapless/cache |
| AUD-P0-03 | Detached decoder preparation shares a mutable child-process slot, permitting stale A to kill or replace newer B. | STATIC-HIGH | Decoder lifecycle |
| AUD-P0-04 | DSD is decoded/transcoded to PCM while the UI says `DSD NATIVE`. No DoP/native path exists. | STATIC-HIGH | Audio/UI truth |
| AUD-P0-05 | “Bit-perfect” still goes through `f32`, may resample, ramps startup gain, and can use a non-source sample format. | STATIC-HIGH | Output integrity |
| AUD-P0-06 | FFmpeg background fallback fixes output at 44.1 kHz/16-bit/stereo but exposes the original decoder's rate/channel metadata. | STATIC-HIGH | Cache/decode |
| AUD-P0-07 | UPnP can report connected while frontend playback remains local; `upnp_play` has no frontend caller. | REPRODUCED/STATIC-HIGH | Casting |
| AUD-P0-08 | Public v0.9.6 installers and locally installed binaries are unsigned; updater sidecars are absent. | REPRODUCED/EXTERNAL | Release |
| AUD-P0-09 | Tidal/Qobuz implementations use borrowed/scraped application credentials and direct playback URLs without demonstrated provider approval. | STATIC-HIGH/EXTERNAL | Streaming/legal |
| AUD-P0-10 | Full lyric fixtures and helper binaries ship or are distributed without a complete third-party/provenance compliance bundle. | REPRODUCED/EXTERNAL | Legal/release |

## Requested physical and external tests: exact status

| Requested test | Status | What was actually established | What is still required |
|---|---|---|---|
| Physical WASAPI exclusive-mode devices | **UNTESTED** | Code, registry and endpoint inspection; two ordinary output devices present. | Play calibrated PCM fixtures through each target format/rate; capture loopback or digital output; force pause/resume, hot-unplug and mode contention. |
| ASIO hardware | **BLOCKED / UNTESTED** | FiiO KA5 and Realtek ASIO registrations found. Optional build failed because the ASIO SDK header was missing. Shipping workflow omits the feature. | Reproducible licensed SDK/Clang setup, `--features asio` release build, then real driver open/play/stop/recovery tests. |
| Native DSD / DoP output | **UNTESTED and not implemented** | Static path proves DSF/DFF become PCM. | Implement a separately identified native/DoP path, then verify DAC DSD indicator plus captured marker/native data. |
| Chromecast receiver | **BLOCKED / UNTESTED** | No receiver was discovered on the audited LAN; server/control code was reviewed. | Test Google, speaker-only and TV receivers with MP3/AAC/FLAC/WAV, range seeks, 96/24 boundary, disconnect and network change. |
| UPnP/DLNA renderer | **BLOCKED / UNTESTED** | SSDP produced no renderer response; frontend call-path defect is definitive without hardware. | Fix call path first, then test several renderer protocol-info dialects and transport events. |
| Real Tidal account | **BLOCKED / UNTESTED** | No `TIDAL_ACCESS_TOKEN`; static auth/URL path and official terms reviewed. | Provider-approved client, test account and written entitlement; test token rotation, region/subscription errors and quality ladder. |
| Real Qobuz account | **BLOCKED / UNTESTED** | No `QOBUZ_E2E_TOKEN`; ignored live smoke test; scraping/signing path reviewed. | Qobuz-issued application credentials and test account; run search/stream/expiry/geo/quality tests. |
| Signed clean install/update VM | **BLOCKED / UNTESTED** | Public artifacts downloaded without executing, hashed, Authenticode-checked, then deleted. | Fresh supported Windows VMs, trusted certificate, install/uninstall/upgrade/downgrade/failure/rollback matrix. |
| Full visual/accessibility QA | **BLOCKED / PARTIAL STATIC ONLY** | Static semantics/focus/motion review. In-app browser runtime reported no browser available. | Render every route/state at supported sizes/DPI/themes; keyboard, screen-reader, contrast, focus and reduced-motion runs. |
| Legal review | **NOT LEGAL ADVICE** | Engineering compliance screen against primary terms/licenses. | Qualified counsel and documented provider/lyrics rights. |

## Environment observations

- Windows audio devices reported OK: AMD High Definition Audio Device and Realtek High Definition Audio.
- Active endpoint: Speakers (Realtek(R) Audio). A FiiO KA5 headphone endpoint was registered but disconnected/unknown.
- ASIO registry entries existed for FiiO KA5 and Realtek ASIO, in both 32-bit and 64-bit views.
- `CPAL_ASIO_DIR` and `LIBCLANG_PATH` were not configured; no suitable Clang/LLVM command was found in the audit shell.
- No Tidal/Qobuz live-token environment variables or signing private key were present in the audit shell. No secret values are reproduced in this pack.
- The audited LAN was a public-profile Wi-Fi network. SSDP searches received no MediaRenderer/AVTransport reply.

## Verification ledger

The final results must be read together with the scope above:

| Command/check | Result |
|---|---|
| `npx tsc --noEmit` | PASS |
| `npx vitest run src/test` | PASS — 66 files, 426 tests; console/runtime warnings remain visible |
| `cargo check --manifest-path src-tauri/Cargo.toml` | PASS for default features |
| `cargo test --manifest-path src-tauri/Cargo.toml` | PASS — 210 passed, 1 ignored; the ignored test is the Qobuz live smoke test |
| `cargo check --manifest-path src-tauri/Cargo.toml --features asio` | **FAIL** in `asio-sys`; `asiodrivers.h` missing |
| `git diff --check HEAD~1` for the new gapless commit | **FAIL** — trailing whitespace in the committed diff |
| Physical audio output | NOT RUN |
| Clean-VM installer/update | NOT RUN |
| Rendered visual/accessibility suite | NOT RUN |

Passing default builds do not downgrade the blockers above. The new gapless tests assert two helper functions, not end-to-end transition timing, old-audio absence, decoder pre-readiness, hardware continuity, or cursor correctness.

## External-source policy

The internet is not a finite dataset, so “all data on the internet” cannot be literally exhausted. This audit used current primary/official documentation and live public-release metadata where available, dated the observations, and avoided treating blogs or marketing as specifications. Important primary references are linked beside the findings they support in the individual reports.

## Sign-off rule

Do not release based on this audit until every P0 item has:

1. a code-level correction;
2. an automated regression that exercises the real integration boundary;
3. the relevant physical/account/VM test where the claim depends on external behavior; and
4. product copy changed to the narrower truth until that evidence exists.
