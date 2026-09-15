# YouTube direct playback investigation

Research date: 2026-09-15.

## Why Aideo receives 403

Aideo previously requested audio through InnerTube as `ANDROID_VR` version `1.65.10`.
Current yt-dlp source explicitly records that all formats from this version
started returning HTTP 403 on 2026-08-17. An API response containing an audio URL
therefore does not establish that the media server will accept a download.

The earlier retry repair lets yt-dlp recover after this rejection. It does not
repair the obsolete direct client. The user's subsequent log confirms successful
fallback downloads, transcoding, caching, and WASAPI initialization.

## How maintained extractors work

| Project | Current source behavior | Lesson for Aideo |
| --- | --- | --- |
| yt-dlp | Defaults to `visionos,web`; its JavaScript-free default is `visionos`. Selects formats by client capabilities, handles player JavaScript when needed, and skips formats requiring unavailable origin tokens. | Use a current direct client; keep yt-dlp for broader compatibility. |
| NewPipeExtractor | Fetches VisionOS player data and extracts audio from its streaming data. Maintains client identity and playback context explicitly. | Direct playback can operate independently of the yt-dlp executable. |
| YouTube.js | Defines a VisionOS client and applies its matching User-Agent to API requests. | Keep client identity consistent across requests. |

Proof of Origin tokens and JavaScript signature challenges are distinct mechanisms.
yt-dlp does not universally generate origin tokens itself; token providers are
separate. A header change alone does not implement either mechanism.

## Aideo's updated flow

1. Resolve audio in Rust using the maintained VisionOS profile.
2. Select an HTTPS Googlevideo audio URL, preferring Opus format 251, then AAC 140.
3. Check a small range request before declaring success or caching the URL.
4. Download directly with reqwest and feed the existing FFmpeg/audio pipeline.
5. Invoke yt-dlp only when direct resolution or download fails.

The first yt-dlp fallback uses its maintained default clients and User-Agent
selection. The existing final legacy-client resolution attempt remains available.

No additional runtime, cookies, token service, or dependency is needed for this
client update. This profile remains subject to YouTube changes, regional
availability, and session restrictions. A later authenticated/token-aware client
should be added only when live evidence shows it is needed.

## Sources

- [yt-dlp client profiles and Android VR retirement](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/youtube/_base.py)
- [yt-dlp default client selection](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/youtube/_video.py)
- [yt-dlp origin-token documentation](https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide)
- [NewPipe stream extractor](https://github.com/TeamNewPipe/NewPipeExtractor/blob/dev/extractor/src/main/java/org/schabi/newpipe/extractor/services/youtube/extractors/YoutubeStreamExtractor.java)
- [YouTube.js client profiles](https://github.com/LuanRT/YouTube.js/blob/main/src/utils/Constants.ts)

These are source observations, not live verification on the user's connection.

## Verification

Local regression tests cover audio selection, URL validation, request headers,
and rejection of HTTP errors, HTML, and empty audio responses. The retry-lifecycle
test exercises real child processes. The live test intentionally bypasses yt-dlp:

```powershell
$env:PROTOC = (Resolve-Path 'src-tauri/bin/bin/protoc.exe').Path
cargo test --manifest-path src-tauri/Cargo.toml direct_audio_live_three_tracks --lib -- --ignored --nocapture
```

It resolves and probes the three affected songs and requires format 251 or 140.
It does not establish full-track playback or DAC behavior. During this session,
automatic approval review could not authorize external network execution because
its service reported missing provider credentials, even after the user approved.

## Opus error at EOF (2026-09-15)

The latest log shows three completed downloads with matching feeder byte counts,
successful transcodes/cache writes, and no HTTP 403. Each transcode logs one
`Error parsing Opus packet header` immediately after EOF. One song still needs
yt-dlp after the direct player response returns `LOGIN_REQUIRED`.

FFmpeg 8.0.1 calls `set_frame_duration` on an empty flush buffer in the Opus
complete-frame parser. Upstream explicitly fixes this spurious EOF message in
[commit 618fc15](https://github.com/FFmpeg/FFmpeg/commit/618fc15e65f57c9ce25d4562f4b516129815608c).
The fix is present in tag `n8.1`; it is absent in `n8.0.1` and `n8.0.2`.
This matches the log pattern, but the installed binary and cached tracks have
not been tested locally because automatic approval review blocked access.

The FFmpeg build workflow now defaults to 8.1 and checks a generated one-second
Opus fixture through both file and pipe inputs. It requires identical decoded
output and empty error logs, since FFmpeg can return success with this bug.
Run the same check locally with:

```powershell
node scripts/check-ffmpeg-opus.mjs "$env:APPDATA\Aideo\ffmpeg.exe"
```

The workflow keeps build artifacts and defaults to no publication. Optional
publication creates a versioned release without deleting the old plugin asset.
Deployment remains pending: build and run the check, verify the actual cached
tracks, then update the FFmpeg URL, verified ZIP SHA-256, and plugin version in
`src-tauri/src/dependencies.rs` together. The installer remains on its existing
verified artifact until that build exists. No decoder errors are filtered out.
