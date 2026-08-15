# Aideo Music Player — Full Code Audit Report

**Version audited:** 0.9.5 (Tauri 2.11.1 + React 19 + Zustand + Rust)
**Date:** 2026-08-15
**Scope:** `src/` (React/Zustand frontend), `src-tauri/src/` (Rust backend, ~20 modules), Tauri config, capabilities, env handling.
**Method:** Line-by-line read of all store slices, `App.tsx`, all Rust modules, plus targeted verification of every security/data-loss claim (checked tauri-2.11.1 vendored source where behavior depended on framework semantics).

This report lists defects found. It is intentionally critical — every item was verified in source with a file/line reference. "Verified non-issues" at the end lists things that *look* wrong but are actually correct, so future reviewers don't waste time.

---

## Critical

1. **Remote clients can set unbounded volume (audio hardware damage / clipping).**
   `src-tauri/src/remote_server.rs` — the WebSocket `volume` command writes the raw value into `player.volume` with **no clamping**. The frontend `setVolume` clamps to `[0,1]`, but this path bypasses the frontend entirely. Worse, the backend `set_volume` command (`src-tauri/src/lib.rs:1482-1486`) also does **no clamping**, so the only clamp in the whole app is the React slider. A remote client (or any LAN script on the bound `0.0.0.0` port) can send `volume: 9999` → the player multiplies audio by an insane gain → clipping/blown speakers. Fix: clamp in `set_volume` and in the remote server before storing.

2. **`scan_and_save` permanently deletes tracks + playlist membership when a file is temporarily unavailable.**
   `src-tauri/src/lib.rs:573-622` — for every DB row whose path doesn't currently `exists()` on disk, it deletes the `tracks` row **and** its `playlist_tracks` rows. A disconnected external drive, an unmounted NAS, or a typo'd scan directory permanently destroys the library, loved state, and playlist memberships. The code even advertises "recover missing tracks" recovery elsewhere — these two features directly contradict each other. At minimum, missing-file cleanup must be an explicit user action (`clean_missing_tracks`, which already exists), not part of a normal scan. Fix: don't delete in `scan_and_save`; only add/update.

3. **`get_cover_art` is an unauthenticated SSRF with unbounded download.**
   `src-tauri/src/lib.rs:859-887` — the command accepts any `http(s)` URL from the frontend, fetches it with no host allowlist, no size limit (`res.bytes()` is unbounded), and returns the base64 body to the caller. A compromised/script-injected webview can probe internal hosts (`http://127.0.0.1:...`) and exfiltrate responses as base64. `apply_online_cover` (`lib.rs:896-911`) has the same unrestricted-fetch pattern plus an unbounded `res.bytes()` written straight to disk. Fix: allowlist hosts (ytimg, musicbrainz, lastfm, tidal, jellyfin/subsonic origins) and cap response size.

4. **The Chromecast HTTP file server exposes arbitrary user files to the LAN.**
   `src-tauri/src/chromecast.rs` — `is_path_safe`'s third tier returns true for **any file in the same parent directory as any library track** (line ~63-88), and the server binds `0.0.0.0` with zero authentication. LAN clients can stream private documents via guessable `C:\Users\<name>\...` paths. Additionally every accepted connection spawns an unbounded `tokio::spawn` with a 4 KiB read loop and no connection cap or timeout → trivial LAN DoS/memory exhaustion.

5. **Subsonic token + Jellyfin API key are embedded in stream URLs that are persisted forever.**
   `src-tauri/src/cloud.rs` — Subsonic stream URLs carry `t=<md5(password+salt)>&s=<salt>`; Subsonic token auth stays valid indefinitely for that salt. These URLs are stored in the SQLite `tracks` table, in `localStorage` (queue), and are handed to Chromecast over the network (`chromecast.rs`). Jellyfin stream URLs embed `api_key=` the same way. Anyone who obtains one of these URLs has a permanent credential to the user's Subsonic/Jellyfin account. Fix: prefer header auth (Jellyfin supports it) and/or short-lived timestamp tokens, never persist signed URLs.

6. **`yt-dlp.exe` / `ffmpeg.exe` are downloaded and self-updated with no integrity verification.**
   - `src-tauri/src/youtube/mod.rs:2058-2068` — `yt-dlp.exe` is downloaded without checking HTTP status or any checksum; a captive-portal/proxy 200 HTML page is written as `yt-dlp.exe`, and since all later code gates on `ytdlp_path.exists()`, the corrupt binary is never re-downloaded.
   - `src-tauri/src/dependencies.rs` — downloads `yt-dlp.exe` (GitHub) and `ffmpeg.exe` from a third-party mirror repo (`xihan123/FFmpeg-Audio`) with **no checksum verification**.
   - `src-tauri/src/dependencies.rs` `spawn_background_ytdlp_updater` and `player/mod.rs:872-887` run `yt-dlp -U` **at startup and on resolve failure** — an unsigned self-updater that can replace the executable with code from yt-dlp's update channel. Combined with no checksums, a compromise anywhere in that chain yields arbitrary code execution on user machines.
   - `youtube/mod.rs:2105` and `player/mod.rs:858/916` pass `--no-check-certificate` to yt-dlp, disabling TLS verification (MITM can inject arbitrary content).

7. **Two `.setup()` calls — the first is silently discarded (tray menu never appears).**
   `src-tauri/src/lib.rs:2040` and `lib.rs:2218` both call `.setup()`. Verified against tauri-2.11.1 source: `Builder::setup` assigns `self.setup = Box::new(setup)` to a single field — the second call replaces the first. The tray menu creation (Show/Quit, lines 2040-2066) is dead code; the right-click tray menu never shows. Fix: merge the two into one `.setup()`.

8. **Deleted tracks resurrect from playlist orphans at every startup.**
   `src-tauri/src/db.rs` — the FK from `playlist_tracks` to `tracks` was dropped in a migration (db.rs:135-172). `delete_track` removes only the `tracks` row, leaving `playlist_tracks` orphans; the "Recover missing playlist tracks" block (db.rs:200-277) then re-inserts those paths as new `tracks` on every launch. Users delete a track, it comes back after restart. Fix: delete orphaned `playlist_tracks` in `delete_track`, or keep the FK cascade.

---

## Major

9. **Unclamped/unvalidated remote inputs:**
   - `remote_server.rs` — PIN check uses substring match `request_str.contains("pin=...")` (a URL like `?pin=ABC1234` also matches `?x=ABC123&pin=...`? — actually the pin is matched as a substring anywhere, so a crafted query can bypass only if the full PIN is present, which is the design; but the PIN is 128-bit and **never rotates**, and is printed to the console and embedded in QR/URLs).
   - `tidal.rs:383` — `300 / interval` divides by an unvalidated server value; `interval == 0` panics the task; `interval > 300` makes the loop run zero times so login never completes, silently.
   - `tidal.rs:557` — unparseable track IDs collapse to `"0"` → all such tracks share one ID (dedup/collision).
   - `youtube/mod.rs:2785` — `start_offset + fetch_limit + 10` can overflow usize.

10. **`player/mod.rs` streaming weakness — position/EOF correctness:**
    - HTTP streams can't seek (seek restarts ffmpeg at the offset; see 4781-4899) — acceptable, but note the buffer-drain position math `true_pos = ram_cursor/rate - (pending+ring)/rate` is only correct for RAM-cached decode; for streaming it approximates.
    - `GrowingFileReader` (172-198) hard-stalls 120 s then errors on stalled downloads — long, but intentional.
    - The `+1.15x` gain boost applied to ALL exclusive-mode output (4783-4790) is a deliberate psychoacoustic trick but silently alters level and can clip on hot masters even though it runs *before* the limiter — borderline, flag as audio-fidelity concern.

11. **Last.fm scrobble "success" is a lie.**
    `src-tauri/src/lastfm.rs:126-130` — returns `Ok(())` whenever a `scrobbles` key exists, even if `"accepted": 0` (all scrobbles ignored/rejected). Combined with `lib.rs:347` where `timestamp` is an unvalidated frontend-supplied i64, every rejected scrobble is silently reported as success.

12. **`db.rs` destructive upsert wipes metadata.**
    `db.rs:342-347` — `save_tracks` `ON CONFLICT(path) DO UPDATE SET title/artist/album = excluded.*` unconditionally. A rescan of a file whose tags are missing (or a caller passing `None`) permanently erases previously stored metadata. Unlike `cover_url`, these columns have no `COALESCE` protection.

13. **WASAPI exclusive silent death.**
    `wasapi_engine.rs:290-292` — `client.start_stream()` failure is swallowed after `Ok()` was already returned to the caller; the stream appears healthy and playback silently dies with no error event. Also `on_error` is invoked from the audio thread (wasapi_engine.rs:314/329/441) and can block the audio callback if the event channel is full.

14. **Frontend keyboard shortcuts are broken by design interactions:**
    - `App.tsx:404-410` — `'b'` and `'m'` are hardcoded unconditional branches that defeat the remapper: after remapping, old keys remain phantom bindings, and remapping any *other* action onto `b`/`m` makes that action win and kills DSP bypass/mute.
    - `FullscreenView.tsx:170-229` registers a **second** global keydown handler; in fullscreen, ArrowRight fires `playNext()` AND `seek(+5)`, ArrowUp/Down step +0.1 instead of +0.05, and `'m'` calls `toggleMute()` twice (the second cancels the first → mute appears broken).
    - `App.tsx:380` / `FullscreenView.tsx:173` guards miss `<select>` and contentEditable focus.
    - `SettingsView.tsx:207-225` shortcut recorder: Esc can't cancel, modifier-only keys are bindable, no duplicate-binding validation.

15. **`SettingsView.tsx:335-343` `resetScrobbling` has inverted conditions:**
    - (a) checks `lastfmSessionKey` instead of `scrobbleEnabled` → pressing "Reset to Defaults" turns Last.fm scrobbling ON when it was OFF.
    - (c) `if (!listenbrainzEnabled) toggleListenbrainzScrobble()` re-enables LB right after (b) disabled it — ends up enabled with no token.

16. **Tidal integration is dead code — unreachable from the UI.**
    `src/components/TidalView.tsx` is exported but **never imported anywhere**; `view === 'tidal'` has no render branch in `App.tsx` (verified: only `aideo, library, loved_streams, albums, nowplaying, lastfm, listenbrainz, aideo_lab, settings, insights, charts, fullscreen` render). `view === 'aideo_search'` is likewise never rendered and never set. The entire Tidal feature (login, search, download) exists in the backend but cannot be used.

17. **Cover-art "healing" runs an unbounded background YouTube search loop at startup.**
    `lib.rs:2376-2442` — for every online track missing a cover, it runs a YouTube search + 300 ms sleep. On a library with hundreds of online tracks this hammers YouTube for minutes at every launch and can trip rate limits. No cap, no resume marker.

18. **`sonic_analyzer.rs` does not implement what it claims.**
    Lines 346-352: comment says "EBU R128 Integrated LUFS" but the code is plain unweighted RMS→dB with a fixed -0.69 offset — no K-weighting, no gating. The `lufs_gain_db` derived from it is not a valid ReplayGain value. Also unhandled `AudioBufferRef` variants fall into `_ => {}` (silent zeros → garbage fingerprints), and fingerprint `feed`/`finish` errors are discarded.

19. **`musicbrainz.rs:6` regex corrupts search titles.**
    `(audio)|(lyrics)|(lyric\s*video)` with no word boundaries: "Audiobook" → "book", "Lyricist" → "ist", "My Audio Diary" → "My  Diary". The sanitizer damages the query it is meant to clean.

20. **Discord presence reconnect race.**
    `discord.rs:27/41/59-69` — `set_enabled(false)` clears `IS_CONNECTING` while the reconnect thread may still be running; rapid enable/disable spawns unbounded duplicate threads that race to overwrite `DISCORD_CLIENT` (a client dropped unclosed). Presence-update failures (including transient "Client not initialized") force a full close+reconnect churn.

21. **`taskbar.rs` leaks.**
    `Box<AppHandle>` stored via `SetPropW` is never freed (re-init leaks the old box); loaded `HICON`s never `DestroyIcon`'d; `static mut` icon globals are a data race.

---

## Minor

22. **`chromecast.rs`:** full stream URLs (with signed yt-dlp tokens / `sig`/`expire`, and absolute filesystem paths with the username) logged to console (464/506); global `CAST_CLIENT` mutex held across `resolve_remote_content_type` (two sequential 3 s timeouts) and `load_media` → UI hangs seconds on unreachable device (435-436/470/517); lock-acquisition order differs between connect and disconnect (deadlock hazard, 371-377 vs 342-353); `start_time` (seek) unvalidated, negative values passed to `load_media` (516).

23. **`scanner.rs`:**
    - `43-47` — background scan metadata failures are broadcast on the **`playback-error`** event channel → UI may treat library scans as playback failures.
    - `186-202` — ID3v2.4 frame sizes read as plain big-endian (v2.3 style) and encoding byte `0` decoded with `from_utf8_lossy` → mis-sized frames and mojibake for Latin-1 tags.
    - `107-108` — hard-capped disc heuristic `d < 20` rejects legit multi-disc sets; `discN` substring false-positives on dirs like `acdc2`.
    - `149` — dead variable `_channels`.

24. **`youtube/mod.rs`:** 3-part duration "0:59:59" treated as "1 hour or more" and dropped (1556-1567); `is_official_topic` inversion when artist is literally "Topic" (386); search words interpolated into `LIKE '%word%'` without escaping `%`/`_` (1396-1397); `child.wait()` with no timeout and no abort path on the stderr-drain spawn (1822-1858).

25. **`tidal.rs`:** any 4xx refresh (incl. 429) logs the user out (295-299); on refresh network error the possibly-expired token is returned as success guaranteeing a 401 (304-307); region fallback hardcoded to `"MY"` Malaysia (504); autoplay queries the literal string `"<artist> Radio"` which is not a real catalog track (1070-1071); empty artist makes `contains("")` always-true so every track lands in the same-artist pool (1122).

26. **`playbackSlice.ts`:**
    - `setVolume` skips persistence when the new volume is `0` (muted volume is never saved, so restart resets to stale value).
    - `mutedPrevVolume` not updated when volume changes while muted → unmute jumps to an old value.
    - DSP "activation" logic: while bit-perfect, setting **any** DSP param (even `eq_enabled: false`) is treated as activation → auto-toggles bit-perfect off and forces `dsp.enabled = true`.
    - `check_files_exist` trusts backend array length; a length mismatch marks tracks as missing.
    - `seek()` stores position unclamped (`playbackSlice.ts:254-263`); can exceed track duration until next poll.

27. **`librarySlice.ts`:**
    - `generateSmartMix` fails entirely when `create_playlist` hits the `name TEXT UNIQUE` constraint (db.rs:432-433 returns Err on duplicate) — no graceful fallback.
    - Auto-queue after `playTrack` only adds to the backend queue via `invoke('add_to_queue')`, not to the React `queue` state → UI queue and actual queue diverge.
    - `playNext` computes `trackId` at ~688-693 then never uses it (dead code); Tidal autoplay is invoked with only artist/title.
    - `isOnline` recomputed at ~375 drops Tidal FLAC / YouTube Direct (inconsistent with the ~316 version) → non-http Tidal tracks get no buffering events / onlineTrackCache entry.
    - `handleTrackTransition` logs *every* backend transition as `'autoplay'`; index `-1` fallback → `(index+1)%len = 0` edge case.
    - On repeated failure the catch-block `setTimeout(() => playNext(), 1500)` cascades through all tracks.

28. **`metadataSlice.ts`:** `autoFetchLyricsOnline` calls `adjustLyricOffset(calculatedMs)` which *adds* to the existing offset → cumulative drift on repeated auto-fetch when lyrics aren't persisted.

29. **`uiSlice.ts`:** sleep timer keeps decrementing while the window is hidden/minimized (README claims 0% idle); `resetProMode` doesn't reset convolution, `aideo_filter`, `saturation`, or `audio_profile`.

30. **`syncEngine.ts`:** cloud playlist tracks are never pruned — delete+reinsert only runs when `tracks.length > 0`; `syncFromCloud` only adds missing tracks, never removes locally-removed ones → stale Supabase rows. `downloadProgress` map grows unbounded (`AideoView.tsx:648-655`).

31. **`db.rs`:** `add_to_playlist` position race (`MAX(position)+1` outside the insert, 459-467); `toggle_love_track`/`toggle_dislike_track` non-atomic exists-then-insert (552-556/622-626); migrations errors swallowed every startup (`let _ = ALTER TABLE`, 195-197); `get_playlist_tracks` recomputes `path_hash` instead of selecting the column (491-501).

32. **`lastfm.rs`:** placeholder keys `"YOUR_LASTFM_API_KEY"` shipped in the binary (7-15) → silent 401s if env not set; `get_user_info`/`get_recent_tracks`/`get_top_artists` don't check `json["error"]` unlike every other function (133-165).

33. **`lyrics.rs:183-191`:** Enhanced-LRC `<mm:ss.xx>` word timestamps are used raw, but Enhanced-LRC times are relative to the line start → word highlighting offset by the line's start time (NetEase `(offset,duration)` words add `line_start_secs` correctly at 149, but angle-bracket words don't).

34. **`artwork.rs:28-33`:** count-only cache eviction — 100 entries of ~16 MB each ≈ 2 GB RAM; a `None` result is cached, so a cover added later is never picked up until the cache fills.

35. **`lib.rs`:** `set_volume` no clamp (1482); `open_oauth_window` callback URL check is a loose substring match on `localhost:1420`/`alirull18.github.io` + `access_token=`/`code=` (any URL containing those substrings emits the token to the app, 134-150); rescan never refreshes title/artist/album/duration (604-615); `get_similar_tracks` BPM diff divided by 60 can exceed ±1 (weighting oddity, 1748).

36. **`cloud.rs`:** `xor_cipher`/`subsonic_decrypt` with hardcoded keys (`AIDEO_OFFLINE_CACHE_KEY_2026`, `aideo_music_player_secret_key_123`) — obfuscation presented as "encrypted cache" (marketing mismatch with README's "Download and encrypt stream").

37. **`updater.rs`:** `expected_sha256` is optional — when the release has no `.sha256` asset, the frontend passes `null` and the download proceeds **unverified**; no signature check at all (custom updater vs Tauri's signed updater). Installer path is interpolated into a `cmd.exe /C` string (input-derived but not user-controlled — low risk).

38. **No CSP anywhere.** `tauri.conf.json` has no `security.csp`; `index.html` has no CSP meta. Combined with the SSRF-susceptible `get_cover_art`/`apply_online_cover` commands and all custom commands exposed to the webview, this is a meaningful attack surface. Also `deep-link:default` permission is missing from `capabilities/default.json` even though the `aideo` scheme is registered (deep-link events won't be delivered to the webview).

39. **Plaintext credentials in `localStorage`:** custom Supabase url/key (`authSlice`), Jellyfin api key (`cloudSlice`), ListenBrainz token, Last.fm session key, Tidal client id/secret (check — saved via keyring but Tidal custom client id/secret stored in localStorage per `TidalView.tsx:115`). `.env` itself is gitignored and was never committed (verified `git log --all -- .env` empty) — that's good — but `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` are inlined into the client bundle (normal for anon key; RLS must be the real protection).

40. **`NowPlayingView.tsx:458`:** artist-name click runs `openUrl(playback.current_track)` unconditionally — for local files it passes a filesystem path to the OS opener. **`LibraryView.tsx:1231-1259`:** `useVirtualList` run 3× on one scroll container — after sector switch `scrollTop` can exceed the new list height (transient blank).

---

## Nits

- `wasapi_engine.rs:356/387` — `mask = !0` for `valid_bits == 32` is a no-op.
- `sonic_analyzer.rs:21 vs 91` — S16 scaling inconsistent (×32767.0 vs ÷32768.0); F32/S16 truncate instead of round.
- `discord.rs:168-177` — `clear_presence` clears `LAST_DETAILS`/`LAST_STATE` but not `LAST_IS_PLAYING`.
- `scanner.rs:435-438` — `tb.calc_time(ts)` computed twice per track.
- `db.rs:534-537` + `201` — see Critical #8 (resurrection).
- `App.tsx:468-474` — AideoView and LibraryView are always mounted (display-toggled); heavy views stay alive contradicting README "0% idle" claim.
- `FullscreenView.tsx:229` — effect deps include `playback.position_secs` (~200 ms re-subscription) and omit handlers; stale closures can re-fetch romaji/translations after in-place lyric updates.
- `AudioControlCenter.tsx:340` — crossfade preset sets `{crossfade_transition_enabled, crossfade_transition_duration}` without `enabled:`, so enabling crossfade there never activates the DSP engine; the identical control in `AideoLabView.tsx:1922` sets `enabled`. Behavior differs per UI.
- `SettingsView.tsx:227-237` — `resetShortcuts` resets only 5 of 7 actions; `dspBypass` is missing from the remapper UI entirely (640-646) even though `App.tsx` honors `userShortcuts.dspBypass`.

---

## Verified non-issues (checked, no bug — don't re-investigate)

- Parabolic BPM interpolation is correct (`sonic_analyzer.rs:287-290`; the 0.5 is folded into the denominator).
- yt-dlp/ffmpeg invocations use `.args()` (no shell) → no command injection.
- WASAPI callback zero-fills underruns; event-mode `num_frames = buffer_size` matches the one-period exclusive buffer.
- DSF fmt-chunk offsets and DFF duration math are correct per spec.
- `sign_request` (`lastfm.rs:18-29`) is spec-compliant (BTreeMap deterministic signing, `format`/`callback` excluded).
- `artwork.rs` itself never fetches URLs — the SSRF is exclusively in `get_cover_art` (lib.rs:859).
- Karaoke word-progress division-by-zero is guarded by an `isFinished` branch.
- Sleep-timer display countdown and chip-highlight logic are correct.
- `toggleLoveTrack` signature is consistent across PlayerBar/MiniPlayer.
- `update_media_metadata` duration `from_secs_f64` is safe (values are non-negative).
- `dependencies.rs` download host is allowlisted to GitHub domains (mitigation, but still no checksums — see Critical #6).
- `.env` secrets were never committed to git.

---

## Recommended fix priority

1. Clamp volume at the backend boundary (`set_volume`, remote WebSocket) — Critical #1.
2. Stop deleting tracks/playlist membership during scans; keep `clean_missing_tracks` as the explicit destructive path — Critical #2.
3. Host-allowlist + size-limit `get_cover_art` / `apply_online_cover` — Critical #3.
4. Restrict Chromecast file server to a whitelist of exact library paths, add auth + connection caps — Critical #4.
5. Stop persisting signed Subsonic/Jellyfin URLs; prefer header/short-lived auth — Critical #5.
6. Add checksums + remove `-U` self-update and `--no-check-certificate` — Critical #6.
7. Merge the two `.setup()` calls so the tray menu works — Critical #7.
8. Fix `delete_track` to remove playlist orphans — Critical #8.
9. Add a CSP and the `deep-link:default` permission.
10. Wire up or remove Tidal; fix `resetScrobbling`, shortcut remapper, and fullscreen keydown duplication.
11. Make `scan_and_save` refresh stale metadata and make `save_tracks` non-destructive (COALESCE).
