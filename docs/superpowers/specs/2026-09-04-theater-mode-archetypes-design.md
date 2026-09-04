# Design Spec: Theater & Fullscreen Mode 6 Visual Archetypes & Appearance Settings

## 1. Overview
This specification details the overhaul of the Theater / Fullscreen Mode ([FullscreenView.tsx](file:///C:/Users/Alirul/Aideo-Music-Player/src/components/FullscreenView.tsx)) in Aideo Music Player. The current two-mode system (`stage` and `zen`) is expanded into **six craft-heavy, distinctive visual archetypes** engineered with strict anti-slop principles. Furthermore, default layout selection is brought into [SettingsView.tsx](file:///C:/Users/Alirul/Aideo-Music-Player/src/components/SettingsView.tsx) under the **Appearance** tab, while remaining dynamically switchable inside the Theater HUD.

---

## 2. Archetype Specifications

### 2.1 Stage Mode (`stage`)
* **Concept**: Modern classic presentation.
* **Layout**: Balanced 2-column grid. Left side hosts prominent artwork (respecting `albumArtFit` contain/cover) with subtle ambient aura, track meta, and audio format badge. Right side hosts the synced scrolling lyrics panel with word-by-word karaoke wipe.
* **Anti-Slop Safeguards**: Clean border-radius (max 16px on container, 20px on cover), verified contrast for secondary text, smooth exponential easing transitions, zero gradient text.

### 2.2 Zen Mode (`zen`)
* **Concept**: Distraction-free typography and deep listening.
* **Layout**: Centered, large-scale lyric typography with generous vertical pacing. Floating minimal artwork thumbnail in the corner that dims during playback. Ambient audio-reactive backdrop tuned to low opacity.
* **Anti-Slop Safeguards**: Pure typographic discipline. No decorative glass cards. Generous whitespace with balanced line wraps (`text-wrap: balance`).

### 2.3 Hi-Fi Studio Deck (`studio`)
* **Concept**: Vintage analog studio mastering deck.
* **Visual Components**:
  * **Dual Ballistic Needle VU Meters**: Stereo (L / R) analog meters rendered on `<canvas>`.
    * Realistic ballistic physics: ~300ms rise time, ~1.2% spring overshoot, logarithmic damping decay.
    * Driven by low/mid/high frequency bands from the Tauri `audio-spectrum` event.
    * Calibrated logarithmic scale from -20dB to +3dB with amber-to-red peak overload indicators.
  * **Chassis & Hardware Aesthetic**: Dark anodized slate chassis, brushed metal bezels, authentic silkscreen markings.
  * **Signal Path Telemetry Display**: Real-time sample rate (e.g. `96.0 kHz`), bit depth (`24-bit`), codec badge (`FLAC / DSD`), and output driver mode (`ASIO BIT-PERFECT` / `WASAPI EXCLUSIVE`).
  * **Vector Oscilloscope / Audio Spectrum**: Real-time phosphor-green / amber oscilloscope vector display tracking audio waveform.
  * **Compact Floating Lyrics Ticker**: Minimal active-line lyric ticker positioned below the meters.

### 2.4 Vinyl Turntable (`vinyl`)
* **Concept**: Tactile mechanical turntable with realistic materials.
* **Visual Components**:
  * **12-Inch Vinyl Record**: Concentric groove micro-refraction rendered with anisotropic specular sheen; authentic center label sticker featuring album art and spindle hole.
  * **Physical Rotation Mechanics**: Smooth 33⅓ RPM rotation tied directly to `playbackStatus === 'Playing'`. Clean deceleration when paused.
  * **Reactive Mechanical Tonearm**: Pivot base with metallic arm and cartridge. The tonearm angle moves dynamically across the vinyl surface from outer edge to lead-out groove proportional to `playbackPositionSecs / duration`.
  * **Propped Album Jacket**: Album cover displayed leaning beside the platter at a subtle perspective angle with cardboard spine depth and edge highlights.
  * **Active Lyric Ticker**: Subtle, non-intrusive 2-line lyric display beneath the turntable base.

### 2.5 Editorial Poster (`poster`)
* **Concept**: Swiss typographic music editorial broadsheet.
* **Visual Components**:
  * **Asymmetric Editorial Layout**: Large, expressive display typography for track and artist (`clamp(2rem, 5vw, 4.5rem)`), obeying tight tracking limits (`letter-spacing >= -0.04em`).
  * **Duotone / Solid Ink Color Discipline**: Background and ink derived from the cover art dominant palette. Zero gradient text; high contrast ink-on-surface.
  * **Liner Notes & Metadata Column**: Track number, album, release year, bitrate, publisher/credits, and full synced lyric text set in elegant editorial columns.

### 2.6 Pure Immersion Scope (`scope`)
* **Concept**: Full-bleed audio reactive visualizer theater.
* **Visual Components**:
  * **High-Density Vector Scope / Particle Field**: Silky 60fps `<canvas>` visualization reacting to the 64 FFT bands with organic fluid motion.
  * **Ethereal Overlay**: Center-bottom floating translucent typography with track title and current karaoke lyric line, gracefully auto-fading to 20% opacity during playback to prioritize visual immersion.

---

## 3. Architecture & State Management

### 3.1 Store Slice ([src/store/types.ts](file:///C:/Users/Alirul/Aideo-Music-Player/src/store/types.ts) & [src/store/uiSlice.ts](file:///C:/Users/Alirul/Aideo-Music-Player/src/store/uiSlice.ts))
* Type definition:
  ```typescript
  export type TheaterModeDesign = 'stage' | 'zen' | 'studio' | 'vinyl' | 'poster' | 'scope';
  ```
* State additions to `UIState`:
  * `theaterModeDesign: TheaterModeDesign` (defaults to `'stage'`).
  * `setTheaterModeDesign: (design: TheaterModeDesign) => void`.
* Persistence:
  * Synced to `localStorage.getItem('aideo-theater-design')`.
  * Backwards compatible: any legacy `'stage' | 'zen'` value maps directly to the new union.

### 3.2 Component Directory Structure (`src/components/theater/`)
To keep [FullscreenView.tsx](file:///C:/Users/Alirul/Aideo-Music-Player/src/components/FullscreenView.tsx) maintainable and adhere to surgical isolation:
```
src/components/theater/
├── StageLayout.tsx          # 2-column modern standard
├── ZenLayout.tsx            # Centered typography minimalist
├── StudioDeckLayout.tsx     # Ballistic VU meters, oscilloscope, signal path
├── VinylTurntableLayout.tsx # Spinning vinyl, animated tonearm, propped jacket
├── EditorialPosterLayout.tsx# Swiss asymmetric typography, liner notes
├── PureScopeLayout.tsx      # Full-bleed 60fps audio reactive particle scope
└── TheaterLayoutSwitch.tsx  # Layout resolver with AnimatePresence
```

### 3.3 FullscreenView Orchestrator
[FullscreenView.tsx](file:///C:/Users/Alirul/Aideo-Music-Player/src/components/FullscreenView.tsx) retains control over:
* Tauri borderless / native fullscreen window invoke.
* Keyboard hotkeys (`Space`, `Esc`, `ArrowLeft/Right`, `ArrowUp/Down`, `F`, `M`, `L` for cycling layout, `V` for visualizer mode).
* Activity detection (3.5s inactivity timer for hiding the HUD).
* Bottom Playback HUD (waveform seekbar, volume, transport buttons, utility popovers).
* Audio spectrum listener passed down or consumed by layout sub-components.

---

## 4. Settings View Integration

* **Location**: [SettingsView.tsx](file:///C:/Users/Alirul/Aideo-Music-Player/src/components/SettingsView.tsx) inside `activeTab === 'appearance'`.
* **Setting Card**:
  * Title: **Theater & Fullscreen Style**
  * Description: *Select the visual persona and layout for Theater Fullscreen mode.*
  * Grid: 6 cards (`repeat(auto-fit, minmax(260px, 1fr))`), each displaying:
    * Custom SVG icon representing the archetype (Microphone/Lyrics, Align-Center, Gauge/VU, Disc/Vinyl, Newspaper/Poster, Activity/Scope).
    * Archetype name and badge (`STAGE`, `ZEN`, `STUDIO DECK`, `VINYL`, `EDITORIAL`, `PURE SCOPE`).
    * 1-sentence descriptor.
    * Selected state highlight matching `var(--accent)`.

---

## 5. In-Theater HUD Integration

* The current HUD layout button in [FullscreenView.tsx](file:///C:/Users/Alirul/Aideo-Music-Player/src/components/FullscreenView.tsx) is upgraded:
  * Displays current archetype name and icon.
  * Clicking cycles through the 6 archetypes sequentially:
    `stage` → `zen` → `studio` → `vinyl` → `poster` → `scope` → `stage`.
  * Right-clicking or hovering opens a floating popup pill allowing instant direct selection of any of the 6 archetypes without leaving fullscreen.
  * Pressing keyboard shortcut `L` cycles to the next archetype with a crisp HUD toast.

---

## 6. Verification & Quality Gates

1. **TypeScript Typecheck**:
   `npx tsc --noEmit` must pass with 0 errors.
2. **Unit Tests**:
   - `src/test/theaterModeDesigns.test.ts`: Test store persistence, state update, default fallbacks, and layout cycling order.
   - `npx vitest run src/test` must pass.
3. **Rust Checks**:
   - `cargo check --quiet --manifest-path src-tauri/Cargo.toml`
   - `cargo test --quiet --manifest-path src-tauri/Cargo.toml`
4. **Visual & Performance**:
   - 60fps smooth animation on Canvas (VU meters, turntable, oscilloscope, particle scope).
   - Clean teardown of `requestAnimationFrame` and canvas event listeners on unmount.
   - Reduced-motion mode fallback (`prefers-reduced-motion`).
