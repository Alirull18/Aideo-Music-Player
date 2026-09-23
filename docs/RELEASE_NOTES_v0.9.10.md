# 💎 Aideo Music Player v0.9.10 — Album Layout Architectures, Library Designs & Audio Engine Hardening

Welcome to **Aideo v0.9.10**! This milestone delivers major architectural upgrades across album and library browsing, user interactions, audio engine transition hardening, and visual design consistency.

> [!IMPORTANT]
> **Notice for v0.9.9 Users (One-Time Manual Install Required):**
> If you are upgrading from v0.9.9, please download and run the v0.9.10 installer (`.exe` or `.msi`) directly from GitHub Releases or via `winget upgrade Alirul.Aideo`. In v0.9.9, the embedded updater public key did not match the GitHub Actions signing keypair, causing signature verification to fail. v0.9.10 permanently aligns the embedded public key with our release signing keypair, so all subsequent updates (v0.9.10 and newer) will update automatically inside the app.

---

## 🌟 Highlights & Key Additions

### 💿 3 Distinct Album Layout Architectures (`src/components/AlbumsView.tsx`)
Replaced superficial card gimmicks with 3 complete, full-page album viewing experiences:

1. **Classic Wall (`classic`)**:
   - Fast, high-density virtualized 2D album grid designed for rapid collection scanning and instant 1-click playback.
2. **Compact Table (`compact`)**:
   - Dense, sortable master table with clickable column headers (**Album Title**, **Artist**, **Year**, **Tracks**, **Duration**).
   - In-place expandable accordion tracklists with full multi-disc support (Disc 1, Disc 2), active playing indicators (`Activity`), and quick queue controls (`ListPlus`).
3. **Editorial Magazine (`editorial`)**:
   - Visual storytelling experience featuring a dynamic Hero Spotlight album with backdrop glow, a sneak-peek tracklist, and curated horizontal shelves.

---

### 📚 6 Signature Library Layout Designs (`src/components/LibraryView.tsx`)
* **Classic**: Original balanced table and album grid layout.
* **Studio Pro**: Audiophile rack with compact 38px rows and high-res audio tech chips.
* **Editorial Archive**: Rich serif typography with liner notes and vinyl aesthetic.
* **Crate Digger**: Split-pane artist/album explorer with 42px rows.
* **Ambient Flow**: Fluid glass interface with floating pill capsules.
* **Industrial Brutalist**: Swiss typographic terminal with high-contrast amber and cyan accents.

---

### 🖱️ Universal Track Context Menu & Modal Portals (`src/components/TrackContextMenu.tsx`)
* **Unified Right-Click Control**:
  - Accessible across all views: Library, Albums, Playlists, Queue, Unified Search, and Now Playing.
  - Quick actions: **Play Next**, **Add to Queue**, **Add to Playlist**, **View Album**, **View Artist**, **Edit Tags**, **Copy Link**, **Show in File Explorer**, and **Switch Audio Source**.
* **Decoupled Portal Architecture**:
  - Context menus and modal dialogs render via React portals directly to the document root, eliminating CSS `overflow: hidden` clipping and z-index stacking issues.

---

### 📑 Dedicated Add-to-Playlist Modal (`src/components/AddToPlaylistModal.tsx`)
* One-click modal dialog to assign tracks to existing playlists or create new playlists on the fly without interrupting playback.

---

### ⚡ Audio Transition & Queue Reset Hardening
* **Zero Audio Bleed on Manual Track Selection (`src-tauri/src/player/mod.rs`, `src/store/librarySlice.ts`)**:
  - Eliminated the audio bleed where the previous song could briefly be heard when playing a track outside the queue. Immediate upfront pause dispatch and backend ringbuffer flush signal ensure completely silent, clean transitions.
* **Queue Algorithm Reset Safety (`src/test/queueAlgorithmReset.test.ts`)**:
  - Queue clearing and reshuffling algorithms hardened against orphaned playback state.
* **Locked DSP Test Suite (`src-tauri/src/player/dsp_tests.rs`)**:
  - Added `test_manual_track_play_clears_pending_and_flushes_ringbuffer` locking in buffer flush behavior.

---

### 🎨 Adaptive Appearance Colors in Home Feeds (`src/components/aideo/home.css`)
* **Horizon & Spatial Glass Theme Synchronization**:
  - Replaced hardcoded brand colors with dynamic CSS custom properties (`var(--accent)`, `var(--accent-rgb)`), ensuring home screen layouts faithfully follow the active album palette or Settings > Appearance accent color.

---

### 📊 Local Listening Insights V2 (`src/components/ListeningInsightsView.tsx`)
* Refined listening heatmaps, daily/weekly listening trends, peak listening hours, and skip-rate radar charts powered by local zero-telemetry database queries.

---

### 💀 High-Performance View Skeletons (`src/components/ViewSkeleton.tsx`)
* Shimmering placeholders across Library, Albums, and Insights views for zero perceived layout shift during initial load.

---

## 🧪 Verification & Quality Gate

| Verification Gate | Result | Notes |
|---|---|---|
| **Frontend TypeScript Typecheck** | `PASSED (0 errors)` | `npx tsc --noEmit` across all React 19 / TS components |
| **Frontend Unit & Integration Tests** | `PASSED (1,137/1,137)` | `npx vitest run src/test` across **115 test files** |
| **Backend Rust Check** | `PASSED (0 errors)` | `cargo check --quiet --manifest-path src-tauri/Cargo.toml` |
| **Backend Rust Test Suite** | `PASSED (319/321)` | `cargo test --quiet --manifest-path src-tauri/Cargo.toml` (319 passed, 2 ignored, 0 failed) |

---

## 📋 Detailed Commit History (v0.9.9 → v0.9.10)

* `feat(albums)`: implement 3 full-page album layout architectures (Classic Wall, Compact Table with Inline Accordion, Editorial Magazine)
* `feat(library)`: implement 6 signature Library designs (Classic, Studio Pro, Editorial Archive, Crate Digger, Ambient Flow, Industrial Brutalist)
* `feat(context-menu)`: add universal right-click `TrackContextMenu` portal across all views
* `feat(playlist)`: add interactive `AddToPlaylistModal` portal
* `feat(audio)`: eliminate track transition bleed when playing outside queue with immediate pause and ringbuffer flush
* `feat(home)`: synchronize Horizon and Spatial Glass layouts with dynamic `var(--accent)` appearance colors
* `feat(insights)`: overhaul `ListeningInsightsView` with heatmaps and skip analytics
* `feat(ui)`: add `ViewSkeleton` loading state placeholders for zero perceived layout shift
* `test`: add `albumDesigns.test.tsx`, `libraryDesign.test.ts`, `listeningInsights.test.tsx`, `queueAlgorithmReset.test.ts`, `trackContextMenu.test.tsx`, and `horizonAndSpatialLayouts.test.tsx`
* `chore`: bump version to v0.9.10 across `package.json`, `Cargo.toml`, `tauri.conf.json`, and documentation
