import type { PlaybackState } from '../store/types';

export interface AudioPathPresentation {
  badge: {
    label: string;
    kind: 'bit-perfect' | 'exclusive';
  } | null;
  hudLabel: string;
  outputRate: number;
  isBitPerfect: boolean;
  isExclusive: boolean;
}

const formatRate = (sampleRate: number): string => {
  const rateKhz = sampleRate / 1000;
  return Number.isInteger(rateKhz) ? `${rateKhz}kHz` : `${rateKhz.toFixed(1)}kHz`;
};

export const getAudioPathPresentation = (playback: PlaybackState): AudioPathPresentation => {
  const path = playback.effective_audio_path;
  const isBitPerfect = Boolean(path?.active && path.strict_bit_perfect);
  const isExclusive = Boolean(
    path?.active && (path.share_mode === 'exclusive' || path.share_mode === 'direct')
  );

  if (!path?.active) {
    return {
      badge: null,
      hudLabel: playback.status === 'Stopped' ? 'SHARED ENGINE' : 'AUDIO PATH PENDING',
      outputRate: 0,
      isBitPerfect: false,
      isExclusive: false,
    };
  }

  const outputRate = path.output.sample_rate;
  const engineLabel = path.engine === 'asio' ? 'ASIO' : path.engine === 'wasapi' ? 'WASAPI' : 'CPAL';

  if (isBitPerfect) {
    return {
      badge: {
        label: `BIT-PERFECT${outputRate > 0 ? ` · ${formatRate(outputRate)}` : ''}`,
        kind: 'bit-perfect',
      },
      hudLabel: `${engineLabel} / BIT-PERFECT`,
      outputRate,
      isBitPerfect,
      isExclusive,
    };
  }

  if (isExclusive) {
    return {
      badge: {
        label: `${engineLabel} ${path.share_mode === 'direct' ? 'DIRECT' : 'EXCLUSIVE'}`,
        kind: 'exclusive',
      },
      hudLabel: `${engineLabel} ${path.share_mode === 'direct' ? 'DIRECT' : 'EXCLUSIVE'}`,
      outputRate,
      isBitPerfect,
      isExclusive,
    };
  }

  return {
    badge: null,
    hudLabel: 'SHARED ENGINE',
    outputRate,
    isBitPerfect,
    isExclusive,
  };
};
