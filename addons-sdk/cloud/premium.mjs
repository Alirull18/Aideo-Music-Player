// Authorized-token subset of HEAD tidal.rs/qobuz.rs: search, quality fallback and signed streams.
// ponytail: supply/rotate your own authorized tokens; add server-side OAuth refresh when unattended use requires it.
import { createHash } from 'node:crypto';
import { invalid, readJson, upstreamError, validateCatalog } from './http.mjs';

export function premiumConfig(env) {
  const provider = env.PROVIDER;
  const token = provider === 'tidal' ? env.TIDAL_ACCESS_TOKEN : env.QOBUZ_AUTH_TOKEN;
  if (typeof token !== 'string' || !token) throw new Error('Set an authorized user token');
  if (provider === 'tidal') {
    const country = env.TIDAL_COUNTRY_CODE;
    if (!/^[A-Z]{2}$/.test(country ?? '')) throw new Error('Set TIDAL_COUNTRY_CODE to your account country');
    return { provider, token, country };
  }
  const appId = env.QOBUZ_APP_ID;
  const secret = env.QOBUZ_APP_SECRET;
  if (typeof appId !== 'string' || !appId || typeof secret !== 'string' || !secret) {
    throw new Error('Set your authorized Qobuz app ID and signing secret');
  }
  return { provider, token, appId, secret };
}

function cdnUrl(value, provider) {
  const url = new URL(value);
  const suffixes = provider === 'tidal'
    ? ['tidal.com', 'tidalhifi.com', 'akamaized.net', 'cloudfront.net']
    : ['qobuz.com', 'cdn-qobuz.com', 'akamaized.net', 'cloudfront.net'];
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')
    || !suffixes.some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`))) throw upstreamError();
  return url;
}

function directManifest(encoded) {
  if (typeof encoded !== 'string') throw upstreamError();
  const decoded = Buffer.from(encoded, 'base64').toString('utf8');
  if (decoded.trim().startsWith('{')) {
    const value = JSON.parse(decoded);
    if ((value.encryptionType && value.encryptionType !== 'NONE') || !Array.isArray(value.urls)
      || value.urls.length !== 1) throw upstreamError();
    return value.urls[0];
  }
  const urls = [...decoded.matchAll(/<BaseURL>([^<]+)<\/BaseURL>/g)];
  if (/<(?:\w+:)?(?:ContentProtection|SegmentTemplate|SegmentList|SegmentBase)\b/.test(decoded)
    || urls.length !== 1) throw upstreamError();
  return urls[0][1].replaceAll('&amp;', '&').trim();
}

function title(item) {
  const name = typeof item.title === 'string' ? item.title : 'Unknown';
  const version = typeof item.version === 'string' ? item.version.trim() : '';
  return version && !name.toLowerCase().includes(version.toLowerCase()) ? `${name} (${version})` : name;
}

export function createPremiumAdapter(config, fetchUpstream) {
  const tidal = config.provider === 'tidal';
  const base = tidal ? 'https://api.tidal.com/v1/' : 'https://www.qobuz.com/api.json/0.2/';
  const auth = tidal ? { Authorization: `Bearer ${config.token}` }
    : { 'X-App-Id': config.appId, 'X-User-Auth-Token': config.token };

  async function fetchSafe(url, headers) {
    try {
      return await fetchUpstream(url, { headers, redirect: 'error', signal: AbortSignal.timeout(30_000) });
    } catch { throw upstreamError(); }
  }
  async function api(path, params = {}) {
    const url = new URL(path, base);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    return fetchSafe(url, auth);
  }
  function validateId(id) {
    if (typeof id !== 'string' || !/^\d{1,20}$/.test(id)) throw invalid();
  }
  async function artwork(id) {
    const item = await readJson(await api(tidal ? `tracks/${id}` : 'track/get', tidal ? {} : { track_id: id }));
    const cover = item?.album?.cover;
    if (tidal) {
      if (typeof cover !== 'string' || !/^[a-zA-Z0-9-]+$/.test(cover)) throw upstreamError();
      return `https://resources.tidal.com/images/${cover.replaceAll('-', '/')}/320x320.jpg`;
    }
    return item?.album?.image?.large || item?.album?.image?.small;
  }
  async function resolve(id) {
    for (const quality of tidal ? ['HI_RES_LOSSLESS', 'HI_RES', 'LOSSLESS', 'HIGH', 'LOW'] : [27, 7, 6, 5]) {
      const params = tidal ? { playbackmode: 'STREAM', audioquality: quality, assetpresentation: 'FULL' }
        : { format_id: quality, intent: 'stream', track_id: id };
      const ts = Math.floor(Date.now() / 1000);
      const input = 'trackgetFileUrl' + Object.keys(params).sort().map(key => `${key}${params[key]}`).join('')
        + ts + config.secret;
      const signedParams = tidal ? params : { ...params, request_ts: ts,
        request_sig: createHash('md5').update(input).digest('hex') };
      const response = await api(tidal ? `tracks/${id}/playbackinfopostpaywall` : 'track/getFileUrl', signedParams);
      if (response.status === 401) { await response.body?.cancel(); throw upstreamError(); }
      try {
        const json = await readJson(response);
        return cdnUrl(tidal ? directManifest(json.manifest) : json.url, config.provider);
      } catch { /* An unavailable entitlement or unusable rendition advances the original quality ladder. */ }
    }
    throw upstreamError();
  }

  return {
    async catalog(query = '', offset = 0, limit = 100) {
      validateCatalog(query, offset, limit);
      const json = await readJson(await api(tidal ? 'search' : 'track/search', {
        query, offset, limit, ...(tidal ? { types: 'TRACKS', countryCode: config.country } : {}),
      }));
      const rows = json?.tracks?.items;
      if (!Array.isArray(rows)) throw upstreamError();
      return rows.filter(item => item && /^\d{1,20}$/.test(String(item.id)) && item.streamable !== false)
        .slice(0, limit).map(item => ({
          id: String(item.id), title: title(item),
          artist: (tidal ? item.artist?.name : item.performer?.name) || item.artists?.[0]?.name || 'Unknown Artist',
          album: item.album?.title || 'Unknown Album', duration: Number.isFinite(item.duration) && item.duration >= 0 ? item.duration : 0,
          coverId: (tidal ? item.album?.cover : item.album?.image?.large || item.album?.image?.small) ? String(item.id) : null,
          trackNumber: (tidal ? item.trackNumber : item.track_number) ?? null,
          discNumber: (tidal ? item.volumeNumber : item.media_number) ?? null,
        }));
    },
    async media(id, cover, headers = {}) {
      validateId(id);
      const url = cover ? cdnUrl(await artwork(id), config.provider) : await resolve(id);
      // Never forward API authorization headers to a CDN, and never expose signed CDN URLs to clients.
      return fetchSafe(url, headers);
    },
    async ping() {
      const response = await api(tidal ? 'sessions' : 'user/get');
      await readJson(response);
      return true;
    },
  };
}
