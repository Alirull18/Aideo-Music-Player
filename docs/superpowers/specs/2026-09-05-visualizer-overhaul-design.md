# Design Specification: Aideo Studio Audio Visualizer Overhaul

**Date:** 2026-09-05  
**Status:** Approved  
**Target Subsystems:** `src/components/Visualizer.tsx`, `src/components/NowPlayingView.tsx`, `src/components/SettingsView.tsx`, `src/store/uiSlice.ts`, `src/store/types.ts`

---

## 1. Executive Summary & Product Objective
Aideo Music Player's current visualizer—located in the bottom-left column of the **Now Playing** view below the track artwork and metadata—is limited to a fixed 60px height and 3 rudimentary render modes (`baseline`, `circle`, `wave`). It abruptly blacks out when audio is paused and lacks user customization in the settings interface.

This overhaul upgrades the visualizer into a versatile **Studio Visualizer Engine** adhering to Aideo's "Dark Obsidian Studio" hardware aesthetic. It introduces:
1. **5 Hardware-Inspired Visual Styles**: Studio Peak-Decay Bars, Bilateral Mirror Spectrum, Analog Oscilloscope Silk Ribbon, Radial Halo Orbit, and Phosphor LED Dot-Matrix.
2. **Graceful Idle & Ballistic Physics**: Smooth exponential decay on pause transitioning to an ambient resting baseline, plus independent gravity-based floating peak indicators.
3. **Adaptive Canvas Container**: 64px compact default height with a subtle hover expander toggle to 140px for panoramic display.
4. **Dedicated Visualizer Settings**: User-configurable style selector chips, decay/smoothing response options, and persistent preferences integrated into `SettingsView.tsx` and Zustand `uiSlice`.

---

## 2. Subsystems & Component Architecture

### 2.1 Component & Store Changes
```text
src/
├── components/
│   ├── Visualizer.tsx             # Overhauled modular canvas engine (5 styles, peaks, idle decay)
│   ├── NowPlayingView.tsx         # Adaptive 64px/140px container + hover expand/collapse trigger
│   └── SettingsView.tsx          # New "Audio Visualizer" configuration section
├── store/
│   ├── types.ts                   # VisualizerMode, VisualizerDecayRate types in PlayerState
│   └── uiSlice.ts                 # visualizerMode, visualizerDecayRate, setVisualizerMode, setVisualizerDecayRate
└── test/
    ├── visualizer.test.ts         # Unit tests for visualizer modes, cycle logic, and settings persistence
    └── fullscreenShortcuts.test.ts# Updated cycle logic unit tests
```

### 2.2 Caller Compatibility
The existing `<Visualizer mode={...} />` interface is strictly preserved. Callers specifying an explicit `mode` prop ([FullscreenView.tsx](file:///C:/Users/Alirul/Aideo-Music-Player/src/components/FullscreenView.tsx), [StageLayout.tsx](file:///C:/Users/Alirul/Aideo-Music-Player/src/components/theater/StageLayout.tsx), [ZenLayout.tsx](file:///C:/Users/Alirul/Aideo-Music-Player/src/components/theater/ZenLayout.tsx)) continue to override internal settings, while unbounded callers ([NowPlayingView.tsx](file:///C:/Users/Alirul/Aideo-Music-Player/src/components/NowPlayingView.tsx)) bind to the global Zustand store preference.

---

## 3. Visual Modes & Rendering Specifications

All modes render directly to an HTML5 `<canvas>` with `window.devicePixelRatio` scaling and respect `lowSpecMode` (shadow blurs disabled to guarantee 60fps on low-tier hardware).

### 3.1 Mode Definitions (`VisualizerMode`)
```typescript
export type VisualizerMode = 
  | 'bars'         // Studio VU with floating peak-decay caps (formerly 'baseline')
  | 'mirror'       // Bilateral centered mirror spectrum
  | 'wave'         // Analog oscilloscope silk ribbon
  | 'circle'       // Radial halo orbit
  | 'dots';        // Phosphor LED dot-matrix
```

For backward compatibility with stored local preferences, `'baseline'` aliases to `'bars'`.

### 3.2 Detailed Mode Rendering

#### 1. Studio Peak-Decay Bars (`'bars'`)
* **Layout**: 64 vertical rounded bars evenly spaced across canvas width.
* **Colors**: Linear gradient from top `#ffffff` -> midpoint `accentColor` -> bottom `rgba(accentColor, 0.05)`.
* **Peak Indicator**: A 2px floating cap drawn 2-4px above each bar that holds peak level for 12 frames, then falls under quadratic gravity (`velocity += 0.15px/frame`). Cap color: accent-amber (`#fbbf24` / `oklch(0.78 0.16 68)`) or bright white.
* **Baseline**: 1px subtle line at `height - 1` with 0.3 opacity.

#### 2. Bilateral Mirror Spectrum (`'mirror'`)
* **Layout**: Bars radiate symmetrically from the horizontal center outward (low frequencies at center, high frequencies at left and right flanks), reflected vertically across the horizontal centerline.
* **Aesthetic**: Symmetrical stereo mastering console feel.
* **Colors**: Accent gradient fading outward to violet/cyan.

#### 3. Analog Oscilloscope Silk Ribbon (`'wave'`)
* **Layout**: Continuous smooth Bezier spline passing through frequency magnitude control points.
* **Fill & Stroke**: Dual layered curve: a solid 2.5px bright stroke with 12px shadow blur (`lowSpecMode` permitting), plus an area fill beneath the curve with 0.12 gradient opacity.
* **Oscillation**: Micro time factor (`Date.now() / 240`) for natural, analog hardware drift.

#### 4. Radial Halo Orbit (`'circle'`)
* **Layout**: Circular ring centered in canvas. Outer radius scales to `Math.min(width, height) * 0.42`.
* **Adapts to Container**: In compact mode (64px), automatically scales radius down cleanly with fewer radial spokes (32 bars); in expanded mode (140px), flourishes with full 64 spokes.
* **Stroke**: Rounded end-caps (`ctx.lineCap = 'round'`), dynamic gradient radiating outward.

#### 5. Phosphor LED Dot-Matrix (`'dots'`)
* **Layout**: 32 or 48 vertical columns, each consisting of stacked discrete circular or pill dots (spacing: 3px, dot radius: 2px).
* **Behavior**: Dots illuminate according to current band magnitude. The uppermost illuminated dot stays lit momentarily as a peak dot.
* **Aesthetic**: Vintage Japanese audiophile rack equipment (Pioneer/Technics fluorescent spectrum displays).

---

## 4. Physics, Idle State, & Color Reactivity

### 4.1 Idle State & Pause Decay
When `playbackStatus !== 'Playing'`:
* The visualizer does **not** instantly wipe to blank.
* Existing frequency values decay exponentially (`smoothedBands[i] *= 0.88`) toward 0 over ~200–300ms.
* Once bands reach `< 0.005`, an ambient resting state is rendered:
  * For linear modes (`bars`, `mirror`, `wave`, `dots`): A 1px horizontal baseline at low opacity (`alpha = 0.25`) with a gentle 0.05 breathing cycle.
  * For radial mode (`circle`): A minimalist concentric resting ring at 0.2 opacity.

### 4.2 Smoothing & Decay Settings
Three selectable response profiles:
* **Snappy**: Smoothing factor `0.35`, peak drop `0.25` (sharp, punchy response for electronic / drums).
* **Balanced** (Default): Smoothing factor `0.20`, peak drop `0.15` (natural studio response).
* **Silky**: Smoothing factor `0.10`, peak drop `0.08` (fluid, liquid visual transitions for ambient / classical).

---

## 5. Layout & Interaction in Now Playing View

### 5.1 Container Specifications ([NowPlayingView.tsx](file:///C:/Users/Alirul/Aideo-Music-Player/src/components/NowPlayingView.tsx))
* **Container Location**: Bottom of left column, under track artist metadata.
* **Height Transition**: CSS `transition: height 220ms cubic-bezier(0.16, 1, 0.3, 1)`.
  * Compact: `height: 64px`
  * Expanded: `height: 140px`
* **Interaction**:
  * **Clicking Canvas**: Cycles to the next visualizer mode: `bars` -> `mirror` -> `wave` -> `circle` -> `dots` -> `bars`, dispatches toast notification, updates Zustand store and `localStorage`.
  * **Hover Expander**: A subtle semi-transparent button in the top-right corner (`<Maximize2 size={12} />` / `<Minimize2 size={12} />`) toggles compact/expanded view with zero layout shifting to surrounding elements.

---

## 6. Settings Surface ([SettingsView.tsx](file:///C:/Users/Alirul/Aideo-Music-Player/src/components/SettingsView.tsx))

A dedicated **"Audio Visualizer"** section positioned under UI Preferences:
1. **Style Selection**: Segmented control / visual chip buttons for all 5 styles with descriptive labels and active indicator border in `accentColor`.
2. **Smoothing Profile**: Radio pill selector for `Snappy`, `Balanced`, and `Silky`.
3. **Default Height**: Toggle between `Compact (64px)` and `Expanded (140px)`.

---

## 7. State Management & Storage (`src/store/`)

### 7.1 Type Additions ([types.ts](file:///C:/Users/Alirul/Aideo-Music-Player/src/store/types.ts))
```typescript
export type VisualizerMode = 'bars' | 'mirror' | 'wave' | 'circle' | 'dots';
export type VisualizerDecayRate = 'snappy' | 'balanced' | 'silky';

export interface UISlice {
  // ... existing fields
  visualizerMode: VisualizerMode;
  visualizerDecayRate: VisualizerDecayRate;
  visualizerExpanded: boolean;
  setVisualizerMode: (mode: VisualizerMode) => void;
  setVisualizerDecayRate: (decay: VisualizerDecayRate) => void;
  setVisualizerExpanded: (expanded: boolean) => void;
}
```

### 7.2 Storage Keys
* `aideo_visualizer_mode`: `'bars' | 'mirror' | 'wave' | 'circle' | 'dots'` (with `'baseline'` migrated to `'bars'`).
* `aideo_visualizer_decay`: `'snappy' | 'balanced' | 'silky'`.
* `aideo_visualizer_expanded`: `'true' | 'false'`.

---

## 8. Testing & Verification Gate

1. **Unit Tests (`src/test/visualizer.test.ts`)**:
   - Verify mode cycle order: `bars` -> `mirror` -> `wave` -> `circle` -> `dots` -> `bars`.
   - Verify legacy migration from `'baseline'` to `'bars'`.
   - Verify decay rates map correctly to numerical smoothing lerp constants.
   - Verify storage sync when `setVisualizerMode` is invoked.
2. **Existing Test Safety**:
   - Update `src/test/fullscreenShortcuts.test.ts` to accommodate the expanded mode cycle while preserving shortcut contracts.
3. **Verification Commands**:
   - `npx tsc --noEmit`
   - `npx vitest run src/test/visualizer.test.ts`
   - `npx vitest run src/test/fullscreenShortcuts.test.ts`
   - `cargo check --quiet --manifest-path src-tauri/Cargo.toml`
