/**
 * Session-aware shuffle picker.
 * Tracks when each path was last picked during this app session so shuffle
 * avoids repeating tracks until most of the library has played.
 */

const lastPickedAt = new Map<string, number>();
let pickCounter = 0;

const CLEAR_THRESHOLD = 0.85;

/**
 * Picks a "random" index from `length` options that avoids recently played
 * paths. Falls back to a uniform random pick when tracking data is cold.
 */
export function pickShuffleIndex(paths: string[], currentIndex: number, excludeIndex?: number): number {
  const length = paths.length;
  if (length <= 1) return 0;
  if (length === 2 && (currentIndex === 0 || currentIndex === 1)) return currentIndex === 0 ? 1 : 0;

  const known = paths.filter(p => lastPickedAt.has(p));
  // Once most of the pool has been played, reset history so picks stay fresh
  if (known.length >= Math.max(2, Math.floor(length * CLEAR_THRESHOLD))) {
    lastPickedAt.clear();
  }

  // Prefer candidates never played this session; otherwise least-recently played.
  let bestCandidates: number[] = [];
  let bestScore = Infinity;
  const now = ++pickCounter;
  for (let i = 0; i < length; i++) {
    if (i === currentIndex || (excludeIndex !== undefined && i === excludeIndex)) continue;
    const last = lastPickedAt.get(paths[i]);
    const score = last === undefined ? -1 : last;
    if (score < bestScore) {
      bestScore = score;
      bestCandidates = [i];
    } else if (score === bestScore) {
      bestCandidates.push(i);
    }
  }

  let bestIndex = -1;
  if (bestCandidates.length > 0) {
    const randomChoice = Math.floor(Math.random() * bestCandidates.length);
    bestIndex = bestCandidates[randomChoice];
  } else {
    bestIndex = (currentIndex + 1) % length;
  }

  lastPickedAt.set(paths[bestIndex], now);
  return bestIndex;
}

/** Marks a path as played so shuffle avoids repeating it soon. */
export function markShufflePlayed(path: string): void {
  if (!path) return;
  lastPickedAt.set(path, ++pickCounter);
}

/**
 * Fisher-Yates array shuffle that returns a new shuffled array without mutating the original.
 */
export function shuffleArray<T>(items: readonly T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
