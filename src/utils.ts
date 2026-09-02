export function fmt(s: number | null) {
  if (!s || isNaN(s) || s < 0) return '0:00';
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

export function baseName(p: string | null) {
  return p ? (p.split(/[\\/]/).pop() ?? p) : '—';
}

export function getStreamName(url: string | null) {
  if (!url) return 'Unknown Stream';
  try {
    const u = new URL(url);
    const domain = u.hostname.replace('www.', '');
    const path = u.pathname.split('/').pop();

    if (path && path.length > 2 && !path.includes('.')) {
      const station = path.charAt(0).toUpperCase() + path.slice(1);
      return `${station} (${domain})`;
    }

    if (domain.length < 4 || /^\d/.test(domain)) return url;

    return domain.charAt(0).toUpperCase() + domain.slice(1);
  } catch {
    return url;
  }
}

// Maps a resolved stream URL back to its source track path (e.g. Tidal track ID).
// Persisted so queue entries keep their titles/identity across app restarts and
// webview reloads (the backend queue keeps raw URLs, this restores the linkage).
export const resolvedPathMap = new Map<string, string>();
export const trackIdToStreamUrl = new Map<string, { url: string; resolvedAt: number }>();

(() => {
  try {
    const raw = localStorage.getItem('aideo_resolved_paths');
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        arr.forEach(([url, id]) => {
          if (url && id) resolvedPathMap.set(url, id);
        });
      }
    }
  } catch (e) {
    console.error('Failed to load resolvedPathMap:', e);
  }
})();

export function rememberResolvedPath(streamUrl: string, trackPath: string) {
  if (!streamUrl || !trackPath) return;
  resolvedPathMap.set(streamUrl, trackPath);
  try {
    const entries = Array.from(resolvedPathMap.entries()).slice(-300);
    localStorage.setItem('aideo_resolved_paths', JSON.stringify(entries));
  } catch (e) {
    console.error('Failed to save resolvedPathMap:', e);
  }
}

export const onlineTrackCache = (() => {
  const map = new Map<string, any>();
  try {
    const raw = localStorage.getItem('aideo_online_track_cache');
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        arr.forEach(([k, v]) => {
          if (k && v) map.set(k, v);
        });
      }
    }
  } catch (e) {
    console.error('Failed to load onlineTrackCache:', e);
  }
  return map;
})();

export function saveOnlineTrackCache() {
  try {
    const entries = Array.from(onlineTrackCache.entries()).slice(-200);
    localStorage.setItem('aideo_online_track_cache', JSON.stringify(entries));
  } catch (e) {
    console.error('Failed to save onlineTrackCache:', e);
  }
}

export function setOnlineTrackCache(key: string, track: any) {
  if (!key || !track) return;
  // Don't cache generic fallback metadata
  if (track.title === 'Web Audio Stream' || track.artist === 'Web Stream') return;
  onlineTrackCache.set(key, track);
  saveOnlineTrackCache();
}

export function pathsEqual(p1: string | null | undefined, p2: string | null | undefined): boolean {
  if (!p1 || !p2) return false;
  
  let r1 = p1;
  let r2 = p2;
  if (resolvedPathMap.has(p1)) r1 = resolvedPathMap.get(p1)!;
  if (resolvedPathMap.has(p2)) r2 = resolvedPathMap.get(p2)!;

  const n1 = r1.replace(/\\/g, '/').toLowerCase();
  const n2 = r2.replace(/\\/g, '/').toLowerCase();
  if (n1 === n2) return true;

  // Handle Temp Cache Files (e.g. CloudCache/<hash>.tmp or aideo_cache_<hash>.wav)
  const isTemp1 = n1.includes('cloudcache') || n1.includes('aideo_cache_');
  const isTemp2 = n2.includes('cloudcache') || n2.includes('aideo_cache_');
  if (isTemp1 || isTemp2) {
    const extractHash = (p: string) => {
      const m = p.match(/([a-f0-9]{32})/i);
      return m ? m[1].toLowerCase() : null;
    };
    const h1 = extractHash(n1);
    const h2 = extractHash(n2);
    if (h1 && h2 && h1 === h2) return true;

    if (h1) {
      for (const key of onlineTrackCache.keys()) {
        const keyLower = key.replace(/\\/g, '/').toLowerCase();
        if (keyLower === n2 || n2.includes(keyLower)) return true;
      }
    }
    if (h2) {
      for (const key of onlineTrackCache.keys()) {
        const keyLower = key.replace(/\\/g, '/').toLowerCase();
        if (keyLower === n1 || n1.includes(keyLower)) return true;
      }
    }
  }

  return false;
}

export function parseStreamMetadata(url: string | null) {
  if (!url) return { title: 'Unknown Stream', artist: 'Online Stream', album: '', duration: null, cover_url: null, format: 'URL' };
  
  let lookupUrl = url;
  if (resolvedPathMap.has(url)) {
    lookupUrl = resolvedPathMap.get(url)!;
  }
  
  const isYoutube = url.includes('youtube.com') || url.includes('youtu.be') || url.includes('googlevideo.com');
  const defaultFormat = isYoutube ? 'YouTube Direct' : 'URL';

  // Check both the raw stream URL and its resolved track path — metadata may be
  // cached under either key depending on where it was recorded.
  for (const key of [url, lookupUrl]) {
    if (key && onlineTrackCache.has(key)) {
      const cached = onlineTrackCache.get(key);
      if (cached && cached.title && cached.title !== 'Web Audio Stream') {
        return {
          title: cached.title,
          artist: cached.artist || 'Online Stream',
          album: cached.album || '',
          duration: cached.duration ?? null,
          cover_url: cached.cover_url || null,
          format: cached.format || defaultFormat,
        };
      }
    }
  }

  // Check onlineTrackCache for any key matching hash in URL
  const hashMatch = lookupUrl.match(/([a-f0-9]{32})/i);
  if (hashMatch) {
    const hash = hashMatch[1].toLowerCase();
    for (const [key, cached] of onlineTrackCache.entries()) {
      if (key.includes(hash) || pathsEqual(key, lookupUrl)) {
        if (cached && cached.title && cached.title !== 'Web Audio Stream') {
          return {
            title: cached.title,
            artist: cached.artist || 'Online Stream',
            album: cached.album || '',
            duration: cached.duration ?? null,
            cover_url: cached.cover_url || null,
            format: cached.format || defaultFormat,
          };
        }
      }
    }
  }

  try {
    const u = new URL(url);
    const title = u.searchParams.get('title');
    const artist = u.searchParams.get('artist');
    const album = u.searchParams.get('album');
    
    if (title) {
      return {
        title,
        artist: artist || 'Online Stream',
        album: album || '',
        duration: null,
        cover_url: null,
        format: defaultFormat,
      };
    }

    if (isYoutube) {
      return {
        title: 'Web Audio Stream',
        artist: 'Web Stream',
        album: '',
        duration: null,
        cover_url: null,
        format: 'YouTube Direct',
      };
    }
  } catch {}
  
  return {
    title: getStreamName(url),
    artist: 'Online Stream',
    album: '',
    duration: null,
    cover_url: null,
    format: defaultFormat,
  };
}

export function isRadioStream(track: any, playbackTrackUrl?: string | null, duration?: number | null): boolean {
  const path = track?.path || playbackTrackUrl || '';
  const format = (track?.format || '').toUpperCase();
  const isUrlFormat = format === 'URL';
  const isOnline = path.startsWith('http://') || path.startsWith('https://');
  const isYTMOrTidalOrCloud =
    format === 'YOUTUBE DIRECT' ||
    format === 'YOUTUBE WEB STREAM' ||
    format === 'TIDAL FLAC' ||
    format === 'QOBUZ FLAC' ||
    format === 'SUBSONIC' ||
    format === 'JELLYFIN' ||
    path.includes('youtube.com') ||
    path.includes('youtu.be') ||
    path.includes('googlevideo.com') ||
    path.includes('api.tidal.com') ||
    path.includes('audio.tidal.com') ||
    path.includes('qobuz.com');
  
  if (isYTMOrTidalOrCloud) return false;
  if (!isOnline && !isUrlFormat) return false;

  const trackDuration = track?.duration ?? duration ?? null;
  return (!trackDuration || trackDuration <= 0);
}

// Matches placeholder/degraded stream titles: empty, known placeholders, raw URLs,
// or bare hostnames like "Lgf.audio.tidal.com" (no spaces, dot-separated, not a file extension).
export function isGenericStreamTitle(title: string | null | undefined): boolean {
  const t = (title || '').trim();
  if (!t) return true;
  if (t === 'Web Audio Stream' || t === 'Unknown Stream' || t === 'Unknown Track' || t === 'Unknown Title') return true;
  if (t.includes('://')) return true;
  return !t.includes(' ') && t.includes('.') && !/\.(mp3|flac|m4a|wav|ogg|aac|wma|opus|alac|aiff|ape|dsf|dff)$/i.test(t);
}

// Matches placeholder artists produced by stream fallbacks — never a real artist name.
export function isGenericStreamArtist(artist: string | null | undefined): boolean {
  const a = (artist || '').trim();
  return !a || a === 'Unknown Artist' || a === 'Online Stream' || a === 'Web Stream' || a === 'YouTube Audio' || a === '—';
}

export function cleanSearchQuery(artist: string | null | undefined, title: string | null | undefined): { artist: string; title: string } {
  let a = (artist || '').trim();
  let t = (title || '').trim();

  // If title is a file path or URL, use base name
  if (t.startsWith('http://') || t.startsWith('https://')) {
    t = baseName(t);
  }
  // Remove file extension
  t = t.replace(/\.(mp3|flac|m4a|wav|ogg|aac|wma)$/i, '');

  // Split title by '|' and keep the first part (common on YouTube for channel suffixes)
  if (t.includes('|')) {
    t = t.split('|')[0].trim();
  }

  // Pre-clean leading square brackets/parentheses from title (e.g. [MV], [스튜디오 춤])
  t = t.replace(/^(\s*[\[\(].*?[\]\)]\s*)+/g, '').trim();

  // Common YouTube publishers/channels that shouldn't be treated as the main artist
  const PUBLISHERS = [
    /studio\s*choom/i, /스튜디오\s*춤/i, /kbs\s*kpop/i, /sbs\s*kpop/i, /mnet/i, /\bm2\b/i, /1thek/i,
    /stone\s*music/i, /dingo/i, /\bcolors\b/i, /genius/i, /hybe\s*labels/i, /jyp/i, /yg\s*entertainment/i,
    /smtown/i, /starship/i, /fncent/i, /cube/i, /woolliment/i, /fancam/i, /직캠/i,
    /youtube\s*direct/i, /unknown/i, /online\s*stream/i
  ];

  const isPublisher = (name: string) => {
    return PUBLISHERS.some(regex => regex.test(name));
  };

  // If artist is generic or is a known publisher channel, clear it so we can infer it from the title
  if (!a || isPublisher(a)) {
    a = '';
  }

  // If artist is empty, try to split title by hyphen/colon/tilde/quote to infer artist and title
  if (!a) {
    // Check for "Artist - Title" or "Artist : Title"
    const delimiters = [/\s*[-—~_]\s*/, /\s*:\s+/];
    for (const delim of delimiters) {
      if (delim.test(t)) {
        const parts = t.split(delim);
        const candidateArtist = parts[0].trim();
        const candidateTitle = parts.slice(1).join(' ').trim();
        // Only accept the split if the left side is a plausible artist token
        // (non-empty, reasonably short) and leaves a non-empty title behind.
        if (candidateArtist && candidateArtist.length <= 40 && candidateTitle) {
          a = candidateArtist;
          t = candidateTitle;
          break;
        }
      }
    }

    // Check for "Artist 'Song'" or 'Artist "Song"'
    if (!a) {
      const quoteMatch = t.match(/^([^'"]+)\s+['"]([^'"]+)['"]/);
      if (quoteMatch) {
        a = quoteMatch[1].trim();
        t = quoteMatch[2].trim();
      }
    }
  }

  // Clean tags from title and artist
  const cleanTags = (s: string) => {
    return s
      // Remove brackets/parentheses containing video production/performance keywords
      .replace(/\s*[([].*?(official|lyrics|video|audio|hq|hd|edit|remix|version|distribution|cover|stage|live|choreo|studio|performance|show|sub|eng|rom|han|fancam|karaoke|instrumental|inst|ver|clip|mv|m\/v|스페셜|special|원더케이).*?[\])]/gi, '')
      // Remove specific trailing bracketed tags
      .replace(/\s*[([].*?(4k|8k|1080p|hd|sone|ch|orig).*?[\])]/gi, '')
      // Remove trailing "from ... studio"
      .replace(/\s+from\s+.*studio$/i, '')
      // Remove trailing keywords at the end of the string
      .replace(/\s+(official|lyrics|video|mv|lrc|distribution|cover|stage|live|choreo|performance|show|sub|raw|hd|hq)$/i, '')
      // Remove extra whitespace
      .replace(/\s+/g, ' ')
      .trim();
  };

  let cleanTitle = cleanTags(t);
  let cleanArtist = cleanTags(a).replace(/\s*-\s*topic$/i, '').trim();

  // If cleanArtist is still a publisher, remove it
  if (isPublisher(cleanArtist)) {
    cleanArtist = '';
  }

  // Remove empty brackets/parentheses
  cleanTitle = cleanTitle.replace(/[([][\s]*[\])]/g, '').trim();
  cleanArtist = cleanArtist.replace(/[([][\s]*[\])]/g, '').trim();

  // Last-resort fallback: if cleaning nuked the artist entirely, restore the raw
  // original so the search query always carries an artist token when one existed.
  if (!cleanArtist) {
    cleanArtist = (artist || '').trim();
  }

  return { artist: cleanArtist, title: cleanTitle };
}

export function isStreamTrack(path?: string | null, format?: string | null): boolean {  if (!path) return false;
  const fmt = (format || '').toUpperCase();
  return (
    path.startsWith('http://') ||
    path.startsWith('https://') ||
    path.startsWith('mms://') ||
    path.startsWith('rtsp://') ||
    path.startsWith('aideo://') ||
    fmt === 'YOUTUBE DIRECT' ||
    fmt.includes('YOUTUBE') ||
    fmt.includes('TIDAL') ||
    fmt.includes('QOBUZ') ||
    fmt === 'SUBSONIC' ||
    fmt === 'JELLYFIN' ||
    fmt === 'STREAM' ||
    fmt === 'RADIO' ||
    (/^[a-zA-Z0-9_-]{11}$/.test(path) && fmt !== 'FLAC' && fmt !== 'MP3' && fmt !== 'WAV' && fmt !== 'OGG' && fmt !== 'M4A' && fmt !== 'AAC' && fmt !== 'OPUS' && fmt !== 'DSF' && fmt !== 'DFF')
  );
}

const MUSIC_LINK_RE = /^https?:\/\/(open\.spotify\.com|spotify\.link|music\.apple\.com|(www\.)?deezer\.com)\//i;

export function isSupportedMusicLink(text: string): boolean {
  return MUSIC_LINK_RE.test(text.trim());
}

export function buildResolvedLinkQuery(meta: { title?: string; artist?: string | null } | null | undefined): string {
  if (!meta || !meta.title) return '';
  return [meta.title, meta.artist].filter(Boolean).join(' ').trim();
}

export const VARIANT_PATTERNS = [
  /\b(japanese\s*ver(sion)?|jp\s*ver)\b/i,
  /\b(korean\s*ver(sion)?|kr\s*ver|kor\s*ver)\b/i,
  /\b(chinese\s*ver(sion)?|cn\s*ver)\b/i,
  /\b(english\s*ver(sion)?|eng\s*ver)\b/i,
  /\b(spanish\s*ver(sion)?)\b/i,
  /\b(instrumental|inst|off\s*vocal|minus\s*one)\b/i,
  /\b(acoustic\s*ver(sion)?)\b/i,
  /\b(remix|speed\s*up|slowed)\b/i,
];

export function getVariantPenalty(targetTitle?: string | null, resultTitle?: string | null): number {
  if (!targetTitle || !resultTitle) return 0;
  for (const pattern of VARIANT_PATTERNS) {
    const targetHas = pattern.test(targetTitle);
    const resultHas = pattern.test(resultTitle);
    if (targetHas !== resultHas) {
      return -0.60;
    }
  }
  return 0.0;
}





