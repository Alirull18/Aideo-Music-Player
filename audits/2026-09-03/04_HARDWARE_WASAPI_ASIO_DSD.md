# Hardware output audit — WASAPI, ASIO and DSD

**Snapshot:** `be94f376930cadd288b987183ee3486c6d36abbd`  
**Verdict:** **NO-GO / PHYSICAL OUTPUT UNVERIFIED**

This report does not claim that a device played sound. It separates registry/endpoint presence, buildability, static control flow and actual hardware playback.

## Audited machine inventory

### Windows audio

**REPRODUCED:** Windows reported these sound devices as OK:

- AMD High Definition Audio Device
- Realtek High Definition Audio

Endpoint inspection found:

- Speakers (Realtek(R) Audio): available/OK
- Microphone Array: available/OK, input only
- Headphones (FiiO KA5): registered but disconnected/unknown
- other Realtek/Baseus endpoints: disconnected/unknown

No tone, music fixture or bitstream was sent to any endpoint during this audit.

### ASIO registration

**REPRODUCED:** both 32-bit and 64-bit ASIO registry views contained:

- FiiO KA5 Audio Device
- Realtek ASIO

This proves driver registration only. It does not prove that CPAL can load the driver, negotiate a stream, survive callback load, or produce correct samples.

## WASAPI exclusive-mode findings

### AUD-HW-01 — Exclusive output was not physically validated

**Severity:** release-blocking evidence gap  
**Evidence:** UNTESTED

The custom backend negotiates formats and owns the endpoint on a dedicated thread, but no physical device was opened during the audit. There is no evidence for:

- every advertised sample rate/channel/valid-bit combination;
- actual exclusive ownership vs shared fallback;
- endpoint clock changes;
- event vs polling timing;
- underrun behavior under DPC/CPU pressure;
- pause releasing the endpoint and resume reacquiring it;
- hot-unplug/default-device changes; or
- digital output equality.

Microsoft states that an exclusive-mode application must use a format the endpoint supports; `IAudioClient::IsFormatSupported` is the negotiation authority, and exclusive streams bypass the system mixer ([Microsoft: exclusive-mode streams](https://learn.microsoft.com/en-us/windows/win32/coreaudio/exclusive-mode-streams), [Microsoft: IsFormatSupported](https://learn.microsoft.com/en-us/windows/win32/api/audioclient/nf-audioclient-iaudioclient-isformatsupported)). Code inspection cannot substitute for those device-specific responses.

### AUD-HW-02 — Initialization has no caller-side timeout

**Severity:** P1  
**Evidence:** STATIC-RISK

`start_exclusive_stream` spawns the hardware thread and blocks on `rx.recv()` (`wasapi_engine.rs:109-130,636`). A stuck COM/driver operation can hang playback indefinitely. A timeout must cancel and reap the initialization worker rather than merely returning.

### AUD-HW-03 — Negotiation success is reported before `start_stream`

**Severity:** P1  
**Evidence:** STATIC-HIGH

The worker pre-fills silence, sends `Ok(bits, format, rate)` and only later starts hardware when the playing-state loop runs (`wasapi_engine.rs:404-425,437-469`). A driver can therefore fail after the caller has accepted the stream and updated UI telemetry.

### AUD-HW-04 — Drop can synchronously block for driver/event latency

**Severity:** P1  
**Evidence:** STATIC-HIGH

`WasapiStream::drop` joins the worker (`wasapi_engine.rs:18-23`). The worker may wait up to two seconds for an event (`508-513`) or be blocked inside the driver. Stop, restart and incompatible-track transitions can stall the player thread.

### AUD-HW-05 — Output selection is not source-word-length preservation

**Severity:** P0 for bit-perfect claim  
**Evidence:** STATIC-HIGH

The format selector probes supported formats and may prefer floating-point or wider integer formats; the decoder has already converted samples to `f32`. The application does not carry source valid-bit depth through to a byte-transparent render buffer. Gain ramps and prefills further alter boundaries. “WASAPI exclusive” may be accurate after a successful start; “bit-perfect” is not established by selecting exclusive mode.

### AUD-HW-06 — Fuzzy device matching can target the wrong endpoint

**Severity:** P1  
**Evidence:** STATIC-RISK

After exact matching, device selection tokenizes names and ignores generic words (`player/mod.rs` around `3930-3997`). Similar products/endpoints can resolve to the first model-token match. Persist a stable endpoint ID where the backend allows it and report the resolved ID/name back to the UI.

## ASIO findings

### AUD-HW-07 — Shipping CI/release does not build ASIO

**Severity:** P0 for advertised ASIO  
**Evidence:** REPRODUCED/STATIC-HIGH

`src-tauri/Cargo.toml` declares `default = []` and `asio = ["cpal/asio"]`. Both `.github/workflows/check.yml` and `.github/workflows/publish.yml` run Cargo/Tauri without `--features asio`; the publish matrix has empty args. Consequently the normal release binary compiles out ASIO host enumeration and startup guarded by `#[cfg(feature = "asio")]` (`lib.rs:1094-1113,3682-3697`; `player/mod.rs:3917-3923`).

The frontend still contains ASIO selectors and `ASIO Bit-Perfect` labels. In a default release, selecting an `[ASIO]`-prefixed value falls back to the default host in the non-feature branch. Status derives `driver_type` from the name prefix, so it can report ASIO without an ASIO host.

### AUD-HW-08 — Optional ASIO build failed in the audited environment

**Severity:** P0 build/reproducibility gap  
**Evidence:** REPRODUCED

Command:

```text
cargo check --manifest-path src-tauri/Cargo.toml --features asio
```

Result: failed while building `asio-sys v0.2.6`; the build script used an SDK location but MSVC could not find `asiodrivers.h`. `CPAL_ASIO_DIR` and `LIBCLANG_PATH` were unset and no usable Clang/LLVM executable was found in the audit shell.

CPAL documents ASIO as an optional backend requiring the Steinberg ASIO SDK and LLVM/Clang setup ([RustAudio CPAL](https://github.com/RustAudio/cpal)). The repository does not provide a reproducible, licensed ASIO setup or a feature-enabled CI/release job.

### AUD-HW-09 — ASIO SDK licensing route is undocumented

**Severity:** legal/release hold  
**Evidence:** EXTERNAL/STATIC-HIGH

Steinberg offers an open-source ASIO SDK route under GPLv3 and separately discusses proprietary licensing/trademark conditions ([Steinberg ASIO SDK licensing](https://www.steinberg.net/developers/asiosdk-open/)). The project is MIT-labelled and does not document which ASIO SDK license path applies, how obligations are met, or whether an ASIO trademark license is needed for product copy.

This report does not declare a legal conclusion. Counsel must approve the chosen SDK/distribution route before enabling ASIO in a binary.

## DSD findings

### AUD-HW-10 — Neither native DSD nor DoP exists in the output path

**Severity:** P0  
**Evidence:** STATIC-HIGH

DSF/DFF are decoded by FFmpeg into ordinary PCM. Highest-quality mapping is 24-bit PCM at 176.4 kHz (`player/mod.rs:1119-1129,1304-1312`). The output engines accept `f32` PCM and quantize PCM formats; no native DSD device format, ASIO DSD extension, DoP marker construction or DSD capability negotiation exists.

DoP uses defined marker bytes and DSD payload placement inside PCM-looking frames; merely outputting PCM at 176.4 kHz is not DoP ([DoP open standard 1.1](https://dsd-guide.com/sites/default/files/white-papers/DoP_openStandard_1v1.pdf)).

The `DSD NATIVE` UI label must be removed or replaced with an honest `DSD → PCM 176.4 kHz`-style status immediately.

## Required physical matrix

Before any hardware claim is signed off, record device/driver/firmware and raw evidence for:

| Area | Minimum cases | Evidence to retain |
|---|---|---|
| WASAPI shared | 44.1/48/96/192 kHz; 16/24/32/float where supported | negotiated mix format, callback logs, captured output |
| WASAPI exclusive | same-rate native, unsupported rate, contention, pause/resume, hot-unplug | HRESULTs, exact negotiated format, device indicator/capture |
| Bit-perfect | PCM16 and PCM24 known patterns at unity | source/capture hashes or bitwise comparison |
| ASIO | each registered real driver; buffer sizes; sample-rate switch; device loss | feature-enabled signed build, driver panel/log, recorded output |
| DSD | DSD64/128 for each claimed native/DoP route | DAC DSD indicator plus captured native/DoP framing |
| Gapless | same-format album pairs and incompatible-rate transitions | sample-level transition capture, inserted/dropped frame count |
| Stress | CPU load, DPC latency, sleep/wake, default-device change | underrun counters and audible/captured discontinuities |

Until this matrix passes, hardware badges must report only verified runtime facts such as selected endpoint and negotiated PCM rate—not aspirational mode names.

