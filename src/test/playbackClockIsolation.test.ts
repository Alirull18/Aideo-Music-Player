import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../store';

// Views that select primitives (not `s.playback`) must not re-render on position ticks.
describe('playback clock isolation', () => {
  it('50 position ticks re-render the clock leaf but not a primitive-selector view', () => {
    let viewRenders = 0;
    let leafRenders = 0;

    renderHook(() => {
      viewRenders += 1;
      return useStore(
        useShallow((s) => ({
          status: s.playback.status,
          exclusive: s.playback.exclusive,
          path: s.playback.effective_audio_path,
        })),
      );
    });
    renderHook(() => {
      leafRenders += 1;
      return useStore((s) => s.playback.position_secs);
    });

    const viewBefore = viewRenders;
    const leafBefore = leafRenders;
    for (let i = 1; i <= 50; i++) {
      act(() => {
        useStore.setState((s) => ({ playback: { ...s.playback, position_secs: i * 0.1 } }));
      });
    }

    expect(viewRenders - viewBefore).toBe(0);
    expect(leafRenders - leafBefore).toBe(50);
  });
});
