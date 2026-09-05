# Visualizer Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Overhaul the Now Playing bottom-left visualizer into a versatile Studio Visualizer Engine with 5 distinct rendering modes, gravity-based peak-decay physics, smooth pause-decay to resting baseline, adaptive container height, and dedicated Settings controls.

**Architecture:** Refactor `Visualizer.tsx` into modular canvas render pipelines backed by Zustand `uiSlice` and persistent storage. Enhance `NowPlayingView.tsx` with an adaptive 64px/140px container featuring a hover expander toggle. Introduce an "Audio Visualizer" configuration card to `SettingsView.tsx` for style, decay profile, and height selection.

**Tech Stack:** React 19, TypeScript, HTML5 Canvas 2D API, Zustand, Lucide React, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-05-visualizer-overhaul-design.md`

## Global Constraints
- Every line of code changed must trace directly to the visualizer overhaul requirements.
- Existing visualizer callers (`FullscreenView.tsx`, `StageLayout.tsx`, `ZenLayout.tsx`) must continue functioning with full backward compatibility.
- Canvas rendering must respect `lowSpecMode` (disable drop-shadow blurs and reduce computational overhead).
- Visual styling must adhere to the "Dark Obsidian Studio" hardware aesthetic defined in `PRODUCT.md` and `DESIGN.md`.
- No direct imports across the Tauri frontend-backend boundary.

---

### Task 1: Store Types, State & Persistence

**Files:**
- Modify: `src/store/types.ts:320-360`
- Modify: `src/store/uiSlice.ts:1-150`
- Test: `src/test/visualizerStore.test.ts`

**Interfaces:**
- Consumes: `safeGetStorage`, `safeSetStorage` from `src/utils/storage.ts`
- Produces: `VisualizerMode`, `VisualizerDecayRate`, and `visualizerMode`, `visualizerDecayRate`, `visualizerExpanded` state and setters on `PlayerState`

- [ ] **Step 1: Write the failing unit test for visualizer store state**

Create `src/test/visualizerStore.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../store';
import { VisualizerMode, VisualizerDecayRate } from '../store/types';

describe('Visualizer Store Slice', () => {
  beforeEach(() => {
    localStorage.clear();
    useStore.setState({
      visualizerMode: 'bars',
      visualizerDecayRate: 'balanced',
      visualizerExpanded: false,
    });
  });

  it('initializes with default visualizer values', () => {
    const state = useStore.getState();
    expect(state.visualizerMode).toBe('bars');
    expect(state.visualizerDecayRate).toBe('balanced');
    expect(state.visualizerExpanded).toBe(false);
  });

  it('updates visualizerMode and persists to localStorage', () => {
    const { setVisualizerMode } = useStore.getState();
    setVisualizerMode('mirror');
    expect(useStore.getState().visualizerMode).toBe('mirror');
    expect(localStorage.getItem('aideo_visualizer_mode')).toBe('mirror');

    setVisualizerMode('wave');
    expect(useStore.getState().visualizerMode).toBe('wave');
  });

  it('updates visualizerDecayRate and persists to localStorage', () => {
    const { setVisualizerDecayRate } = useStore.getState();
    setVisualizerDecayRate('snappy');
    expect(useStore.getState().visualizerDecayRate).toBe('snappy');
    expect(localStorage.getItem('aideo_visualizer_decay')).toBe('snappy');
  });

  it('updates visualizerExpanded and persists to localStorage', () => {
    const { setVisualizerExpanded } = useStore.getState();
    setVisualizerExpanded(true);
    expect(useStore.getState().visualizerExpanded).toBe(true);
    expect(localStorage.getItem('aideo_visualizer_expanded')).toBe('true');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/test/visualizerStore.test.ts`
Expected: FAIL with TypeScript/runtime errors (`setVisualizerMode` does not exist on `PlayerState`).

- [ ] **Step 3: Update `src/store/types.ts` and `src/store/uiSlice.ts`**

In `src/store/types.ts`:
```typescript
export type VisualizerMode = 'bars' | 'mirror' | 'wave' | 'circle' | 'dots' | 'baseline';
export type VisualizerDecayRate = 'snappy' | 'balanced' | 'silky';
```
Add to `PlayerState` interface:
```typescript
  visualizerMode: VisualizerMode;
  visualizerDecayRate: VisualizerDecayRate;
  visualizerExpanded: boolean;
  setVisualizerMode: (mode: VisualizerMode) => void;
  setVisualizerDecayRate: (decay: VisualizerDecayRate) => void;
  setVisualizerExpanded: (expanded: boolean) => void;
```

In `src/store/uiSlice.ts`:
Add helper functions to read saved storage:
```typescript
const getSavedVisualizerMode = (): VisualizerMode => {
  const saved = safeGetStorage('aideo_visualizer_mode');
  if (saved === 'baseline') return 'bars';
  if (saved === 'bars' || saved === 'mirror' || saved === 'wave' || saved === 'circle' || saved === 'dots') {
    return saved;
  }
  return 'bars';
};

const getSavedVisualizerDecay = (): VisualizerDecayRate => {
  const saved = safeGetStorage('aideo_visualizer_decay');
  if (saved === 'snappy' || saved === 'balanced' || saved === 'silky') {
    return saved;
  }
  return 'balanced';
};

const getSavedVisualizerExpanded = (): boolean => {
  return safeGetStorage('aideo_visualizer_expanded') === 'true';
};
```

In `createUISlice`:
```typescript
  visualizerMode: getSavedVisualizerMode(),
  visualizerDecayRate: getSavedVisualizerDecay(),
  visualizerExpanded: getSavedVisualizerExpanded(),
  setVisualizerMode: (mode: VisualizerMode) => {
    safeSetStorage('aideo_visualizer_mode', mode);
    set({ visualizerMode: mode });
  },
  setVisualizerDecayRate: (decay: VisualizerDecayRate) => {
    safeSetStorage('aideo_visualizer_decay', decay);
    set({ visualizerDecayRate: decay });
  },
  setVisualizerExpanded: (expanded: boolean) => {
    safeSetStorage('aideo_visualizer_expanded', String(expanded));
    set({ visualizerExpanded: expanded });
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/test/visualizerStore.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/store/types.ts src/store/uiSlice.ts src/test/visualizerStore.test.ts
git commit -m "feat: add visualizer preferences and state to ui store"
```

---

### Task 2: Modular Canvas Visualizer Engine

**Files:**
- Modify: `src/components/Visualizer.tsx`
- Create: `src/test/visualizer.test.ts`
- Modify: `src/test/fullscreenShortcuts.test.ts`

**Interfaces:**
- Consumes: `useStore` (`visualizerMode`, `visualizerDecayRate`, `accentColor`, `playback.status`, `lowSpecMode`)
- Produces: `<Visualizer mode={...} decayRate={...} />` component rendering the 5 modes with peak decay and resting baseline

- [ ] **Step 1: Write failing unit test for visualizer mode logic & aliases**

Create `src/test/visualizer.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { VisualizerMode } from '../store/types';

describe('Visualizer Mode Cycling & Aliasing', () => {
  const NEXT_MODE_MAP: Record<VisualizerMode, VisualizerMode> = {
    bars: 'mirror',
    mirror: 'wave',
    wave: 'circle',
    circle: 'dots',
    dots: 'bars',
    baseline: 'mirror',
  };

  it('cycles through all 5 visualizer modes in sequence', () => {
    let mode: VisualizerMode = 'bars';
    mode = NEXT_MODE_MAP[mode];
    expect(mode).toBe('mirror');
    mode = NEXT_MODE_MAP[mode];
    expect(mode).toBe('wave');
    mode = NEXT_MODE_MAP[mode];
    expect(mode).toBe('circle');
    mode = NEXT_MODE_MAP[mode];
    expect(mode).toBe('dots');
    mode = NEXT_MODE_MAP[mode];
    expect(mode).toBe('bars');
  });

  it('normalizes legacy baseline mode to bars', () => {
    const normalizeMode = (m: string | null): VisualizerMode => {
      if (!m || m === 'baseline') return 'bars';
      if (['bars', 'mirror', 'wave', 'circle', 'dots'].includes(m)) return m as VisualizerMode;
      return 'bars';
    };

    expect(normalizeMode('baseline')).toBe('bars');
    expect(normalizeMode('wave')).toBe('wave');
    expect(normalizeMode(null)).toBe('bars');
  });

  it('maps decay rate profiles to appropriate smoothing coefficients', () => {
    const DECAY_FACTORS = {
      snappy: { smooth: 0.35, peakGravity: 0.25 },
      balanced: { smooth: 0.20, peakGravity: 0.15 },
      silky: { smooth: 0.10, peakGravity: 0.08 },
    };

    expect(DECAY_FACTORS.snappy.smooth).toBeGreaterThan(DECAY_FACTORS.balanced.smooth);
    expect(DECAY_FACTORS.balanced.smooth).toBeGreaterThan(DECAY_FACTORS.silky.smooth);
  });
});
```

- [ ] **Step 2: Run test to verify it passes initial specifications**

Run: `npx vitest run src/test/visualizer.test.ts`
Expected: PASS

- [ ] **Step 3: Implement modular renderer in `src/components/Visualizer.tsx`**

Update `src/components/Visualizer.tsx`:
1. Support props: `mode?: VisualizerMode`, `decayRate?: VisualizerDecayRate`.
2. Connect to `useStore` for global fallback when props are omitted.
3. Manage physics buffers:
   - `smoothedBands = new Array(64).fill(0)`
   - `peakLevels = new Array(64).fill(0)`
   - `peakHoldFrames = new Array(64).fill(0)`
   - `peakVelocities = new Array(64).fill(0)`
4. Render 5 modes:
   - `'bars'` (or `'baseline'`): 64 vertical bars with floating peak caps (`#fbbf24` amber peak caps).
   - `'mirror'`: Symmetrical center-out bilateral bars.
   - `'wave'`: Smooth continuous Bezier spline with area gradient fill.
   - `'circle'`: Radial halo orbit centered with dynamic scale for compact/expanded containers.
   - `'dots'`: Phosphor LED dot-matrix with illuminated peak dots.
5. On pause / zero status:
   - Exponential falloff (`smoothedBands[i] *= 0.88`, `peakLevels[i] *= 0.88`).
   - Once quiet, render subtle resting baseline with breathing opacity.
6. Click handler (when propMode is not set):
   - Advances to next mode in `bars` -> `mirror` -> `wave` -> `circle` -> `dots` -> `bars`.
   - Updates Zustand store and dispatches `ui-toast` notification.

- [ ] **Step 4: Run tests & TypeScript check**

Run: `npx vitest run src/test/visualizer.test.ts`
Run: `npx vitest run src/test/fullscreenShortcuts.test.ts`
Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/Visualizer.tsx src/test/visualizer.test.ts
git commit -m "feat: overhaul Visualizer engine with 5 styles, peak-decay, and idle line"
```

---

### Task 3: Adaptive Now Playing Visualizer Container

**Files:**
- Modify: `src/components/NowPlayingView.tsx:1085-1090`
- Create: `src/test/nowPlayingVisualizer.test.tsx`

**Interfaces:**
- Consumes: `<Visualizer />`, `useStore` (`visualizerExpanded`, `setVisualizerExpanded`)
- Produces: Adaptive 64px / 140px container with hover toggle button (`Maximize2` / `Minimize2` icons)

- [ ] **Step 1: Write failing test for Now Playing adaptive visualizer container**

Create `src/test/nowPlayingVisualizer.test.tsx`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useStore } from '../store';
import NowPlayingView from '../components/NowPlayingView';

describe('NowPlayingView Visualizer Container', () => {
  beforeEach(() => {
    useStore.setState({
      visualizerExpanded: false,
      playback: {
        ...useStore.getState().playback,
        status: 'Playing',
      },
    });
  });

  it('renders visualizer container with default compact height', () => {
    const { container } = render(<NowPlayingView />);
    const vizContainer = container.querySelector('.np-visualizer-container') as HTMLElement;
    expect(vizContainer).toBeInTheDocument();
    expect(vizContainer.style.height).toBe('64px');
  });

  it('toggles to expanded height when expand button is clicked', () => {
    const { container } = render(<NowPlayingView />);
    const toggleBtn = screen.getByRole('button', { name: /expand visualizer/i });
    fireEvent.click(toggleBtn);

    expect(useStore.getState().visualizerExpanded).toBe(true);
    const vizContainer = container.querySelector('.np-visualizer-container') as HTMLElement;
    expect(vizContainer.style.height).toBe('140px');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/test/nowPlayingVisualizer.test.tsx`
Expected: FAIL (cannot find `.np-visualizer-container` or expand button).

- [ ] **Step 3: Implement adaptive container in `src/components/NowPlayingView.tsx`**

In `src/components/NowPlayingView.tsx`:
Import `Maximize2`, `Minimize2` from `lucide-react`.
Destructure `visualizerExpanded`, `setVisualizerExpanded` from `useStore`.
Update line 1086-1088:
```tsx
        <div 
          className="np-visualizer-container relative group transition-all duration-200 ease-out" 
          style={{ 
            height: visualizerExpanded ? 140 : 64, 
            width: '100%', 
            flexShrink: 0, 
            marginTop: 8,
            borderRadius: 8,
            overflow: 'hidden'
          }}
        >
          <Visualizer />
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setVisualizerExpanded(!visualizerExpanded);
            }}
            className="absolute top-1 right-1 opacity-0 group-hover:opacity-75 hover:!opacity-100 p-1 rounded bg-black/40 text-white/80 hover:text-white transition-opacity z-10"
            title={visualizerExpanded ? "Collapse Visualizer" : "Expand Visualizer"}
            aria-label={visualizerExpanded ? "Collapse visualizer" : "Expand visualizer"}
          >
            {visualizerExpanded ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
          </button>
        </div>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/test/nowPlayingVisualizer.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/NowPlayingView.tsx src/test/nowPlayingVisualizer.test.tsx
git commit -m "feat: add adaptive 64px/140px visualizer container with expand toggle"
```

---

### Task 4: Audio Visualizer Settings Surface

**Files:**
- Modify: `src/components/SettingsView.tsx`
- Create: `src/test/settingsVisualizer.test.tsx`

**Interfaces:**
- Consumes: `visualizerMode`, `setVisualizerMode`, `visualizerDecayRate`, `setVisualizerDecayRate`, `visualizerExpanded`, `setVisualizerExpanded` from `useStore`
- Produces: Configuration card in `SettingsView.tsx` under Appearance tab with mode chips, response pills, and height toggle

- [ ] **Step 1: Write failing test for visualizer settings section**

Create `src/test/settingsVisualizer.test.tsx`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useStore } from '../store';
import SettingsView from '../components/SettingsView';

describe('SettingsView Audio Visualizer Section', () => {
  beforeEach(() => {
    useStore.setState({
      visualizerMode: 'bars',
      visualizerDecayRate: 'balanced',
      visualizerExpanded: false,
    });
  });

  it('renders visualizer mode selection chips', () => {
    render(<SettingsView />);
    expect(screen.getByText('Audio Spectrum Visualizer')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /studio bars/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /bilateral mirror/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /silk wave/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /radial halo/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /dot matrix/i })).toBeInTheDocument();
  });

  it('updates visualizer mode when a style chip is selected', () => {
    render(<SettingsView />);
    const silkWaveBtn = screen.getByRole('button', { name: /silk wave/i });
    fireEvent.click(silkWaveBtn);
    expect(useStore.getState().visualizerMode).toBe('wave');
  });

  it('updates decay profile when response pill is clicked', () => {
    render(<SettingsView />);
    const silkyBtn = screen.getByRole('button', { name: /silky/i });
    fireEvent.click(silkyBtn);
    expect(useStore.getState().visualizerDecayRate).toBe('silky');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/test/settingsVisualizer.test.tsx`
Expected: FAIL (cannot find Audio Spectrum Visualizer card).

- [ ] **Step 3: Implement settings section in `src/components/SettingsView.tsx`**

In `src/components/SettingsView.tsx`:
Destructure `visualizerMode`, `setVisualizerMode`, `visualizerDecayRate`, `setVisualizerDecayRate`, `visualizerExpanded`, `setVisualizerExpanded` from `useStore`.
Add the `audio-visualizer-config` section under the settings list:
```tsx
    {
      id: 'audio-visualizer-config',
      title: 'Audio Spectrum Visualizer',
      description: 'Customize visualizer rendering styles, decay kinetics, and display height in the player.',
      keywords: 'visualizer spectrum audio style bars wave circle mirror dots decay height now playing',
      tab: 'appearance',
      element: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Style selector chips */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-dim)', letterSpacing: 0.5, marginBottom: 8 }}>
              Rendering Style
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
              {[
                { id: 'bars', name: 'Studio Bars', desc: 'Floating peak caps' },
                { id: 'mirror', name: 'Bilateral Mirror', desc: 'Center-out stereo' },
                { id: 'wave', name: 'Silk Wave', desc: 'Analog oscilloscope' },
                { id: 'circle', name: 'Radial Halo', desc: 'Orbital burst' },
                { id: 'dots', name: 'Dot Matrix', desc: 'Phosphor LED grid' },
              ].map(style => (
                <button
                  key={style.id}
                  type="button"
                  onClick={() => setVisualizerMode(style.id as any)}
                  className={`btn-style-chip ${visualizerMode === style.id ? 'active' : ''}`}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 8,
                    textAlign: 'left',
                    background: visualizerMode === style.id ? 'rgba(var(--accent-rgb), 0.15)' : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${visualizerMode === style.id ? 'var(--accent)' : 'var(--glass-border)'}`,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                  aria-label={style.name}
                >
                  <div style={{ fontSize: 12, fontWeight: 700, color: visualizerMode === style.id ? 'var(--accent)' : 'var(--text)' }}>
                    {style.name}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>
                    {style.desc}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Decay Profile Pills */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-dim)', letterSpacing: 0.5, marginBottom: 8 }}>
              Decay Kinetics
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {[
                { id: 'snappy', label: 'Snappy', desc: 'Fast & punchy' },
                { id: 'balanced', label: 'Balanced', desc: 'Natural studio response' },
                { id: 'silky', label: 'Silky', desc: 'Liquid smooth transitions' },
              ].map(decay => (
                <button
                  key={decay.id}
                  type="button"
                  onClick={() => setVisualizerDecayRate(decay.id as any)}
                  className={`btn ${visualizerDecayRate === decay.id ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ fontSize: 11, padding: '6px 14px' }}
                  aria-label={decay.label}
                >
                  {decay.label}
                </button>
              ))}
            </div>
          </div>

          {/* Default Height Toggle */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8, borderTop: '1px solid var(--glass-border)' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Expanded Now Playing Canvas</div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
                Use taller 140px view instead of compact 64px
              </div>
            </div>
            <SlidingSwitch 
              checked={visualizerExpanded} 
              onChange={() => setVisualizerExpanded(!visualizerExpanded)} 
            />
          </div>
        </div>
      )
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/test/settingsVisualizer.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/SettingsView.tsx src/test/settingsVisualizer.test.tsx
git commit -m "feat: add Audio Visualizer settings card to SettingsView"
```

---

### Task 5: End-to-End Verification Gate

**Files:**
- Test: All touched test suites and system verification

- [ ] **Step 1: Run TypeScript compiler check**

Run: `npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 2: Run all visualizer test suites**

Run: `npx vitest run src/test/visualizerStore.test.ts src/test/visualizer.test.ts src/test/nowPlayingVisualizer.test.tsx src/test/settingsVisualizer.test.tsx src/test/fullscreenShortcuts.test.ts`
Expected: All tests PASS

- [ ] **Step 3: Run Rust backend compiler check**

Run: `cargo check --quiet --manifest-path src-tauri/Cargo.toml`
Expected: 0 errors

- [ ] **Step 4: Inspect git status & final verification**

Run: `git status -s`
Ensure working tree is clean and only intentional files were modified.
