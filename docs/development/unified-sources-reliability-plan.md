# Reliable unified music sources for Aideo

Date: 2026-09-16. Status: proposed implementation plan; no product changes made by this document.

Scope: Local, YouTube Music, connected Tidal, and enabled/connected Qobuz. Preserve Aideo's React/Zustand + Tauri/Rust architecture, existing playback controls, saved music, and audio output settings.

## 1. Recommendation and listener contract

Build on the existing source system. The main work is consistent identity, shared source discovery, conservative matching, and reliable playback lifecycle handling. A replacement player, a custom URI scheme, and an addon platform are unnecessary for this work.

The intended experience is:

- Search or home shows a song once, with its known source choices and duration. Provider names do not create separate song rows or artwork outlines.
- Equivalent releases can share a row. Live performances, remixes, covers, radio edits, clean/explicit editions, and identifiable remasters remain distinct versions. Provider duplicates and different performances are different problems.
- Clicking Play starts the selected recording. Auto can choose among confidently equivalent copies; a source being visible under a song does not automatically make it eligible for substitution.
- Playback continues on the chosen source until the song ends, the source fails, or the listener changes it. Background discovery normally improves the next play or the next queued song.
- Stop, Pause, Next, Previous, seek, repeat, shuffle, queue order, and playlist order behave predictably. Late network results cannot restart stopped music or replace a newer selection.
- An explicit source choice stays explicit. If it fails, preserve Aideo's documented temporary fallback behavior only among verified equivalent copies, show the fallback, and retain the saved choice. No fallback to a different version.
- Source choice, quality preference, and audio output mode remain separate. Selecting FLAC must never silently toggle DSP, resampling, exclusive mode, or bit-perfect mode.
- Available results remain usable when another provider is slow. Show "Checking sources" or a provider error instead of pretending a partial result is complete.

These are Aideo's proposed product contracts, not claims that every commercial player implements one universal standard.

## 2. What the BitChord research establishes

Reviewed public source at commit `7072e7b969f3190ebe1533d8ad6179495e35a30d`, rather than relying on the supplied summary. Source inspection establishes implementation intent; it does not establish live startup times or seamless audio on Aideo's Windows devices.

| Research claim | Verified qualification | Aideo decision |
| --- | --- | --- |
| Queue identities resolve lazily through `bitchord://` | `PlaybackService` uses `ResolvingDataSource`; the custom URI carries lookup metadata. | Adopt the separation of identity and temporary URL. Aideo already carries typed source IDs and metadata through IPC; retain that representation. |
| Strict title/version matching and a three-second duration rule | `TrackMatcher` splits title components, but its general duration ceiling is 30 seconds, with up to 90 seconds for some same-artist candidates. `SourceResolver.preferred` prefers copies within three seconds, then falls back to the wider set. | Do not copy the wider automatic substitution behavior. Three seconds is corroborating evidence, not a fingerprint. |
| Artist agreement is required | Current matcher has a different-credit exception within two seconds and allows missing credits in some scoring paths. | Missing or conflicting artists must not become verified equivalents solely because durations match. |
| Version distinctions are strict | The matcher treats `radioedit`, `monoversion`, and `stereoversion` as neutral segments; it strips non-ASCII characters during parts of normalization. | Preserve meaningful edits/mixes and Unicode names. Aideo serves multilingual music. |
| An upgrade is seamless after probing a URL | `PlaybackService.swapIn` explicitly discusses interruption. `auditionUpgrade` uses a second silent player to decode, seek, and buffer before replacement, with guards and recovery. A HEAD request is not equivalent. | No automatic mid-song upgrade in the initial reliability release. A native preparation/handoff experiment is a later, separate gate. |
| A two-second match makes a live swap safe | BitChord uses a two-second gate for upgrades. Equal total length does not prove equal sample alignment or the same master. | Never promise an exact or inaudible handoff from duration metadata alone. |
| A 96 kbps gain proves an improvement | The code uses this heuristic and acknowledges cross-codec comparisons are imperfect. | Do not rank Opus/AAC/MP3 by raw bitrate as a universal quality scale. |
| A `q=hifi` marker prevents cache collisions | Upgrade generations receive separate cache markers; comments also describe stream-choice persistence and cache ownership. | Use explicit rendition identity and atomic cache lifecycle. Appending a query parameter alone is insufficient for Aideo's cache pipeline. |
| Playback will start within 500 ms | This is not a portable guarantee across network, authentication, extraction, decoder startup, and WASAPI devices. | Measure click-to-first-audible-sample. Use fixture deadlines and measured targets rather than promising a universal time. |

Useful patterns to reuse conceptually: lazy resolution, bounded fallback, independent source results, per-source metadata, cancellation, and preparation before disruptive transitions.

Do not add JioSaavn, HTTP addons, QuickJS, mandatory YouTube enablement, a provider ranking editor, or Android Media3 concepts to the core delivery. They do not solve the reported inconsistency. Aideo local-only mode must remain local-only.

Pinned references:

- [TrackMatcher.kt](https://github.com/kushagrasinghx/BitChord/blob/7072e7b969f3190ebe1533d8ad6179495e35a30d/app/src/main/java/com/music/bitchord/data/sources/TrackMatcher.kt): `score`, `durationScore`, `preferred` callers, constants and title classification.
- [SourceResolver.kt](https://github.com/kushagrasinghx/BitChord/blob/7072e7b969f3190ebe1533d8ad6179495e35a30d/app/src/main/java/com/music/bitchord/data/sources/SourceResolver.kt): `resolve`, `bestAcross`, `preferred`, `worthSwapping`, `sameRecordingAs`.
- [QualityUpgrade.kt](https://github.com/kushagrasinghx/BitChord/blob/7072e7b969f3190ebe1533d8ad6179495e35a30d/app/src/main/java/com/music/bitchord/playback/QualityUpgrade.kt): session lifecycle, refused upgrades, generation markers.
- [PlaybackService.kt](https://github.com/kushagrasinghx/BitChord/blob/7072e7b969f3190ebe1533d8ad6179495e35a30d/app/src/main/java/com/music/bitchord/playback/PlaybackService.kt): resolving data source, `swapIn`, `swapPointFor`, `auditionUpgrade`, `auditionVerdict`.

## 3. Aideo baseline and confirmed code gaps

Inspection baseline: HEAD `36ad14bfa28867f04d20bd5eccdefcbce6ed9019` plus the existing working-tree changes, including the recent search/home revisions. `SettingsView.tsx` contains unrelated user edits that implementation must preserve.

The repository knowledge graph was stale and did not cover `unifiedSources.ts`; current source and `git diff` were used instead. Existing `docs/development/unified-sources.md` contains historical descriptions that disagree with today's code. Do not treat its verification labels as proof of current runtime behavior.

Already present and worth retaining:

- `PlaybackSource`, `RecordingSources`, and `SourceSelection`, stable provider IDs, source-specific metadata, and separate active-source information.
- Local/Tidal/Qobuz/YouTube search and quality-aware stream resolution.
- Playlist entry IDs, additive SQLite source contexts, legacy path-only entries, queue/session restoration, and persisted preferences.
- Frontend request sequencing, bounded retries, source-aware queue mode, and existing native decoding/output infrastructure.
- Tests for source fallback, cancellation, persistence, home grouping, and explicit source selection.

| Observed code | Consequence to address |
| --- | --- |
| `src/utils/unifiedSources.ts:99`: `groupRecordings` uses `isSameSong`, which compares normalized title/artist/version but not duration or conflicting ISRCs. | Display grouping currently also builds the automatic playback source list. Different recordings can enter that list. |
| `src/utils/unifiedSources.ts:75`: `matchingSources` accepts an exact grouped row and flattens all its sources. | A stricter comparison of row representatives does not validate every source contained in that row. |
| `src/test/unifiedSources.test.ts:82` and `src/test/songFirstSearch.test.ts:70` intentionally accept a single group containing conflicting recording IDs or unequal durations. | Passing tests prove the current grouping contract, not safe interchangeability. Replace that contract with separate display and playback assertions. |
| `src/utils/unifiedSources.ts:46` and `:123`: identity can derive from release metadata or the first sorted source. | A later provider response can change the row's identity, selected metadata, and component key. Durable recording identity needs an explicit lifecycle. |
| `src/components/AideoView.tsx:626`: quick results query YouTube separately; submitted search queries all providers. | Suggestions and full results have different source completeness. |
| `src/components/SourceMenu.tsx:12`, `:21`, `:42`: the picker owns a context snapshot and performs another search; its synchronization dependencies omit source-list changes. | New alternatives need not appear consistently in every surface as provider results arrive. |
| `src/utils/discoveryFeed.ts:12`: home only merges returned shelves/mixes and a matching subset of library tracks. | It cannot attach a provider copy that was never returned. It is not exhaustive cross-catalog discovery. |
| `src-tauri/src/youtube/mod.rs:3138`, `:5048`: selected home feeds remove online tracks matching local signatures before reaching the frontend. | Deduplication discards source evidence that the unified card later needs. |
| `src/components/AideoView.tsx:956`: Tidal home fetch races a 2.5-second timer and maps a late result to an empty pool. | Slow answers can disappear for that home refresh instead of enriching it later. |
| `src/utils/tidalHub.ts:40`: missing Tidal duration becomes 180 seconds; quality/evidence fields are not preserved by this adapter. | A guessed duration can become identity evidence, and home ranking has less metadata than search. |
| `src/store/sourcePlayback.ts:135`, `:151`, `:160`: known sources resolve concurrently, a 750 ms selection window runs, then another path resolves and may upgrade the playing track. | A YouTube watch URL can be considered ready before native extraction/probing. Slow sources can be resolved more than once, and a better late source can interrupt playback. |
| `src/store/sourcePlayback.ts:88`; `src-tauri/src/lib.rs:2405`: `play_track` acknowledges a queued command, not successful decoder start. | UI success/upgrade messages must be tied to native playback readiness, not IPC acceptance. |
| `src/store/sourcePlayback.ts:20`; `src-tauri/src/lib.rs:2399`: source queue mode clears the native queue. | Unified home cards, including local copies, can lose the ordinary local gapless path. Queue ownership must be explicit. |
| `src/App.tsx:392`; `src-tauri/src/player/mod.rs:6813`: natural-end events have no playback attempt identity. | A delayed event cannot be attributed safely across source changes or repeated plays of the same URL. |
| `src/utils/unifiedSources.ts:42`; `src-tauri/src/youtube/mod.rs:1375`: frontend and backend filtering differ; broad terms also reject legitimate instrumental/live music. | Music classification, recording version, and the 20-minute discovery policy are conflated. |
| `src/utils/syncEngine.ts:54`, `:304`: cloud payload/restoration remains path-oriented. | Local source-context persistence does not prove a cloud round-trip preserves it. Explicit compatibility coverage is needed. |

These are code-supported gaps and risk mechanisms. The exact cause of each intermittent incident still requires reproduction with real provider responses; this plan does not pretend that a single incident has already been diagnosed.

## 4. Model: song presentation, recording identity, and playback attempts

Keep these responsibilities distinct:

| Concept | Meaning | Persistence |
| --- | --- | --- |
| Song display group | One UI row for equivalent song listings; may contain an explicitly labelled related video/uncertain copy. | Derived from catalog data; not a playback identifier. |
| Recording | The selected performance/edit/edition with its stable identity. | Reuse existing recording IDs; new IDs are opaque and do not change when metadata improves. |
| Source reference | `{ provider, id }` plus original source metadata and matching evidence. | Durable; never a signed CDN URL. |
| Match assessment | Equivalent, related/uncertain, or rejected, with reason and matcher version. | Cache validated assessments; always revalidate old untrusted contexts. |
| Queue entry | One occurrence of a selected recording, with its Auto/explicit preference. | Unique entry ID even if the same song appears twice. |
| Playback attempt | One request to resolve/prepare/start a source for a queue entry. | Runtime only; owns cancellation and terminal events. |
| Resolved rendition | Expiring URL/headers, actual format, and a byte-cache identity. | Short-lived resolution cache; no secrets in queue or UI storage. |

Extend existing types rather than introduce a generic plugin framework. Add optional, versioned fields only where these contracts require them: explicit state, content kind, duration provenance, artist credits, recording evidence per source, match assessment, and queue/attempt IDs. Keep unknown metadata unknown.

`RecordingSources.sources` must contain only sources eligible for that selected recording. Related or uncertain candidates belong to the display/picker model, not the fallback array. Selecting a different version creates/selects that recording; it does not silently relabel the current recording's safe sources.

Identity rules:

1. `sourceKey(provider, id)` remains the provider identity. Numeric IDs from Tidal and Qobuz must never collide.
2. Preserve existing durable recording and playlist entry IDs. Do not regenerate them from album/UPC/duration as results arrive.
3. Keep a bounded source-to-recording mapping in the shared store; persist confirmed associations with existing saved source contexts initially. A separate SQLite association table is only needed if restart tests demonstrate that saved contexts cannot support unsaved discovery continuity.
4. A new unsaved row gets one session ID that remains stable during progressive enrichment. When saved/queued, retain it as the recording ID. If two already-saved IDs converge, alias them for presentation without rewriting entries or preferences automatically.
5. Catalog evidence identifies candidates; ISRC is useful evidence but not an infallible primary key. UPC identifies a release, not a recording. Different albums can carry the same recording.
6. Library rescans and Windows path spelling changes must use existing path comparison rules; do not lowercase every provider ID or silently conflate case-sensitive paths on other platforms.

## 5. Matching rules

Implement one pure matcher used by search enrichment, home, the picker, queue fallback, and any future upgrade. Each source is compared to the selected recording's anchor and contradictory evidence within its cohort. Do not build identity through transitive title-only links.

### Normalization

- Preserve the original strings for display. Normalize copies with Unicode NFKC, case/spacing normalization, and cautious punctuation handling.
- Separate core title, version qualifiers, and presentation context. Strip a known artist prefix or `- Topic` suffix only in the relevant provider adapter.
- Strip recognized wrappers such as `Official Audio`, `Official Music Video`, and `Lyric Video`; retain whether the item was a video and its measured/catalog duration.
- Treat movie/soundtrack wrappers as context only when the wrapper is recognized. Do not delete arbitrary parentheses or parts of legitimate titles.
- Preserve remix names, live venue/year, acoustic, instrumental, karaoke, radio/extended edits, remaster/year, mono/stereo, sped/slowed, and other identity-changing qualifiers. `Song (Live at A)` must not equal `Song (Live at B)` merely because both contain `live`.
- Use structured artist arrays/provider IDs when available. Parse featured credits conservatively; an uploader/channel is not automatically the recording artist. Unknown artist/composer-only conflicts need corroboration or manual choice.
- Keep clean/explicit as tri-state metadata. A known conflict is a hard rejection; unknown does not erase a known conflict or establish equivalence on its own.

### Decision table

| Evidence | Display | Auto/fallback |
| --- | --- | --- |
| Same provider and source ID | Deduplicate that source | Same source; refresh metadata |
| Compatible core title, credited artist, version and explicit state; real durations within 3 seconds; no conflicting recording evidence | One song/recording with several sources | Eligible, with recorded match reasons |
| Same ISRC with compatible version/title/credits and corroborating duration | One recording, even across albums/UPCs | Eligible; ISRC does not override contradictory metadata |
| Strong title/artist match but unknown duration or ambiguous recording evidence | Same song's labelled possible alternative where appropriate | Ineligible until verified or manually selected as its own recording |
| Same title/artist but conflicting ISRCs or substantially different duration | Retain distinct recording candidates; disclose version/duration | Never automatically interchangeable |
| Music video has intro/outro/dialogue and differs from album audio | A labelled video variant can be nested under the song | User-selected playback from the beginning; no position-preserving automatic swap |
| Live/remix/cover/clean-explicit conflict | Separate labelled version; covers by another artist remain separate songs | Reject substitution |
| Equal duration, unrelated or missing artists | Do not infer identical recording | Reject automatic match |

Three seconds is an initial conservative matching ceiling, not a proof of audio identity. Equal-length covers and remasters exist. No fuzzy-score total may cancel a hard contradiction. Missing metadata must never be filled with a convenient duration or artist.

Queries: first normalized title + primary artist; use title-only as one conditional second query after no acceptable result, then validate credits. Do this for targeted source discovery, not for every row of every artist search. Respect provider result limits and label an empty limited search "not found in this check", not "this provider does not have the song".

## 6. One source-discovery path for every surface

Use the existing Zustand store and source helpers to own shared source knowledge. Components subscribe to that state; a dialog is not the only place where a song gains alternatives.

Flow:

```text
Provider results / library / cached home data
                 |
       validate and preserve metadata
                 |
       shared match + source knowledge
            /            \
 one song display row    selected recording's safe sources
            |                          |
 Search / Home / Picker          Queue -> resolver -> Rust
```

Required behavior:

1. Submitted search starts enabled providers independently and renders completed results immediately. Keep stale-query guards; add shared request deduplication and cancellation ownership.
2. Source labels and picker choices subscribe to the same state. A new result updates both without another search, click, save, or playback request.
3. Keep the displayed row key, focused control, and chosen recording stable while late sources arrive. Preserve source-specific metadata separately from display metadata.
4. Autocomplete text remains lightweight. If playable quick results are displayed, they use the same grouped result model; they must not imply a completed all-source search from a YouTube-only response.
5. Home keeps editorial shelves such as Recently Played and Recommended. Merge source evidence before removing duplicate cards; no Tidal-only discovery shelf. Aggregate views deduplicate cards, but a deliberate playlist/queue occurrence must not be removed because the same song exists elsewhere.
6. Change backend home deduplication to retain alternate source references instead of dropping them. Preserve the novelty/ranking policy separately so merging sources does not flood recommendations with library songs.
7. Late Tidal results enrich the current home generation. Navigating away, refreshing, logging out, or entering local-only mode invalidates the applicable generation.
8. Bounded background enrichment handles visible top results/current song/next queue entry. Proposed initial limit: at most two song-enrichment jobs concurrently, with at most one request per provider per job. Do not query every source for hundreds of cards.
9. Start with session caching and shared in-flight promises. Cache keys include normalized query, provider, account/region scope and matcher version. Positive results can be reused briefly; negative results have a shorter lifetime and must never include timeout/authentication errors as absence.
10. Preserve known alternatives when a provider disconnects; mark them unavailable and exclude them from Auto. On logout, evict account-bound URLs and requests. In local-only mode, make no online discovery or resolution calls.

The UI promises consistent known sources and honest progress, not instant exhaustive knowledge of every catalog.

## 7. Music-content filtering

Keep the requested YouTube discovery/search cap: known duration greater than 1,200 seconds is excluded; exactly 20:00 remains eligible. Local/Tidal/Qobuz music is not subject to this YouTube cap.

- Prefer YouTube Music song results and typed music metadata. Reject podcast/episode/profile/playlist/live-stream/compilation results from song discovery where their type is known.
- Separate content kind from version: a genuine instrumental, acoustic or live recording is still music. It must remain findable as its own version.
- Replace broad substring bans with typed classification first, narrow contextual rules second. A legitimate catalog song named `Interview` or `Reaction` must not be rejected solely by that word.
- Unknown duration remains unknown and displays `--:--`. Verify unresolved YouTube items with a bounded metadata lookup before promoting them into automatic recommendations/fallback. Do not silently treat `0:00` as confirmed short music.
- Apply the policy consistently to fresh searches, cached home shelves, mixes, and newly generated radio. Revalidate old cached entries with a filter version; preserve the underlying saved library and history.
- Preserve manually saved music, explicit pasted-link playback, and deliberately queued entries. If an explicit link falls outside discovery policy, label it and require the ordinary deliberate Play action; it must not silently seed song recommendations.
- Expose a short reason in diagnostics when a result is excluded. Do not add a filter-settings panel unless listener feedback shows a need.

## 8. Playback selection, resolution, and fallback

Retain `src/store/sourcePlayback.ts` as the orchestration point. Reuse provider commands and the native player. Only enabled, authenticated and matching sources enter a playback attempt.

### Selection policy

| Mode | Behavior |
| --- | --- |
| Explicit source | Try the selected source first; do not silently prefer another provider because its catalog advertises higher quality. |
| Auto / Best available | Rank equivalent renditions by verified lossless capability and requested resolution preference. Prefer suitable local audio; use provider preference for meaningful ties. Higher resolution is a preference, not a claim of better mastering. |
| Auto / Standard lossless | Prefer verified CD-quality-or-better local audio, or request the provider's standard lossless tier. Do not download a higher stream tier solely to satisfy this setting. |
| Auto / Data saver | Prefer local audio, otherwise the supported low-data streaming tier; no background quality hunt or mid-play upgrade. |
| Local-only/offline | Play available local material and legally usable completed caches supported by the existing app. No provider search or authentication refresh loops. |

Catalog format is an estimate. Resolved stream metadata is better evidence; decoder telemetry is the authority for the active audio format. A file extension or provider name never proves lossless delivery, and a lossless container cannot prove the absence of a lossy upstream master.

### Attempt lifecycle

```text
Requested -> Resolving -> Preparing -> Playing <-> Paused
                  |           |          |
                  +---- failure ----------+ -> next verified source
                  |                      |
                  +-> Cancelled          +-> Ended (once)
                  +-> Exhausted
```

- Give each queue occurrence and play request stable runtime identifiers. Every prepare/start/error/end event includes the attempt identity; retain the existing native command channel and output engine.
- Cancel at Stop/Next/Previous/new Play, queue replacement, applicable logout, or app-mode change. Cancellation must reach native preparation where supported; dropping a frontend promise alone is insufficient. Non-cancellable work may finish, but it must have no authority to start audio or write current state.
- Deduplicate in-flight resolution by provider/source/quality/account. A 750 ms ranking window is not evidence that a source has buffered audio. Reuse results rather than immediately invoking resolution again.
- Keep a bounded grace window for a preferred ready source, then use a verified playable alternative. Resolve network alternatives concurrently within the concurrency cap; do not allow one stalled preferred source to block a ready alternative for its entire timeout.
- Proposed initial budgets: preserve the current 750 ms selection grace as a tunable internal constant; enforce an overall 15-second interactive resolve/prepare deadline shared by retries. Allocate provider sub-deadlines from the remaining time. Do not stack 15 seconds for every source, quality tier, and extractor fallback. Local cached playback should not wait for network quality inspection.
- Propagate deadlines through YouTube direct resolution and yt-dlp fallback. Keep provider-native recovery where useful, but it must share the attempt budget. Distinguish request accepted, source prepared, and audio actually started.
- At most one normal attempt per equivalent source, with one fresh-URL retry for evidence of an expired/authenticated URL, bounded by the same overall deadline. A user pressing Retry starts a new attempt. Do not loop across sources indefinitely.
- Classify failures: cancellation, missing local file, authentication, region/unavailable track, timeout/offline, expired URL, unsupported format, decoder failure, or output-device failure. An output-device failure does not become a catalog-search loop.
- Before playback starts, fallback can choose another verified source at position zero. After playback has started, resume at the current position only with a compatible, seekable recording; if equivalence/alignment cannot be established, stop with an honest retry/choose-source state instead of substituting a different edit.
- Preserve original preference and queue occurrence during fallback. Update active metadata only when the new attempt is accepted as current; publish successful playback only on native readiness. Late metadata/lyrics callbacks must use the same attempt guard.
- Report fallback once with the actual source and reason. Never show "Upgraded" just because `play_track` enqueued a command.

## 9. Mid-song upgrades and manual switching

Recommended first-release change: disable the existing automatic mid-song upgrade path. Continue background discovery, attach verified alternatives, and use them on the next play or next queued track. Manual source selection remains available.

This is a deliberate behavior change from the earlier implementation, proposed to meet the user's request for normal, predictable music playback. Existing explicit source preferences and streaming-quality preferences remain intact. Rewrite tests that currently require an automatic in-song upgrade to assert enrichment without interruption.

Manual switch rules:

- Prepare the selected source before replacing healthy current audio when the native path supports it. If it does not, show a clear buffering transition; do not call it seamless.
- Capture position immediately before committing the switch, not before a network lookup. Preserve paused state and prevent a paused switch from briefly producing audio.
- Resume only for the same verified recording with compatible timing. For a video/edit/uncertain alternative, start the selected version at zero with a clear label.
- On failure keep the old source playing if it has not been torn down. If it has, make one bounded recovery attempt and expose failure. Keep history/scrobbling tied to the same listening session where appropriate.

Optional later experiment, excluded from the core release:

1. Native prepare/commit/discard API with attempt IDs and a separately owned decoder/buffer, using existing native primitives where possible.
2. Validate response, container, decoder, observed codec/rate, duration and seekability. Decode and buffer near the intended position; a URL probe alone is insufficient.
3. Total duration difference of at most two seconds is necessary but insufficient; require compatible timeline evidence, or limit to explicitly requested switches with a documented interruption.
4. Recheck active queue occurrence, generation, selection, playback state, current position, remaining duration, output target and quality preference immediately before commit.
5. No automatic switch during seek, pause, crossfade, casting, device reconfiguration or the last part of a song. Initial experiment stays disabled in exclusive/bit-perfect mode unless device-specific validation supports it.
6. Independent rendition cache, one attempt per play, bounded preparation budget, discard on cancellation, and recoverable commit failure.
7. Do not ship an "inaudible" or "sample-accurate" claim without measured audio evidence. A normal timestamp seek does not establish either property.

## 10. Queue, audio, and cache safety

### Queue ownership

- Use one authoritative logical queue. Source resolution must not reorder entries or deduplicate intentional repeats.
- Distinguish playlist entry ID from queue occurrence ID. Playing the same saved entry twice must still produce two independently controllable queue items.
- Store provider IDs and source choices in the queue, not resolved URLs. Restore identities first and resolve when needed after restart.
- Preserve the ordinary local native gapless path for local-only sequences, including local recordings reached through unified home/search. A source context alone is not a reason to disable it.
- For mixed queues, define a single owner for end transitions. Until recording-aware native prefetch exists, let the source controller own transitions and document the gapless limit. Never run native auto-advance and frontend `playNext` for the same completion.
- Add queue-generation and attempt IDs to native completion/error/readiness events. Handle duplicate or late events idempotently. Test natural-end events and polling recovery together, including manual Stop near the end.
- Prefetch at most the next logical entry initially. Invalidate it on reorder/remove/skip, source preference change, quality change, logout, and local-only mode. Never play a removed prepared entry.
- Keep repeat-one on the same recording/preference; repeat-all and shuffle operate on queue occurrences. Autoplay excludes disliked/non-music items but must not replace the listener's selected version.

### Quality and output

- Protect local FLAC/ALAC/PCM metadata and the source-versus-output distinction. Do not call transcoded YouTube audio lossless because the intermediate container is FLAC.
- Test local gapless, crossfade, ReplayGain/DSP, exclusive WASAPI, shared mode, sample-rate changes, and bit-perfect telemetry. Selection logic must not touch output settings.
- Test Chromecast and UPnP independently: receiver codecs, MIME values, headers, expiring URLs, local serving, pause and seek differ from local playback. A codec string such as `flac` is not necessarily a MIME type.
- Unsupported receiver rendition must produce a supported same-recording alternative or an explicit error; no silent desktop playback and no automatic cast handoff upgrade.

### Cache layers

1. Discovery/match cache: normalized metadata, verified source associations, matcher/filter version, account/region scope. No signed URLs or credentials.
2. Resolution cache: provider/source ID, requested quality, account/region generation, expiry, rendition information. Invalidate on logout, quality change, expiry or relevant error. Coalesce in-flight work.
3. Byte/decoded cache: namespace/version + provider/source ID + actual rendition identity + codec/container/rate/depth/channel metadata as available. Same quality label alone is not enough when it can fall back to different formats.

Current YouTube disk keys hash the canonical video URL; ordinary HTTP disk keys hash the full URL. Audit both before changing cache identity. Do not merely append `q=hifi`: canonicalization may discard it, and a signed URL may reject mutation.

Use unique temporary writes, one writer per rendition, completion metadata, and atomic promotion. Partial or failed downloads are never promoted as complete or appended to another rendition. Validate size/container and provider identity; cancellation cannot delete another live writer's data. Keep eviction bounded and preserve user downloads separately from disposable cache. Never log signed URL query strings or provider credentials.

## 11. Persistence and migration

Use an additive versioned change; do not rewrite the library to fit the new model.

1. Capture baseline fixtures for legacy paths, current source contexts, favorites, playlist ordering, repeated queue items and explicit choices. Back up affected persistence before migration testing.
2. Keep path-only entries unchanged. Reopening search must not convert existing playlist entries to Auto.
3. Read existing source contexts as version 1. Their grouped alternatives are candidates, not automatically proven equivalent recordings. Retain the explicit chosen source or original anchor, revalidate alternatives, and preserve uncertain alternatives for manual selection.
4. Preserve existing IDs and preferences even when a match is split. Never silently erase an explicit choice, merge playlist entries, or transfer a choice to a different recording.
5. Persist version 2 only after validation; make writes transactional and migration idempotent. Validate provider IDs, finite durations, URL/path boundaries, field lengths, duplicates and limits in TypeScript and Rust. Reject malformed input without destroying the last valid saved state.
6. Preserve the current 32-source durable-context ceiling. Keep representative safe sources per provider and the explicit/active source; uncertain candidates cannot evict them. Larger catalog result sets remain transient display data.
7. Read older queue/localStorage snapshots through a compatibility adapter; newer snapshots must not expose temporary URLs as durable identity. On corruption, recover individual valid entries and report the affected entry rather than clearing the whole queue.
8. Cloud sync is a compatibility gate: today's path-only payload does not carry the full context. At minimum, syncing must not overwrite existing local source contexts or corrupt numeric provider IDs. Cross-device unified source restoration must either receive a separately tested additive protocol update or be explicitly marked unsupported for these entries. Do not silently claim the feature survives cloud restore.
9. Rollback disables new matching/enrichment/upgrades while retaining saved data. Preserve a readable legacy source anchor and do not require a destructive down-migration. Test downgrade/re-upgrade with actual database copies.

## 12. Delivery plan and completion gates

Each phase is a small reviewable change set. Do not combine matcher changes, queue rewrites, and audio handoff changes in one patch. Estimates below describe relative effort, not delivery promises; live-provider investigation can change scope.

| Phase | Work and principal files | Exit gate | Relative effort |
| --- | --- | --- | --- |
| 0. Baseline and incident capture | Inspect current dirty diff; reproduce first/second Anggi Marito search, home refresh and Other sources; capture sanitized provider timing/metadata; characterize current behavior in existing tests. Reconcile outdated `docs/development/unified-sources.md`. | A reproducible fixture for source-list inconsistency and a written baseline for playback/queue behavior. Separate confirmed causes from hypotheses. | Small-medium |
| 1. Identity and matching contract | `types.ts`, `unifiedSources.ts`, native `sources.rs`/`db.rs` models as needed; separate UI group from safe recording cohort; remove invented durations in `tidalHub.ts`; add Unicode/version/explicit/provenance tests. Disable automatic mid-song upgrades as the documented reliability default in `sourcePlayback.ts`. | No unsafe copy enters Auto; no automatic replacement of healthy playing audio; deliberate versions remain accessible. | Medium |
| 2. Shared discovery and music filtering | Shared store knowledge using existing helpers; `AideoView.tsx`, `SourceMenu.tsx`, `UnifiedSearchResults.tsx`, `discoveryFeed.ts`, `tidalHub.ts`, `aideo/*`, YouTube parser/home functions. Preserve late results and alternate IDs; unify quick/full search; revalidate cached content. | First search/home/picker converge without a second action; partial errors are honest; cap/classification fixtures pass; no provider-only duplicate rows/outlines. | Medium-large |
| 3. Playback attempts and cache correctness | `sourcePlayback.ts`, `unifiedSources.ts`, `librarySlice.ts`, `playbackSlice.ts`, `App.tsx`, native command/event handling, provider resolvers and `player/mod.rs` cache paths. Add attempt IDs, deduplicated resolution, native readiness, typed failures and common deadline. | Stop/skip/pause defeat delayed work; expired URLs recover within bounds; decoder failure never looks like success; distinct renditions cannot share partial bytes. | Large |
| 4. Queue and persistence compatibility | Existing queue/session/playlist paths, `db.rs`, `db_tests.rs`, source context adapters and cloud-sync boundary tests. Restore single-local native queue eligibility; idempotent completion; bounded next-entry preparation where needed. | Repeated entries, playlist choices, restart, natural ends, local gapless, migration and rollback preserve identity/order/data. Cloud limitations resolved or explicitly gated. | Medium-large |
| 5. Desktop release validation | Four home designs, real provider accounts, offline/local-only scenarios, large library, long playback, cast targets and available DAC/output modes. Update docs to describe tested behavior and remaining limits. | All automated gates plus real acceptance matrix below, zero critical identity/data-loss/cancellation failures. | Medium; hardware dependent |
| 6. Optional native upgrade experiment | Separate prepare/commit/discard support and measured handoff tests. Not a dependency of phases 0-5. | Evidence of safe preparation, cancellation, timeline behavior, independent cache and recovery. Explicit opt-in only until proven. | Separate project |

Phases 1 and 2 depend on the phase 0 fixture; phase 3 depends on phase 1's safe-source model; phase 4 depends on phase 3 event identities. Phase 5 evaluates the combined result. Land each phase only after its specific tests and the full repository gate pass.

## 13. Regression and acceptance matrix

Use existing Vitest and Rust test infrastructure. Add fixtures and assertions to the existing matching, source playback, persistence and home tests; add a new small test file only for genuinely separate logic. Tests must assert user-visible behavior and ordering, not mirror helper implementations.

| Area | Required cases and expected result |
| --- | --- |
| Matching positives | Anggi Marito/`Tak Segampang Itu`; local + Tidal single/album + YouTube official audio; Topic artist suffix; recognized movie wrapper; partial featured credits; punctuation and Unicode Malay/Chinese/Korean/Arabic fixtures. Equivalent copies appear together. |
| Matching negatives | Cover with identical duration; same title/artist with conflicting ISRC; live venues; studio/live; remix names; acoustic; radio/extended; mono/stereo; remaster year; clean/explicit. Never automatic substitutes. |
| Ambiguity | Unknown artist/duration; uploader names; three-way bridge where A matches B loosely and B conflicts with C; video intro; malformed metadata. Uncertainty remains visible and excluded from Auto. |
| Durations | 19:59, 20:00, 20:01, 01:00:00, absent/zero/negative/NaN/overflow and invalid colon fields. Cap applies only to YouTube discovery/search; long local music remains playable. No guessed 180 seconds. |
| Music classification | Podcasts, interviews, tutorials, multi-song compilations, ongoing live streams; legitimate songs containing filter words and legitimate instrumental/live versions. Correct kind/version separation. |
| Progressive search | Permute provider completion order; slow Tidal beyond 2.5 seconds; one timeout; all providers unavailable; query A finishes after query B; change filter mid-search. Stable row identity and focus; known alternatives never require a second search. |
| Shared surfaces | Search -> home -> Other sources -> queue -> Now Playing and reverse. New verified sources propagate; closing a picker does not discard knowledge or keep uncontrolled work alive. All four home layouts. |
| Selection | Each quality preference; local lossless versus lossy; provider claims lossless but resolves lossy; missing quality; explicit unavailable source; disconnect/login-region changes. Preferences survive fallback. |
| Attempt races | Play A then B; Stop while resolving/preparing; pause then resume; next during failure; same URL played twice; late error/readiness/end/lyrics response; logout or local-only during resolution. Only current attempt can affect audio/state. |
| Failure budgets | 403/expired URL, 404, auth failure, rate limit, offline, stalled extraction, invalid HTML body, unsupported decoder, missing file and device failure. Bounded retries and correct failure class. |
| Queues | Intentional duplicate songs, reorder/remove during prefetch, Play next, repeat-one/all, shuffle, autoplay, legacy + unified mixed entries, one-source local home cards. Exactly one logical advancement; local gapless preserved. |
| Persistence | Save/restart/research, entry-specific choice, same provider ID across catalogs, library rescan, missing file, malformed context, interrupted migration, downgrade/re-upgrade. No lost/merged entries or preference drift. |
| Cloud compatibility | Path-only legacy restore and unified entry in same playlist, source-ID collisions and another device's unavailable local path. Preserve local contexts; no unannounced destructive downgrade. |
| Cache | Same song in Opus/AAC/FLAC, same source across quality tiers, two simultaneous resolves/writers, signed-URL renewal, partial download, cancellation, decoder rejection and cache eviction. No cross-rendition reuse or partial-file promotion. |
| Listening state | Manual source switch at 40 seconds, switch while paused, failure near track end, lyrics timing, Now Playing title/duration/source, media keys, Discord, history/play counts/scrobbles. One listening session unless intentionally changing version. |
| Output | Shared WASAPI, exclusive mode, bit-perfect, available sample-rate transitions, DSP/crossfade, Chromecast/UPnP. No unintended settings changes; receiver errors do not start desktop audio. |
| Accessibility/layout | Keyboard source picker, Escape/focus return, screen-reader labels/status, row focus during late arrivals, narrow/wide windows and long multilingual titles. No nested interactive-control regressions. |

Native fixtures should exercise the real command/event and decoder boundary with short local audio and a loopback HTTP fixture where possible. Mocked `invoke` success cannot prove first audio, cancellation of native work, or codec correctness. Live-provider tests are opt-in and record provider/account region, source IDs, timing, and outcome without secrets.

Run after every implementation phase:

```powershell
git status --short
npx.cmd tsc --noEmit
npx.cmd vitest run src/test
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

Also run `git diff --check` scoped to changed paths and `npm.cmd run build` for release-candidate frontend packaging. No `npm run lint`. Keep the required test setup and repository test locations. Classify ignored/live tests explicitly; they are not passed tests.

Prior-turn results were 665 frontend tests and 290 Rust tests passed with two Rust tests ignored. Those results describe that earlier tree/run only; this planning pass does not rerun or certify the feature. Automated success must be supplemented with real Tauri and device checks.

## 14. Measurement, rollout, and rollback

Add compact diagnostics to the existing logger, not a new analytics system. Record request/queue/attempt IDs, provider/source identity, matcher version/reason, cache hit, deadline, resolution/prepare/start durations, fallback reason and cancellation. Redact credentials, signed URLs and private local path details from exported reports.

Track separate milestones: first visible result, source-check completion, click-to-native-ready, click-to-first-audio when measurable, fallback time and queue-transition gap. A JavaScript promise resolving is not a first-audio measurement.

Provisional acceptance budgets:

- Local playback gains no network dependency; compare p50/p95 startup to the phase 0 baseline on the same device.
- A slow provider cannot hold back completed search results or a ready allowed source indefinitely.
- A 15-second controlled failure fixture reaches a terminal state within the overall deadline plus a small scheduler allowance, regardless of source count.
- Background enrichment stays within the stated concurrency limit; repeated opening of one picker joins existing work.
- Automated stale-event/cancellation fixtures produce zero unwanted starts, double advances, or wrong-source commits.
- Matching fixtures produce zero known false automatic substitutions. Record unresolved positives separately rather than relaxing a hard mismatch to improve a hit-rate number.
- Run at least one full-track transition per provider and a mixed-queue soak with stop/skip/seek and a forced provider failure. Document audible gaps, not just process survival.

Rollout sequence: fixture-only characterization -> local development -> real-account desktop validation -> limited release candidate -> normal release. Use one temporary internal release gate if needed, rather than a permanent matrix of user-facing experimental switches.

Block release for wrong recording playback, lost entries/preferences, audio after Stop, duplicate queue advancement, cross-rendition cache reuse, or a regression in the ordinary local audio path. On failure, disable the new orchestration/enrichment path and use preserved source anchors while retaining user data. Do not restore the unsafe automatic upgrade path as a rollback strategy.

## 15. Definition of done and deliberate exclusions

The core feature is done when a first search or home visit converges to one consistent song presentation, all known equivalent sources are available everywhere, automatic playback cannot cross into an unverified version, and the complete queue/persistence/device acceptance gates pass.

No automated test suite can guarantee that external catalogs and streaming endpoints never fail. The requirement is bounded, understandable failure without wrong music, lost data, or uncontrolled playback.

Excluded from the core plan: new providers/addons, arbitrary JavaScript execution, acoustic fingerprint services, a replacement audio engine, custom internal URI serialization, and automatic seamless mid-song quality upgrades. Add any of these only for a demonstrated unmet requirement after phases 0-5 are stable.

Recommended first implementation increment: phase 0 fixtures, then phase 1's separation of display grouping from safe source matching, removal of invented duration evidence, and the non-interrupting background-discovery default.
