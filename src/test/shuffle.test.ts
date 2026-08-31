import { describe, it, expect, beforeEach } from 'vitest';
import { pickShuffleIndex, markShufflePlayed, shuffleArray } from '../utils/shuffle';

const paths = (n: number) => Array.from({ length: n }, (_, i) => `/music/track${i}.mp3`);

describe('Session-aware shuffle', () => {
  beforeEach(() => {
    // Fresh module state is impossible to reset externally, so tests use
    // unique path sets to avoid cross-test contamination.
  });

  it('never returns the current index', () => {
    const p = paths(10).map(x => `a${x}`);
    for (let i = 0; i < 50; i++) {
      const next = pickShuffleIndex(p, 3);
      expect(next).not.toBe(3);
      expect(next).toBeGreaterThanOrEqual(0);
      expect(next).toBeLessThan(p.length);
    }
  });

  it('avoids recently played tracks until the pool is exhausted', () => {
    const p = paths(6).map(x => `b${x}`);
    const picked = new Set<number>();
    let cur = -1;
    for (let i = 0; i < 5; i++) {
      const next = pickShuffleIndex(p, cur);
      expect(picked.has(next)).toBe(false);
      picked.add(next);
      cur = next;
    }
    expect(picked.size).toBe(5);
    // 6th pick: history auto-cleared at 85% coverage (5/6 >= 0.85*6), so any index except current is valid
    const next = pickShuffleIndex(p, cur);
    expect(next).not.toBe(cur);
  });

  it('handles tiny pools', () => {
    expect(pickShuffleIndex(['only'.padEnd(8, '1')], 0)).toBe(0);
    const two = ['x1', 'x2'];
    expect(pickShuffleIndex(two, 0)).toBe(1);
    expect(pickShuffleIndex(two, 1)).toBe(0);
  });

  it('markShufflePlayed biases future picks away from the marked path', () => {
    const p = paths(4).map(x => `c${x}`);
    markShufflePlayed(p[0]);
    // With a cold map, the unmarked paths win; p[0] should never be picked first
    const next = pickShuffleIndex(p, -1);
    expect(next).not.toBe(0);
  });

  it('selects non-deterministically with distributed picks across cold runs', () => {
    const firstPicks = new Set<number>();
    // Across 40 independent picks with cold unplayed tracks, we should see multiple different picks
    for (let run = 0; run < 40; run++) {
      const freshPaths = paths(10).map(x => `rand_${run}_${x}`);
      const pick = pickShuffleIndex(freshPaths, -1);
      firstPicks.add(pick);
    }
    expect(firstPicks.size).toBeGreaterThanOrEqual(4);
  });

  describe('shuffleArray (Fisher-Yates)', () => {
    it('preserves all elements and array length without mutating input', () => {
      const original = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const copy = [...original];
      const shuffled = shuffleArray(original);

      expect(original).toEqual(copy); // does not mutate input
      expect(shuffled).toHaveLength(original.length);
      expect(new Set(shuffled)).toEqual(new Set(original));
    });

    it('handles empty and single-element arrays', () => {
      expect(shuffleArray([])).toEqual([]);
      expect(shuffleArray([42])).toEqual([42]);
    });
  });
});
