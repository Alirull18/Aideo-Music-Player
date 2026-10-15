import { useStore } from '../store';
import { useShallow } from 'zustand/react/shallow';
import { Layers, Zap, Sparkles, Check } from 'lucide-react';

export type OutputPathOption = 'shared' | 'exclusive' | 'bitperfect';

interface AudioOutputPathSelectorProps {
  compact?: boolean;
}

export function AudioOutputPathSelector({ compact = false }: AudioOutputPathSelectorProps) {
  const {
    playbackExclusive,
    playbackBitPerfect,
    setAudioOutputPath,
    audioDeviceSwitching,
  } = useStore(
    useShallow(s => ({
      playbackExclusive: s.playback.exclusive,
      playbackBitPerfect: s.playback.bit_perfect,
      setAudioOutputPath: s.setAudioOutputPath,
      audioDeviceSwitching: s.audioDeviceSwitching,
    }))
  );

  const currentMode: OutputPathOption = playbackBitPerfect
    ? 'bitperfect'
    : playbackExclusive
    ? 'exclusive'
    : 'shared';

  const options: {
    id: OutputPathOption;
    title: string;
    subtitle: string;
    description: string;
    icon: typeof Layers;
    accentColor: string;
    badgeLabel: string;
  }[] = [
    {
      id: 'shared',
      title: 'Standard Shared Mode',
      subtitle: 'System Audio Mixer',
      description:
        'Play alongside other PC apps. Aideo 10-Band EQ, AutoEQ Headphone Optimization, and Crossfade are active.',
      icon: Layers,
      accentColor: 'var(--accent, #a855f7)',
      badgeLabel: 'SHARED',
    },
    {
      id: 'exclusive',
      title: 'Direct Hardware Exclusive (WASAPI + DSP)',
      subtitle: 'Bypass Windows Mixer + Active DSP',
      description:
        'Bypass Windows OS mixer & auto-match hardware sample rate while keeping Aideo EQ & Headphone Optimization active. Mutes other PC apps.',
      icon: Zap,
      accentColor: '#3b82f6',
      badgeLabel: 'EXCLUSIVE + DSP',
    },
    {
      id: 'bitperfect',
      title: 'Pure Bit-Perfect Passthrough',
      subtitle: 'Untouched 1:1 Digital Audio',
      description:
        'Untouched 1:1 digital audio straight to your DAC. Disables Aideo EQ, AutoEQ, ReplayGain, and digital volume attenuation.',
      icon: Sparkles,
      accentColor: '#06b6d4',
      badgeLabel: 'BIT-PERFECT',
    },
  ];

  return (
    <div
      role="radiogroup"
      aria-label="Audio Output Path"
      style={{
        display: 'grid',
        gridTemplateColumns: compact
          ? '1fr'
          : 'repeat(auto-fit, minmax(240px, 1fr))',
        gap: compact ? 10 : 12,
        width: '100%',
      }}
    >
      {options.map(opt => {
        const isSelected = currentMode === opt.id;
        const IconComponent = opt.icon;

        return (
          <div
            key={opt.id}
            role="radio"
            aria-checked={isSelected}
            tabIndex={0}
            onClick={() => {
              if (!audioDeviceSwitching && !isSelected) {
                setAudioOutputPath(opt.id);
              }
            }}
            onKeyDown={e => {
              if ((e.key === 'Enter' || e.key === ' ') && !audioDeviceSwitching && !isSelected) {
                e.preventDefault();
                setAudioOutputPath(opt.id);
              }
            }}
            style={{
              padding: compact ? '12px 14px' : '16px 18px',
              borderRadius: 12,
              background: isSelected
                ? opt.id === 'bitperfect'
                  ? 'rgba(6, 182, 212, 0.12)'
                  : opt.id === 'exclusive'
                  ? 'rgba(59, 130, 246, 0.12)'
                  : 'rgba(var(--accent-rgb, 168, 85, 247), 0.12)'
                : 'rgba(255, 255, 255, 0.03)',
              border: isSelected
                ? `1.5px solid ${opt.accentColor}`
                : '1px solid rgba(255, 255, 255, 0.08)',
              cursor: audioDeviceSwitching ? 'wait' : 'pointer',
              opacity: audioDeviceSwitching ? 0.7 : 1,
              transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              position: 'relative',
              boxShadow: isSelected
                ? `0 4px 20px ${opt.accentColor}25`
                : 'none',
            }}
          >
            <div>
              {/* Header row: Icon, Badge, Selection indicator */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 10,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 7,
                      background: isSelected
                        ? `${opt.accentColor}25`
                        : 'rgba(255, 255, 255, 0.06)',
                      color: isSelected ? opt.accentColor : 'var(--text-dim)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <IconComponent size={15} />
                  </div>
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 800,
                      letterSpacing: 0.8,
                      textTransform: 'uppercase',
                      padding: '2px 6px',
                      borderRadius: 4,
                      background: isSelected
                        ? opt.accentColor
                        : 'rgba(255, 255, 255, 0.08)',
                      color: isSelected ? '#fff' : 'var(--text-dim)',
                    }}
                  >
                    {opt.badgeLabel}
                  </span>
                </div>

                {isSelected ? (
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 800,
                      color: opt.accentColor,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <Check size={12} strokeWidth={3} /> ACTIVE
                  </span>
                ) : (
                  <span style={{ fontSize: 10, color: 'var(--text-dim)', opacity: 0.6 }}>
                    Select
                  </span>
                )}
              </div>

              {/* Title & subtitle */}
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: isSelected ? 'var(--text, #fff)' : 'var(--text)',
                  lineHeight: 1.3,
                  marginBottom: 6,
                }}
              >
                {opt.title}
              </div>

              {/* Detailed Description */}
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--text-dim, #9ca3af)',
                  lineHeight: 1.45,
                }}
              >
                {opt.description}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
