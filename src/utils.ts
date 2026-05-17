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
