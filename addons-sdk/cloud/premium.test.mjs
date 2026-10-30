import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';
import { createAdapter, createServer, loadConfig } from './server.mjs';

const tidal = { PROVIDER: 'tidal', TIDAL_ACCESS_TOKEN: 'authorized-token', TIDAL_COUNTRY_CODE: 'MY' };
const qobuz = { PROVIDER: 'qobuz', QOBUZ_AUTH_TOKEN: 'authorized-token', QOBUZ_APP_ID: 'authorized-app',
  QOBUZ_APP_SECRET: 'authorized-secret' };
const json = value => new Response(JSON.stringify(value));
const manifest = value => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64');

test('premium configuration requires authorized tokens and Qobuz signing credentials, with no built-in credentials', () => {
  assert.equal(loadConfig(tidal).provider, 'tidal');
  assert.equal(loadConfig(qobuz).provider, 'qobuz');
  assert.equal(loadConfig(tidal).port, 7013);
  assert.equal(loadConfig(qobuz).port, 7014);
  for (const env of [{ ...tidal, TIDAL_ACCESS_TOKEN: '' }, { ...tidal, TIDAL_COUNTRY_CODE: 'not-country' },
    { ...qobuz, QOBUZ_AUTH_TOKEN: '' }, { ...qobuz, QOBUZ_APP_ID: '' }, { ...qobuz, QOBUZ_APP_SECRET: '' }]) {
    assert.throws(() => loadConfig(env));
  }
});

test('Tidal search carries bearer auth, pagination, region and versioned metadata', async () => {
  const calls = [];
  const adapter = createAdapter(loadConfig(tidal), async (url, options) => {
    calls.push({ url: new URL(url), options });
    return json({ tracks: { items: [{ id: 42, title: 'Title', version: 'Live',
      artist: { name: 'Artist' }, album: { title: 'Album', cover: 'a-b-c' }, duration: 123,
      trackNumber: 3, volumeNumber: 2 }] } });
  });
  const tracks = await adapter.catalog('雪 & +', 25, 50);
  assert.equal(tracks[0].id, '42');
  assert.equal(tracks[0].title, 'Title (Live)');
  assert.equal(tracks[0].artist, 'Artist');
  assert.equal(tracks[0].coverId, '42');
  assert.equal(tracks[0].duration, 123);
  assert.equal(tracks[0].trackNumber, 3);
  assert.equal(tracks[0].discNumber, 2);
  assert.equal(calls[0].url.origin, 'https://api.tidal.com');
  assert.equal(calls[0].url.pathname, '/v1/search');
  assert.equal(calls[0].url.searchParams.get('query'), '雪 & +');
  assert.equal(calls[0].url.searchParams.get('countryCode'), 'MY');
  assert.equal(calls[0].url.searchParams.get('offset'), '25');
  assert.equal(calls[0].url.searchParams.get('limit'), '50');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer authorized-token');
  assert.equal(calls[0].options.redirect, 'error');
  await assert.rejects(adapter.catalog(null));
});

test('Qobuz search carries app/token headers, preserves version metadata and excludes unstreamable tracks', async () => {
  const calls = [];
  const adapter = createAdapter(loadConfig(qobuz), async (url, options) => {
    calls.push({ url: new URL(url), options });
    return json({ tracks: { items: [null, { id: 0, streamable: false }, { id: 42, title: 'Title',
      version: 'Live', performer: { name: 'Artist' }, album: { title: 'Album', image: { small: 'https://static.qobuz.com/image.jpg' } },
      duration: 123, track_number: 3, media_number: 2 }] } });
  });
  const tracks = await adapter.catalog('雪 & +', 25, 50);
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].title, 'Title (Live)');
  assert.equal(tracks[0].artist, 'Artist');
  assert.equal(tracks[0].coverId, '42');
  assert.equal(tracks[0].trackNumber, 3);
  assert.equal(tracks[0].discNumber, 2);
  assert.equal(calls[0].url.pathname, '/api.json/0.2/track/search');
  assert.equal(calls[0].url.searchParams.get('query'), '雪 & +');
  assert.equal(calls[0].options.headers['X-App-Id'], 'authorized-app');
  assert.equal(calls[0].options.headers['X-User-Auth-Token'], 'authorized-token');
  assert.equal(calls[0].url.searchParams.has('user_auth_token'), false);
});

test('Tidal quality fallback rejects encryption, segmented and non-HTTPS manifests before proxying usable audio', async () => {
  const calls = [];
  const invalid = [
    { encryptionType: 'OLD_AES', urls: ['https://audio.tidal.com/one'] },
    { urls: ['https://audio.tidal.com/one', 'https://audio.tidal.com/two'] },
    { urls: ['file:///private'] },
    { urls: ['https://127.0.0.1/private'] },
  ];
  const adapter = createAdapter(loadConfig(tidal), async (url, options) => {
    const parsed = new URL(url);
    calls.push({ url: parsed, options });
    if (parsed.pathname.includes('playbackinfopostpaywall')) {
      return json({ manifest: manifest(invalid.shift() ?? { encryptionType: 'NONE', urls: ['https://audio.tidal.com/usable?secret=cdn'] }) });
    }
    return new Response('audio');
  });
  assert.equal(await (await adapter.media('42', false, { Range: 'bytes=0-9' })).text(), 'audio');
  assert.deepEqual(calls.slice(0, 5).map(call => call.url.searchParams.get('audioquality')),
    ['HI_RES_LOSSLESS', 'HI_RES', 'LOSSLESS', 'HIGH', 'LOW']);
  assert.equal(calls.at(-1).url.href, 'https://audio.tidal.com/usable?secret=cdn');
  assert.equal(calls.at(-1).options.headers.Authorization, undefined);
  assert.equal(calls.at(-1).options.headers.Range, 'bytes=0-9');
});

test('Tidal refuses encrypted/segmented XML but accepts a single unencrypted BaseURL', async () => {
  for (const xml of [
    '<MPD><ContentProtection/><BaseURL>https://audio.tidal.com/audio</BaseURL></MPD>',
    '<MPD><SegmentTemplate/><BaseURL>https://audio.tidal.com/audio</BaseURL></MPD>',
    '<MPD><BaseURL>https://audio.tidal.com/audio</BaseURL><BaseURL>https://audio.tidal.com/other</BaseURL></MPD>',
  ]) {
    const adapter = createAdapter(loadConfig(tidal), async () => json({ manifest: manifest(xml) }));
    await assert.rejects(adapter.media('42', false));
  }
  const adapter = createAdapter(loadConfig(tidal), async url => new URL(url).hostname === 'api.tidal.com'
    ? json({ manifest: manifest('<MPD><BaseURL>https://audio.tidal.com/audio?a=1&amp;b=2</BaseURL></MPD>') })
    : new Response('audio'));
  assert.equal(await (await adapter.media('42', false)).text(), 'audio');
});

test('Qobuz signs exactly the extracted HEAD formula and falls back through authorized formats', async () => {
  const calls = [];
  const adapter = createAdapter(loadConfig(qobuz), async (url, options) => {
    const parsed = new URL(url);
    calls.push({ url: parsed, options });
    if (parsed.pathname.endsWith('getFileUrl')) return parsed.searchParams.get('format_id') === '5'
      ? json({ url: 'https://streaming-qobuz-std.akamaized.net/audio?secret=cdn' })
      : new Response('subscription restriction', { status: 403 });
    return new Response('audio');
  });
  assert.equal(await (await adapter.media('42', false)).text(), 'audio');
  assert.deepEqual(calls.slice(0, 4).map(call => call.url.searchParams.get('format_id')), ['27', '7', '6', '5']);
  const signed = calls[0].url.searchParams;
  assert.equal(signed.get('request_sig'), createHash('md5').update(
    `trackgetFileUrlformat_id27intentstreamtrack_id42${signed.get('request_ts')}authorized-secret`,
  ).digest('hex'));
  assert.equal(calls.at(-1).options.headers['X-User-Auth-Token'], undefined);
  assert.equal(calls.at(-1).options.headers['X-App-Id'], undefined);
});

test('premium auth failures stop retries and malformed responses fail without credential leakage', async () => {
  for (const config of [tidal, qobuz]) {
    let calls = 0;
    const adapter = createAdapter(loadConfig(config), async () => {
      calls++; return new Response('authorized-token', { status: 401 });
    });
    await assert.rejects(adapter.media('42', false), error => !error.message.includes('authorized-token'));
    assert.equal(calls, 1);
    await assert.rejects(adapter.media('../42', false));
    assert.equal(calls, 1);
    await assert.rejects(adapter.catalog(), error => !error.message.includes('authorized-token'));
    const malformed = createAdapter(loadConfig(config), async () => json({}));
    await assert.rejects(malformed.catalog());
    await assert.rejects(malformed.media('42', false));
    const network = createAdapter(loadConfig(config), async () => { throw new Error('authorized-token'); });
    await assert.rejects(network.catalog(), error => !error.message.includes('authorized-token'));
  }
});

test('premium artwork proxy uses provider metadata rather than client-supplied URLs', async () => {
  for (const [config, metadata, image] of [
    [tidal, { album: { cover: 'a-b-c' } }, 'https://resources.tidal.com/images/a/b/c/320x320.jpg'],
    [qobuz, { album: { image: { large: 'https://static.qobuz.com/image.jpg' } } }, 'https://static.qobuz.com/image.jpg'],
  ]) {
    const calls = [];
    const adapter = createAdapter(loadConfig(config), async (url, options) => {
      calls.push({ url: new URL(url), options });
      return calls.length === 1 ? json(metadata) : new Response('image');
    });
    assert.equal(await (await adapter.media('42', true)).text(), 'image');
    assert.equal(calls.at(-1).url.href, image);
    assert.deepEqual(calls.at(-1).options.headers, {});
  }
});

test('premium health uses authenticated session endpoints; HTTP streams contain only loopback proxy URLs', async t => {
  for (const config of [tidal, qobuz]) {
    const calls = [];
    const server = createServer(loadConfig(config), async url => { calls.push(new URL(url)); return json({}); });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    const base = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(`${base}/health`)).status, 200);
    const stream = await (await fetch(`${base}/stream/42`)).json();
    assert.ok(stream.url.startsWith(`${base}/audio/`));
    assert.ok(!JSON.stringify(stream).includes('authorized'));
    assert.ok(calls[0].pathname.endsWith(config.PROVIDER === 'tidal' ? '/sessions' : '/user/get'));
  }
});
