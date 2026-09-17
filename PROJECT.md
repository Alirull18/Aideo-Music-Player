# Project: Aideo Music Player — Reliable Unified Music Sources

## Architecture
- **Frontend Layer (`src/`)**: React 19 + TypeScript + Zustand.
  - Store: Shared reactive source cache & resolution state (`src/store/sourcePlayback.ts`, `src/store/types.ts`, `src/store/librarySlice.ts`, `src/store/playbackSlice.ts`).
  - Source Matcher & Utilities: `src/utils/unifiedSources.ts`, `src/utils/tidalHub.ts`, `src/utils/discoveryFeed.ts`.
  - UI Surfaces: `src/components/SourceMenu.tsx` (Source Picker), `src/components/AideoView.tsx` (Search & Home), `src/components/UnifiedSearchResults.tsx`.
- **Backend Layer (`src-tauri/`)**: Rust Tauri v2 core.
  - YouTube Engine & Home Feed: `src-tauri/src/youtube/mod.rs` (discovery deduplication, content filtering, 1200s duration cap).
  - Database & Persistence: `src-tauri/src/db.rs`, `src-tauri/src/sources.rs` (additive v1->v2 context persistence, 32-source ceiling).
  - Audio Engine & Player: `src-tauri/src/player/mod.rs`, `src-tauri/src/lib.rs` (native decoder readiness gating, attempt tracking, cache isolation, WASAPI output safety).
- **IPC Boundary**: Tauri IPC commands and events (`@tauri-apps/api/core`). Strict separation: frontend never makes direct filesystem or audio device calls.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Unicode NFKC Normalization | Normalize titles and artists with Unicode NFKC, case folding, and whitespace collapse. | M1 | R1 Spec |
| 2 | Presentation Wrapper Stripping | Strip `- Topic`, `Official Audio`, `Official Music Video`, `Lyric Video` wrappers without deleting core titles. | M1 | R1 Spec |
| 3 | Version Qualifier Preservation | Strictly preserve Remix, Live (venue/year), Acoustic, Instrumental, Radio/Extended Edit, Mono/Stereo, Remaster year. | M1 | R1 Spec |
| 4 | Separate Display vs Safe Cohort | Separate UI display grouping from safe automatic playback substitution cohort. | M1 | R1 Spec |
| 5 | 3-Second Corroboration Rule | Real durations must be within 3 seconds for automatic recording equivalence. | M1 | R1 Spec |
| 6 | Strict Artist Agreement | Never substitute tracks with conflicting or unrelated artists merely due to matching duration. | M1 | R1 Spec |
| 7 | ISRC Conflict Rejection | Conflicting ISRCs hard-reject automatic substitution; matching ISRC requires title/version/duration corroboration. | M1 | R1 Spec |
| 8 | Removal of Invented Durations | Remove hardcoded `duration: t.duration \|\| 180` in `tidalHub.ts`; preserve unknown duration as null/`--:--`. | M1 | R1 Spec |
| 9 | Explicit vs Auto Source Model | Disclose distinct recording candidates; preserve explicit user source selection without silent overrides. | M1 | R1 Spec |
| 10 | Disable Mid-Song Upgrades | Disable automatic mid-song audio interruptions; attach discovered better sources for next play or queued track. | M1 | R1 Spec |
| 11 | Clean/Explicit Tri-State Filter | Treat clean/explicit as tri-state; explicit conflict hard-rejects substitution. | M1 | R1 Spec |
| 12 | Punctuation & Script Handling | Conservative punctuation handling preserving CJK, Cyrillic, Arabic, and multilingual titles. | M1 | R1 Spec |
| 13 | Centralized Reactive Source Store | Single shared source knowledge store in `src/store/` shared by Search, Home, Source Picker, and Queue. | M2 | R2 Spec |
| 14 | Progressive Search Enrichment | Render completed provider responses immediately; late arrivals enrich cards without shifting row keys or focus. | M2 | R2 Spec |
| 15 | Reactive Source Picker Sync | `SourceMenu.tsx` subscribes to shared store state rather than launching detached, redundant searches. | M2 | R2 Spec |
| 16 | Unified Quick & Full Search | Autocomplete and quick search share the grouped result model instead of YouTube-only raw un-grouped tracks. | M2 | R2 Spec |
| 17 | Home Shelves Source Preservation | In `src-tauri/src/youtube/mod.rs`, preserve alternate online source IDs in deduplication rather than discarding them. | M2 | R2 Spec |
| 18 | Eliminate 2.5s Tidal Drop | Remove the 2.5-second drop timer in `AideoView.tsx` so slow provider results enrich the current generation. | M2 | R2 Spec |
| 19 | YouTube 20-Minute Duration Cap | Exclude YouTube videos with duration > 1,200s (<= 1,200s eligible); local/Tidal/Qobuz unaffected. | M2 | R2 Spec |
| 20 | Non-Music Format Exclusion | Reject podcasts, episodes, tutorials, and compilations from music song discovery. | M2 | R2 Spec |
| 21 | Instrumental Music Preservation | Refactor `is_third_party_or_instrumental` to preserve genuine musical instrumentals, acoustic, and piano pieces. | M2 | R2 Spec |
| 22 | Live Music Version Preservation | Preserve genuine live performances as distinct musical versions rather than banning them as non-music. | M2 | R2 Spec |
| 23 | Bounded Background Enrichment | Limit background source discovery to at most 2 concurrent jobs with 1 request per provider per job. | M2 | R2 Spec |
| 24 | Stable Runtime Attempt IDs | Assign unique runtime `attempt_id` to every queue occurrence and playback request. | M3 | R3 Spec |
| 25 | Rapid Control Cancellation | Stop, Next, Previous, new Play, queue replace, and mode change cancel in-flight network and native preparation. | M3 | R3 Spec |
| 26 | Unified 15s Interactive Deadline | Enforce shared 15s overall deadline across all provider resolution retries with coalesced promises. | M3 | R3 Spec |
| 27 | Decoder Readiness Gate | Publish playback success, UI status (`Playing`), and play counts only on native decoder readiness. | M3 | R3 Spec |
| 28 | Safe Fallback on Preferred Failure | Fallback occurs strictly among verified equivalent recordings with honest UI toast and retained preference. | M3 | R3 Spec |
| 29 | Typed Failure Classification | Categorize failures (cancellation, missing file, auth, offline, timeout, unsupported codec, device error) with bounded retries. | M3 | R3 Spec |
| 30 | Cache Key Isolation | Partition disk and memory cache keys by namespace, provider, source ID, and verified rendition format. | M3 | R3 Spec |
| 31 | Cross-Codec Collision Prevention | Prevent Opus, AAC, and FLAC streams from sharing cache keys or colliding in decoder buffers. | M3 | R3 Spec |
| 32 | Atomic Cache Promotion | Write temporary cache files atomically; partial or failed streams are never promoted or appended. | M3 | R3 Spec |
| 33 | Tagged Natural-End Events | Native `track-ended` event carries `attempt_id` and `queue_occurrence_id` to prevent delayed event ghost advances. | M3 | R3 Spec |
| 34 | Manual Source Switch Safety | Manual source switch captures playback position immediately before switch and requires compatible timeline. | M3 | R3 Spec |
| 35 | Authoritative Logical Queue | Single logical queue preserving user ordering and intentional duplicates without silent deduplication. | M4 | R4 Spec |
| 36 | Decouple Playlist & Queue IDs | Separate `playlist_entry_id` from `queue_occurrence_id` for independent repeat and item control. | M4 | R4 Spec |
| 37 | Local Native Gapless Preservation | Preserve native gapless audio pipeline for local-only sequences; do not clear native queue on local tracks. | M4 | R4 Spec |
| 38 | Additive Persistence (v1->v2) | Support additive source context persistence with backward compatibility; remove rigid `deny_unknown_fields`. | M4 | R4 Spec |
| 39 | 32-Source Durable Ceiling | Enforce durable ceiling of 32 sources per recording context, keeping representative sources per provider. | M4 | R4 Spec |
| 40 | Path-Only Legacy Entry Safety | Never overwrite path-only legacy library entries or convert them to Auto on search or playback. | M4 | R4 Spec |
| 41 | Output & WASAPI Settings Safety | Source selection and streaming preference must never alter WASAPI exclusive mode, bit-perfect, sample rate, or DSP. | M4 | R4 Spec |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| E2E | E2E Testing Track | Independent opaque-box test suite (Tiers 1-4) covering all 41 features; publishes TEST_READY.md | none | IN_PROGRESS |
| M1 | Recording Identity & Conservative Matching Contract | Features 1-12: pure matcher, Unicode NFKC, version qualifiers, safe cohort, no guessed 180s, disable mid-song audio upgrade | none | IN_PROGRESS |
| M2 | Shared Source Discovery & Music Content Filtering | Features 13-23: reactive source store, stable row keys, home deduplication preservation, 1200s cap, filter refactor | M1 | PLANNED |
| M3 | Playback Attempt Lifecycle, Safe Fallback & Cache Isolation | Features 24-34: attempt IDs, cancellation, 15s deadline, decoder readiness gating, cache isolation, safe fallback | M1 | PLANNED |
| M4 | Queue Ownership, Persistence & Output Safety | Features 35-41: logical queue, occurrence IDs, local gapless preservation, v1->v2 additive persistence, WASAPI safety | M1, M3 | PLANNED |
| M5 | Final Verification & Coverage Hardening | Phase 1: 100% E2E test pass (Tiers 1-4); Phase 2: Adversarial coverage hardening (Tier 5); full repo gate pass | E2E, M1, M2, M3, M4 | PLANNED |

## Interface Contracts
### M1 ↔ M2 / M3: Matcher & Recording Types (`src/store/types.ts` & `src/utils/unifiedSources.ts`)
- `RecordingSources`:
  ```ts
  export interface RecordingSources {
    recording_id: string;
    sources: PlaybackSource[]; // Safe, verified equivalent playback cohort only
    selection: SourceSelection;
    display_candidates?: PlaybackSource[]; // Discovered related/uncertain candidates for UI display
    match_version?: number;
  }
  ```
- `isSameRecording(a: Track, b: Track): boolean`: Strict equality requiring normalized core title match, artist match, version qualifier equality, and duration within <= 3.0s (if durations known). Conflicting ISRCs return `false`.
- `groupRecordings(tracks: Track[], query: string): Track[]`: Groups tracks for UI display while populating `source_context.sources` strictly with `isSameRecording`.
- `catalogTrack(...)`: Duration is null if absent; no guessed 180s duration.

### M3 ↔ Native Player: Attempt & Readiness Contract (`src-tauri/src/player/mod.rs` & `src-tauri/src/lib.rs`)
- Command: `play_track(path: String, start_pos: f64, attempt_id: String)`
- Event: `playback-ready`: Emitted when Symphonia decoder initializes audio frames successfully for `attempt_id`.
- Event: `track-ended`: Emitted with `{ attempt_id: String, path: String }` so frontend validates current attempt before advancing queue.
- Event: `playback-cancelled`: Acknowledges cancellation of previous attempt.

### M3 ↔ Cache Storage: Rendition Cache Isolation (`src-tauri/src/player/mod.rs`)
- Disk Cache Key: `format!("{namespace}:{provider}:{source_id}:{rendition_format}")`
  - Prevents cross-codec collision between Opus (WebM), AAC (M4A), and FLAC.
  - Temporary download files `.tmp` promoted atomically via `std::fs::rename` only upon complete verification.

### M4 ↔ Database & Queue: Persistence & Occurrence Contract (`src-tauri/src/db.rs` & `src/store/types.ts`)
- `Track`: `queue_occurrence_id?: string` generated uniquely per queue insertion.
- SQLite `source_context`: JSON text with backward/forward-compatible schema (no `deny_unknown_fields`). Ceil at 32 sources.

## Code Layout
- `src/store/types.ts`: Core data structures (`PlaybackSource`, `RecordingSources`, `Track`, `PlayerState`).
- `src/utils/unifiedSources.ts`: Title normalization, strict matcher, display grouping, source ranking, and resolution cache.
- `src/utils/tidalHub.ts`: Tidal adapter (remove 180s default).
- `src/store/sourcePlayback.ts`: Attempt lifecycle orchestration, 15s deadline, cancellation, fallback, background enrichment (no mid-song interruptions).
- `src/components/SourceMenu.tsx`: Reactive source selection UI connected to store.
- `src/components/AideoView.tsx`: Search and Home views with progressive enrichment.
- `src-tauri/src/youtube/mod.rs`: YouTube content filtering, 20-minute cap, home deduplication preserving alternate source references.
- `src-tauri/src/db.rs`: Additive v1->v2 SQLite persistence for source context.
- `src-tauri/src/player/mod.rs`: Native audio playback, decoder readiness event, attempt cancellation, and cache isolation.
- `src-tauri/src/lib.rs`: Tauri IPC commands (`play_track`, `set_source_queue_mode`).
- `src/test/`: Frontend Vitest suites (`unifiedSources.test.ts`, `songFirstSearch.test.ts`, `sourcePlayback.test.ts`, `e2e_unified_sources.test.ts`).
- `src-tauri/src/db_tests.rs`: Backend SQLite persistence tests.
