# Unified search and playback sources

Status: song-first search revision implemented on 2026-09-16. Live-provider
playback and visual inspection remain unverified.

## Song-first revision

- Search always queries accessible providers. Optional source filters narrow the
  same results without issuing a different search or discarding other copies.
- Rows expose Play, Play next, Add to queue and Save with pending/error/success
  feedback. The compact Auto/source control retains discovered alternatives.
- Real YouTube `duration_raw` values are parsed and validated. Strong matching
  title, artist and duration (within three seconds) can group copies without
  catalog IDs. Conflicting versions, artists, albums, ISRCs or UPCs stay separate;
  an ambiguous upload cannot bridge conflicting releases. Metadata is not proof
  of an identical master.
- Quality remains Best available, Standard lossless or Data saver. A saved
  preferred provider breaks equal-quality ties, after suitable local copies.
  Disconnected services and streaming sources in local-only mode are excluded.
- Auto waits up to 750 ms for known source quality checks, then starts an available
  copy. One bounded background search may upgrade to verified lossless audio (or
  higher lossless resolution under Best available) at the current position.
  Paused playback waits for resume; stop/skip cancels the upgrade. Explicit source
  choices and Data saver do not trigger background quality upgrades.
- Switching reuses the existing native play/seek path and may briefly buffer.
  Seamless handoff and native gapless between unified recordings remain separate
  work. Catalog bitrate across different lossy codecs is not treated as proof of
  a quality improvement.
- A failed initial copy can use newly discovered alternatives before exhausting
  playback. Search suggestions also use Auto instead of bypassing preferences.
- Playlist-entry choices stay entry-specific. Search source choices retain the
  discovered source IDs for subsequent plays and restart.
- Each source retains its own title, artist, album, duration, artwork and track/disc
  tags. Manual switches, fallback and upgrades update the playing metadata and
  system media controls while retaining the recording and playlist-entry identity.
- Revision verification: TypeScript passes; 649 frontend tests
  pass across 96 files; Cargo check and 289 native tests pass (two ignored).
  Computer-use reported no available browser, so rendered inspection and live
  provider handoffs still need desktop verification.

## Implementation progress

- All four home layouts default to All sources. Local files, YouTube, connected
  Tidal, and enabled/connected Qobuz publish results independently, with pending
  and partial-failure notices. Stale unified searches cannot replace newer ones.
- Recording matching uses the strong metadata rules above, retaining catalog
  identity where present and keeping conflicting or ambiguous evidence separate.
- Settings > Plugins > Streaming Quality offers Best available (default),
  Standard lossless, and Data saver. Native provider ladders honor the setting.
  Auto compares resolved quality and prefers suitable local files. Catalog labels
  never establish decoded playback quality. DSP/resampling settings are unchanged.
- Other sources is available in search, Library row menus, and Now Playing. It
  remembers explicit choices per recording and can return to Auto. A deliberate
  change can switch the playing recording at its current position. Existing path-only playlist entries remain independent;
  explicitly converting one preserves its entry ID and neighboring entries.
- Unified saved songs appear in Favorite Songs and the library's loved views.
  Entry IDs preserve same-path selections, removals, and playlist ordering.
  Queue/session restoration keeps recording context and stable provider IDs.
- Playback uses bounded source resolution and same-recording fallback, retains
  explicit preferences, and reports degraded/unverified quality. Stop/skip/new
  requests cancel remaining work. Decoder failure cannot cause an endless retry.
- Both artwork-outline implementations are removed. Now Playing shows the active
  provider and uses playback telemetry for the signal inspector.

## Verification and limits

- TypeScript checking and the full frontend/native suites cover persistence,
  source matching, quality requests, caches, queue restoration, missing local
  files, decoder failure, cancellation, choice controls, and partial search.
  The frontend suite passes 610 tests. The updater-popup test timed out once
  under parallel load; the complete suite passed with two workers. Native tests
  pass 289 tests with two ignored. TypeScript and Cargo checks pass.
- Source-aware queues resolve at track start and do not use native gapless or
  crossfade between recordings. Ordinary local-only playback restores native
  queue behavior. Recording-aware native prefetch is a separate enhancement.
- Search and resolution have a 15-second frontend timeout per operation. The
  underlying IPC work may finish later; cancelled results cannot start playback.
- Browser preview could not start: esbuild was denied a parent-directory read,
  and automatic approval review rejected the retry because its service lacked
  credentials. Component/keyboard tests passed; window-size visual checks and
  real Tidal/Qobuz/YouTube playback still require desktop verification.

## Agreed behavior

- Search local files, YouTube, Tidal, and Qobuz in one experience. Use available,
  connected providers and preserve Qobuz's existing enablement setting.
- Remove the artwork outlines that encode source or quality by color.
- Combine confidently matched copies of the same recording. Keep originals,
  remasters, live recordings, covers, and uncertain matches separate.
- Rank search results by relevance. Quality breaks ties between equivalent copies;
  a higher-resolution unrelated result must not displace the requested song.
- New unified results use Auto source selection. Prefer a local copy when it meets
  the chosen quality preference; otherwise select an appropriate streaming copy.
- Settings offers Best available (default), Standard lossless, and Data saver.
  These control stream selection independently of DSP and resampling.
- If the desired quality is unavailable, play an equivalent available copy and
  show a small fallback notice.
- Each song has an Other sources control. An explicit choice persists for that
  recording until the user returns it to Auto.
- If an explicit source fails, temporarily use another copy of the same recording,
  show a notice, and retain the explicit preference for the next attempt.
- Existing playlists and saved songs retain their current sources. Users can
  switch individual existing entries to Auto. New additions from unified results
  retain Auto across saving, queueing, and restarting the app.
- Track details continue to expose the source and actual playback format.

## Engineering rules

- Separate recording identity, provider identity, and resolved playback URL.
  Provider IDs must include their provider; CDN URLs are temporary playback data.
- Preserve existing path-based entries through an additive persistence change.
  An Auto choice on a new entry must not silently convert an existing saved entry.
- Use conservative recording matching. Title and artist alone are insufficient
  to establish an identical recording or master. Missing metadata must not count
  as agreement, and duration guesses must not become matching evidence.
- Keep the selected preference separate from the source used for this attempt.
  A fallback must not overwrite the saved choice or alter other playlist entries.
- Request quality from the provider. Do not infer actual playback quality from a
  provider name, file extension, or catalog maximum, and do not upsample to meet
  a preference. Higher resolution is a selection rule, not proof of better sound.
- Show local and completed provider results while other searches are pending.
  Ignore stale responses after a new search; expose partial provider failures.
- Apply selection consistently to unified manual playback, queue next, natural
  transitions, repeat, and restored sessions. Auto may upgrade once during
  playback under the position, matching and cancellation rules above.
- Bound fallback attempts and stop after exhausting equivalent sources. Stop,
  skip, or a newer play request must cancel the old request's remaining work.
- Cache stream resolutions by provider, track ID, and requested quality. Changing
  quality must not reuse a URL resolved for a different preference.
- Use the existing Tauri IPC boundary. Keep source authentication in Settings.

## Implementation order

1. Add typed recording/source selections and backward-compatible persistence.
   Lock in preservation of existing entries with tests before changing playback.
2. Add matching and ranking, preserve provider quality metadata, and pass the
   requested quality into the existing native stream resolvers.
3. Add bounded source fallback and cancellation across manual and queued playback.
   Report the actual resolved quality and retain the original preference.
4. Unify search and discovery interactions, remove both outline implementations,
   add Other sources, and add streaming-quality controls to Settings.
5. Verify the complete flow, including restart, queue transitions, missing local
   files, unavailable providers, and fallback from an explicit source.

## Current code touchpoints

- `src/components/AideoView.tsx`: separate searches, source tabs, artwork outlines,
  and discovery playback handlers.
- `src/components/aideo/HomeParts.tsx`: shared search source controls and duplicate
  source-color logic used by the other home layouts.
- `src/components/SettingsView.tsx`: existing DSP profile; add a distinct streaming
  quality setting using the established Settings controls.
- `src/store/types.ts`, `tidalSlice.ts`, and `qobuzSlice.ts`: track representations
  and provider results. Search mapping currently drops provider quality labels.
- `src/store/librarySlice.ts`: manual playback, playlist IPC, source resolution,
  pre-caching, and native track transitions.
- `src/store/playbackSlice.ts`: queue insertion, queue restoration, and stream
  resolution. These paths also need the selected quality and recording identity.
- `src-tauri/src/db.rs`: existing playlist entries are keyed by track path.
- `src-tauri/src/tidal.rs` and `qobuz.rs`: current native quality fallback ladders.

## Acceptance checks

- A matching local, Tidal, and Qobuz recording appears once with source choices;
  different versions and uncertain YouTube matches remain separate.
- All three quality preferences survive restart and change the requested native
  stream quality without changing DSP settings.
- Existing saved entries keep their sources; a newly saved Auto entry stays Auto
  after restart, including when it shares a recording with an existing entry.
- Explicit choice survives a temporary fallback and can be reset to Auto.
- A failed source triggers one bounded fallback sequence and a clear notice.
  Exhaustion leaves an honest failure state; stop/skip prevents delayed playback.
- Provider ID collisions and stale URLs cannot play a different source or song.
- Queue playback and restored playback obey the same rules as a search click.
- Inspect all existing Aideo home layouts and the source picker with keyboard
  navigation, loading/error states, and narrow window sizes.
- Run the repository gate: `npx.cmd tsc --noEmit`,
  `npx.cmd vitest run src/test`,
  `cargo check --manifest-path src-tauri/Cargo.toml`, and
  `cargo test --manifest-path src-tauri/Cargo.toml`.
