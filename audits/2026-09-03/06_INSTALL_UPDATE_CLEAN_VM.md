# Install, signing, updater and clean-VM audit

**Source snapshot:** `be94f376930cadd288b987183ee3486c6d36abbd` (app version 0.9.7)  
**Live public release observed:** v0.9.6, published 2026-08-23  
**Verdict:** **NO-GO**  
**Clean-VM cycle:** **NOT PERFORMED**

## Public artifact evidence

The live [v0.9.6 GitHub release](https://github.com/Alirull18/Aideo-Music-Player/releases/tag/v0.9.6) exposed only two assets at audit time:

| Asset | Bytes | Audit SHA-256 | Authenticode |
|---|---:|---|---|
| `Aideo_0.9.6_x64-setup.exe` | 6,936,512 | `2834FB88BB3C61F67A63E34F66E1853DBDDA6CF6CEDACC9477223614542846A5` | **NotSigned** |
| `Aideo_0.9.6_x64_en-US.msi` | 9,342,976 | `D528B9DE5F7E4EB64950D9263F7138442C24A895D5818EBD471118659F2CB8EB` | **NotSigned** |

**REPRODUCED:** the files were downloaded into an isolated temporary directory, hashed, checked with Windows Authenticode APIs, not executed, and deleted. The release had no `.sha256` or `.sig` asset.

The locally installed `%LOCALAPPDATA%\Aideo\aideo.exe` and `uninstall.exe` also reported **NotSigned**. This does not prove the current source creates the same installed binary; it proves the audited installation is unsigned.

## Findings

### AUD-UPD-01 — Public Windows packages lack publisher authentication

**Severity:** P0  
**Evidence:** REPRODUCED/EXTERNAL

A SHA-256 computed by the auditor detects accidental/change-after-download differences only when compared to a separately trusted value. Authenticode establishes publisher identity and signed-file integrity. Current public installers have neither a Windows publisher signature nor a published checksum/signature sidecar.

Microsoft notes that reputation-based SmartScreen decisions incorporate application/download reputation and publisher signing; unsigned low-reputation binaries commonly receive stronger warnings ([Microsoft SmartScreen reputation](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)). Tauri separately documents Windows code signing for distributable bundles ([Tauri Windows signing](https://v2.tauri.app/distribute/sign/windows/)).

### AUD-UPD-02 — The custom updater cannot install the current public release

**Severity:** P0  
**Evidence:** STATIC-HIGH + live release inspection

`updater.rs::check_update` chooses the first `.exe`/`.msi` and looks for any `.sha256` **or** `.sig` asset (`updater.rs:79-100`). `download_and_install` then requires a 64-character SHA-256 token and aborts if it is absent (`154-156,203-220`).

The v0.9.6 release has no sidecar, so a client can discover it but cannot pass mandatory validation.

If a future release provides only a Tauri `.sig`, this code selects it and attempts to parse the signature as a SHA-256 string, which also fails. Installer and sidecar are not paired by basename, so multiple platform assets could be mismatched.

### AUD-UPD-03 — Hash and installer come from the same replaceable trust domain

**Severity:** P1  
**Evidence:** STATIC-HIGH

Even when a `.sha256` exists, both binary and expected hash are downloaded from the same GitHub release controlled by the same account/token. A release compromise can replace both. This is useful transport/integrity checking, not independent publisher authentication.

Tauri's official updater verifies signatures with a public key embedded in the application and states that signature verification cannot be disabled ([Tauri updater documentation](https://v2.tauri.app/plugin/updater/)). The audited `tauri.conf.json` contains no updater plugin/public key/create-updater-artifacts configuration, and no updater plugin dependency was found.

### AUD-UPD-04 — Signing secrets in CI do not prove Authenticode or updater verification

**Severity:** P0 evidence gap  
**Evidence:** STATIC-HIGH

`publish.yml` exports `TAURI_SIGNING_PRIVATE_KEY` variables, but the application has no corresponding official updater configuration/artifact generation. Tauri updater signing keys are not Windows Authenticode certificates. The actual public EXE/MSI checks are definitive: they are unsigned.

### AUD-UPD-05 — Installer launch is treated as success before installation succeeds

**Severity:** P1  
**Evidence:** STATIC-HIGH

After spawning `msiexec` or the EXE as a detached process, the app immediately exits (`updater.rs:159-200`). It does not wait for exit status, verify the installed version, preserve/restore state, detect cancellation, or roll back a failed upgrade.

### AUD-UPD-06 — Stale, disconnected updater metadata remains in the repository

**Severity:** P2  
**Evidence:** REPRODUCED

Root `updater.json` describes version 0.8.9 and includes an old signature/platform URL, while the source version is 0.9.7 and the custom updater queries GitHub directly. No active config references this manifest. It is confusing release debris and should either become the single generated source of truth or be removed in a separately reviewed cleanup.

### AUD-UPD-07 — Release supply chain is not reproducibly pinned

**Severity:** P1  
**Evidence:** STATIC-HIGH

CI/publish actions largely use mutable major tags (`@v4`, `@stable`, `@v0`, etc.) rather than immutable commit SHAs. The FFmpeg workflow clones the default branch of `xihan123/FFmpeg-Audio` with `--depth 1` and does not pin the clone to an audited commit before executing its build script (`.github/workflows/build-ffmpeg-dsd.yml:53-55`). An input named FFmpeg version does not pin that build-recipe repository.

### AUD-UPD-08 — Tag publishing is not demonstrably gated by the main CI workflow

**Severity:** P1  
**Evidence:** STATIC-HIGH

The check workflow triggers on pushes/PRs to `main`; publish triggers directly on `v*` tags and does not depend on a successful check job. It also builds default Cargo features, so advertised ASIO is absent. Protect release environments/tags and make publish call a reusable, immutable verification workflow.

## What was not tested

No clean Windows VM or snapshot facility was available. Therefore none of the following passed:

- first install as standard user and administrator;
- SmartScreen/UAC presentation with a trusted certificate;
- file/protocol associations and deep link;
- WebView2/runtimes/prerequisites on a genuinely clean image;
- upgrade from each supported prior version;
- settings/database/cache preservation;
- installer cancellation, disk-full, locked-file, network-loss and power-loss recovery;
- downgrade blocking;
- uninstall completeness and user-data retention choice;
- official updater signature validation;
- rollback after failed install.

“Not tested” must not be converted into a release pass.

## Required signed-release gate

1. Pin all workflow actions/build sources to reviewed immutable revisions.
2. Build from a protected tag whose commit passed the full frontend/Rust gate and the selected feature matrix.
3. Authenticode-sign EXE, MSI, installed executable and uninstaller with a trusted certificate and timestamp.
4. Use one updater design. For Tauri updater, embed the public key and generate signed updater artifacts; do not parse `.sig` as SHA-256.
5. Publish checksums plus updater signatures with deterministic basename/platform pairing.
6. Independently download every published asset and verify hash, Authenticode chain/timestamp, updater signature, version metadata and malware scan.
7. Run the clean-VM matrix above on supported Windows versions, retaining screenshots/logs and installer exit codes.
8. Make the app wait for/observe installer outcome or use a transactional updater with rollback semantics.

