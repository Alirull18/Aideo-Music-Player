# Test Infrastructure & Methodology — Reliable Unified Music Sources

## 1. Overview & Architecture

This document defines the test architecture, execution model, and 4-tier testing methodology for verifying the Reliable Unified Music Sources initiative in Aideo Music Player. The testing track operates independently as an opaque-box, requirement-driven verification system ensuring that all 41 features defined in `PROJECT.md` satisfy the contracts laid out in `ORIGINAL_REQUEST.md` and `docs/development/unified-sources-reliability-plan.md`.

### Testing Stack
- **Framework**: Vitest (powered by Vite)
- **Environment**: jsdom with `@testing-library/react` and `@testing-library/jest-dom`
- **Global Setup**: `src/test/setup.ts` providing mocked Tauri IPC boundaries (`@tauri-apps/api/core`, `@tauri-apps/api/event`, plugins)
- **Test File Location**: `src/test/e2e_unified_sources.test.ts` (Vitest include pattern: `src/test/*.test.ts`)
- **Execution Target**: Node.js / jsdom simulating desktop runtime state

## 2. Test Execution Commands

```bash
# Run the complete unified sources E2E test suite
npx vitest run src/test/e2e_unified_sources.test.ts

# Run with verbose reporting
npx vitest run src/test/e2e_unified_sources.test.ts --reporter=verbose

# Run the full project test suite
npm test

# Run frontend TypeScript type-checking gate
npx tsc --noEmit
```

## 3. Testing Principles

1. **Opaque-Box Verification**: Tests interact only with public exports, Zustand store state transitions, and Tauri IPC mock expectations. Tests never depend on private implementation variables or uncommitted assumptions.
2. **Deterministic & Isolated**: Each test establishes its own state via `beforeEach`, clearing `localStorage`, resetting Zustand store slices (`useStore.setState`), resetting mock invocations, and clearing caches (`clearSourceCache`).
3. **Requirement Traceability**: Every test case maps explicitly to one or more of Features 1 through 41 in `PROJECT.md § Feature Inventory` and requirements R1-R4 in `ORIGINAL_REQUEST.md`.
4. **Authoritative Expected Outputs**: Expected values are derived from `ORIGINAL_REQUEST.md` and `unified-sources-reliability-plan.md` specifications, mathematical properties (e.g. duration tolerances <= 3.0s, duration cap <= 1200s), and Unicode NFKC standards.

## 4. Four-Tier Test Case Design Methodology

### Tier 1: Feature Coverage (Unit & Feature Level)
- **Target**: Every feature from Feature 1 to Feature 41 has representative happy-path and primary behavior coverage with at least 5 targeted test cases per feature.
- **Coverage Map**:
  - **M1 (Features 1–12)**:
    - F1: Unicode NFKC normalization (accents, compatibility glyphs, whitespace collapse, case folding).
    - F2: Presentation wrapper stripping (`- Topic`, `Official Audio`, `Official Music Video`, `Lyric Video`).
    - F3: Version qualifier preservation (Remix, Live venue/year, Acoustic, Instrumental, Radio/Extended Edit, Mono/Stereo, Remaster).
    - F4: Separate display vs safe playback cohort (`RecordingSources.sources` vs UI display grouping).
    - F5: 3-second corroboration rule (<=3.0s matches, >3.0s rejected).
    - F6: Strict artist agreement (collaborations, featured artists, unrelated artists rejected).
    - F7: ISRC conflict rejection (conflicting ISRCs hard-reject automatic substitution).
    - F8: Removal of invented durations (null duration preserved as `--:--`, no guessed 180s).
    - F9: Explicit vs Auto source model (user explicit choices respected without silent override).
    - F10: Disable mid-song upgrades (no mid-song playback interruption; background discovery queued for next play).
    - F11: Clean/Explicit tri-state filter (known explicit conflict hard-rejects substitution).
    - F12: Punctuation & script handling (CJK, Cyrillic, Arabic, multilingual preservation).
  - **M2 (Features 13–23)**:
    - F13: Centralized reactive source store (`useStore` shared source state).
    - F14: Progressive search enrichment (immediate partial rendering, stable card keys).
    - F15: Reactive source picker sync (`SourceMenu` subscribes to shared state).
    - F16: Unified quick & full search (quick suggestions share grouped recording model).
    - F17: Home shelves source preservation (backend home deduplication preserves alternate source IDs).
    - F18: Eliminate 2.5s Tidal drop (slow provider responses enrich current generation).
    - F19: YouTube 20-minute duration cap (<=1200s eligible, >1200s excluded; local/Tidal/Qobuz unaffected).
    - F20: Non-music format exclusion (podcasts, episodes, tutorials, compilations rejected).
    - F21: Instrumental music preservation (genuine instrumental, acoustic, and piano pieces preserved).
    - F22: Live music version preservation (genuine live recordings preserved as distinct versions).
    - F23: Bounded background enrichment (max 2 concurrent jobs, 1 request per provider per job).
  - **M3 (Features 24–34)**:
    - F24: Stable runtime attempt IDs (unique `attempt_id` per play and queue occurrence).
    - F25: Rapid control cancellation (Stop, Next, Prev, new Play cancel in-flight network/native operations).
    - F26: Unified 15s interactive deadline (shared 15s deadline across resolution attempts).
    - F27: Decoder readiness gate (Playing status and play count emitted only on native readiness).
    - F28: Safe fallback on preferred failure (fallback strictly within equivalent cohort with honest UI notice).
    - F29: Typed failure classification (cancellation, missing file, auth, timeout, decoder, device).
    - F30: Cache key isolation (namespace, provider, source ID, rendition format partitioning).
    - F31: Cross-codec collision prevention (Opus, AAC, and FLAC stream isolation).
    - F32: Atomic cache promotion (temporary downloads `.tmp` promoted only upon verified completion).
    - F33: Tagged natural-end events (`track-ended` carries `attempt_id` and `queue_occurrence_id`).
    - F34: Manual source switch safety (playback position captured immediately prior to switch).
  - **M4 (Features 35–41)**:
    - F35: Authoritative logical queue (order preserved, intentional duplicates maintained).
    - F36: Decouple playlist & queue IDs (`playlist_entry_id` vs `queue_occurrence_id`).
    - F37: Local native gapless preservation (native queue retained for local sequences).
    - F38: Additive persistence (v1->v2 migration, unknown fields tolerated).
    - F39: 32-source durable ceiling (durable context capped at 32 sources with representative providers).
    - F40: Path-only legacy entry safety (legacy entries never overwritten or forced to Auto).
    - F41: Output & WASAPI settings safety (WASAPI exclusive mode, bit-perfect, sample rate untouched by source selection).

### Tier 2: Boundary & Corner Cases
- Empty, null, and whitespace-only strings for title, artist, album, ISRC.
- Extreme duration boundaries: 0s, 1s, 1199s, 1200s, 1201s, 3600s, negative values, NaN, Infinity, malformed colon strings (`3:99`, `abc`).
- Duration delta boundaries: exactly 3.000s difference (match) vs 3.001s difference (reject).
- Multi-provider ID collisions: identical numeric/alphanumeric IDs across Tidal, Qobuz, YouTube, Local.
- Unicode edge cases: combining diacritics, right-to-left (Arabic/Hebrew), full-width CJK characters, emojis, ligatures (`æ`, `œ`).
- Network edge conditions: immediate network abortion, 0-byte responses, delayed responses arriving after timeout or component unmount.
- Corrupted persistence payloads: malformed JSON, truncated contexts, schema version mismatches.

### Tier 3: Cross-Feature Combinations (Pairwise & Integration)
- Matcher Equivalence + Playback Fallback (Features 5, 7, 28): Fallback when preferred source fails selects only verified equivalent sources within the 3-second window, rejecting conflicting ISRCs.
- 20-Minute Cap + Progressive Search Enrichment (Features 14, 19, 20): Fast YouTube response with mixed short/long videos correctly filters out >1200s items while integrating with Tidal/Local items.
- Explicit Selection + Centralized Store + Source Picker (Features 9, 13, 15): Explicit choice in SourceMenu updates the central store, immediately reflected in Search/Home without redundant network lookups.
- Rapid Cancellation + Attempt IDs + Tagged Natural End (Features 24, 25, 33): Rapidly skipping tracks updates attempt IDs; late `track-ended` events from previous attempts are ignored.
- Queue Occurrence IDs + Additive Persistence + Gapless (Features 35, 36, 37, 38): A queue with duplicated songs maintains distinct occurrence IDs while local-only sequences preserve the native gapless pipeline.
- Mid-Song Upgrade Suppression + Bounded Enrichment (Features 10, 23): Background resolution finding higher quality attaches it to `source_context` for next playback without interrupting active audio.

### Tier 4: Real-World Application Scenarios
1. **Full Search to Playback with Fallback**: User searches "Anggi Marito", receives progressive results, selects a grouped card, starts playback; preferred Tidal stream fails with 403, player automatically falls back to verified YouTube Official Audio with UI toast, preserving user's explicit preference.
2. **Multi-Surface Source Picker Convergence**: User views Home shelf, opens Source Picker modal, changes source preference from Auto to explicit Qobuz, navigates to Search view, observes exact same track displaying Qobuz as active without initiating secondary searches.
3. **Rapid Queue Advancement & Cancellation Stress**: User queues 5 songs, rapidly presses Next 4 times within 500ms; previous in-flight HTTP requests and decoder setups are cancelled; only the 5th track's attempt activates audio and decoder state.
4. **Intentional Repeat & Playlist Continuity**: User builds a playlist with Track A -> Track B -> Track A; queue maintains 3 distinct occurrence IDs; playing Track A the second time does not consume or deselect the first occurrence.
5. **Offline/Local-Only Transition & WASAPI Integrity**: User switches to offline/local mode; online resolution is suppressed, local tracks play directly via native audio pipeline without modifying WASAPI bit-perfect or sample rate settings.

## 5. Mocking & Isolation Strategy

To ensure deterministic, reproducible execution without external network or audio hardware dependencies:
- **Tauri IPC (`invoke`)**: Spied or mocked per test using `vi.mocked(invoke)` to simulate provider search results, stream resolution payloads, and backend state.
- **Tauri Events (`listen`/`emit`)**: Mocked to capture and simulate native events (`playback-ready`, `track-ended`, `playback-cancelled`).
- **Timers**: `vi.useFakeTimers()` applied selectively for timeout and race condition verification (e.g. 15s deadline).
- **LocalStorage**: Reset before each test via `localStorage.clear()`.
- **Zustand Store**: Reinitialized to baseline state before each test run.
