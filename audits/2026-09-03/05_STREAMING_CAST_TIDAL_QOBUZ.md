# Streaming, Chromecast, UPnP, Tidal and Qobuz audit

**Snapshot:** `be94f376930cadd288b987183ee3486c6d36abbd`  
**Verdict:** **NO-GO**  
**Real account/receiver status:** Tidal **UNTESTED**, Qobuz **UNTESTED**, Chromecast **UNTESTED**, UPnP renderer **UNTESTED**.

## Live-test boundary

- `TIDAL_ACCESS_TOKEN`: absent in audit environment.
- `QOBUZ_E2E_TOKEN`: absent in audit environment.
- Qobuz's live smoke test is marked ignored and remained the single ignored Rust test.
- SSDP searches on the audited LAN returned no MediaRenderer/AVTransport response.
- No Chromecast receiver was discovered/available.

Offline fixtures prove parsers and request construction, not provider authorization, entitlement, stream delivery, region behavior, token rotation, receiver compatibility or sound output.

## Tidal

### AUD-NET-01 — The binary contains fallback credentials for another Tidal client identity

**Severity:** P0 legal/operational risk  
**Evidence:** STATIC-HIGH

`src-tauri/src/tidal.rs:17-24,122-125` contains a fallback Fire TV client ID and reconstructs a client secret when the user has not supplied credentials. This report intentionally does not reproduce the values.

The app then performs device authorization and directly requests `playbackinfopostpaywall` stream URLs (`tidal.rs:420-472,713-720`). There is no evidence that Aideo owns that client registration or has permission to impersonate/use it.

Tidal's current developer terms describe full-track playback through Tidal's official, unmodified Player module/SDK and constrain commercial/use cases; scraping or bypassing official modules requires explicit rights ([Tidal Developer Terms](https://developer.tidal.com/documentation/guidelines/guidelines-developer-terms)). Aideo's direct URL/decoder path does not demonstrate that approved route.

**Required action:** remove borrowed fallback credentials; use an Aideo-issued client and the provider-approved playback integration, or remove Tidal playback until written authorization exists.

### AUD-NET-02 — No real token lifecycle or quality claim was tested

**Severity:** P1 evidence gap  
**Evidence:** UNTESTED

Unit tests cover classification, polling intervals and quality order. They do not test concurrent refresh-token rotation, subscription failures, regional blocks, manifest expiry, lossless/hi-res entitlement, CDN redirects or actual decoded format. Do not present “Tidal FLAC/Hi-Res” as verified based only on requested quality strings.

## Qobuz

### AUD-NET-03 — Application credentials are scraped from Qobuz's web bundle

**Severity:** P0 legal/operational risk  
**Evidence:** STATIC-HIGH

When environment overrides are absent, `qobuz.rs:239-280` downloads the Qobuz login page and JavaScript bundle, regex-extracts an application ID and base64 signing secrets, then signs unofficial `track/getFileUrl` requests (`483-545`). Tests deliberately lock the scraped bundle layout and extracted values.

Qobuz API terms require a valid application ID/secret issued for the application, prohibit sharing the secret, and require prescribed attribution/certification wording ([Qobuz API Terms of Use](https://static.qobuz.com/apps/api/QobuzAPI-TermsofUse.pdf)). Scraping web-player secrets is both brittle and inconsistent with a demonstrated Aideo-issued credential path.

**Required action:** obtain provider-issued credentials and written playback authorization. Do not ship the scraper as a substitute.

### AUD-NET-04 — Live Qobuz test is not part of the gate

**Severity:** P1 evidence gap  
**Evidence:** REPRODUCED

`qobuz::tests::live_smoke_validate_token` was ignored. The default suite passed with `210 passed; 1 ignored`. Offline JSON/bundle fixtures cannot detect API/terms changes, entitlement failures or stream URL behavior.

## UPnP / DLNA

### AUD-NET-05 — Connected UPnP playback still goes to the local player

**Severity:** P0  
**Evidence:** STATIC-HIGH/REPRODUCED search

The backend command `upnp_play` is registered (`lib.rs:3270-3298,3572`). There is no frontend invocation of `upnp_play`.

`librarySlice.playTrack` branches only on `chromecast_connected`; otherwise it invokes local `play_track` (`librarySlice.ts:492-529`). `connectUpnpDevice` sets `upnp_connected`, stops local playback, displays `Connected ... [Hi-Res Lossless DLNA]`, then calls the same `playTrack` (`playbackSlice.ts:1653-1679`). The selected song therefore resumes locally, not on the renderer.

This defect is definitive without physical hardware. A receiver test would not rescue the missing call path.

### AUD-NET-06 — UPnP protocol metadata is malformed/overclaimed

**Severity:** P1  
**Evidence:** STATIC-HIGH

`upnp.rs:250-269` emits protocolInfo with an extra space between MIME and the colon and hardcodes `DLNA.ORG_PN=FLAC` even when `mime_type` is MP3, WAV, OGG or MP4. Renderers are notoriously strict about DIDL-Lite and protocolInfo. Fix metadata generation per actual resource and test against multiple devices before using “Hi-Res Lossless DLNA.”

## Chromecast

### AUD-NET-07 — No receiver or codec matrix was tested

**Severity:** release-blocking evidence gap for compatibility claims  
**Evidence:** UNTESTED

The code was reviewed, but no Cast session was established. Google's supported-media table limits Cast Audio FLAC to 96 kHz/24-bit and makes support receiver-dependent; higher local “hi-res” files cannot be assumed to play ([Google Cast supported media](https://developers.google.com/cast/docs/media)).

### AUD-NET-08 — Local HTTP range handling is incomplete

**Severity:** P1 interoperability risk  
**Evidence:** STATIC-HIGH

The local server canonicalizes/allowlists library/cache paths, which is a meaningful strength (`chromecast.rs:68-103`). Its Range parser, however, reads only the start offset and ignores an explicit end; a start beyond EOF falls through to a full `200 OK` instead of `416 Range Not Satisfiable` (`chromecast.rs:230-300`). This can break seeks or cause excessive transfer on some receivers.

Remote MIME is probed with HEAD then `GET Range: bytes=0-0`, but actual decoder/receiver capability is not negotiated end-to-end.

### AUD-NET-09 — Provider stream URLs are handed to LAN receivers

**Severity:** P1 security/terms risk  
**Evidence:** STATIC-HIGH

Frontend resolution occurs before the cast branch, and the resolved URL is passed to `chromecast_play` (`librarySlice.ts:470-510`). Those URLs can contain bearer-like query material and leave the PC trust boundary for the receiver and LAN. Expiry helps but is not a complete policy. Provider terms and receiver logging behavior must be reviewed; prefer a bounded authenticated local proxy that does not expose upstream credentials where permitted.

## Required end-to-end matrix

### Provider accounts

For provider-issued test applications/accounts only:

1. login/device pairing, cancellation, expiry and logout;
2. concurrent requests during refresh-token rotation;
3. free/trial/paid and region-restricted responses;
4. requested vs delivered codec/rate/bit depth verified from decoded media;
5. URL/manifest expiry mid-track and retry without duplicate playback;
6. queue/crossfade/cache behavior without logging secrets;
7. provider review/approval artefact attached to release sign-off.

### Receivers

Test at least one Google speaker, one Google TV/Chromecast, and two unrelated UPnP renderers:

- MP3, AAC/M4A, FLAC 44.1/16 through 96/24, WAV and unsupported >96/24;
- local file and authorized remote stream;
- play/pause/seek/stop/queue advance;
- bounded and invalid byte ranges;
- receiver disconnect, Wi-Fi change and app exit;
- honest UI state when remote playback fails or falls back.

No casting or provider feature should be labelled verified until these runs exist.

