export interface ScopedSearchCriteria {
  artist?: string;
  album?: string;
  title?: string;
  format?: string;
  loved?: boolean;
  freeText: string[];
}

/**
 * Normalizes text by converting to lowercase and stripping diacritics / accents.
 * e.g. "Beyoncé" -> "beyonce", "Mötley Crüe" -> "motley crue"
 */
export function foldSearchText(text?: string | null): string {
  if (!text) return '';
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Simplifies punctuation to spaces for flexible matching across punctuation differences.
 * e.g. "AC/DC" -> "ac dc", "Guns N' Roses" -> "guns n roses"
 */
export function simplifyPunctuation(text: string): string {
  return text.toLowerCase().replace(/[/'"`´’\-—.,:;&()+!?]/g, ' ').replace(/\s+/g, ' ').trim();
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
  
  // Regex to match supported scoped keys with optional space, either quoted or unquoted values:
  // e.g. artist:"Daft Punk", album:Discovery, format:flac, loved:true
  const scopedRegex = /(?<![a-z0-9])(artist|ar|album|al|title|track|ti|format|ext|loved|favorite|liked):\s*(?:"([^"]+)"|(\S+))/gi;
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

  const rawTitle = track.title || '';
  const rawArtist = track.artist || '';
  const rawAlbumArtist = track.album_artist || track.albumArtist || '';
  const rawAlbum = track.album || '';
  const rawFormat = track.format || '';
  const rawPath = track.path || track.stream_url || '';

  const foldedTitle = foldSearchText(rawTitle);
  const foldedArtist = foldSearchText(rawArtist);
  const foldedAlbumArtist = foldSearchText(rawAlbumArtist);
  const foldedAlbum = foldSearchText(rawAlbum);
  const foldedFormat = foldSearchText(rawFormat);
  const foldedPath = foldSearchText(rawPath);

  const simpleTitle = simplifyPunctuation(foldedTitle);
  const simpleArtist = simplifyPunctuation(foldedArtist);
  const simpleAlbumArtist = simplifyPunctuation(foldedAlbumArtist);
  const simpleAlbum = simplifyPunctuation(foldedAlbum);

  const isLoved = Boolean(track.loved === 1 || track.loved === true);

  if (criteria.artist) {
    const target = foldSearchText(criteria.artist);
    const simpleTarget = simplifyPunctuation(target);
    const matchesArtist =
      foldedArtist.includes(target) ||
      foldedAlbumArtist.includes(target) ||
      (Boolean(simpleTarget) && (simpleArtist.includes(simpleTarget) || simpleAlbumArtist.includes(simpleTarget)));
    if (!matchesArtist) {
      return false;
    }
  }

  if (criteria.album) {
    const target = foldSearchText(criteria.album);
    const simpleTarget = simplifyPunctuation(target);
    const matchesAlbum =
      foldedAlbum.includes(target) ||
      (Boolean(simpleTarget) && simpleAlbum.includes(simpleTarget));
    if (!matchesAlbum) {
      return false;
    }
  }

  if (criteria.title) {
    const target = foldSearchText(criteria.title);
    const simpleTarget = simplifyPunctuation(target);
    const matchesTitle =
      foldedTitle.includes(target) ||
      (Boolean(simpleTarget) && simpleTitle.includes(simpleTarget));
    if (!matchesTitle) {
      return false;
    }
  }

  if (criteria.format && !foldedFormat.includes(criteria.format) && !foldedPath.includes(criteria.format)) {
    return false;
  }

  if (criteria.loved !== undefined && isLoved !== criteria.loved) {
    return false;
  }

  // Free text must match in title, artist, album artist, album, or filename
  for (const token of criteria.freeText) {
    const foldedToken = foldSearchText(token);
    const simpleToken = simplifyPunctuation(foldedToken);

    const inTitle = foldedTitle.includes(foldedToken) || (Boolean(simpleToken) && simpleTitle.includes(simpleToken));
    const inArtist =
      foldedArtist.includes(foldedToken) ||
      foldedAlbumArtist.includes(foldedToken) ||
      (Boolean(simpleToken) && (simpleArtist.includes(simpleToken) || simpleAlbumArtist.includes(simpleToken)));
    const inAlbum = foldedAlbum.includes(foldedToken) || (Boolean(simpleToken) && simpleAlbum.includes(simpleToken));
    const inPath = foldedPath.includes(foldedToken);

    if (!inTitle && !inArtist && !inAlbum && !inPath) {
      return false;
    }
  }

  return true;
}
