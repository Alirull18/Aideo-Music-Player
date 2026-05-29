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


