export interface ScopedSearchCriteria {
  artist?: string;
  album?: string;
  title?: string;
  format?: string;
  loved?: boolean;
  freeText: string[];
}

/**
 * Parses a search query string into structured filter criteria.
 * Example: `artist:"Daft Punk" format:flac alive`
 */
export function parseSearchQuery(query: string): ScopedSearchCriteria {
  const trimmed = (query || '').trim();
  if (!trimmed) {
    return { freeText: [] };
  }

  const criteria: ScopedSearchCriteria = { freeText: [] };
  
  // Regex to match supported scoped keys with either quoted or unquoted values:
  // e.g. artist:"Daft Punk", album:Discovery, format:flac, loved:true
  const scopedRegex = /(?<![a-z0-9])(artist|ar|album|al|title|track|ti|format|ext|loved|favorite|liked):(?:"([^"]+)"|(\S+))/gi;
  let match: RegExpExecArray | null;

  // Track parts that were captured as scoped criteria
  const capturedRanges: [number, number][] = [];

  while ((match = scopedRegex.exec(trimmed)) !== null) {
    const key = match[1].toLowerCase();
    const value = (match[2] ?? match[3] ?? '').trim();
    capturedRanges.push([match.index, match.index + match[0].length]);

    if (key === 'artist' || key === 'ar') {
      criteria.artist = value.toLowerCase();
    } else if (key === 'album' || key === 'al') {
      criteria.album = value.toLowerCase();
    } else if (key === 'title' || key === 'track' || key === 'ti') {
      criteria.title = value.toLowerCase();
    } else if (key === 'format' || key === 'ext') {
      criteria.format = value.toLowerCase();
    } else if (key === 'loved' || key === 'favorite' || key === 'liked') {
      criteria.loved = value.toLowerCase() === 'true' || value === '1' || value.toLowerCase() === 'yes';
    }
  }

  // Extract any remaining non-scoped free-text tokens
  let cursor = 0;
  let remainingText = '';
  for (const [start, end] of capturedRanges) {
    if (start > cursor) {
      remainingText += ' ' + trimmed.substring(cursor, start);
    }
    cursor = end;
  }
  if (cursor < trimmed.length) {
    remainingText += ' ' + trimmed.substring(cursor);
  }

  const tokens = remainingText
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  criteria.freeText = tokens;
  return criteria;
}

/**
 * Evaluates whether a track matches the parsed search criteria.
 */
export function matchesSearchQuery(track: any, query: string): boolean {
  if (!query || !query.trim()) return true;
  if (!track) return false;

  const criteria = parseSearchQuery(query);

  const title = (track.title || '').toLowerCase();
  const artist = (track.artist || '').toLowerCase();
  const album = (track.album || '').toLowerCase();
  const format = (track.format || '').toLowerCase();
  const path = (track.path || track.stream_url || '').toLowerCase();
  const isLoved = Boolean(track.loved === 1 || track.loved === true);

  if (criteria.artist && !artist.includes(criteria.artist)) {
    return false;
  }

  if (criteria.album && !album.includes(criteria.album)) {
    return false;
  }

  if (criteria.title && !title.includes(criteria.title)) {
    return false;
  }

  if (criteria.format && !format.includes(criteria.format) && !path.includes(criteria.format)) {
    return false;
  }

  if (criteria.loved !== undefined && isLoved !== criteria.loved) {
    return false;
  }

  // Free text must match in title, artist, album, or filename
  for (const token of criteria.freeText) {
    const inTitle = title.includes(token);
    const inArtist = artist.includes(token);
    const inAlbum = album.includes(token);
    const inPath = path.includes(token);
    if (!inTitle && !inArtist && !inAlbum && !inPath) {
      return false;
    }
  }

  return true;
}
