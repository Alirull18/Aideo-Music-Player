# Adaptive recommendations and bug ledger

Implemented locally on 2 October 2026. The shared Rust ranker is `src-tauri/src/recommendations.rs`; Home, radio, Smart Mix and dynamic mixes call it through Tauri IPC. Provider catalogs supply candidates, while Aideo applies recording identity, feedback, eligibility and ranking. No hosted learning service or new dependency was added.

## Source policy and duplicate cards

Discovery categories and the combined feed deduplicate equivalent recordings while preserving distinct versions. Cards use source-qualified keys, and Recently Played matches recordings rather than literal URLs. Manual playlists retain intentional repeated entries.

Radio started from online music excludes local files from candidate ranking and automatic source fallback unless **Mix local tracks into online radio** is enabled in Settings > System. The native ranker enforces the same eligibility rule, including empty-provider fallbacks. Radio refills retain the source actually played rather than the grouped card's original representative. Local-only playback and manually queued tracks retain their existing behavior. Changing the switch rebuilds automatic radio entries without clearing manual queue choices.

## Listening and feedback

- Starts do not count as positive taste. Observations accumulate confirmed playback progress against elapsed monotonic time, excluding seeks, stalls, pauses and long polling gaps.
- A listen qualifies after `min(120 seconds, half the known duration)`, or 120 seconds when duration is unknown. Natural completion also requires at least 80% actually listened.
- Qualified partial listens contribute 0.75 positive and 0.25 negative evidence; completion contributes 1 positive; an early user skip contributes 0.5 negative. Playback failures are neutral.
- Evidence decays with a 60-day half-life, with at most three contributions per recording per UTC day. Legacy history supplies only a weak prior; it cannot create a qualified listen or version preference.
- Affinity is `(2 + positive) / (4 + positive + negative)`. Explicit favorites persist. Artist rejection requires early skips of three distinct recordings within 30 days.
- Session evidence covers the last ten qualified observations within two hours, decays with a 30-minute half-life, and expires after 30 minutes without a qualified listen.
- “Not interested” persists recording exclusion, clears its favorite, and removes matching automatic queue entries. Manual queue choices and current playback remain available. Undo can restore the previous favorite; “Allow recommendations again” clears exclusion. An old Undo cannot overwrite a later preference.

## Recording identity and source policy

Source keys include the provider, so Tidal ID `123` and Qobuz ID `123` stay distinct. Cross-source aliases require complete matching artist/title, positive durations within three seconds, and compatible available recording evidence. Meaningful live venues, remaster years and other version labels are preserved. New conflicting catalog evidence separates identities without rewriting historical observations; explicit feedback survives refinement.

Local mode admits available local files. Hybrid mode admits local files and the selected provider, or all enabled providers with Aideo selected. Automatic source fallback follows that policy. Manual playback retains its source selection behavior. Provider changes filter incompatible automatic queue entries, and discovery-level changes refill radio without discarding manual choices.

## Scores and surfaces

`T` is persistent taste, `R` is supported recording relatedness, `U` is session affinity, `N` is related novelty, and `V` is affinity for the specific recording/version.

| Surface | T | R | U | N | V |
| --- | ---: | ---: | ---: | ---: | ---: |
| Radio / artist spotlight | .25 | .35 | .20 | .10 | .10 |
| Home / general mixes | .55 | .10 | .05 | .20 | .10 |
| Discovery | .25 | .25 | .05 | .35 | .10 |

Familiarity shifts weight toward taste; Discovery shifts weight toward related novelty. Selection penalizes redundancy against already selected tracks and adds continuity for radio. Artist spacing and rolling caps avoid dominating the queue. Short pools remain short.

| Surface | Selection behavior |
| --- | --- |
| Radio | Original session seed, current session evidence, provider radio and local similarity; excludes seed, queued, played, cleared and rejected recordings |
| Home | Broad taste across eligible local and provider candidates; context/generation guards reject obsolete results |
| Supermix | Targets 60% familiar recordings, 25% unfamiliar tracks from known artists, 15% discoveries when supported candidates exist |
| Artist spotlight | Targets 70% seed artist and 30% related music; does not invent unrelated padding |
| On repeat | At least two qualified listens within seven days |
| Heavy rotation | At least two qualified listens within 30 days |
| Recent | Most recent qualified listening observations |
| Forgotten favorites / gems | Positive historical evidence and at least 30 days since last qualified listen; gems also need two qualified listens |
| Recap | Qualified listening in the requested period; current frontend default is 30 days |
| Discovery mix | Related novelty; unrelated candidates cannot win through novelty alone |
| Smart Mix / daypart mix | Supported genre or energy evidence; visible mood labels are normalized; insufficient evidence returns an empty mix |
| Charts / manual playlists | Keep their ordering, with automatic eligibility filtering for charts |

Home creates local mix surfaces when catalog retrieval supplies none. Objective mix query failures leave those mixes empty. Home requests use context-aware caching and generation guards. Online recommendation work has an eight-second deadline and a shared three-request cap; scoped requests are dropped on timeout. Generated Smart Mix playlist replacement uses one database transaction and preserves the prior playlist if saving fails.

## Idle audio analysis

One worker starts after 30 seconds idle. Playback and buffering on the local player, Chromecast or UPnP cancel analysis between packets, computation steps and before writes. Analysis decodes at most 90 seconds, supports sample rates up to 192 kHz, and limits decode wall time to 30 seconds. It aggregates multiple Hann-windowed FFT samples and stores coarse BPM, RMS energy, bass and treble features. It does not write ReplayGain.

Successful and failed attempts are cached by path, file size, modification time and analysis version. Ranking overlays fresh database features on supplied local tracks and seeds, so a client with stale metadata still benefits. Files changed during analysis are not committed.

## Original audit bugs

| Finding | Implemented correction / regression coverage |
| --- | --- |
| Generated mixes cleared their own queue | Start first track with queue preservation; Smart Mix and dynamic mix queue regressions |
| Unified recording counts disagreed with path counts | Qualified observations update compatibility counts; shared taste comes from canonical native history |
| Dislikes leaked into automatic mixes and provider copies | Shared canonical exclusion plus cached Home and queue filtering; feedback and menu tests |
| Ordinary seed artists received favorite bonuses | Genuine favorite artists are separated from retrieval seeds |
| Provider radio accepted unrelated text-search hits | Related recording retrieval and strict catalog validation; provider regressions |
| Fresh libraries lacked an analysis flow | Bounded idle worker, remote playback gate and fresh-feature ranking tests |
| Search hits inherited another recording's reason | Meaningful recording/version matching and provider-qualified evidence/provenance maps |
| Saved online tracks were labeled local | Provider-aware source mapping, including normal Tidal/Qobuz playback formats |
| Starts and seeks distorted listening taste | Elapsed qualification, neutral failures, monotonic checkpoints and idempotent finalization |
| Home committed obsolete mode results | Context/generation guards for fetches, cache, ranking and rendered shelves |

Additional review regressions cover overlapping history transitions, late inserts, feedback after identity refinement, numeric provider-ID collisions, lost Home source choices, visible mood labels, stale queue policy, atomic playlist rollback, and Undo/error states.

## Practical limits

The audio features and mood rules are coarse heuristics. Version preference learns individual recording outcomes; it does not infer a universal preference for every remaster, live performance or instrumental. Sparse evidence can leave specialized shelves empty. Analysis failures retry after file or analyzer-version changes. Remote status failures conservatively defer analysis, and playback started outside Aideo is detected on the next status poll.

Regression tests validate local logic and mocked provider contracts. Real catalog availability, cast devices and whether ranking suits the listener still require live listening evaluation. No deployment or release is implied.

## Verification

Working-tree verification on 2 October 2026 after the duplicate-card and online-radio fixes: `npx.cmd tsc --noEmit` passed; `npx.cmd vitest run src/test` passed all 1,366 tests in 134 files; `cargo check --manifest-path src-tauri/Cargo.toml` passed; `cargo test --manifest-path src-tauri/Cargo.toml` passed 436 tests with five existing ignored tests. The production frontend build passed with the existing large-chunk warning. Live provider playback and the reported screenshot still require an interactive retest; these checks do not publish a release. Final reliability evidence and external acceptance are recorded in `docs/reliability-validation.md`. Frontend and native regression suites ran outside the sandbox where test tooling needed parent-directory or temporary-file access.

## Preference management and learned-taste reset

Settings lists canonical excluded recordings with searchable title, artist, version and provider-qualified source references. Allow again uses the existing recording-interest operation; persistence errors remain visible. Current playback and manual queue entries are preserved when automatic recommendations refresh.

Learned taste can be reset for selected canonical recordings, an inclusive UTC date range, or all learned history. Preview counts history observations not already ignored. Applying requires a saved rollback backup and rechecks the preview against current history after playback has been stopped/flushed. If new observations arrived, preview again. A failed backup prevents reset.

Reset stores history IDs in `recommendation_training_ignored`; the shared evidence query ignores these IDs for both persistent and session taste. Visible history, favorites and exclusions are not deleted. New listens remain eligible. Ignored-history state belongs to backup/restore and must map to restored history identities rather than reusing another database's numeric IDs. Preference changes invalidate pending rankings and Home cache contexts.

Three real 45-minute listening sessions (familiar, discovery, recently excluded) remain an external qualitative evaluation gate. Fixture tests cannot establish listener relevance.
