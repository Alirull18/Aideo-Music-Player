import { useEffect, useState } from 'react';
import type { AudioLevels } from '../utils/useAudioLevels';

export function AudioLevelReadout({ levels }: { levels: AudioLevels | null }) {
  const peak = levels?.peak_dbfs ?? null;
  const [heldPeak, setHeldPeak] = useState<number | null>(peak);
  useEffect(() => {
    if (peak !== null) setHeldPeak(previous => previous === null ? peak : Math.max(previous, peak));
  }, [peak]);
  const displayPeak = Math.max(-60, Math.min(0, peak ?? -60));
  const heldPosition = Math.max(0, Math.min(1, ((heldPeak ?? -60) + 60) / 60));
  const tone = peak !== null && peak >= 0 ? 'limit' : peak !== null && peak >= -6 ? 'near-limit' : 'normal';
  const status = !levels ? 'No samples available' : levels.silent ? 'Silent output' : peak !== null && peak > 0 ? 'Above full scale' : tone === 'limit' ? 'At full scale' : tone === 'near-limit' ? 'Low headroom' : 'Live output';
  const peakText = levels?.silent ? 'Silence' : peak !== null ? `${peak.toFixed(1)} dBFS` : 'Unavailable';
  return (
    <div className={`audio-levels audio-levels--${tone}`} role="group" aria-label="Output sample levels">
      <dl className="audio-level-readings">
        <div><dt>Peak</dt><dd><strong>{peakText}</strong></dd></div>
        <div><dt>Headroom</dt><dd><strong>{levels?.silent ? '∞ dB (silence)' : levels?.headroom_db != null ? `${levels.headroom_db.toFixed(1)} dB` : 'Unavailable'}</strong></dd></div>
      </dl>
      <div className="audio-level-bar" role="meter" aria-label="Output sample peak" aria-valuemin={-60} aria-valuemax={0} aria-valuenow={displayPeak} aria-valuetext={peakText}>
        <span className="audio-level-fill" style={{ transform: `scaleX(${(displayPeak + 60) / 60})` }} />
        {heldPeak !== null && <span className="audio-level-hold" style={{ left: `calc(${heldPosition * 100}% - 2px)` }} />}
      </div>
      <div className="audio-level-scale" aria-hidden="true"><span>−60</span><span>−36</span><span>−12</span><span>0 dBFS</span></div>
      <div className="audio-level-status">{status}</div>
      <div className="audio-level-controls">
        <span role="group" aria-label="Held sample peak">Peak hold: {heldPeak !== null ? `${heldPeak.toFixed(1)} dBFS` : 'No peak yet'}</span>
        <button type="button" disabled={heldPeak === null} onClick={() => setHeldPeak(peak)}>Reset peak</button>
      </div>
      <details className="audio-level-help">
        <summary>About these readings</summary>
        <p>Peak is the highest output sample since the last update, after processing and volume. Headroom is the margin before 0 dBFS; a negative value is above full scale.</p>
        <p>The white marker holds the highest peak while this inspector is open. Reset peak starts again from the current reading.</p>
        <p>Sample peak does not detect peaks between samples and is not a hardware DAC measurement.</p>
      </details>
    </div>
  );
}
