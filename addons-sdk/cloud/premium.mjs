// Authorized-token subset of HEAD tidal.rs/qobuz.rs: search, quality fallback and signed streams.
// ponytail: supply/rotate your own authorized tokens; add server-side OAuth refresh when unattended use requires it.
import { createHash } from 'node:crypto';
import { invalid, readJson, upstreamError, validateCatalog } from './http.mjs';

export function premiumConfig(env) {
  const provider = env.PROVIDER;
  if (provider === 'tidal') {
    const token = env.TIDAL_ACCESS_TOKEN ?? '';
    const refreshToken = env.TIDAL_REFRESH_TOKEN ?? '';
    const clientId = env.TIDAL_CLIENT_ID ?? '';
    const clientSecret = env.TIDAL_CLIENT_SECRET ?? '';
    const country = env.TIDAL_COUNTRY_CODE ?? '';
    if ([token, refreshToken, clientId, clientSecret, country].some(v => typeof v !== 'string')) {
      throw new Error('Set TIDAL_ACCESS_TOKEN or TIDAL_CLIENT_ID');
    }
    if (!token && !clientId) throw new Error('Set TIDAL_ACCESS_TOKEN or TIDAL_CLIENT_ID');
    if (refreshToken && !clientId) throw new Error('Set TIDAL_CLIENT_ID when using TIDAL_REFRESH_TOKEN');
    if (country && !/^[A-Z]{2}$/.test(country)) throw new Error('Set TIDAL_COUNTRY_CODE to your account country');
    if (!clientId && !/^[A-Z]{2}$/.test(country)) throw new Error('Set TIDAL_COUNTRY_CODE to your account country');
    return { provider, token, refreshToken, clientId, clientSecret, country };
  }
  const token = env.QOBUZ_AUTH_TOKEN;
  if (typeof token !== 'string' || !token) throw new Error('Set an authorized user token');
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
  const session = {
    accessToken: config.token || '',
    refreshToken: config.refreshToken || '',
    expiresAt: config.token && !config.refreshToken ? Infinity : (config.token ? Date.now() + 3600_000 : 0),
    country: config.country || '',
    refreshPromise: null,
    deviceCode: '',
  };

  async function fetchSafe(url, headers) {
    try {
      return await fetchUpstream(url, { headers, redirect: 'error', signal: AbortSignal.timeout(30_000) });
    } catch { throw upstreamError(); }
  }
  async function postForm(url, params) {
    try {
      return await fetchUpstream(new URL(url), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(params).toString(),
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
      });
    } catch { throw upstreamError(); }
  }
  async function refreshAccessToken() {
    if (!tidal || !config.clientId || !session.refreshToken) throw upstreamError();
    if (session.refreshPromise) return session.refreshPromise;
    session.refreshPromise = (async () => {
      const res = await postForm('https://auth.tidal.com/v1/oauth2/token', {
        grant_type: 'refresh_token',
        refresh_token: session.refreshToken,
        client_id: config.clientId,
        ...(config.clientSecret ? { client_secret: config.clientSecret } : {}),
      });
      const data = await readJson(res);
      if (typeof data?.access_token !== 'string' || !data.access_token) throw upstreamError();
      session.accessToken = data.access_token;
      if (typeof data.refresh_token === 'string' && data.refresh_token) {
        session.refreshToken = data.refresh_token;
      }
      session.expiresAt = Date.now() + (Number.isFinite(data.expires_in) && data.expires_in > 0 ? data.expires_in : 3600) * 1000;
      if (!session.country && typeof data.user?.countryCode === 'string' && /^[A-Z]{2}$/.test(data.user.countryCode)) {
        session.country = data.user.countryCode;
      }
      return session.accessToken;
    })().finally(() => { session.refreshPromise = null; });
    return session.refreshPromise;
  }
  async function ensureAccessToken() {
    if (!tidal) return config.token;
    if ((!session.accessToken || Date.now() + 60_000 >= session.expiresAt) && config.clientId && session.refreshToken) {
      await refreshAccessToken();
    }
    if (!session.accessToken) throw upstreamError();
    return session.accessToken;
  }
  async function api(path, params = {}, allowRetry = true) {
    const token = await ensureAccessToken();
    const url = new URL(path, base);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    const headers = tidal ? { Authorization: `Bearer ${token}` }
      : { 'X-App-Id': config.appId, 'X-User-Auth-Token': token };
    const res = await fetchSafe(url, headers);
    if (tidal && res.status === 401 && allowRetry && config.clientId && session.refreshToken) {
      await res.body?.cancel();
      await refreshAccessToken();
      return api(path, params, false);
    }
    return res;
  }
  async function ensureCountry() {
    if (!session.country) await ensureAccessToken();
    if (session.country) return session.country;
    const data = await readJson(await api('sessions'));
    if (typeof data?.countryCode === 'string' && /^[A-Z]{2}$/.test(data.countryCode)) {
      session.country = data.countryCode;
      return session.country;
    }
    throw upstreamError();
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
      const countryCode = tidal ? await ensureCountry() : undefined;
      const json = await readJson(await api(tidal ? 'search' : 'track/search', {
        query, offset, limit, ...(tidal ? { types: 'TRACKS', countryCode } : {}),
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
    async startDeviceAuth() {
      if (!tidal || !config.clientId) throw invalid();
      const data = await readJson(await postForm('https://auth.tidal.com/v1/oauth2/device_authorization', {
        client_id: config.clientId,
        scope: 'r_usr w_usr w_sub',
        ...(config.clientSecret ? { client_secret: config.clientSecret } : {}),
      }));
      if (typeof data?.deviceCode !== 'string' || !data.deviceCode
        || typeof data?.userCode !== 'string' || !data.userCode) throw upstreamError();
      session.deviceCode = data.deviceCode;
      const rawComplete = typeof data.verificationUriComplete === 'string' && data.verificationUriComplete
        ? data.verificationUriComplete : 'https://link.tidal.com';
      const verificationUriComplete = /^https?:\/\//i.test(rawComplete) ? rawComplete : `https://${rawComplete}`;
      let parsed;
      try { parsed = new URL(verificationUriComplete); } catch { throw upstreamError(); }
      if (parsed.protocol !== 'https:'
        || (parsed.hostname !== 'tidal.com' && !parsed.hostname.endsWith('.tidal.com'))) throw upstreamError();
      return {
        userCode: data.userCode,
        verificationUri: typeof data.verificationUri === 'string' ? data.verificationUri : 'link.tidal.com',
        verificationUriComplete,
        expiresIn: Number.isFinite(data.expiresIn) ? data.expiresIn : 300,
        interval: Number.isFinite(data.interval) ? data.interval : 5,
      };
    },
    async pollDeviceAuth() {
      if (!tidal || !config.clientId || !session.deviceCode) throw invalid();
      const res = await postForm('https://auth.tidal.com/v1/oauth2/token', {
        client_id: config.clientId,
        ...(config.clientSecret ? { client_secret: config.clientSecret } : {}),
        device_code: session.deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        scope: 'r_usr w_usr w_sub',
      });
      if (res.ok) {
        const data = await readJson(res);
        if (typeof data?.access_token !== 'string' || !data.access_token) throw upstreamError();
        session.accessToken = data.access_token;
        session.refreshToken = typeof data.refresh_token === 'string' && data.refresh_token
          ? data.refresh_token : session.refreshToken;
        session.expiresAt = Date.now() + (Number.isFinite(data.expires_in) && data.expires_in > 0 ? data.expires_in : 3600) * 1000;
        if (typeof data.user?.countryCode === 'string' && /^[A-Z]{2}$/.test(data.user.countryCode)) {
          session.country = data.user.countryCode;
        }
        session.deviceCode = '';
        return { authenticated: true, countryCode: session.country || null };
      }
      if (res.status === 400) {
        let err;
        try { err = await res.json(); } catch { err = null; }
        if (err?.error === 'authorization_pending' || err?.error === 'slow_down') {
          return { authenticated: false, pending: true };
        }
        session.deviceCode = '';
        throw upstreamError();
      }
      await res.body?.cancel();
      session.deviceCode = '';
      throw upstreamError();
    },
  };
}
