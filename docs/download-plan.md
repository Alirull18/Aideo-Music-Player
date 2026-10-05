# Track downloads

## Agreed behavior

Every track menu opens a download chooser. Known copies appear immediately while connected providers are searched. Confident matches and possible matches are separated, with source metadata visible. Download selection never changes playback preferences.

Users choose a source and one of its verified available qualities, then a remembered destination folder. Filename collisions offer Keep both, Replace, or Cancel. A replacement preserves the original until the new file is complete. No source or quality fallback is automatic.

Downloads run in the background. The Downloaded view and an in-app notification show the same job, percentage (or indeterminate progress and bytes), and Cancel action. Success follows finalization and library import. Failures offer Retry or Choose another copy. Cancellation removes partial output and preserves existing files.

## Execution

1. Reuse provider resolvers with strict format requests; discover downloadable quality options. Add backend jobs, cancellation, progress, destination validation, and safe finalization.
2. Add a global download chooser and shared progress UI. Wire existing track menus and retain playback choices independently.
3. Import completed files and retain downloaded paths for custom-folder filtering in Downloaded. Keep cache management separate from exported files.
4. Test file preservation/cancellation, exact format resolution, matching, chooser state, and shared job progress. Run TypeScript, all frontend tests, cargo check, cargo test, and scoped diff checks.

## Scope

Uses installed dependencies and existing provider credentials. No transcoding, automatic fallback, playlist batch redesign, or Windows notifications. Job records persist in SQLite; interrupted direct transfers can resume when the source provides a strong rendition validator and consistent byte ranges. Live provider and account access remains necessary to verify external downloads end to end.

## Outcome

Implemented the chooser, strict format requests, remembered folder, collision choices, background jobs, shared notification/Downloaded progress, cancellation, retry, and persistent library import. New menus support right-click and Shift+F10. Partial files end in `.part` so library scans ignore them; audio headers are checked before final replacement. Encrypted or segmented Tidal copies are excluded from direct export.

Verification on 2026-10-01: TypeScript passed; 117 frontend test files / 1,230 tests passed; cargo check passed; Rust tests passed (363 passed, 5 ignored). The full Rust suite required a rerun outside the sandbox because three existing playlist tests could not overwrite their temporary files. Download-specific coverage includes 14 frontend tests and 7 backend tests, plus provider quality/manifest tests. Scoped Git whitespace checks passed.

UI refinement: explicitly centered the dialog, grouped source selection beside quality/destination controls, and kept the footer visible while the body scrolls. The compact bottom-right notification shows one download, offers minimize/expand and View all, and hides on Downloaded. Browser fixture checks confirmed centering at 1280 × 800 and 400 × 700, a scrollable narrow layout without horizontal overflow, and light-theme colors.

Authenticated downloads from real YouTube, Tidal, and Qobuz accounts have not been verified end to end. Existing ignored live/hardware tests remain ignored.

## Restart recovery and direct-transfer resume (2 October 2026)

Versioned SQLite records preserve source IDs, selected quality, collision choice, destination, revision and transfer validators. Provider URLs, headers, account credentials, cover URLs and raw provider failures are excluded. Restart rechecks files and exposes interrupted jobs with Retry and Discard; no transport starts automatically. Every saved or completed output is checked against its persisted SHA-256 before being trusted. A replaced or missing destination becomes recoverable; it is not imported as the old source. An output matching the pre-commit fingerprint can finish library import after restart. Stable job IDs and the import ledger preserve idempotency.

Retry resolves fresh provider URLs for the same source and selected quality. A strong ETag and known total permit Range/If-Range requests at the actual partial-file length. Append requires a matching 206, exact Content-Range bounds/total, matching validator and content length, and no encoded transfer. Ignored ranges and incompatible responses restart the owned partial from zero. A 416 can finalize only a complete partial with matching validator/total and valid audio profile. Authentication failures expose reconnect guidance. Segmented/encrypted transfers remain unsupported.

Cancellation removes owned partials; cleanup errors remain visible. Discard removes the recovery record and its owned sibling partial, never the destination. A replacement keeps the original until full transfer/header/quality validation and atomic file commit. Active jobs hold the library-maintenance gate through transfer and import.

Local HTTP/crash/SQLite fixtures and frontend recovery controls are covered by regression tests. Live provider exports and process-kill exercises in the installed app still require separate verification; local fixtures do not establish provider support.
