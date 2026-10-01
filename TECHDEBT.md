# Aideo Audit — 2026-09-30 (re-verified)

Source revision checked: `86d3f36`. At final recheck, `git status --short` reports modified `AGENTS.md` and untracked `TECHDEBT.md`; the source working tree is not claimed to be wholly clean. `AGENTS.md` was not edited by this audit. Source line numbers will drift.
Static audit. **Nothing was run on audio hardware and no UI was opened in a browser.**

Tags: `[V]` exact source inspection; described runtime effects remain source-derived unless separately exercised. `[D]` tool/data confirmation. `[I]` inference requiring a repro.
Status: `[ ]` unresolved/retained, `[x]` implemented. Original audit observations below are historical; see execution dispositions before applying them. Item 12 remains withdrawn.

Baseline recorded earlier in this recheck (not rerun for this document-only correction):
`npx tsc --noEmit` produced no diagnostics (its individual exit status was not reliably captured) · `vitest run src/test`: 116 files / 1204 tests passed · `cargo check` finished successfully with no reported warnings · `cargo test`: **341 passed, 0 failed, 4 ignored**.
`graphify-out/` was built at `ed3a7546` and is stale.

Ordered **lowest → highest** by subjective priority, not measured severity. Numbers were reassigned in this revision; see "Corrections" for the old → new mapping. Item 12 retains its number to preserve references.

## Execution — 2026-10-01

Isolated branch `fix/techdebt-2026-10-01`, starting at `6cf3b1d`. Changes are uncommitted. The original checkout was not modified by execution. Runtime evidence and remaining limitations are recorded below; historical line references are not current.

| Items | Disposition |
|---|---|
| 1, 2 | Removed unused biquad and direct Tailwind/daisyui/postcss/autoprefixer tooling; PostCSS may remain a Vite transitive dependency. |
| 3, 4, 5, 6 | Removed private unused helpers/exports and obsolete event paths; parser/recovery coverage migrated to live paths. Public Last.fm APIs and diagnostic/RAII holders retained. HE-AAC local-fixture test explicitly ignored. |
| 7, 8 | Retained externally exposed broadcasts and all registered candidate IPCs after dynamic-dispatch/backend/plugin/docs caller checks. No in-repo caller is not external deletion proof; translate_lyric_line and telemetry have backend uses. No blanket keyring deletion. |
| 9, 10, 11, 20, 21 | Shared menu/track/Sonic Mix/thumbnail/artist/key helpers, injected cloud-sync state access, repaired UTF-8. Saved loved-album IDs migrate using actual legacy track identities, preserving explicit album artists/compilations/unmatched keys. Discovery fallback remains explicitly 180 seconds; generic invalid duration returns 0. Different duration formatters remain separate. |
| 13, 14, 15 | All ten Symphonia formats use shared native sample conversion with skip offsets. FFmpeg paths consistently stereo. Unknown duration and native multichannel bypass RAM decoding safely, not truncated cache playback. |
| 16 | Unique decrypted-file ownership persists through decoder/background worker lifetimes; last owner removes only its generated file after handles/processes close. Startup crash cleanup retained; external Windows lock failures logged. |
| 17 | Unresolved: no specified application action/URI contract for aideo:// found. Scheme/plugin and existing localhost/HTTPS OAuth behavior retained. Do not claim implemented Open-with or scheme-driven OAuth dispatch. |
| 18, 19 | Readable scanner/provider errors, failed download progress cleared, terminal100 only after flush/import. App correlates playback error/buffering by attempt; Toast receives DOM feedback. User stop synchronously clears buffering state/card before async native stop; stale native ends remain rejected. |
| 22, 23, 24, 25 | Live frontend pre-resolution retained; inert Rust mirror removed. Native custom CSS overlay/focus repairs, provider Settings navigation consumes pending Library tab, pruning uses freshly read persisted limitGb without changing policy. |
| 26 | Zero-distance metadata tie preference fixed. Complete finite profiles used; new rows remain NULL even on legacy-default schemas. Empty/nonfinite analysis rejects instead of fabricating values. Historical tuples untouched: numeric values are not provenance proof. |
| 27 | Deliberately unverified, not falsely completed: production integrity flags remain false and gain-ramp blocker remains. Real signed32→f32 collision regression demonstrates one identity limitation; no 16/24-bit or WASAPI hardware certification. |
| 28, 29 | Genuine stereo folding precedes DSP/mixing, source-layout visualization preserved. Live pre-trigger fade decisions, latched active duration, cancellation/process cleanup and exactly-owned queue reservation restoration. Queue-generation invalidation prevents resurrecting source-mode-cleared entries; both seek paths clear pending handoff before restoration. |
| 30, 31 | Truthful pitch-changing speed labels/disabled bit-perfect controls. Native bit-perfect enable resets rate1 and rejects nonunity changes. Full client DSP updates preserve backend ReplayGain/rate under same mutex. |

Verification: `npx tsc --noEmit` passed; `npx vitest run src/test`: **116 files / 1219 tests passed**; `cargo check --manifest-path src-tauri/Cargo.toml` passed; final `cargo test --manifest-path src-tauri/Cargo.toml -- --nocapture`: **353 passed / 0 failed / 5 ignored**, including all three audio-review regressions. Final production Vite build and settings/buffering regression recheck passed (2 files /17 tests). Frontend tests contain React act/duplicate-key and mocked-updater stderr; build reports CSS-property, mixed-import and large-chunk warnings. No warning-free claim.

Renderer smoke used actual React UI with installed mocked Tauri IPC/events: visualizer click expands64→140px; keyboard Enter collapses140→64px with focused control visible; Settings consumes Library pending request and retains selected tab while hidden; prune reads changed policy3GB at click despite initial2.5GB, then refreshes quota; rejected rate stays1, accepted1.25, accepted bit-perfect resets1 and disables controls; stale error discarded/live single toast; stop-while-buffering reproduced before fix and confirmed false/card absent/Stopped after fix plus stale end.

Real hardware-independent audio smoke ran Symphonia probing/decoding of synthetic6-channel PCM WAV through shared conversion, stereo fold and EQ; ownership, actual child-process cancellation/reap, sample-format and32-bit precision regressions passed. No native desktop launch, physical output, acoustic continuity, live provider-download finalization,16/24-bit identity or scheme dispatch certification. Screenshots captured but unavailable for model interpretation; layout evidence is DOM/a11y/computed geometry. Four scoped reviews and rereviews resolved premature download completion, saved loved-album migration, buffering cancellation, stale process-slot cleanup, source-mode queue invalidation and pending handoff after seek; final scoped verdicts have no remaining findings. Throwaway renderer harness removed, owned browser page closed and dev server stopped.



---

## Tier 1 — Cleanup candidates; caller checks required

### 1. [x] Unused `biquad` crate `[D]`
- `src-tauri/Cargo.toml:47`. `RUSTFLAGS="-W unused-crate-dependencies" cargo check` reports `biquad` unused in **both** the lib (`tauri_app_lib`) and bin (`aideo`) crates. `player/dsp.rs` has its own `BiquadFilter`.
- Every other crate is reported only for the thin bin crate. That is noise, not dead deps. `chromaprint-next` is used by the lib.
- Local run needs `PROTOC=src-tauri/bin/bin/protoc.exe` and a separate `--target-dir` so it doesn't thrash your build cache.

### 2. [x] Unwired styling devDependencies `[V]`
- `package.json` devDependencies: `tailwindcss`, `daisyui`, `postcss`, `autoprefixer`. No postcss/tailwind config file (only `vite.config.ts`, `vitest.config.ts`), no `@import "tailwindcss"` or `@plugin` in any CSS, and `grep tailwind|daisyui` over `src/` returns nothing.
- `.btn`, `.btn-primary`, `.btn-secondary` are custom CSS (`App.css:332,347,365`).
- The current `AGENTS.md` correctly states that Tailwind/daisyui are not wired into Vite. The previous version of this audit falsely called that guidance wrong.
- Decision: remove unused styling tooling after checking build scripts, or deliberately configure it if utility styling is desired. Item 23 identifies utility-class usage without that configuration; changing `AGENTS.md` is not required.

### 3. [x] Rust cleanup candidates `[V]`
- Prior searches found no non-test callers for `lyrics.rs:88 get_lrc_path`, `:952 detect_and_parse_lyrics` (aliases, tests only); `lastfm_api.rs:120 get_global_top_tracks` (delegates to `_page`), `:198 get_artist_top_tags`; `player/dsp.rs:49 reset_state`, `:195 process_block`; `player/mod.rs:5126 trim_encoder_delay_and_padding` (tests only). These are candidates, not deletion approval; check public/API uses first. Migrate useful parsing coverage from aliases to the live parsers rather than deleting it.
- `TimePeriodGuard::is_active` (`mod.rs:312`) has a real test caller (`player/dsp_tests.rs:1601`); its lack of production callers alone does not justify removing this diagnostic accessor or its test.
- Publicly reachable library items may escape unused-code diagnostics. A clean `cargo check` does not prove the absence of dead code.
- Keep their `#[allow(dead_code)]`: `ActiveStream` (`mod.rs:27`, its variants hold live streams for RAII drop; the "unread field" is the point), `TimePeriodGuard.active` (`:294`), `DecodedManifest` (`tidal.rs:692`, serde struct), `ActiveStreamDownload` (`mod.rs:581`, check its fields first).

### 4. [x] Vacuous test `[V]`
`player/playback_lifecycle_tests.rs:444-477` (`test_he_aac_sbr_symphonia_half_rate_proves_ffmpeg_delegation`) returns early unless `%TEMP%\aideo_cache_c3f44a8c….m4a` exists. The app deletes those files at startup (`lib.rs:4088`), so on CI and any fresh machine it passes without asserting anything. Fix: commit a tiny HE-AAC fixture, or `#[ignore = "needs local fixture"]`.

### 5. [x] Unused TS exports `[V]`
`ERA_ORDER`, `getAlbumEra` (`AlbumsView.tsx:115,117`), `VISUALIZER_MODES`, `ExtendedVisualizerMode` (`Visualizer.tsx:16,8`) appear only at their declaration. An earlier scan (not re-run) also reported ~118 exports with no non-test importer, mostly types; low value.

### 6. [x] Dead frontend handlers `[V]`
- `playback-state-changed` has no emitter in `src/` or `src-tauri/src/`. Listeners: `App.tsx:415` → `handlePlaybackStateChanged` (`playbackSlice.ts:895`, `types.ts:586`), and `DesktopLyricBar.tsx:140`. Polling does the real work.
- `handlePlaybackStateChanged` is exercised by `src/test/playbackCrashGuard.test.ts:32-113`. If the obsolete event path is removed, preserve meaningful crash-recovery coverage on the live path; remove only tests specific to discarded wiring.
- `ui-toast-info` / `ui-toast-success` (`Toast.tsx:469,473`): no emitters.

### 7. [ ] Backend events with no frontend listener found `[V]`
`playback-success` (`mod.rs:2769,5795`), `playback-cancelled` (9 emit sites: `3301,3310,5285,5297,6598,6611,7241,7429,7447`), `track-metadata-updated` (`lib.rs:3586`), `tidal-download-complete` (`tidal.rs:968`), `qobuz-download-complete` (`qobuz.rs:891`). No frontend listener was found in `src/`; check backend/plugin/external consumers and the intended contract before deleting emits. (`*-download-error`, `scanner-error` → item 18; `deep-link` → item 17.)

### 8. [ ] 27 registered IPC cleanup candidates with no reference found in `src/` `[D]`
`get_close_to_tray`, `move_window_by`, `clean_missing_tracks`, `get_library_page`, `get_library_count`, `queue_next`, `get_exclusive_mode`, `get_bit_perfect_mode`, `get_network_telemetry`, `get_dsp_state`, `translate_lyric_line`, `remove_from_queue_bulk`, `reorder_queue`, `lastfm_get_token`, `save_keyring_secret`, `get_keyring_secret`, `delete_keyring_secret`, `get_artist_profile`, `add_track_to_library`, `get_aideo_recommendations`, `tidal_save_credentials`, `tidal_get_credentials`, `subsonic_search`, `jellyfin_search`, `acoustid_identify_track`, `get_remote_pin`, `get_desktop_lyrics_status`.
- Prior Rust text-reference counts found definitions and registrations for most entries; `get_network_telemetry` also has backend uses. These counts do not establish globally unused public APIs.
- Before deleting a function or `generate_handler!` registration (`lib.rs` ~3934-4000), check dynamic command construction, variable dispatchers, backend/plugin callers and any external contract. Keyring and credential commands are not approved for blanket deletion.
- `acoustid_identify_track` is the current sonic-profile writing path found in this inspection → see item 26 before touching it.
- **Live, not dead** (my first draft wrongly listed them): `pre_resolve_youtube_url` (`librarySlice.ts:1108`), `update_playlist_source` (`unifiedSources.ts:1032`), `tidal_/qobuz_resolve_source` and `tidal_/qobuz_search` (templated: `unifiedSources.ts:1085,904`), `tidal_/qobuz_get_stream_url` (`resolver` variable).

---

## Tier 2 — Duplicates and structure

### 9. [x] Copies of the same code `[V]`
- `getMenuPosition`: `LibraryView.tsx:258` = `TrackContextMenu.tsx:53`, identical.
- `isLosslessTrack`: `AlbumsView.tsx:29` (exported, `t?.format`) and `LibraryView.tsx:51` (`t.format`, throws on null). Not identical; my first draft said it was.
- `cloudTrackToVirtualTrack`: `LibraryView.tsx:71` does `ct.provider.toUpperCase()` unguarded; `TrackContextMenu.tsx:39` guards and falls back to `'STREAM'`. Latent only: LibraryView's callers pass a typed `CloudTrack` (`:349` guards `track.provider`).
- "Sonic Mix" handler ×3: `LibraryView.tsx:475-500`, `TrackContextMenu.tsx:267-305`, `AlbumsView.tsx:1700-1723` (clear queue → add each → play first → toasts).
- Fix: one export each (utils or a store action).

### 10. [x] Same names, different bodies `[V]`
- `extractPrimaryArtist`: `albumUtils.ts:131` (own regex, `'Unknown Artist'` fallback) vs `unifiedSources.ts:32` (via `normalizeArtist`, different regex, `''` fallback). They can group the same artist differently.
- `trackKey`: `discoveryFeed.ts:49` vs `HomeParts.tsx:44`, same result, different signature.
- `AlbumThumbnail` (`AlbumsView`, `ArtistDiscographyDrawer`): not compared `[I]`.
- **Not** duplicates (my first draft said they were): `formatDuration` (`tidalHub.ts:25` → `m:ss`/`--:--`; `ListeningInsightsView.tsx:15` → "X hrs Y mins").

### 11. [x] Import cycle `store.ts → authSlice.ts → syncEngine.ts → store.ts` `[V]`
`store.ts:12` imports `authSlice`; `authSlice.ts:4` imports `syncEngine`; `syncEngine.ts:3` imports `useStore` from `'../store'`. Runtime-safe today because `useStore` is only used inside functions. Low priority; fix by passing `get/set` in or lazy import.

---

## Tier 3 — Wrong or misleading behaviour, low impact

### 12. Withdrawn — outer restart attempt-ID bug not established `[V]`
- `player/mod.rs:3421` does assign `None`, but the earlier "idle gap" explanation ignored the loop invariant. If `play_file` returns no next track, `:3365-3372` clears `current_track`; the outer `RestartStream` then exits at `:3391` before requeueing.
- If a next track exists, `next_track.take()` creates `Play` before `rx.recv()` (`:3282-3288`), and play-start debounce drops queued `RestartStream` (`:3317-3319`). Current-track reference inspection found no independent writer that establishes the alleged gap.
- In-`play_file` restart paths preserve the attempt ID. No reachable production ID-loss scenario was demonstrated; withdraw the functional-bug claim and proposed fix rather than treating this as a rare confirmed bug.

### 13. [x] Unhandled Symphonia sample formats are dropped `[V]`
- Four copies of the format conversion: `background_decode` (`mod.rs:4635-4643`), stream fill (`:6946`), crossfade fill (`:7024`), `extract_f32_channel_data` (`:4203`, used only by the IR loader). `U16`, `U24`, `U32`, `S8` hit `_ =>`, and `decoded_frames` (`:7580`) returns 0 for them, so the packet is **skipped**, not zero-filled. A track in such a format ends with "Decoder reached end of stream without producing audio frames" (`:7520`).
- Rare in practice `[I]` (e.g. 8-bit signed AIFF).
- Fix: one shared converter (use `extract_f32_channel_data` with a skip offset) covering all variants, plus a test per variant.

### 14. [x] FFmpeg stereo forcing is inconsistent `[V]`
Streaming decode forces `-ac 2` (`build_ffmpeg_decoder_args` `mod.rs:2036`, yt-dlp pipe `:2643`); the cached-decode fallback keeps source channels (`-ac file_ch`, `:4549`). Multichannel via FFmpeg therefore behaves differently depending on path (item 28 applies only to the multichannel one). Decide and document.

### 15. [x] RAM-cache size guard blind when duration unknown `[I]`
`should_bypass_ram_cache` (`mod.rs:4958`) skips the 400 MB estimate when `duration_secs == 0`, and `duration_secs` comes from `n_frames` (`:5360`), which some files lack. Then only the 150 MB on-disk rule applies. Fix: estimate from bytes when duration is 0, or cap during `background_decode`.

### 16. [x] Decrypted offline copies sit in `%TEMP%` while the app runs `[V]`
`aideo_cache_<hash>.<ext>` is written at `player/mod.rs:2179` and `:2320` and not removed after playback. It is swept at every startup (`lib.rs:4088`) and by the prune paths (`mod.rs:1553`, `cloud.rs:743`) and `clear_application_cache` (`lib.rs:3362`); after a crash it survives until next launch. Fix: delete on stop/track end (mind Windows file locks).

### 17. [ ] Registered `aideo://` route lacks application dispatch `[V]` (intended contract unconfirmed)
`tauri.conf.json:43` registers the scheme and `lib.rs:3761` initializes `tauri_plugin_deep_link`, but no application `on_open_url` handler was found. `single_instance` emits `deep-link` with `argv` (`lib.rs:3767`); the listener only logs it (`:4297`). No cold-start argv dispatch was found in `lib.rs`, and no file associations are configured. This is incomplete routing if scheme-driven actions are intended, not proof of a broken implemented "Open with" feature. Establish the intended action and OAuth dependencies before removal or implementation.

### 18. [x] Download and scan error events lack frontend consumers `[V]`
`tidal-download-error` (`tidal.rs:977`), `qobuz-download-error` (`qobuz.rs:900`), `scanner-error` (`scanner.rs:82`) have no frontend listener found. `AideoView.tsx` consumes the `*-download-progress` events. Those error-event paths do not provide frontend feedback; this alone does not prove every failure is silent through all command-return or logging paths.

### 19. [x] `playback-error` is handled twice with conflicting assumptions `[V]`
- `App.tsx:495` correctly expects `{path, attempt_id, error}` and drops stale attempts.
- `Toast.tsx:449` also listens, typed `listen<string>`, and passes the whole object to `addToast`. The payload has `error`, not `message`, so `addToast` (`:386-394`) `JSON.stringify`s it. Audio-ish errors are then rewritten to the generic "Audio playback system encountered an error…"; others (e.g. yt-dlp) show the raw JSON.
- The attempt-id guard in `App.tsx` is bypassed because `Toast.tsx` shows a toast for every error, stale or not, and a live error gets two toasts.
- Fix: delete the `Toast.tsx` listener (App already toasts via `ui-toast`), or make it read `payload.error` and honour the same guard.

### 20. [x] Mojibake in `AideoView.tsx` `[V]`
User-visible: `:34` (`â€”` should be `—`), `:2053` and `:2229` (`Â·` → `·`), `:3253` (`ðŸ‘¥`), `:3256` (`ðŸ’¿`). `:1062` is a comment. A sweep of `src/` and `src-tauri/src` finds no others. Replace and re-save as UTF-8.

### 21. [x] Helpers with different behaviour under one name `[V]`
- `parseDuration`: `utils.ts:6` returns 0 for invalid; `AideoView.tsx:38` returns 180 (documented: "defaulting to 180s").
- `isStreamTrack`: `utils.ts:424` also matches `mms://`, `rtsp://`, `aideo://`, any format containing YOUTUBE/TIDAL/QOBUZ, `STREAM`, `RADIO`, and the bare 11-char id heuristic; `LibraryView.tsx:47` matches only http(s) plus five exact format strings. The Library "streams"/"local" filters (`:1388-1389`) can therefore disagree with the rest of the app.
- `baseName`: three copies (`utils.ts:24`, `LibraryView.tsx:85`, `AideoView.tsx:33` with the mojibake).
- Fix: one implementation each in `utils.ts`; decide whether 180 is intended for discovery cards.

### 22. [x] Frontend lookahead works; unused Rust mirror removed (audit corrected)
Execution found `librarySlice.ts` uses this preference to gate real upcoming-track pre-resolution. Keep the frontend switch/default/gate; remove only the unused Rust DSP mirror. No backend lookahead claim is made.

### 23. [x] Tailwind-only class names render unstyled `[V]` (effect `[I]`)
`NowPlayingView.tsx:1205,1222` and `DownloadedView.tsx:443` use `relative group absolute top-1 right-1 opacity-0 group-hover:opacity-75 p-1 rounded bg-black/40 z-10 hover:bg-white/5 …`, none of which exist (item 2). Likely effect: the expand/collapse visualizer button isn't absolutely positioned or hidden, so it renders after the full-height canvas inside a 64px `overflow:hidden` container and is clipped. `nowPlayingVisualizer.test.tsx` passes because jsdom has no layout. Check visually. Fix: real CSS classes.

---

## Tier 4 — Functional bugs, non-audio

### 24. [x] "Go to Settings" nudge never navigates `[V]`
- `tidalSlice.ts:81` and `qobuzSlice.ts:80` dispatch a DOM `CustomEvent('ui-goto-settings-tab')`. `App.tsx:832` listens with Tauri `listen()`, which never receives DOM events. (The companion `ui-toast` DOM event works: `Toast.tsx:535` uses `addEventListener`.)
- Even if delivered, `pendingSettingsTab` (written at `App.tsx:834`) is read nowhere in `src/`.
- `tidalIntegration.test.tsx:223` asserts `pendingSettingsTab === null`, pinning the broken behaviour.
- Fix: set `view` / `pendingSettingsTab` straight from the slices, make `SettingsView` consume it, update that test.

### 25. [x] Downloaded-view prune invocation violates the IPC contract `[V]`
- `DownloadedView.tsx:91` invokes `prune_cache_to_limit` with `{ maxMb }`; the command requires `limit_gb: f64` (`cloud.rs:788`, JS key `limitGb`; `librarySlice.ts:2134` sends it correctly). The missing required key predicts IPC rejection, not runtime-observed here. Simply renaming the key while retaining the button's `5000` (`:243`) would request 5000 **GB**.
- `downloadedView.test.tsx:127` asserts `{ maxMb: 5000 }` against a mock that echoes args, so it pins the broken contract.
- The command also overwrites persisted `cache_limit_gb.txt` (`cloud.rs:792-794`). Whether this button should change the configured limit or prune once is a product decision not established by this audit.
- Side note: `get_cache_size_info` hardcodes `limit_gb: 5.0` (`lib.rs:3436`); `DownloadedView` declares `limit_gb` (`:29`) and never reads it.
- Fix the IPC key and units first (`limitGb`, with 5000 MB converted to the intended GB limit). Reuse the existing persisted-limit command if that is intended; introduce a non-persisting path only if one-off pruning is required. Replace the argument-echo assertion with useful behavior/contract coverage.

### 26. [x] Sonic ranking treats repeated profiles as measured and reverses metadata preference at zero distance `[D]`
- The current profile-writing path is `acoustid_identify_track` → `sonic_analyzer::analyze_audio_file` → `db::update_track_sonic_profile`; no frontend caller was found. Routine analysis from the current UI is therefore not established. This does not prove historical analysis never occurred.
- Read-only aggregate query: 160 tracks; **157 share `bpm=120, energy=0.5, bass_ratio=0.33, treble_ratio=0.33`**, and 3 have other feature tuples. These repeated values match the analyzer's empty-input fallback (`sonic_analyzer.rs:227`), but their origin is unknown. The current BPM schema default is `0.0` (`db.rs:240`), not 120. Do not classify the three other rows as proven measurements or the 157 rows as proven empty analyses.
- `rank_similar_tracks` (`lib.rs:3249`) treats non-NULL BPM/energy as features (`:3273`). For eligible candidates whose full profile equals the seed, distance is `0.0`; artist adjustment floors it at `0.05` (`:3303`), genre at `0.1`. An unrelated equal-profile candidate therefore sorts ahead of an artist/genre match. Equal-distance candidates retain input order; actual listening impact was not exercised.
- It feeds the Sonic Mix menu items (item 9) and local-track autoplay (`librarySlice.ts:1229`).
- Fix the metadata preference boundary and represent analysis validity/provenance explicitly if needed. Do not use the plausible numeric tuple as an infallible missing-data sentinel. Any proposed analysis integration needs a deliberate policy; preserve existing ranking eligibility/exclusion tests (`lib.rs:4377+`) and add coverage for zero-distance metadata ties and known-unanalysed rows.

---

## Tier 5 — Audio engine

### 27. [ ] Strict bit-perfect verification is unreachable in production `[V]`
- `sample_integrity_verified` is hard-coded `false` in all three route builders (`mod.rs:5828, 6189, 6423`) and its default (`:118`); `gain_ramp` is hard-coded `true` (`:5825, 6186, 6420`). `evaluate_audio_path` (`:211, :182-184, :208-210`) turns each into a failure reason, so `strict_bit_perfect` is always false.
- Two independent blockers: fixing only `sample_integrity_verified` still yields "gain_ramp_active". `effective_audio_path_tests.rs` passes because it injects `true`/`false`.
- Consequence: `audioPath.ts:21` cannot show the strict "BIT-PERFECT" badge from these production snapshots; an eligible exclusive route may show "WASAPI EXCLUSIVE" instead.
- This may be deliberate: `playbackSlice.ts:1164` tells the user "Sample integrity is unverified until the effective path confirms it". Treat it as unfinished verification, not a false bit-perfect certification.
- Keep reporting unverified until the sample path is demonstrated to preserve identity. Exclusive mode, matching rate/valid bits and absence of reported transforms/underruns are necessary route checks, not sufficient proof: float conversion, gain ramps, clamps and integer conversion also matter. Any future verification must cover actual sample conversion/output semantics and transient state; never set the flag true from metadata alone.

### 28. [x] DSP runs before the stereo downmix `[V]`
- `mod.rs:7159-7163` runs the node chain on all N channels; `:7169-7171` then folds their contribution into channels 0/1 for a 2-channel device. `downmix_to_stereo(&mut [Vec<f32>])` overwrites those channels but does not reduce the container's channel count.
- `EqNode` (`:3785`) and `AideoFilterNode` (`:3890`) touch channels 0 and 1 only; crossfeed, spatializer, width and convolution are 2-channel by their guards (`len() < 2`, first two channels). Centre, surround and LFE bypass them and are folded in afterwards, so EQ is applied to only part of the signal on 5.1 sources.
- Scope: multichannel decoded buffers going to a stereo device, including Symphonia and any channel-preserving FFmpeg fallback (item 14); streaming FFmpeg paths already force stereo.
- Fix direction: fold before stereo DSP and ensure the DSP receives a genuinely two-channel view/container, with compatible node state and no second folddown. Moving the existing slice-mutating call alone is incomplete. Cover centre-only input plus EQ and preserve channel-layout and visualizer semantics (`:7157`).

### 29. [x] Crossfade decisions use a stale DSP snapshot `[V]`
- `dsp_now` is captured once at `mod.rs:5217`. The trigger (`:6768-6769`), the DSP passed to the next decoder (`:6784`) and the next resampler params (`:6821-6823`) use it. The live copy is `current_dsp`, updated at `:6710/6717/7043`; the mix length uses it (`:7133`). The `let dsp_now` at `:7033` shadows too late to help.
- Source-derived consequences, not audio-tested: enabling mid-track leaves the startup trigger disabled; disabling leaves the startup trigger enabled and does not cancel an already-created next decoder. Duration changes use the old trigger boundary but live mix length. Scope excludes intervening stream restarts that recapture state.
- (`quality = last_ffmpeg_quality` at `:6783` is fine; a change restarts the stream, `:6736`.)
- Fix direction: use live state for untriggered decisions and define behavior for a fade already in progress. Triggering pops the next queue entry (`:6775-6776`); cancellation must handle that entry and decoder/process/resampler cleanup without loss or duplication. Replacing snapshot references alone does not solve those transitions. Cover enable, disable, duration changes and queue ownership.

### 30. [x] Playback speed: label wrong, and ignored in bit-perfect `[V]`
- `setPlaybackRate` toasts "(Pitch Preserved)" (`playbackSlice.ts:1326`). The backend only changes the resampler ratio (`update_playback_ratio`, `mod.rs:5070`); there is no time-stretch, so pitch shifts with speed.
- In bit-perfect passthrough (`is_bp`, `mod.rs:7065-7069`) the rate isn't applied at all, yet the toast still reports the new speed. (`evaluate_audio_path` does list `playback_rate` as a transform, so the engine and toast disagree.)
- Fix: implement a pitch-preserving stretch or correct the label, and warn/disable the control under bit-perfect.

### 31. [x] Full frontend DSP updates overwrite backend ReplayGain and playback rate `[V]`
- `play_file` writes the track's ReplayGain into the backend DSP state at each track start (`mod.rs:5199-5215`). The frontend's own `dsp` object holds `track_replaygain_gain: 0.0` and `playback_rate: 1.0` (`playbackSlice.ts:183-184`) and never updates either (`setPlaybackRate` writes only `playbackRate`, and nothing reads `get_dsp_state`).
- `setDSP` sends the entire frontend object (`:952`, `:1054-1060`, `performDspInvoke` `:46`) and `set_dsp_state` replaces the backend state wholesale (`lib.rs:1043`).
- When a frontend DSP update carrying those stale defaults is sent mid-track:
  - Backend ReplayGain becomes 0 dB. With R128 enabled and previously nonzero static gain, `PreampNode` loses that gain (`mod.rs:3703-3705`) and `NormalizerNode` becomes eligible (`:4399-4400`). A loudness change is plausible, not measured; ReplayGain is reloaded at the next track start.
  - Backend playback rate becomes 1.0 while the separate UI rate can retain its old value. Audible effect depends on the active sample path (item 30).
- Fix direction: define field ownership and preserve backend-owned `track_replaygain_gain` / `playback_rate` when applying frontend DSP updates, or synchronize them under an explicit contract. Check sanitization, locking and all field writers; test preservation and deliberate rate changes. No implementation or line-count estimate is established here.

---

## Suggested batches

| Batch | Items | Risk | Notes |
|---|---|---|---|
| A. Lower-risk cleanup | 1, 3, 4, 5, 6, 7, 20 | low after caller checks | preserve meaningful parser/recovery tests; 4 needs a fixture or explicit ignore |
| B. Contract decisions | 2, 8, 14, 17, 22 | scope-dependent | unused references do not prove safe deletion; establish intended behavior |
| C. UI/contract fixes | 9, 10, 11, 21, 24, 25, 19 | low-medium | exercise real navigation, prune invocation and error delivery |
| D. Audio transitions | 13, 28, 29 | medium | cover conversion, channel representation and fade/queue transitions; 12 withdrawn |
| E. Correctness | 31, 26, 30, 27 | medium | prioritize field ownership; ranking provenance and sample-integrity proof need separate designs |
| F. Hygiene | 15, 16, 18, 23 | low-medium | visual proof needed for 23; callback coverage needed for 18 |

Verification gate (`AGENTS.md`) after every batch, all green:
`npx tsc --noEmit` · `npx vitest run src/test` · `cargo check --manifest-path src-tauri/Cargo.toml` · `cargo test --manifest-path src-tauri/Cargo.toml`

---

## Ruled out (do not re-chase)

- `chromecast_*` commands use `#[command]` (not `#[tauri::command]`) and **are** registered (`lib.rs:3994-3999`).
- Live IPC (see item 8): `pre_resolve_youtube_url`, `update_playlist_source`, `tidal_/qobuz_resolve_source`, `tidal_/qobuz_search`, `tidal_/qobuz_get_stream_url`.
- `oauth-success` is emitted by `OauthChildCallback.tsx:24,35`.
- `chromaprint-next` is used by the lib; the bin-crate "unused" lint hits are noise (item 1).
- `ActiveStream`'s `#[allow(dead_code)]` is intentional (RAII holder, item 3).
- `formatDuration` ×2 are different functions (item 10).
- Shared-mode I32 callback ignoring the bit-perfect volume rule (`mod.rs:6082`) is consistent: those routes set `volume_bypass_in_bit_perfect = false` (`:6187`).
- `wasapi_engine.rs:369` passes `upsample_target = 0`, but `play_file` already passes the target rate as `sample_rate` (`mod.rs:5724-5726`), so it is the first candidate.
- Exclusive-mode mute draining the ring (`mod.rs:5745-5750`) is deliberate (keeps position advancing while muted).
- `LimiterNode` built with `min(file_ch, dev_ch)` channels: `LookaheadLimiter::process` grows its buffers on demand (`:3520-3528`).

## Previously inspected behavior (not runtime-certified)

DSP state sanitising (`DSPState::sanitize`, `mod.rs:2940+`). Read in an earlier pass and not re-checked this time: generation tokens / `cancel_token` cancellation, the exclusive failure budget (3 tries then shared for that track, preference stays ON), gain ramp and ±1.0 clamp, drain at EOF, the device-fallback chain, position tracking that subtracts resampler and ring delay.

## Corrections

**To the first draft of this file** (old # → new #): 1→1 (proof strengthened), 2→2+23, 3→3, 4→8, 5→5, 6→6, 7→7, 8→22, 9→20, 10→21, 11→9, 12→10, 13→11, 14→12, 15→18, 16→16, 17→15, 18→14, 19→24, 20→25, 21→29, 22→13, 23→28, 24→30+31, 25→27.
- Wrong: `pre_resolve_youtube_url`, `update_playlist_source`, `tidal_/qobuz_resolve_source` were listed as "test-only IPC". All four are live.
- Wrong: `isLosslessTrack` copies are not identical; `formatDuration` is not a duplicate.
- Wrong: I told you `#[allow(dead_code)]` on `ActiveStream` "may be stale". It's intentional.
- Withdrawn: item 12's "idle gap" attempt-ID bug. The outer loop clears the track or processes pending Play first; reachability was not established.
- Overstated: item 16 (temp files) is swept at each startup, not only by manual cleanup.
- Imprecise: item 29 said `:6784` passes an "FFmpeg quality"; it passes the DSP clone.
- Reframed: item 27 has a second blocker (`gain_ramp: true`) and may be deliberate.
- Item 13: in the first draft I wrote the "0 frames, dropped" conclusion but the file's earlier line said "zero-filled" for those arms; the arms are unreachable for those formats.
- New (not in the first draft or the chat summary): 4, 17, 19, 23, 26, 31, and the bit-perfect half of 30.
- Baseline gained `cargo test`.

**To the chat summary before that:**
- "Bit-perfect never verified" was right, but incomplete (see 27).
- The earlier line-count estimates for crossfade, restart and DSP-ownership fixes were unsupported. Item 12 is withdrawn; items 29 and 31 require transition/ownership-aware changes, not promised one-liners.
- Wrong: the rewritten audit said `AGENTS.md` misdescribed Tailwind/daisyui. Its current guidance is correct and was left untouched.
- Qualified: repeated sonic tuples are observed, not proven empty-analysis sentinels; route metadata does not prove bit identity; "Open with" has no established implemented contract; cleanup candidates are not zero-risk deletions.

**Historical audit limitations:** the September30 pass did not run audio/UI/IPC. October1 execution evidence and remaining limits are recorded above; item13/15 production frequency and aideo:// intended action contract remain unestablished.

---

## Change log

| Date | Item(s) | Commit | What changed | Tests added |
|---|---|---|---|---|
| 2026-09-30 | Audit only | uncommitted | Withdrew #12; corrected AGENTS guidance and repo state; qualified profile provenance, deletion risk and audio remediation | None; application source unchanged by this audit |
| 2026-10-01 | 1–31, dispositions above | uncommitted | Implemented confirmed cleanup/contracts/audio fixes; retained public contracts/live lookahead, withdrew12, left17 contract-blocked and27 honestly unverified | Live parser/recovery, artist/favorite migration, sonic validity, DSP ownership, sample conversion/stereo/resource/fade, settings/prune/speed/error/cancellation regressions |
