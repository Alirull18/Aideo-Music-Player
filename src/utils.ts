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

export const resolvedPathMap = new Map<string, string>();
export const onlineTrackCache = new Map<string, any>();

export function pathsEqual(p1: string | null | undefined, p2: string | null | undefined): boolean {
  if (!p1 || !p2) return false;
  
  let r1 = p1;
  let r2 = p2;
  if (resolvedPathMap.has(p1)) r1 = resolvedPathMap.get(p1)!;
  if (resolvedPathMap.has(p2)) r2 = resolvedPathMap.get(p2)!;

  const n1 = r1.replace(/\\/g, '/').toLowerCase();
  const n2 = r2.replace(/\\/g, '/').toLowerCase();
  return n1 === n2;
}

export function parseStreamMetadata(url: string | null) {
  if (!url) return { title: 'Unknown Stream', artist: 'Online Stream', album: '' };
  try {
    const u = new URL(url);
    const title = u.searchParams.get('title');
    const artist = u.searchParams.get('artist');
    const album = u.searchParams.get('album');
    
    if (title) {
      return {
        title,
        artist: artist || 'Online Stream',
        album: album || ''
      };
    }
  } catch {}
  
  return {
    title: getStreamName(url),
    artist: 'Online Stream',
    album: ''
  };
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
    /studio\s*choom/i, /스튜디오\s*춤/i, /kbs\s*kpop/i, /sbs\s*kpop/i, /mnet/i, /m2/i, /1thek/i,
    /stone\s*music/i, /dingo/i, /colors/i, /genius/i, /hybe\s*labels/i, /jyp/i, /yg\s*entertainment/i,
    /smtown/i, /starship/i, /fncent/i, /cube/i, /woolliment/i, /fancam/i, /직캠/i, /k-pop/i, /kpop/i,
    /youtube\s*direct/i, /unknown/i, /online\s*stream/i, /—/
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
        a = parts[0].trim();
        t = parts.slice(1).join(' ').trim();
        break;
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

  return { artist: cleanArtist, title: cleanTitle };
}



