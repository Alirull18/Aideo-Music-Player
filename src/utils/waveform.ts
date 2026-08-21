/**
 * Generates an organic, track-unique 60-bar waveform visualization
 * based on the track path/title hash and envelope dynamics.
 */
export function generateWaveformPeaks(seedStr: string, count: number = 60): number[] {
  if (!seedStr) {
    return Array.from({ length: count }, () => 0.4);
  }

  let hash = 0;
  for (let i = 0; i < seedStr.length; i++) {
    hash = (hash << 5) - hash + seedStr.charCodeAt(i);
    hash |= 0;
  }

  const absHash = Math.abs(hash);
  const peaks: number[] = [];

  for (let i = 0; i < count; i++) {
    const posRatio = i / count;
    // Bell curve envelope for natural track dynamic contouring
    const envelope = Math.sin(posRatio * Math.PI);
    const pseudoRand = Math.abs(
      Math.sin(absHash * 0.01 + i * 1.37) * 0.65 + Math.cos(i * 0.43) * 0.35
    );
    const rawPeak = envelope * 0.55 + pseudoRand * 0.45;
    peaks.push(Math.max(0.15, Math.min(1.0, rawPeak)));
  }

  return peaks;
}
