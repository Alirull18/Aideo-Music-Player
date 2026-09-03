# Audio concurrency, race-condition and gapless audit

**Snapshot:** `be94f376930cadd288b987183ee3486c6d36abbd`  
**Commit under focused review:** `be94f37 feat(audio): implement true gapless stream session pipeline with encoder delay trimming`  
**Verdict:** **NO-GO**

No ThreadSanitizer run, hardware callback capture or deterministic fake-device integration test exists here. Findings marked STATIC-HIGH follow directly from ownership/control flow; they still need regression fixtures before a fix is accepted.

## Concurrency model

The core is not Tokio-based. It combines:

- one long-lived synchronous `player_loop` thread;
- an `mpsc` command channel shared by frontend commands, callback recovery and player handoff;
- a detached decoder-preparation thread per `play_file` call;
- background full-file decode threads sharing a mutable RAM cache;
- child FFmpeg/yt-dlp processes represented by shared `Arc<Mutex<Option<Child>>>` slots;
- a CPAL callback or a dedicated custom WASAPI thread consuming a ring buffer;
- auxiliary network, FFT, download and cache threads.

Mutex poisoning is generally hidden by `safe_lock`, but logical ownership is not automatically safe just because the memory accesses are locked.

## P0 findings

### AUD-CON-01 — Manual track change can output buffered samples from the old track

**Evidence:** STATIC-HIGH

Commit `be94f37` preserves `stream`, producer and `flush_signal` in `ActiveStreamSession` (`player/mod.rs:3517-3529`, `5500-5518`). On `PlayerCommand::Play`, the pump sets `next_track_info` and exits without setting `flush_signal` or otherwise discarding the consumer side of the old ring (`4832-4837`; the full-buffer wait path does the same at `5354-5366`).

`player_loop` immediately calls the new `play_file` with that session. If device and mode satisfy `can_reuse_stream_session`, the old ring is reused (`4023-4049`). Its unread samples therefore precede the new track's samples. Depending on how full the multi-second ring is, the user can hear the old track after selecting the new one.

```text
old pump                    output callback                new play_file
---------                   ---------------                -------------
ring <- old frames
Play(B) received
return session  ----------> continues draining old frames
                             old audio still audible <---- session reused
                                                           decode B
                                                           ring <- B frames
```

The UI changes `current_track` and position before B is ready, so metadata can say B while A remains audible.

The new unit test calls only `can_reuse_stream_session`; it neither fills a ring nor sends `Play`.

### AUD-CON-02 — Encoder-delay trim shifts a live cache under an independent cursor

**Evidence:** STATIC-HIGH

`background_decode` appends decoded frames into a shared `Vec<Vec<f32>>`. `play_file` concurrently reads it by numeric `ram_cursor` (`player/mod.rs:5011-5019`). At end of decode, the background thread drains `delay` samples from the front and truncates padding (`3462-3477`, `3558-3574`) before setting `complete`.

The mutex prevents simultaneous vector mutation, but it does not adjust `ram_cursor`. If playback has already advanced to index N, draining D front frames makes index N refer to what was N+D. Playback skips D additional frames. Truncation can similarly move the logical end behind a cursor already computed from the pre-trim vector.

This is a logical race, not a Rust data race.

Symphonia 0.5.5 exposes a demuxer `FormatOptions::enable_gapless` setting and defaults it to false; enabling it supplies trim information through packets ([Symphonia 0.5.5 gapless documentation](https://docs.rs/crate/symphonia/0.5.5/source/src/lib.rs)). The application instead probes with `FormatOptions::default()` and post-mutates only the RAM-cache path. Large-file direct decode and crossfade predecode do not receive equivalent trimming, so behavior differs by cache threshold.

The pure helper test runs after decoding against a private vector. It does not exercise concurrent consumption. It also leaves data untouched when `delay == len` or `padding == remaining_len`, rather than producing an empty playable region.

### AUD-CON-03 — Decoder child ownership has an ABA/stale-worker race

**Evidence:** STATIC-HIGH

`play_file` spawns `prepare_decoder` and retains only its result receiver (`player/mod.rs:3608-3626`). There is no cancellation token or join handle for that worker. Aborting the polling loop kills whatever child is currently in the shared `current_process`, but does not stop the worker.

`prepare_decoder` later:

1. takes and kills any child in the shared slot (`1561-1565`);
2. spawns its own child; and
3. writes that child back to the same slot (`1656` or `1683`).

A stale worker A can therefore run after a newer play B begins, kill B's child, and install A's child. Locks serialize each operation but do not encode generation ownership.

```text
A worker starts -------- slow resolve -------- kill(slot) -- spawn A -- slot=A
user skips
main kills(slot)
B worker starts ---- spawn B -- slot=B
                                  ^ A can later kill B here
```

Use a monotonically increasing playback generation plus owned cancellation/join semantics. A child handle must belong to one generation, not to “whichever decoder last touched this mutex.”

### AUD-CON-04 — Command debouncing reorders unlike commands

**Evidence:** STATIC-HIGH

When a `Play` arrives, `player_loop` drains the channel, keeps only the last `Play`, stores every other command, then sends those commands back after choosing the last play (`player/mod.rs:2173-2208`).

Example enqueue order:

```text
Play(A) -> Pause -> Play(B)
```

Execution becomes:

```text
Play(B) -> Pause
```

The final state may be defensible for this example, but chronological semantics have been changed. Other combinations (`Seek`, `RestartStream`, queue mutations) can apply to a different track than the caller intended. Re-inserting onto the same channel also interleaves with concurrent senders.

## Gapless claim review

### AUD-CON-05 — Keeping the stream open does not guarantee a gapless transition

**Severity:** P1  
**Evidence:** STATIC-HIGH

For crossfade-disabled natural queue advance, no next decoder is guaranteed ready. At EOF, the current pump selects the queued path and returns. The old callback drains whatever remains in the ring while the next `play_file` performs path resolution and decoder preparation. When that latency exceeds buffered audio, the callback writes silence.

For exclusive output with a different target rate, `can_reuse_stream_session` intentionally rejects the session and a new stream is created, including startup silence. Shared reuse skips reconfiguration even when source channels or preferred sample format differ.

The predicate does not compare:

- stored vs desired output channel count (although `channels` is stored);
- bit-perfect state;
- output sample format and valid bits;
- dither policy;
- source coded bit depth; or
- a stable endpoint identity beyond the selected name string.

The log string `0ms gapless transition` is therefore not measured evidence.

### AUD-CON-06 — Cache tail and resampler tail are not explicitly finalized

**Severity:** P1  
**Evidence:** STATIC-RISK

The RAM EOF branch advances only while at least a full 1,024-frame pending chunk exists, then exits when pending is shorter than one chunk (`player/mod.rs:5021-5033`). Rubato is driven through per-chunk `process`; there is no end-of-input flush/finalize call. A short decoded tail and filter/resampler latency can be omitted. Rubato's own documentation distinguishes single-chunk `process` from whole-clip methods that trim startup delay and preserve the tail ([Rubato documentation](https://docs.rs/rubato/latest/rubato/)).

Exact loss depends on ratio and library behavior, so this needs impulse/ramp fixtures.

### AUD-CON-07 — Crossfade processes the next track with current-track state

**Severity:** P1  
**Evidence:** STATIC-HIGH

The next decoder's samples are resampled and mixed into `processed` (`player/mod.rs:5170-5212`), after which the common current DSP graph runs (`5237-5240`). The next track's ReplayGain/static loudness data is not loaded as a separate graph before mixing. The next samples therefore inherit current-track gain/DSP state during overlap.

The queue item is also removed at crossfade trigger time (`4931-4938`), before the next decoder has proved usable. Failure falls through to a later ordinary attempt, but queue/history semantics no longer reflect a simple committed transition.

## Other concurrency and lifecycle risks

### AUD-CON-08 — Custom WASAPI initialization can wait forever

**Severity:** P1  
**Evidence:** STATIC-RISK

`start_exclusive_stream` spawns a worker then blocks on `rx.recv()` with no timeout (`wasapi_engine.rs:109-130,636-645`). Any driver/COM call that neither returns nor sends leaves the player thread stuck. A bounded initialization timeout must also cancel and reap the worker.

### AUD-CON-09 — Dropping custom WASAPI can synchronously stall the player

**Severity:** P1  
**Evidence:** STATIC-HIGH

`WasapiStream::drop` sets shutdown then joins (`wasapi_engine.rs:18-23`). The worker may be inside an event wait of up to 2,000 ms (`508-513`) or a driver call. Stop, restart and incompatible-track transitions can therefore block synchronously.

### AUD-CON-10 — “Exclusive opened” precedes actual hardware start

**Severity:** P1  
**Evidence:** STATIC-HIGH

The worker pre-fills silence and sends success at `wasapi_engine.rs:404-425`; `client.start_stream()` occurs later only after the state loop sees Playing (`444-469`). The caller can report successful negotiation before hardware start fails. Recovery emits an asynchronous error later, after the UI may already claim exclusive output.

### AUD-CON-11 — Player-owned sender prevents natural channel shutdown

**Severity:** P2  
**Evidence:** STATIC-RISK

The player thread itself receives a `cmd_tx` clone for reinjection and error recovery. A receiver cannot observe channel disconnection while its own thread retains a sender. There is no demonstrated `Drop` protocol that joins the player/network/FFT threads, so recreating `Player` can leak lifetime-bound workers.

## Required regression design

Use an injectable decoder and fake output sink; wall-clock sleeps alone will be flaky. Required deterministic cases:

1. Fill ring with sentinel A, send `Play(B)`, and assert no A appears after the defined cutover frame.
2. Pause/resume/seek/skip during each of decoder resolve, stream init, ring-full wait, crossfade and final drain.
3. Force A/B decoder interleavings and assert a stale generation cannot kill or install a child.
4. Decode a gapless MP3/AAC fixture while consuming the cache before completion; compare exact playable frames to a trusted decoder.
5. Run compatible and incompatible rate/channel/format album transitions and count inserted, dropped and duplicated frames.
6. Force decoder latency beyond ring duration and prove the UI does not call the result “0 ms gapless.”
7. Bound WASAPI init/drop latency using a fake driver layer before physical-driver fault injection.

