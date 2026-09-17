# Original User Request

## Initial Request — 2026-09-16T13:35:16Z

Implement reliable unified music sources for Aideo across Local files, YouTube Music, connected Tidal, and connected Qobuz according to `docs/development/unified-sources-reliability-plan.md`, ensuring consistent song presentation, conservative cross-catalog matching, safe playback lifecycle and fallback, and zero data corruption or unverified substitutions.

Working directory: c:\Users\Alirul\Aideo-Music-Player
Integrity mode: development

Reference plan: `docs/development/unified-sources-reliability-plan.md`

## Requirements

### R1. Recording Identity & Conservative Matching Contract
Separate UI display grouping from the safe recording playback cohort. Implement a pure, strict matcher (`TrackMatcher`/`unifiedSources.ts`) that compares normalized core titles (Unicode NFKC, stripping presentation context like `- Topic` or `Official Audio` while strictly preserving version qualifiers like Remix, Live venue/year, Acoustic, Instrumental, Radio/Extended Edit, Mono/Stereo, Clean/Explicit).
- Require real durations within 3 seconds as corroborating evidence, but never substitute different artists or conflicting ISRCs merely because durations match.
- Remove invented duration defaults (e.g. guessed 180s in Tidal adapters).
- Disable automatic mid-song audio-interrupting upgrades as the documented reliability default in `sourcePlayback.ts`; background discovery attaches alternatives for the *next* play or next queued track, while manual source switching remains available.

### R2. Shared Source Discovery & Music Content Filtering
Unify source knowledge into a single shared reactive store path (`src/store/`) accessible to Search, Home, Source Picker, and Queue.
- Progressive enrichment must keep displayed row keys, focused controls, and chosen recordings stable as late provider responses arrive.
- Preserve alternate source references in backend home deduplication (`src-tauri/src/youtube/mod.rs`) rather than discarding them.
- Enforce the 20-minute YouTube discovery/search cap (known duration <= 1,200s eligible; > 1,200s excluded; local/Tidal/Qobuz unaffected). Reject podcast/episode/compilation formats while preserving genuine musical instrumental or live tracks.

### R3. Playback Attempt Lifecycle, Safe Fallback & Cache Isolation
Assign stable runtime attempt identifiers to every queue occurrence and play request.
- Cancellation (Stop, Next, Previous, new Play, queue replacement, or mode change) must cancel in-flight network extraction and native preparation.
- Implement a shared 15-second interactive resolve/prepare deadline with deduplicated resolution promises.
- Fallback is strictly confined to verified equivalent recordings of the selected version (never falling back to a remix, live take, or cover).
- Publish playback success and UI updates only upon native decoder readiness, never upon command queuing.
- Isolate disk and memory cache keys by namespace, provider, source ID, and verified rendition format; prevent cross-codec cache collisions (e.g. appending FLAC chunks into cached Opus/AAC streams).

### R4. Queue Ownership, Persistence & Output Safety
Maintain one authoritative logical queue. Distinguish playlist entry IDs from queue occurrence IDs so intentional repeats remain controllable.
- Preserve the ordinary native gapless audio path for local-only sequences.
- Make source context persistence additive (version 1 to version 2 migration) with a 32-source durable ceiling, never overwriting path-only legacy entries or converting them to Auto.
- Selection logic and quality preferences must never alter WASAPI/DAC output settings (exclusive mode, bit-perfect streaming, sample rates, or DSP).

## Verification Resources

- Frontend TypeScript check: `npx.cmd tsc --noEmit`
- Frontend Vitest suite: `npx.cmd vitest run src/test`
- Backend Rust check: `cargo check --manifest-path src-tauri/Cargo.toml`
- Backend Rust tests: `cargo test --manifest-path src-tauri/Cargo.toml`
- Code formatting and hygiene: `git diff --check`
- Existing test suites: `src/test/unifiedSources.test.ts`, `src/test/unifiedSourceUi.test.ts`, `src/test/homeUnifiedSources.test.ts`, `src/test/songFirstSearch.test.ts`, `src/test/sourcePlayback.test.ts`

## Acceptance Criteria

### Matching & Equivalence
- [ ] Known equivalent tracks (e.g., Anggi Marito - `Tak Segampang Itu` across Local, Tidal, and YouTube Official Audio) display under one grouped song row with all available provider choices visible.
- [ ] Distinct performances, live versions (e.g., `Song (Live at A)` vs `Song (Live at B)`), remixes, acoustic cuts, radio edits, and covers by different artists are never automatically grouped as interchangeable playback sources.
- [ ] A missing or conflicting ISRC or duration discrepancy > 3 seconds hard-rejects automatic substitution.

### Discovery & Surfaces
- [ ] Performing a search or opening Home renders completed provider results immediately; late provider results enrich existing song cards without shifting focus, altering selected recordings, or creating duplicate rows.
- [ ] The Source Picker (`SourceMenu.tsx`) reflects the exact same unified source state without triggering separate out-of-sync searches.
- [ ] Long YouTube videos (> 1,200s) and non-music formats (podcasts/compilations) are excluded from discovery while preserving genuine instrumental songs.

### Playback & Fallback Guardrails
- [ ] Initiating Stop, Next, or a new song immediately cancels prior in-flight playback attempts; late resolution or network responses cannot restart stopped audio or replace newer selections.
- [ ] When a preferred source fails, fallback occurs only among verified equivalent recordings with an honest UI notification, retaining the user's original explicit preference.
- [ ] Playing music never suffers an automatic mid-song audio interruption; discovered higher-quality sources attach for the next play.
- [ ] Playing cached audio or different quality tiers (Opus vs AAC vs FLAC) never collides in disk cache or corrupts media decoders.

### Queue, Persistence & Tests
- [ ] Intentional duplicate songs in a playlist or queue retain independent queue occurrence IDs.
- [ ] Local-only playback sequences retain bit-perfect / native gapless playback without being forced through network source queues.
- [ ] All verification commands (`tsc --noEmit`, `vitest run src/test`, `cargo check`, `cargo test`) exit with 0 errors.

## Follow-up — 2026-09-16T14:51:42Z

A server restart occurred and idle background tasks/subagents were stopped. Please resume execution of the teamwork project from where we left off: check the project orchestrator status (.agents/orchestrator_1), revive or re-evaluate subagents if needed, complete Milestone 1 gate evaluation, and proceed through Milestones 2, 3, 4, and final verification.

## Follow-up — 2026-09-17T01:04:32Z

A server restart occurred. Please resume the teamwork system: check Orchestrator Gen 3 in .agents/orchestrator_3, conclude Milestone 2 (worker_m2_frontend_2 has completed the 6 frontend areas and tsc is verified passing with 0 errors), complete Gate 2 evaluation, and proceed through Milestone 3 (R3: Playback Attempt Lifecycle, Safe Fallback & Cache Isolation), Milestone 4 (R4: Queue Ownership, Persistence & Output Safety), and final verification.
