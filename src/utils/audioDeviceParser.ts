export type AudioDeviceCategory =
  | 'headphones'
  | 'dac'
  | 'speakers'
  | 'digital'
  | 'handsfree'
  | 'default';

export interface ParsedAudioDevice {
  rawName: string;
  displayName: string;
  category: AudioDeviceCategory;
  endpointLabel: string;
  isTelephonyHandsFree: boolean;
  driverType: 'WASAPI' | 'ASIO' | 'Default' | 'Standard';
  formattedLabel: string;
}

/**
 * Splits outer endpoint name and inner hardware/device string.
 * Windows MMDevice format typically takes the form:
 *   "Endpoint (Device)" or "Endpoint (Port- Device)" or "Digital Audio (S/PDIF) (Device)"
 * By balancing parentheses backwards, nested tags like "(R)" or "(S/PDIF)" are preserved correctly.
 */
function splitEndpointAndInner(name: string): { endpoint: string; inner: string } {
  const trimmed = name.trim();
  if (trimmed.endsWith(')')) {
    let depth = 0;
    let openIdx = -1;
    for (let i = trimmed.length - 1; i >= 0; i--) {
      if (trimmed[i] === ')') depth++;
      else if (trimmed[i] === '(') {
        depth--;
        if (depth === 0) {
          openIdx = i;
          break;
        }
      }
    }
    if (openIdx > 0) {
      const endpoint = trimmed.slice(0, openIdx).trim();
      const inner = trimmed.slice(openIdx + 1, trimmed.length - 1).trim();
      return { endpoint, inner };
    }
  }
  return { endpoint: '', inner: trimmed };
}

/**
 * Cleans driver noise, Windows port numbers, and trademark junk from hardware names.
 */
function cleanHardwareDisplayName(raw: string): string {
  let cleaned = raw
    // Strip Windows port/index prefix like "2- ", "3- ", "10- "
    .replace(/^\d+-\s*/, '')
    // Strip trademark noise
    .replace(/\((?:r|tm)\)/gi, '')
    .replace(/[®™]/g, '')
    // Strip driver profile noise
    .replace(/\bStereo\b/gi, '')
    .replace(/\bHands-Free\b/gi, '')
    .replace(/\bAG Audio\b/gi, '')
    // Clean up duplicate spaces
    .replace(/\s+/g, ' ')
    .trim();

  // If stripping left empty or redundant string, return sensible fallback
  if (!cleaned) {
    cleaned = raw.replace(/^\d+-\s*/, '').trim();
  }
  return cleaned;
}

/**
 * Parses raw Windows MMDevice/CPAL device names into clean, categorized metadata.
 *
 * @param rawName Raw string from CPAL / WASAPI (e.g., "Headphones (2- Sony WH-1000XM5 Stereo)")
 * @param isDefault Explicit flag if this represents the system default device
 * @param defaultDeviceDisplayName Optional clean name of the underlying active default device
 */
export function parseWindowsAudioDevice(
  rawName: string,
  isDefault?: boolean,
  defaultDeviceDisplayName?: string
): ParsedAudioDevice {
  const isDefaultDevice =
    Boolean(isDefault) ||
    !rawName ||
    rawName === '[System Default Device]' ||
    rawName.toLowerCase() === 'default';

  if (isDefaultDevice) {
    const formatted = defaultDeviceDisplayName
      ? `System Default — ${defaultDeviceDisplayName}`
      : 'System Default';
    return {
      rawName: rawName || '[System Default Device]',
      displayName: defaultDeviceDisplayName || 'System Default Device',
      category: 'default',
      endpointLabel: 'System Default',
      isTelephonyHandsFree: false,
      driverType: 'Default',
      formattedLabel: formatted,
    };
  }

  // Detect and strip driver tags like "[WASAPI] " or "[ASIO] "
  let driverType: ParsedAudioDevice['driverType'] = 'Standard';
  let cleanName = rawName;

  if (cleanName.startsWith('[WASAPI] ')) {
    driverType = 'WASAPI';
    cleanName = cleanName.slice(9).trim();
  } else if (cleanName.startsWith('[ASIO] ')) {
    driverType = 'ASIO';
    cleanName = cleanName.slice(7).trim();
  }

  // Detect low-quality Bluetooth telephony hands-free profiles
  const isTelephonyHandsFree = /hands-free|ag audio/i.test(cleanName);

  const { endpoint, inner } = splitEndpointAndInner(cleanName);
  const displayName = cleanHardwareDisplayName(inner || cleanName);

  // Determine category and endpointLabel
  let category: AudioDeviceCategory = 'speakers';
  let endpointLabel = 'Speakers';

  if (isTelephonyHandsFree) {
    category = 'handsfree';
    endpointLabel = 'Hands-Free Audio';
  } else if (
    /dac|fiio|topping|audioquest|mojo|chord|ifi|schiit|dragonfly|external\s+dac|usb\s+dac/i.test(cleanName) ||
    (/^line\s+out/i.test(cleanName) && !/speaker/i.test(cleanName))
  ) {
    category = 'dac';
    endpointLabel = 'USB / External DAC';
  } else if (
    /s\/pdif|spdif|optical|coaxial/i.test(cleanName) ||
    /digital\s+(?:audio|output)/i.test(cleanName) ||
    /s\/pdif|spdif|optical|digital/i.test(endpoint)
  ) {
    category = 'digital';
    endpointLabel = 'Optical / S/PDIF';
  } else if (
    /headphone|headset|earphone|earbud|airpods|in-ear|iem|\bwh-\d|\bwf-\d|\bqc\d|momentum|accentum|\bbuds\b/i.test(
      cleanName
    ) ||
    /headphone/i.test(endpoint)
  ) {
    category = 'headphones';
    endpointLabel = 'Headphones';
  } else if (
    /usb\s+audio/i.test(cleanName) && !/realtek|conexant|speaker/i.test(cleanName)
  ) {
    category = 'dac';
    endpointLabel = 'USB / External DAC';
  } else {
    category = 'speakers';
    endpointLabel = 'Speakers';
  }

  return {
    rawName,
    displayName,
    category,
    endpointLabel,
    isTelephonyHandsFree,
    driverType,
    formattedLabel: displayName,
  };
}

/**
 * Helper to format audio device display option for dropdowns and selection buttons.
 */
export function formatAudioDeviceOption(
  rawName: string,
  defaultDeviceDisplayName?: string
): string {
  const parsed = parseWindowsAudioDevice(rawName, false, defaultDeviceDisplayName);
  return parsed.formattedLabel;
}
