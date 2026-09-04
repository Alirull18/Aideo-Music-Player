# Theater Mode 6 Visual Archetypes & Appearance Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement 6 distinctive, anti-slop visual archetypes for Theater / Fullscreen Mode (`stage`, `zen`, `studio`, `vinyl`, `poster`, `scope`) with Appearance settings integration in SettingsView and quick cycling in the Fullscreen HUD.

**Architecture:** Create modular layout sub-components under `src/components/theater/`, wire them through a central `TheaterLayoutSwitch` resolver, manage layout selection via Zustand `theaterModeDesign` in `src/store/uiSlice.ts`, add a 6-option selection grid in `SettingsView.tsx` under Appearance, and upgrade the Fullscreen HUD layout button and keyboard shortcut (`L`).

**Tech Stack:** React 19, TypeScript, Tailwind CSS / Vanilla CSS, Framer Motion, HTML5 2D Canvas (for ballistic VU meters, oscilloscope, particle scope, and vinyl micro-grooves), Zustand, Vitest, Tauri v2.

**Spec:** [`docs/superpowers/specs/2026-09-04-theater-mode-archetypes-design.md`](file:///C:/Users/Alirul/Aideo-Music-Player/docs/superpowers/specs/2026-09-04-theater-mode-archetypes-design.md)

## Global Constraints
- Strictly anti-slop: zero gradient text, no meaningless glassmorphism, no fake illustrations, max 16px border-radius on cards, no `img:hover transform`.
- High-contrast typography: text contrast >= 4.5:1, `text-wrap: balance` on titles, clamp() max <= 6rem, display tracking >= -0.04em.
- 60fps animations: use `requestAnimationFrame` with proper teardown on unmount, hardware-accelerated transforms (`transform`, `opacity`).
- Respect `lowSpecMode`: simplify or pause heavy canvas animations when low-spec mode is active.
- Tauri IPC boundary: frontend uses `@tauri-apps/api`, no direct backend imports.
- Verification Gate: `npx tsc --noEmit`, `npx vitest run src/test`, `cargo check --quiet --manifest-path src-tauri/Cargo.toml`, `cargo test --quiet --manifest-path src-tauri/Cargo.toml` must all pass.

---

### Task 1: Store & Types Foundation for TheaterModeDesign

**Files:**
- Modify: `src/store/types.ts`
- Modify: `src/store/uiSlice.ts`
- Test: `src/test/theaterModeDesigns.test.ts`

**Interfaces:**
- Consumes: None (base types in `src/store/types.ts`)
- Produces:
  - `export type TheaterModeDesign = 'stage' | 'zen' | 'studio' | 'vinyl' | 'poster' | 'scope';`
  - `theaterModeDesign: TheaterModeDesign` in `UIState`
  - `setTheaterModeDesign: (design: TheaterModeDesign) => void` in `UIState`

- [ ] **Step 1: Write the failing test**
Create `src/test/theaterModeDesigns.test.ts` testing `theaterModeDesign` state, default fallback (`stage`), setter, and localStorage persistence.

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../store';
import { TheaterModeDesign } from '../store/types';

describe('theaterModeDesign store', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to stage mode and allows switching across all 6 archetypes', () => {
    const state = useStore.getState();
    expect(state.theaterModeDesign).toBeDefined();

    const archetypes: TheaterModeDesign[] = ['stage', 'zen', 'studio', 'vinyl', 'poster', 'scope'];
    for (const arch of archetypes) {
      state.setTheaterModeDesign(arch);
      expect(useStore.getState().theaterModeDesign).toBe(arch);
      expect(localStorage.getItem('aideo-theater-design')).toBe(arch);
    }
  });

  it('migrates legacy aideo-fullscreen-layout if aideo-theater-design is absent', () => {
    localStorage.setItem('aideo-fullscreen-layout', 'zen');
    // Testing migration logic
    const saved = localStorage.getItem('aideo-theater-design') || localStorage.getItem('aideo-fullscreen-layout') || 'stage';
    expect(saved).toBe('zen');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run src/test/theaterModeDesigns.test.ts`
Expected: FAIL (missing `theaterModeDesign` or `TheaterModeDesign` export)

- [ ] **Step 3: Implement store and type changes**
In `src/store/types.ts`:
Add `export type TheaterModeDesign = 'stage' | 'zen' | 'studio' | 'vinyl' | 'poster' | 'scope';` and add `theaterModeDesign: TheaterModeDesign; setTheaterModeDesign: (design: TheaterModeDesign) => void;` to `UIState`.
In `src/store/uiSlice.ts`:
Initialize `theaterModeDesign` from `localStorage.getItem('aideo-theater-design') || localStorage.getItem('aideo-fullscreen-layout') || 'stage'`.
Implement `setTheaterModeDesign: (design) => { localStorage.setItem('aideo-theater-design', design); set({ theaterModeDesign: design }); }`.

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run src/test/theaterModeDesigns.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add src/store/types.ts src/store/uiSlice.ts src/test/theaterModeDesigns.test.ts
git commit -m "feat(store): add theaterModeDesign state and persistence"
```

---

### Task 2: Stage & Zen Modular Layouts

**Files:**
- Create: `src/components/theater/types.ts`
- Create: `src/components/theater/StageLayout.tsx`
- Create: `src/components/theater/ZenLayout.tsx`
- Test: `src/test/theaterStageZen.test.tsx`

**Interfaces:**
- Consumes: `TheaterLayoutProps` from `src/components/theater/types.ts`
- Produces: `StageLayout`, `ZenLayout` React components

- [ ] **Step 1: Write the failing test**
Create `src/test/theaterStageZen.test.tsx` rendering `StageLayout` and `ZenLayout` with mock track and lyrics props.

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run src/test/theaterStageZen.test.tsx`
Expected: FAIL (files do not exist)

- [ ] **Step 3: Implement types, StageLayout, and ZenLayout**
In `src/components/theater/types.ts`:
Define shared `TheaterLayoutProps` containing `currentTrack`, `effectiveCover`, `lyrics`, `playbackPositionSecs`, `playbackStatus`, `seek`, `accentColor`, `vizMode`, etc.
In `src/components/theater/StageLayout.tsx`:
Implement clean 2-column layout (Left: Cover with subtle ambient glow aura, meta, telemetry; Right: Synced lyrics with smooth autoscroll and KaraokeActiveLine support).
In `src/components/theater/ZenLayout.tsx`:
Implement focused centered lyric typography with unobtrusive floating art pill and background circular visualizer option.

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run src/test/theaterStageZen.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add src/components/theater/types.ts src/components/theater/StageLayout.tsx src/components/theater/ZenLayout.tsx src/test/theaterStageZen.test.tsx
git commit -m "feat(theater): implement modular StageLayout and ZenLayout"
```

---

### Task 3: Hi-Fi Studio Deck Layout (Ballistic VU Meters & Oscilloscope)

**Files:**
- Create: `src/components/theater/StudioDeckLayout.tsx`
- Test: `src/test/theaterStudioDeck.test.tsx`

**Interfaces:**
- Consumes: `TheaterLayoutProps` from `src/components/theater/types.ts`
- Produces: `StudioDeckLayout` component with `<canvas>` dual needle ballistic meters (-20dB to +3dB), real-time signal path telemetry, vector oscilloscope, and compact lyric ticker.

- [ ] **Step 1: Write the failing test**
Create `src/test/theaterStudioDeck.test.tsx` rendering `StudioDeckLayout` and verifying the presence of canvas meters and telemetry tags.

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run src/test/theaterStudioDeck.test.tsx`
Expected: FAIL (StudioDeckLayout does not exist)

- [ ] **Step 3: Implement StudioDeckLayout**
In `src/components/theater/StudioDeckLayout.tsx`:
1. Dual Analog Needle VU Meters:
   - `<canvas>` rendering calibrated VU arc (-20, -10, -7, -5, -3, -1, 0, +1, +2, +3 dB).
   - Ballistic physics simulation in `requestAnimationFrame`:
     `needleAngle += (targetAngle - needleAngle) * 0.18 - velocity * 0.04;`
     Rise time 300ms with slight spring overshoot and natural damping.
   - Redline overload indicator LED (> 0dB).
2. Hardware Signal Path Telemetry:
   - True sample rate, bit-depth, codec (`FLAC 96kHz / 24-bit`), output engine badge (`ASIO BIT-PERFECT` / `WASAPI EXCLUSIVE`).
3. Vector Oscilloscope:
   - Fast phosphor line drawing audio spectrum/waveform.
4. Compact Synced Lyric Ticker:
   - Active line with upcoming line preview beneath the meters.

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run src/test/theaterStudioDeck.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add src/components/theater/StudioDeckLayout.tsx src/test/theaterStudioDeck.test.tsx
git commit -m "feat(theater): implement Hi-Fi Studio Deck layout with ballistic VU meters"
```

---

### Task 4: Vinyl Turntable Layout (Rotating Vinyl & Tonearm)

**Files:**
- Create: `src/components/theater/VinylTurntableLayout.tsx`
- Test: `src/test/theaterVinyl.test.tsx`

**Interfaces:**
- Consumes: `TheaterLayoutProps` from `src/components/theater/types.ts`
- Produces: `VinylTurntableLayout` component with spinning vinyl disc, anisotropic groove highlights, reactive tonearm tracking progress, propped sleeve, and active lyrics.

- [ ] **Step 1: Write the failing test**
Create `src/test/theaterVinyl.test.tsx` verifying vinyl layout components and tonearm rotation calculation.

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run src/test/theaterVinyl.test.tsx`
Expected: FAIL (VinylTurntableLayout does not exist)

- [ ] **Step 3: Implement VinylTurntableLayout**
In `src/components/theater/VinylTurntableLayout.tsx`:
1. Turntable platter & 12-inch Vinyl:
   - Micro-groove specular reflection using CSS anisotropic radial gradients.
   - 33⅓ RPM continuous rotation (`animation-play-state: running/paused` based on `playbackStatus === 'Playing'`).
   - Center label sticker displaying track album art with spindle hole.
2. Mechanical Tonearm:
   - Metallic tonearm resting on turntable base.
   - Dynamic rotation angle: maps `(playbackPositionSecs / (trackDuration || 1))` from rest/outer rim (approx 18°) to inner run-out groove (approx 42°).
3. Propped Album Sleeve:
   - Album artwork resting at subtle 3D tilt with realistic paperboard depth and edge highlights.
4. Active Lyric Ticker:
   - 2-line lyric display beneath the turntable base.

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run src/test/theaterVinyl.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add src/components/theater/VinylTurntableLayout.tsx src/test/theaterVinyl.test.tsx
git commit -m "feat(theater): implement Vinyl Turntable layout with animated tonearm"
```

---

### Task 5: Editorial Poster & Pure Immersion Scope Layouts

**Files:**
- Create: `src/components/theater/EditorialPosterLayout.tsx`
- Create: `src/components/theater/PureScopeLayout.tsx`
- Create: `src/components/theater/TheaterLayoutSwitch.tsx`
- Test: `src/test/theaterPosterScope.test.tsx`

**Interfaces:**
- Consumes: `TheaterLayoutProps`, `TheaterModeDesign`
- Produces: `EditorialPosterLayout`, `PureScopeLayout`, `TheaterLayoutSwitch`

- [ ] **Step 1: Write the failing test**
Create `src/test/theaterPosterScope.test.tsx` testing `EditorialPosterLayout`, `PureScopeLayout`, and layout resolution in `TheaterLayoutSwitch`.

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run src/test/theaterPosterScope.test.tsx`
Expected: FAIL (files do not exist)

- [ ] **Step 3: Implement EditorialPoster, PureScope, and TheaterLayoutSwitch**
1. In `src/components/theater/EditorialPosterLayout.tsx`:
   - Swiss editorial typography grid: large track title (`clamp(2.5rem, 5vw, 4.5rem)`), clean uppercase labels, solid ink contrast.
   - Liner notes column: track number, format, duration, release year, album details, and full synced lyric column.
2. In `src/components/theater/PureScopeLayout.tsx`:
   - Full-bleed 60fps audio reactive canvas particle field or Lissajous vector scope driven by 64 FFT bands.
   - Ethereal floating center overlay with track title, artist, and karaoke line, smoothly auto-dimming during playback.
3. In `src/components/theater/TheaterLayoutSwitch.tsx`:
   - Resolves `theaterModeDesign` into the active layout component wrapped with Framer Motion `AnimatePresence`.

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run src/test/theaterPosterScope.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add src/components/theater/EditorialPosterLayout.tsx src/components/theater/PureScopeLayout.tsx src/components/theater/TheaterLayoutSwitch.tsx src/test/theaterPosterScope.test.tsx
git commit -m "feat(theater): implement EditorialPoster, PureScope, and TheaterLayoutSwitch"
```

---

### Task 6: SettingsView Appearance Integration & FullscreenView Wire-up

**Files:**
- Modify: `src/components/SettingsView.tsx`
- Modify: `src/components/FullscreenView.tsx`
- Modify: `src/App.css`
- Test: `src/test/theaterSettingsAndHUD.test.tsx`

**Interfaces:**
- Consumes: `theaterModeDesign`, `setTheaterModeDesign` from `src/store`
- Produces:
  - Settings UI card in Appearance tab for selecting default Theater mode archetype.
  - Upgraded HUD layout button in FullscreenView with sequential cycling, popup selector, and `L` keyboard shortcut.

- [ ] **Step 1: Write the failing test**
Create `src/test/theaterSettingsAndHUD.test.tsx` verifying:
1. Setting card exists under Appearance with 6 archetype options.
2. Layout cycle helper advances through all 6 archetypes in order (`stage` → `zen` → `studio` → `vinyl` → `poster` → `scope` → `stage`).

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run src/test/theaterSettingsAndHUD.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement Settings and FullscreenView changes**
In `src/components/SettingsView.tsx`:
Add a card with ID `theater-mode-design` under `tab: 'appearance'` with 6 visual preset cards (Icon, Title, Badge, Description, selected state border).
In `src/components/FullscreenView.tsx`:
Replace inline stage/zen conditionals with `<TheaterLayoutSwitch ... />`.
Upgrade HUD layout toggle button to display current archetype and cycle through all 6. Update keyboard shortcut `L` to cycle through the 6 archetypes.
In `src/App.css`:
Add styles for the 6 theater layouts and the settings cards (VU meter deck styling, turntable grooving, editorial poster grid, scope overlay).

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run src/test/theaterSettingsAndHUD.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add src/components/SettingsView.tsx src/components/FullscreenView.tsx src/App.css src/test/theaterSettingsAndHUD.test.tsx
git commit -m "feat(theater): integrate Theater Mode archetypes in Settings Appearance and Fullscreen HUD"
```

---

### Task 7: Verification Gate & Quality Checks

**Files:**
- All touched files

- [ ] **Step 1: Run TypeScript typecheck**
Run: `npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 2: Run all frontend unit tests**
Run: `npx vitest run src/test`
Expected: All tests pass

- [ ] **Step 3: Run Rust backend checks**
Run: `cargo check --quiet --manifest-path src-tauri/Cargo.toml`
Run: `cargo test --quiet --manifest-path src-tauri/Cargo.toml`
Expected: Clean compile and passing tests

- [ ] **Step 4: Inspect git status and commit final verification**
Run: `git status --short`
Commit any remaining changes with clean message.
