import { Track } from '../store/types';

/**
 * Extracts the disc number from track metadata or directory/filename fallback.
 */
export function getDiscNumber(t: Partial<Track> | any): number {
  if (t?.disc_number != null && !isNaN(Number(t.disc_number)) && Number(t.disc_number) > 0) {
    return Number(t.disc_number);
  }
  if (t?.discNumber != null && !isNaN(Number(t.discNumber)) && Number(t.discNumber) > 0) {
    return Number(t.discNumber);
  }
  if (t?.disc != null && !isNaN(Number(t.disc)) && Number(t.disc) > 0) {
    return Number(t.disc);
  }

  const path = t?.path || t?.stream_url || '';
  if (path) {
    // 1. Folder check: "/CD 1/", "/Disc 2/", "/Disk1/"
    const discFolderMatch = path.match(/[\\/](?:cd|disc|disk)\s*(\d+)[\\/]/i);
    if (discFolderMatch) {
      const d = parseInt(discFolderMatch[1], 10);
      if (!isNaN(d) && d > 0) return d;
    }

    // 2. Filename prefix check: "1-01 Track.mp3", "2-05 Track.flac", "CD1_01.mp3"
    const filename = path.split(/[\\/]/).pop() || '';
    const discFileMatch = filename.match(/^(?:cd|disc|disk)?(\d+)[-_]\d{1,3}/i);
    if (discFileMatch) {
      const d = parseInt(discFileMatch[1], 10);
      if (!isNaN(d) && d > 0 && d < 20) return d;
    }
  }

  return 1;
}

/**
 * Extracts the track number from track metadata, filename, or title.
 */
export function getTrackNumber(t: Partial<Track> | any): number {
  if (t?.track_number != null && !isNaN(Number(t.track_number)) && Number(t.track_number) > 0) {
    return Number(t.track_number);
  }
  if (t?.trackNumber != null && !isNaN(Number(t.trackNumber)) && Number(t.trackNumber) > 0) {
    return Number(t.trackNumber);
  }
  if (t?.track != null && !isNaN(Number(t.track)) && Number(t.track) > 0) {
    return Number(t.track);
  }

  const path = t?.path || t?.stream_url || '';
  if (path) {
    const filename = path.split(/[\\/]/).pop() || '';

    // Pattern 1: "1-02 Track.mp3", "CD1-05 Track.flac"
    const discTrackMatch = filename.match(/^(?:(?:cd|disc|disk)?\d+[-._\s]+)?(\d{1,3})[-._\s]+/i);
    if (discTrackMatch) {
      const num = parseInt(discTrackMatch[1], 10);
      if (!isNaN(num) && num > 0) return num;
    }

    // Pattern 2: "Track 01.mp3", "Track_01.flac"
    const trackWordMatch = filename.match(/track\s*(\d{1,3})/i);
    if (trackWordMatch) {
      const num = parseInt(trackWordMatch[1], 10);
      if (!isNaN(num) && num > 0) return num;
    }
  }

  // Fallback to title leading number: "01. Song Name", "01 - Song Name"
  const title = t?.title || '';
  if (title) {
    const titleMatch = title.match(/^(\d{1,3})[-.\s_]+/);
    if (titleMatch) {
      const num = parseInt(titleMatch[1], 10);
      if (!isNaN(num) && num > 0) return num;
    }
  }

  return 0;
}

/**
 * Sorts album tracks by (Disc Number ASC, Track Number ASC, Title ASC).
 */
export function sortAlbumTracks<T extends Partial<Track> | any>(tracks: T[]): T[] {
  return [...tracks].sort((a, b) => {
    const discA = getDiscNumber(a);
    const discB = getDiscNumber(b);
    if (discA !== discB) return discA - discB;

    const trackA = getTrackNumber(a);
    const trackB = getTrackNumber(b);
    if (trackA !== trackB) {
      if (trackA === 0) return 1;
      if (trackB === 0) return -1;
      return trackA - trackB;
    }

    const titleA: string = (a as any)?.title || (a as any)?.path || '';
    const titleB: string = (b as any)?.title || (b as any)?.path || '';
    return titleA.localeCompare(titleB, undefined, { numeric: true, sensitivity: 'base' });
  });
}

/**
 * Groups already-sorted tracks by distinct disc numbers.
 */
export function groupTracksByDisc<T extends Partial<Track> | any>(tracks: T[]): { disc: number; tracks: T[] }[] {
  const sorted = sortAlbumTracks(tracks);
  const map = new Map<number, T[]>();

  for (const t of sorted) {
    const disc = getDiscNumber(t);
    if (!map.has(disc)) {
      map.set(disc, []);
    }
    map.get(disc)!.push(t);
  }

  return Array.from(map.entries())
    .sort(([dA], [dB]) => dA - dB)
    .map(([disc, discTracks]) => ({ disc, tracks: discTracks }));
}

/**
 * Extracts the primary artist name by stripping collaborator suffixes
 * such as "feat.", "ft.", "featuring", "with", "x", "vs.", commas, ampersands, slashes, or semicolons.
 */
export function extractPrimaryArtist(artist?: string | null): string {
  if (!artist || !artist.trim()) return 'Unknown Artist';
  const primary = artist.split(/\s+(?:feat\.|ft\.|featuring|with|x|vs\.?)\s+|[,/;&]|\s+&\s+/i)[0]?.trim();
  return primary || artist.trim();
}

/**
 * Generates a unique, collision-resistant album grouping key for a track.
 */
export function buildAlbumKey(t: Partial<Track> | any): string {
  const albumTitle = t?.album?.trim() || 'Unknown Album';
  const albumArtist = t?.album_artist?.trim() || t?.albumArtist?.trim();
  const trackArtist = t?.artist?.trim() || 'Unknown Artist';
  const isCompilation = t?.compilation === 1 || t?.is_compilation === true || t?.compilation === '1';

  // 1. Explicit compilation or Various Artists
  if (isCompilation || albumArtist?.toLowerCase() === 'various artists' || albumArtist?.toLowerCase() === 'soundtrack') {
    return `various:::${albumTitle.toLowerCase()}`;
  }

  // 2. Explicit album artist
  if (albumArtist) {
    return `${albumArtist.toLowerCase()}:::${albumTitle.toLowerCase()}`;
  }

  // 3. Extract primary artist (handling featured collaborators so tracks on the same album stay grouped)
  const primaryArtist = extractPrimaryArtist(trackArtist);
  return `${primaryArtist.toLowerCase()}:::${albumTitle.toLowerCase()}`;
}
