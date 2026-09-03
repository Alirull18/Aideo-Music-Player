# Legal, licensing, service-terms and lyric-provenance screen

**Snapshot:** `be94f376930cadd288b987183ee3486c6d36abbd`  
**Engineering verdict:** **HOLD RELEASE FOR COUNSEL AND COMPLIANCE PACKAGING**  
**Important:** this is an engineering risk screen, **not legal advice**.

## Repository inventory

**REPRODUCED:** tracked legal/provenance material consists of one root MIT `LICENSE`; no tracked `THIRD_PARTY_NOTICES`, `NOTICE`, codec-source offer or lyric-rights manifest was found.

Dependency metadata inventory:

- Cargo: 683 packages including root; all 682 third-party packages declared a license expression. Root `aideo` omits a Cargo `license` field despite the root MIT file.
- npm: 293 package entries including root; all 292 third-party entries declared a license. Root package metadata omits it.
- Notable Cargo obligations needing packaging review include 21 MPL-2.0 packages (primarily Symphonia), `chromaprint-next` marked `MIT AND LGPL-2.1-or-later`, and two `r-efi` versions offering permissive or LGPL alternatives.
- 22 full `.ttml` lyric fixtures are tracked, totalling 933,932 bytes, with numeric names and no provenance/license manifest.

License metadata is an inventory starting point, not proof that notices/source obligations or content rights are satisfied.

## FFmpeg

### AUD-LEG-01 — Static FFmpeg distribution lacks a demonstrated LGPL compliance bundle

**Severity:** P0 legal/release risk  
**Evidence:** REPRODUCED/EXTERNAL

The installed helper reported FFmpeg 8.0.1, LGPL 2.1-or-later, and a custom static/audio-only configuration with `--enable-static --disable-shared`; GPL/nonfree switches were not observed. Installed `ffmpeg.exe` audit SHA-256:

`24E10E3F5BC80DA7536974FB745400A98A338DB088E9E2BFA22B25A88BFE4AC2`

Static linking is not automatically forbidden, but it changes LGPL compliance work. FFmpeg's own legal page/checklist calls for prominent attribution/license information and a way for recipients to obtain the exact corresponding source/configuration; static combinations require particular care ([FFmpeg legal](https://ffmpeg.org/legal.html), [FFmpeg license](https://ffmpeg.org/doxygen/trunk/md_LICENSE.html)).

The app downloads this project-hosted binary, while the repository/distribution has no complete third-party notice or exact corresponding-source offer. Console `-L` output is not a user-facing compliance package.

The build workflow also clones an unpinned third-party build-recipe branch. The exact source/build chain for the published hash is not reproducibly tied to an immutable commit.

**Required:** archive exact FFmpeg source and build scripts/config, document patches, publish required source/relink material as counsel determines, bundle LGPL text and attribution, and pin the build chain.

## yt-dlp

### AUD-LEG-02 — README calls checksums “official cryptographic signatures”

**Severity:** P1 misleading security/compliance copy  
**Evidence:** STATIC-HIGH/EXTERNAL

`README.md:218` says helper tools are verified against official SHA-256 cryptographic signatures. The implementation fetches yt-dlp's `SHA2-256SUMS` and compares a hash (`dependencies.rs:61-70,173-174`); the FFmpeg ZIP uses a hardcoded SHA-256 (`188-194`). A checksum is not a digital signature and provides no separate identity when fetched from the same release trust domain.

### AUD-LEG-03 — Windows yt-dlp executable needs GPL/third-party distribution handling

**Severity:** P1 legal/release risk  
**Evidence:** EXTERNAL/STATIC-HIGH

yt-dlp's main source is Unlicense, but the project documents that official PyInstaller-bundled executables incorporate components under GPLv3+ and other third-party licenses; its repository supplies a third-party license file ([yt-dlp README](https://github.com/yt-dlp/yt-dlp/blob/master/README.md?plain=1), [yt-dlp license](https://github.com/yt-dlp/yt-dlp/blob/master/LICENSE), [yt-dlp third-party licenses](https://github.com/yt-dlp/yt-dlp/blob/master/THIRD_PARTY_LICENSES.txt)).

Aideo downloads/updates the executable for users. Counsel should determine distributor status and the exact notice/source-offer obligations; at minimum ship clear attribution, licenses and source links instead of treating it as an unmentioned plugin.

Installed yt-dlp audit version/hash were 2026.08.19 and:

`66674953FE251B89F4D08C5F0E35E0728679BD67AB3D7D05C0562AF101DD3E7A`

## Lyrics and content rights

### AUD-LEG-04 — Tracked full-song lyric fixtures have no demonstrated rights

**Severity:** P0 content-rights risk  
**Evidence:** REPRODUCED

The 22 `.ttml` files appear to be full timed lyric documents, not short synthetic parser snippets. Song lyrics are copyrighted content separate from parser/source-code licenses. No source, permission, licence, attribution or takedown record accompanies them.

Do not publish those files until rights are documented. Replace parser fixtures with authored synthetic text or minimal legally reviewed excerpts that still cover timing/namespace cases.

### AUD-LEG-05 — Provider/source-code licences do not license lyric corpus content

**Severity:** P0 legal risk  
**Evidence:** EXTERNAL/STATIC-HIGH

- LRCLIB's server source is MIT, but that software license does not grant rights to every lyric submitted/returned ([LRCLIB repository](https://github.com/tranxuanthang/lrclib)).
- Better Lyrics/Unison publishes source under AGPL and describes its corpus dump under ODbL with attribution/share-alike requirements and a separate commercial route ([Unison repository](https://github.com/better-lyrics/unison)). The exact API/corpus used by Aideo and required attribution are not documented.
- README attributes “Apple Music & community lyrics” and BiniLyrics/Better Lyrics (`README.md:121-123,236-237`) without a rights/terms matrix. Apple Music API access does not imply permission to scrape, store or redistribute full lyrics; provider approval must be documented ([Apple Music API](https://developer.apple.com/documentation/applemusicapi)).

Create a per-provider record: endpoint/data, account/app identity, terms version, storage/cache duration, display/attribution requirements, territory, commercial status, takedown route and counsel approval.

## Music-service terms

### AUD-LEG-06 — Tidal implementation lacks a demonstrated approved client/playback route

**Severity:** P0  
**Evidence:** STATIC-HIGH/EXTERNAL

The source embeds fallback credentials identified as Fire TV and requests full playback URLs directly. Tidal's developer terms constrain full-track playback and describe use of its official unmodified Player module/SDK ([Tidal Developer Terms](https://developer.tidal.com/documentation/guidelines/guidelines-developer-terms)). No Aideo client approval or exception was found.

Remove borrowed credentials and obtain written authorization before distribution.

### AUD-LEG-07 — Qobuz implementation scrapes application secrets

**Severity:** P0  
**Evidence:** STATIC-HIGH/EXTERNAL

The app extracts web-player application credentials/secrets and signs API requests. Qobuz terms call for a valid application ID/secret issued for the application, secrecy, attribution and non-certification wording ([Qobuz API Terms of Use](https://static.qobuz.com/apps/api/QobuzAPI-TermsofUse.pdf)). No Aideo-issued credential/approval was demonstrated.

Remove the scraper and use an approved integration or remove the feature.

## ASIO

### AUD-LEG-08 — ASIO licence/trademark route is unresolved

**Severity:** P0 before enabling ASIO  
**Evidence:** EXTERNAL/STATIC-HIGH

The optional CPAL ASIO backend requires the Steinberg SDK. Steinberg describes an open-source GPLv3 route and separate proprietary/trademark considerations ([Steinberg ASIO SDK licensing](https://www.steinberg.net/developers/asiosdk-open/)). The MIT-labelled project does not document which route it will use. Counsel must approve licensing, source-disclosure and product-name/trademark obligations before ASIO-enabled artifacts are built or advertised.

## Rust/npm package obligations

### AUD-LEG-09 — One MIT file is not an adequate third-party notice strategy

**Severity:** P1  
**Evidence:** REPRODUCED

Permissive dependencies often require copyright/license notice retention; MPL/LGPL components have additional file/source or linking-related conditions. The application currently offers no generated third-party attribution bundle. Package metadata should be resolved to actual licence texts, copyright notices, target-specific inclusion and linkage mode—not merely counted.

Special review points:

- verify whether and how `chromaprint-next`/native Chromaprint is linked and satisfy its `MIT AND LGPL-2.1-or-later` expression;
- retain MPL notices and corresponding source for any modified MPL-covered files;
- include font/icon/data licenses such as the npm CC-BY-4.0 entry where the asset ships;
- add explicit root `license` metadata to Cargo/npm only after confirming MIT accurately covers Aideo-owned code.

## Compliance gate before release

Counsel and release engineering should require one signed record containing:

1. complete SBOM for the exact binaries, including helper executables and native/static components;
2. generated third-party notices and license texts shown in the installer/app/distribution as required;
3. exact corresponding-source/build offer for FFmpeg and any other copyleft-linked component;
4. pinned reproducible hashes and provenance for helper binaries;
5. provider approvals and application credentials owned by Aideo for Tidal/Qobuz/lyrics;
6. removal or documented rights for all tracked lyric fixtures;
7. ASIO licensing/trademark decision before enabling or advertising it;
8. privacy/data-flow review for tokens, stream URLs, lyrics cache, LAN receivers and telemetry;
9. a takedown/contact process for lyric/content complaints;
10. product copy corrected so it does not imply provider certification, native DSD, bit-perfect output or cryptographic signatures without evidence.

Until those records exist, the engineering recommendation is to hold public distribution of the affected features/artifacts.

