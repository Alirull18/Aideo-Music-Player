import { describe, it, expect } from 'vitest';

interface DSPStateMock {
  enabled: boolean;
  eq_enabled: boolean;
  spatial_enabled: boolean;
  width: number;
}

function toggleDspABState(current: DSPStateMock): { next: DSPStateMock; toast: { message: string; type: string } } {
  const nextEnabled = !current.enabled;
  const next = {
    ...current,
    enabled: nextEnabled,
  };
  const toast = {
    message: nextEnabled ? '⚡ A/B Mode B: Tuned DSP & AutoEQ Active' : '🎧 A/B Mode A: Direct Raw Bypass (DSP Off)',
    type: nextEnabled ? 'success' : 'info'
  };
  return { next, toast };
}

describe('Instant A/B DSP Comparison Engine', () => {
  it('should toggle from Mode B (Enabled) to Mode A (Raw Bypass)', () => {
    const activeState: DSPStateMock = {
      enabled: true,
      eq_enabled: true,
      spatial_enabled: true,
      width: 1.5,
    };

    const { next, toast } = toggleDspABState(activeState);
    expect(next.enabled).toBe(false);
    // Sub-filters retain configuration for when toggled back
    expect(next.eq_enabled).toBe(true);
    expect(next.spatial_enabled).toBe(true);
    expect(toast.message).toContain('Mode A: Direct Raw Bypass');
    expect(toast.type).toBe('info');
  });

  it('should toggle from Mode A (Bypassed) back to Mode B (Tuned DSP)', () => {
    const bypassedState: DSPStateMock = {
      enabled: false,
      eq_enabled: true,
      spatial_enabled: true,
      width: 1.5,
    };

    const { next, toast } = toggleDspABState(bypassedState);
    expect(next.enabled).toBe(true);
    expect(toast.message).toContain('Mode B: Tuned DSP & AutoEQ Active');
    expect(toast.type).toBe('success');
  });

  it('should trigger on key "b" or "B" unless typing in input fields', () => {
    const handleKey = (key: string, tagName: string): boolean => {
      if (['INPUT', 'TEXTAREA'].includes(tagName.toUpperCase())) return false;
      return key.toLowerCase() === 'b';
    };

    expect(handleKey('b', 'DIV')).toBe(true);
    expect(handleKey('B', 'BODY')).toBe(true);
    expect(handleKey('b', 'INPUT')).toBe(false);
    expect(handleKey('b', 'TEXTAREA')).toBe(false);
    expect(handleKey('c', 'DIV')).toBe(false);
  });
});
