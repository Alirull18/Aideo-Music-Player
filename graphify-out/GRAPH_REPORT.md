# Graph Report - Aideo-Music-Player  (2026-09-03)

## Corpus Check
- 204 files · ~501,745 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2092 nodes · 5105 edges · 100 communities (78 shown, 13 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 61 edges (avg confidence: 0.83)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `be94f376`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- youtube/mod.rs
- AideoView.tsx
- tidal.rs
- useStore
- lyrics.rs
- qobuz.rs
- Vec
- String
- wasapi_engine.rs
- AppState
- db.rs
- dsp_tests.rs
- lib.rs
- utils.ts
- baseName
- AppLogger
- App.tsx
- tauri.conf.json
- AlbumsView.tsx
- logger.ts
- play_file
- scanner.rs
- AideoLabView.tsx
- LibraryView.tsx
- BiquadFilter
- permissions
- SimpleLRU
- updater.rs
- upnp.rs
- remote_server.rs
- chromecast.rs
- cloud.rs
- player/mod.rs
- link_resolver.rs
- compilerOptions
- dependencies
- Vec
- String
- sonic_analyzer.rs
- devDependencies
- insert_cached_youtube_url
- taskbar.rs
- lastfm.rs
- Option
- lastfm_api.rs
- debouncer_loop
- Toast.tsx
- tag_editor.rs
- cache.rs
- apply_shortcuts
- package.json
- 💎 Aideo Music Player v0.9.6
- romanizer.ts
- update_presence_internal
- compilerOptions
- musicbrainz.rs
- .new
- GrowingFileReader
- extract_art
- aideoConnect.test.ts
- crossfade.test.ts
- libraryFilter.test.ts
- select_output_config
- fullscreenShortcuts.test.ts
- miniPlayerLyric.test.ts
- telemetry.rs
- dspComparison.test.ts
- smartSearch.test.ts
- daisyui
- jsdom
- tailwindcss
- @tauri-apps/cli
- vite
- @vitejs/plugin-react
- aideo
- types.ts
- Software Requirements Specification (SRS): Aideo Music Player
- Product Requirement Document (PRD): Aideo Music Player
- Aideo Music Player — Modular & Plugin Architecture Roadmap
- 🌟 Highlights & Key Additions
- Aideo Music Player — AGENTS.md
- ListeningInsightsView.tsx
- lyricsFallback.test.ts
- Product
- test_convolution_matches_direct_form_reference_at_partition_latency
- Design
- Emergency Song Playback Crash — Investigation & Resolution Handoff
- MCP Tools: code-review-graph
- m3u.rs
- downmix_to_stereo
- trim_encoder_delay_and_padding

## God Nodes (most connected - your core abstractions)
1. `useStore` - 110 edges
2. `AppState` - 89 edges
3. `safe_lock()` - 75 edges
4. `play_file()` - 46 edges
5. `parse_ttml()` - 28 edges
6. `permissions` - 27 edges
7. `prepare_decoder()` - 26 edges
8. `player_loop()` - 25 edges
9. `Track` - 24 edges
10. `DSPState` - 23 edges

## Surprising Connections (you probably didn't know these)
- `test_history_index_and_scrobble_bounding()` --calls--> `init_db()`  [INFERRED]
  src-tauri/src/db_tests.rs → src-tauri/src/db.rs
- `test_init_db_in_memory()` --calls--> `init_db()`  [INFERRED]
  src-tauri/src/db_tests.rs → src-tauri/src/db.rs
- `test_transactional_operations_commit_and_rollback()` --calls--> `init_db()`  [INFERRED]
  src-tauri/src/db_tests.rs → src-tauri/src/db.rs
- `background_decode()` --calls--> `safe_lock()`  [INFERRED]
  src-tauri/src/player/mod.rs → src-tauri/src/lib.rs
- `kill_current_process()` --calls--> `safe_lock()`  [INFERRED]
  src-tauri/src/player/mod.rs → src-tauri/src/lib.rs

## Import Cycles
- 3-file cycle: `src/store.ts -> src/store/authSlice.ts -> src/utils/syncEngine.ts -> src/store.ts`

## Communities (100 total, 13 thin omitted)

### Community 0 - "youtube/mod.rs"
Cohesion: 0.08
Nodes (81): add_downloaded_track_to_library(), artist_matches(), autoplay_profile(), AutoplayTasteProfile, blend_shelf_naturally(), capitalize_first(), check_and_download_ytdlp(), clean_title() (+73 more)

### Community 1 - "AideoView.tsx"
Cohesion: 0.06
Nodes (64): AideoView, CommandDeckHome(), FeedTab, qualitySpec(), ArtCard, EditorialHome(), ShelfRow, AideoHomeProps (+56 more)

### Community 2 - "tidal.rs"
Cohesion: 0.08
Nodes (64): Entry, build_radio_queue(), clean_title(), compute_poll_params(), DecodedManifest, dedupe_hub_candidates(), ensure_valid_token(), fuzzy_title_similarity() (+56 more)

### Community 3 - "useStore"
Cohesion: 0.05
Nodes (28): SettingsView, CacheSizeInfo, DownloadedView(), LastfmView(), LiquidBackground(), OnboardingWizard(), QobuzConnectCard(), AccountAuthPanel() (+20 more)

### Community 4 - "lyrics.rs"
Cohesion: 0.07
Nodes (68): BytesStart, clean_stale_lyrics_cache(), clean_url_for_lyrics(), decode_entity(), decode_krc(), detect_and_parse_lyrics(), extract_embedded_lyrics(), extract_timing_attrs() (+60 more)

### Community 5 - "qobuz.rs"
Cohesion: 0.11
Nodes (43): Response, api_get(), classify_stream_error(), decode_secrets(), ensure_app_credentials(), ensure_session_token(), fetch_app_credentials(), get_client() (+35 more)

### Community 6 - "Vec"
Cohesion: 0.07
Nodes (18): BiquadFilter, AideoFilterNode, analyzer_loop(), AudioNode, CompressorNode, CrossfeedNode, DSPState, EQBand (+10 more)

### Community 7 - "String"
Cohesion: 0.09
Nodes (52): AudioTagData, FrontendCrashReport, acoustid_identify_track(), center_window(), clean_translated_text(), clear_application_cache(), clear_log_files(), CoverSearchResult (+44 more)

### Community 8 - "wasapi_engine.rs"
Cohesion: 0.08
Nodes (39): E, JoinHandle, check_update_ytdlp(), DependencyStatus, download_with_progress_and_sha256(), fetch_ytdlp_expected_sha256(), get_aideo_dir(), get_dependencies_status() (+31 more)

### Community 9 - "AppState"
Cohesion: 0.10
Nodes (50): MediaControls, MutexGuard, add_to_playlist(), add_to_queue(), add_track_to_library(), apply_local_cover(), apply_online_cover(), AppState (+42 more)

### Community 10 - "db.rs"
Cohesion: 0.14
Nodes (41): add_to_playlist(), column_exists(), create_playlist(), create_smart_playlist(), delete_playlist(), delete_smart_playlist(), delete_track(), execute_smart_rules() (+33 more)

### Community 12 - "lib.rs"
Cohesion: 0.07
Nodes (32): AudioTagBatchUpdate, AudioTagUpdate, NetworkTelemetry, batch_update_tags(), DayActivity, export_debug_report(), get_debug_system_info(), get_desktop_lyrics_status() (+24 more)

### Community 13 - "utils.ts"
Cohesion: 0.16
Nodes (27): createLibrarySlice(), fetchTrackMetadataAndLyrics(), createMetadataSlice(), chainQueueOperation(), createPlaybackSlice(), performDspInvoke(), queueOperationPromise, notifyQobuzAuthFailure() (+19 more)

### Community 14 - "baseName"
Cohesion: 0.14
Nodes (15): CastSelector(), CoverArtModal(), SearchResult, FullscreenView(), LocalQRCode(), MiniPlayer(), NowPlayingView(), PlayerBar() (+7 more)

### Community 15 - "AppLogger"
Cohesion: 0.13
Nodes (24): AppLogger, FrontendCrashReport, get_logger(), init_logger(), install_panic_hook(), log_msg(), LogEntry, LogLevel (+16 more)

### Community 16 - "App.tsx"
Cohesion: 0.10
Nodes (19): AideoApp(), AideoLabView, DownloadedView, FullscreenView, LastfmView, ListenbrainzView, AideoPrompt(), BrowserCallbackLanding() (+11 more)

### Community 17 - "tauri.conf.json"
Cohesion: 0.06
Nodes (33): aideo, default, icons/128x128@2x.png, icons/128x128.png, icons/32x32.png, icons/icon.icns, icons/icon.ico, app (+25 more)

### Community 18 - "AlbumsView.tsx"
Cohesion: 0.12
Nodes (23): AlbumsView, AlbumCard, AlbumCardProps, AlbumGroup, AlbumsView(), AlbumsViewProps, coverArtCache, getSavedLovedAlbums() (+15 more)

### Community 20 - "logger.ts"
Cohesion: 0.09
Nodes (17): App(), DebugLogsModal(), DebugLogsModalProps, ErrorBoundary, ErrorBoundaryProps, ErrorBoundaryState, addBreadcrumb(), Breadcrumb (+9 more)

### Community 21 - "play_file"
Cohesion: 0.15
Nodes (29): AtomicU32, AtomicU64, Child, abort_background_downloads(), background_decode(), CachedTrack, DownloadGuard, find_ffmpeg_path() (+21 more)

### Community 22 - "scanner.rs"
Cohesion: 0.15
Nodes (26): adjust_opus_r128_gain(), dff_header(), extract_disc_and_track_from_path(), extract_metadata(), parse_dff_metadata(), parse_dff_props(), parse_dsf_metadata(), parse_number_str() (+18 more)

### Community 23 - "AideoLabView.tsx"
Cohesion: 0.20
Nodes (23): AideoLabView(), BRAND_FILTERS, EQ_QUICK_PRESETS, EqViewMode, getSourceStyle(), MainLabTab, AudioControlCenter(), EQ_PRESETS (+15 more)

### Community 24 - "LibraryView.tsx"
Cohesion: 0.11
Nodes (25): baseName(), CloudCacheButtonProps, CloudTrack, CloudTrackRow, cloudTrackToVirtualTrack(), coverArtCache, isLosslessTrack(), isStreamTrack() (+17 more)

### Community 25 - "BiquadFilter"
Cohesion: 0.11
Nodes (9): Complex, Fft, BiquadFilter, CircularDelayLine, ConvolutionFilter, Arc, Self, Vec (+1 more)

### Community 26 - "permissions"
Cohesion: 0.06
Nodes (32): *, core:default, core:event:default, core:webview:allow-create-webview-window, core:window:allow-center, core:window:allow-close, core:window:allow-hide, core:window:allow-maximize (+24 more)

### Community 27 - "SimpleLRU"
Cohesion: 0.14
Nodes (15): ChartsView, TrackCover, TrackCardThumbnail, AlbumThumbnail(), AlbumThumbnail(), ChartsView(), parseDuration(), TrackThumbnail() (+7 more)

### Community 28 - "updater.rs"
Cohesion: 0.13
Nodes (20): check_update(), download_and_install(), extract_sha256_token(), GithubAsset, GithubRelease, is_newer(), is_trusted_github_url(), AppHandle (+12 more)

### Community 29 - "upnp.rs"
Cohesion: 0.19
Nodes (26): build_didl_metadata(), build_protocol_info(), connect_upnp_device(), disconnect_upnp_device(), discover_upnp_devices(), escape_xml(), extract_service_control_url(), extract_tag_value() (+18 more)

### Community 30 - "remote_server.rs"
Cohesion: 0.15
Nodes (19): Cow, SocketAddr, constant_time_eq(), extract_auth_header_from_raw_http(), extract_pin_from_auth_header(), extract_pin_from_query(), get_or_init_pin(), get_remote_html() (+11 more)

### Community 31 - "chromecast.rs"
Cohesion: 0.11
Nodes (33): build_safe_path_set(), chromecast_connect(), chromecast_control(), chromecast_disconnect(), chromecast_discover(), chromecast_get_status(), chromecast_play(), DiscoveredDevice (+25 more)

### Community 32 - "cloud.rs"
Cohesion: 0.23
Nodes (25): cache_cloud_track(), check_url_is_cached(), CloudTrack, delete_keyring_secret(), get_all_cached_cloud_hashes(), get_keyring_secret(), get_subsonic_password(), get_url_hash() (+17 more)

### Community 33 - "player/mod.rs"
Cohesion: 0.09
Nodes (14): ActiveStream, AllPassFilter, decoded_frames(), DecoderInfo, extract_f32_channel_data(), get_network_telemetry(), NetworkTelemetry, PlaybackStatus (+6 more)

### Community 34 - "link_resolver.rs"
Cohesion: 0.20
Nodes (19): apple_album_id_only(), apple_album_with_track_hint(), apple_song_with_country(), deezer_track_variants(), EntityKind, parse(), parse_external_link(), ParsedLink (+11 more)

### Community 35 - "compilerOptions"
Cohesion: 0.09
Nodes (22): DOM, DOM.Iterable, ES2020, src, compilerOptions, allowImportingTsExtensions, isolatedModules, jsx (+14 more)

### Community 37 - "dependencies"
Cohesion: 0.10
Nodes (21): framer-motion, lucide-react, dependencies, framer-motion, lucide-react, react, react-dom, @supabase/supabase-js (+13 more)

### Community 38 - "Vec"
Cohesion: 0.11
Nodes (21): LyricLine, Playlist, add_to_queue_bulk(), check_files_exist(), execute_smart_playlist(), get_audio_devices(), get_library(), get_lyrics() (+13 more)

### Community 39 - "String"
Cohesion: 0.15
Nodes (26): ChildStdin, Instant, Producer, ActiveStreamSession, can_reuse_stream_session(), detect_audio_extension(), detect_format_from_path(), find_best_matching_device_name() (+18 more)

### Community 40 - "sonic_analyzer.rs"
Cohesion: 0.19
Nodes (14): analyze_audio_file(), audio_buffer_to_interleaved_s16(), audio_buffer_to_mono_f32(), BiquadFilter, calculate_ebu_r128_lufs(), calculate_sonic_profile(), calculate_waveform_peaks(), AudioBufferRef (+6 more)

### Community 41 - "devDependencies"
Cohesion: 0.11
Nodes (19): autoprefixer, devDependencies, autoprefixer, postcss, @testing-library/jest-dom, @testing-library/react, @types/node, @types/react (+11 more)

### Community 42 - "insert_cached_youtube_url"
Cohesion: 0.31
Nodes (10): clear_youtube_url_cache(), insert_cached_youtube_url(), invalidate_youtube_url_if(), test_clear_youtube_url_cache_empties_all_entries(), test_invalidate_keeps_freshly_reresolved_url(), test_invalidate_removes_matching_dead_url(), test_invalidate_unknown_key_is_noop(), test_youtube_url_cache_expires_after_ttl() (+2 more)

### Community 43 - "taskbar.rs"
Cohesion: 0.20
Nodes (17): c_void, HICON, HWND, LPARAM, LRESULT, create_button(), get_app_handle_from_prop(), get_original_wndproc_from_prop() (+9 more)

### Community 44 - "lastfm.rs"
Cohesion: 0.42
Nodes (15): BTreeMap, encode_params(), get_api_key(), get_api_secret(), get_auth_token(), get_recent_tracks(), get_session(), get_top_artists() (+7 more)

### Community 45 - "Option"
Cohesion: 0.14
Nodes (16): LogEntry, add_track(), get_local_ip(), get_recent_logs(), get_remote_connection_url(), log_message(), log_playback_start(), play_track() (+8 more)

### Community 46 - "lastfm_api.rs"
Cohesion: 0.52
Nodes (15): get_api_key(), get_artist_info(), get_artist_top_tags(), get_artist_top_tracks(), get_genre_top_tracks_page(), get_geo_top_tracks_page(), get_global_top_tracks(), get_global_top_tracks_page() (+7 more)

### Community 47 - "debouncer_loop"
Cohesion: 0.28
Nodes (13): Event, RecommendedWatcher, debouncer_loop(), rescan_and_notify(), AppHandle, Receiver, Result, Sender (+5 more)

### Community 48 - "Toast.tsx"
Cohesion: 0.24
Nodes (11): formatToastMessage(), recentToastsMap, ToastCardProps, ToastContainer(), ToastMessage, showToast(), toast, ToastAction (+3 more)

### Community 49 - "tag_editor.rs"
Cohesion: 0.31
Nodes (10): AudioTagBatchUpdate, AudioTagData, AudioTagUpdate, batch_write_tags(), parse_num_from_slash_str(), read_tags(), Option, Result (+2 more)

### Community 50 - "cache.rs"
Cohesion: 0.27
Nodes (12): CachedTrack, DecoderInfo, Arc, AtomicBool, Box, Decoder, FormatReader, Mutex (+4 more)

### Community 51 - "apply_shortcuts"
Cohesion: 0.23
Nodes (7): apply_shortcuts(), HotkeyAction, AppHandle, Option, Result, Self, String

### Community 52 - "package.json"
Cohesion: 0.18
Nodes (10): name, private, scripts, build, dev, preview, tauri, test (+2 more)

### Community 53 - "💎 Aideo Music Player v0.9.6"
Cohesion: 0.05
Nodes (39): ⚡ 0% Idle CPU & Battery Optimization, 🎨 Adaptive Album Artwork & Bulk Library Actions, 💎 Aideo Music Player v0.9.5 — The Discovery & Performance Overhaul, 🎵 Complete Artist Discography & Live Search Filter, 📥 Download & Installation, 🌟 Highlights & Key Features, 📌 Pinned Mini Player & Multi-Monitor Fullscreen, 🔄 Resilient Streaming & Session Memory (+31 more)

### Community 54 - "romanizer.ts"
Cohesion: 0.35
Nodes (9): CHOSEONG, hasJapaneseChars(), hasKoreanChars(), JONGSEONG, JUNGSEONG, KANA_MAP, romanizeKana(), romanizeKorean() (+1 more)

### Community 55 - "update_presence_internal"
Cohesion: 0.33
Nodes (7): Error, Box, Result, set_enabled(), trigger_reconnection(), update_presence(), update_presence_internal()

### Community 56 - "compilerOptions"
Cohesion: 0.22
Nodes (8): vite.config.ts, compilerOptions, allowSyntheticDefaultImports, composite, module, moduleResolution, skipLibCheck, include

### Community 57 - "musicbrainz.rs"
Cohesion: 0.46
Nodes (7): clean_recording_title_and_artist(), get_cover_art_url(), Result, String, Value, search_recording(), test_clean_recording_title_and_artist()

### Community 58 - ".new"
Cohesion: 0.22
Nodes (5): ConvolutionNode, enforce_cache_size_limit(), LimiterNode, LookaheadLimiter, Self

### Community 59 - "GrowingFileReader"
Cohesion: 0.20
Nodes (7): File, MediaSource, Read, Seek, SeekFrom, GrowingFileReader, Result

### Community 60 - "extract_art"
Cohesion: 0.53
Nodes (4): extract_art(), get_cover_art(), Option, String

### Community 62 - "crossfade.test.ts"
Cohesion: 0.50
Nodes (3): applyCrossfadePreset(), clampCrossfadeDuration(), CrossfadeConfig

### Community 63 - "libraryFilter.test.ts"
Cohesion: 0.60
Nodes (4): filterLibraryTracks(), isLosslessTrack(), isStreamTrack(), QuickFilterType

### Community 64 - "select_output_config"
Cohesion: 0.50
Nodes (4): Device, SampleFormat, select_output_config(), StreamConfig

### Community 65 - "fullscreenShortcuts.test.ts"
Cohesion: 0.67
Nodes (3): cycleVisualizerMode(), handleFullscreenShortcut(), VisualizerMode

### Community 85 - "types.ts"
Cohesion: 0.07
Nodes (38): DesktopLyricBar(), KaraokeActiveLine, KaraokeActiveLineProps, LyricsPanel(), SearchResult, SearchCoverResult, TagEditorModal(), AideoPageDesign (+30 more)

### Community 86 - "Software Requirements Specification (SRS): Aideo Music Player"
Cohesion: 0.10
Nodes (20): 1.1. Purpose, 1.2. Scope, 1. Introduction, 2.1. User Interface (UI) Requirements, 2.2. Hardware & Driver Interfaces, 2.3. Software Interfaces, 2.4. Communication Interfaces (Tauri IPC Bridge), 2. Technical Architecture & System Interfaces (+12 more)

### Community 87 - "Product Requirement Document (PRD): Aideo Music Player"
Cohesion: 0.10
Nodes (19): 1. Document Control, 2. Product Vision & Goals, 3. User Personas, 4.1. The Audiophile DSP Engine, 4.2. Universal Metadata & Local Library Manager, 4.3. Dual-Engine Synced Lyric Suite, 4.4. Streaming, Cloud & Discovery Integrations, 4.5. OS Platform & Companion Features (+11 more)

### Community 88 - "Aideo Music Player — Modular & Plugin Architecture Roadmap"
Cohesion: 0.11
Nodes (18): 1. Vision & Architecture Overview, 2. Core Extensibility Pillars, 3. Plugin Specification (`plugin.json`), 4. Security & IPC Sandbox Model, 5. Phased Implementation Roadmap, 6. Windows Platform & Audio Gold Standards, Aideo Music Player — Modular & Plugin Architecture Roadmap, Current Implementation Status (+10 more)

### Community 90 - "🌟 Highlights & Key Additions"
Cohesion: 0.17
Nodes (11): 💎 Aideo Music Player v0.9.7 — Feature Expansion, Streaming Services & Stability, 📋 Detailed Commit History (v0.9.6 → v0.9.7), 🛠️ Diagnostics & Diagnostic Telemetry, 🛡️ External Audit Remediation & Pipeline Hardening, 🌟 Highlights & Key Additions, ⚠️ Known Issues & Immediate Remediation Backlog, 💾 Offline Storage & Download Manager, 🎵 Qobuz & Tidal Lossless Streaming (+3 more)

### Community 91 - "Aideo Music Player — AGENTS.md"
Cohesion: 0.18
Nodes (10): Aideo Music Player — AGENTS.md, Architecture, Developer commands, Engineering rules, MCP tools: code-review-graph, Rust backend build, Secrets & env, Tauri / runtime quirks (+2 more)

### Community 92 - "ListeningInsightsView.tsx"
Cohesion: 0.20
Nodes (10): ListeningInsightsView, DAY_LABELS, DayActivity, formatDuration(), HourActivity, ListeningInsightsPayload, ListeningInsightsView(), TopArtist (+2 more)

### Community 93 - "lyricsFallback.test.ts"
Cohesion: 0.28
Nodes (7): LyricLine, LyricWord, parseLineWords(), parseLrc(), parseTimestamp(), scoreLyricResult(), SearchResult

### Community 94 - "Product"
Cohesion: 0.22
Nodes (8): Accessibility & Inclusion, Anti-references, Brand Personality, Design Principles, Product, Product Purpose, Register, Users

### Community 95 - "test_convolution_matches_direct_form_reference_at_partition_latency"
Cohesion: 0.43
Nodes (7): direct_convolve(), peak_normalize(), Vec, test_convolution_matches_direct_form_reference_at_partition_latency(), test_convolution_wet_dry_mix_paths_stay_aligned(), test_lookahead_limiter_bounded_and_finite_on_dynamic_material(), XorShift

### Community 96 - "Design"
Cohesion: 0.29
Nodes (6): Components, Design, Layout, Palette, Theme, Typography

### Community 97 - "Emergency Song Playback Crash — Investigation & Resolution Handoff"
Cohesion: 0.29
Nodes (6): 1. Root Cause Analysis, 2. Changes Applied, 3. Verification Gates, Backend (`src-tauri/`), Emergency Song Playback Crash — Investigation & Resolution Handoff, Summary

### Community 98 - "MCP Tools: code-review-graph"
Cohesion: 0.40
Nodes (4): Key Tools, MCP Tools: code-review-graph, When to use graph tools FIRST, Workflow

### Community 99 - "m3u.rs"
Cohesion: 0.40
Nodes (10): export_playlist_m3u(), export_writes_extended_m3u(), import_playlist_m3u(), import_resolves_by_filename_and_stem(), import_with_no_matches_creates_no_orphan_playlist(), ImportResult, Connection, Result (+2 more)

### Community 100 - "downmix_to_stereo"
Cohesion: 0.50
Nodes (4): test_downmix_to_stereo_3_0_center_balanced(), test_downmix_to_stereo_5_1_includes_lfe(), test_downmix_to_stereo_7_1_folds_rear_surrounds(), downmix_to_stereo()

### Community 101 - "trim_encoder_delay_and_padding"
Cohesion: 0.67
Nodes (3): test_ingestion_delay_skipping_prevents_cache_index_shift(), test_trim_encoder_delay_and_padding(), trim_encoder_delay_and_padding()

## Knowledge Gaps
- **320 isolated node(s):** `name`, `private`, `version`, `type`, `dev` (+315 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 614 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **13 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `AppState` connect `AppState` to `youtube/mod.rs`, `tidal.rs`, `qobuz.rs`, `Vec`, `String`, `lib.rs`, `Option`, `play_file`, `remote_server.rs`, `chromecast.rs`?**
  _High betweenness centrality (0.182) - this node is a cross-community bridge._
- **Why does `Player` connect `play_file` to `player/mod.rs`, `Vec`, `String`, `AppState`, `insert_cached_youtube_url`, `dsp_tests.rs`, `.new`?**
  _High betweenness centrality (0.112) - this node is a cross-community bridge._
- **Why does `WasapiStream` connect `wasapi_engine.rs` to `player/mod.rs`?**
  _High betweenness centrality (0.064) - this node is a cross-community bridge._
- **Are the 7 inferred relationships involving `safe_lock()` (e.g. with `background_decode()` and `kill_current_process()`) actually correct?**
  _`safe_lock()` has 7 INFERRED edges - model-reasoned connections that need verification._
- **What connects `name`, `private`, `version` to the rest of the system?**
  _320 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `youtube/mod.rs` be split into smaller, more focused modules?**
  _Cohesion score 0.07690387016229713 - nodes in this community are weakly interconnected._
- **Should `AideoView.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.06127206127206127 - nodes in this community are weakly interconnected._