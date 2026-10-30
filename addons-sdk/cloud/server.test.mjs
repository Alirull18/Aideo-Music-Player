import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { createAdapter, createServer, loadConfig } from './server.mjs';

const subsonic = {
  PROVIDER: 'subsonic', SUBSONIC_URL: 'http://music.test/base/',
  SUBSONIC_USER: 'user + 雪', SUBSONIC_PASSWORD: 'authorized-password',
};
const jellyfin = {
  PROVIDER: 'jellyfin', JELLYFIN_URL: 'https://jellyfin.test/base/',
  JELLYFIN_API_KEY: 'authorized-api-key',
};

async function serve(t, config, fetchUpstream) {
  const server = createServer(loadConfig(config), fetchUpstream);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => {
    server.closeAllConnections();
    server.close(error => error ? reject(error) : resolve());
  }));
  return `http://127.0.0.1:${server.address().port}`;
}

const subsonicSong = {
  id: 'song/雪', title: 'Song 🎵', artist: 'Artist', album: 'Album',
  duration: 201, coverArt: 'cover/1', track: 3, discNumber: 2,
};
const jellyfinSong = {
  Id: 'song-1', Name: 'Song 🎵', Artists: ['One', 'Two'], Album: 'Album',
  RunTimeTicks: 2010000000, ImageTags: { Primary: 'image' },
  IndexNumber: 3, ParentIndexNumber: 2,
};
const json = value => new Response(JSON.stringify(value), {
  headers: { 'content-type': 'application/json' },
});

test('configuration accepts only known providers, valid URLs and server-side credentials', () => {
  assert.equal(loadConfig(subsonic).url, 'http://music.test/base/');
  for (const input of [null, {}, { PROVIDER: 'tidal' }, { ...subsonic, SUBSONIC_PASSWORD: '' },
    { ...jellyfin, JELLYFIN_API_KEY: '' }, { ...subsonic, SUBSONIC_URL: 'file:///tmp/test' },
    { ...subsonic, SUBSONIC_URL: 'https://user:secret@music.test' },
    { ...subsonic, SUBSONIC_URL: 'https://music.test/?token=secret' },
    { ...subsonic, PORT: '65536' }, { ...subsonic, PORT: '0' },
    { ...subsonic, PORT: '1.2' }, { ...subsonic, PORT: 'abc' }]) {
    assert.throws(() => loadConfig(input));
  }
});

test('Subsonic extracts metadata and preserves salted authentication, query and pagination', async () => {
  const requests = [];
  const adapter = createAdapter(loadConfig(subsonic), async (url, options) => {
    requests.push({ url: new URL(url), options });
    return json({ 'subsonic-response': { status: 'ok', searchResult3: { song: [subsonicSong] } } });
  });
  const tracks = await adapter.catalog('雪 & +', 7, 10);
  assert.deepEqual(tracks, [{
    id: 'song/雪', title: 'Song 🎵', artist: 'Artist', album: 'Album', duration: 201,
    coverId: 'cover/1', trackNumber: 3, discNumber: 2,
  }]);
  const { url, options } = requests[0];
  assert.equal(url.pathname, '/base/rest/search3.view');
  assert.equal(url.searchParams.get('query'), '雪 & +');
  assert.equal(url.searchParams.get('u'), subsonic.SUBSONIC_USER);
  assert.equal(url.searchParams.get('songOffset'), '7');
  assert.equal(url.searchParams.get('songCount'), '10');
  assert.equal(url.searchParams.get('t'), createHash('md5')
    .update(subsonic.SUBSONIC_PASSWORD + url.searchParams.get('s')).digest('hex'));
  assert.equal(options.redirect, 'error');
  assert.ok(options.signal instanceof AbortSignal);
  await adapter.catalog('', 0, 1);
  assert.equal(requests[1].url.searchParams.get('query'), '*');
  assert.notEqual(requests[0].url.searchParams.get('s'), requests[1].url.searchParams.get('s'));
});

test('Jellyfin extracts artists, tick durations, artwork and album numbering', async () => {
  const requests = [];
  const adapter = createAdapter(loadConfig(jellyfin), async (url, options) => {
    requests.push({ url: new URL(url), options });
    return json({ Items: [jellyfinSong, { Id: 'fallback', AlbumArtist: 'Fallback' }] });
  });
  const tracks = await adapter.catalog('A & B', 12, 25);
  assert.deepEqual(tracks[0], {
    id: 'song-1', title: 'Song 🎵', artist: 'One, Two', album: 'Album', duration: 201,
    coverId: 'song-1', trackNumber: 3, discNumber: 2,
  });
  assert.equal(tracks[1].artist, 'Fallback');
  assert.equal(tracks[1].duration, 0);
  assert.equal(tracks[1].coverId, null);
  assert.equal(requests[0].url.pathname, '/base/Items');
  assert.equal(requests[0].url.searchParams.get('searchTerm'), 'A & B');
  assert.equal(requests[0].url.searchParams.get('StartIndex'), '12');
  assert.equal(requests[0].url.searchParams.get('Limit'), '25');
  assert.equal(requests[0].url.searchParams.has('api_key'), false);
  assert.equal(requests[0].options.headers['X-Emby-Token'], jellyfin.JELLYFIN_API_KEY);
});

test('catalog handles empty results and rejects malformed, oversized and failed upstream responses', async () => {
  for (const config of [subsonic, jellyfin]) {
    const empty = config.PROVIDER === 'subsonic'
      ? { 'subsonic-response': { status: 'ok' } } : { Items: [] };
    assert.deepEqual(await createAdapter(loadConfig(config), async () => json(empty)).catalog(), []);
    for (const response of [new Response('secret', { status: 401 }), json({ error: 'secret' }),
      new Response('not json'), new Response('x'.repeat(4 * 1024 * 1024 + 1))]) {
      const adapter = createAdapter(loadConfig(config), async () => response);
      await assert.rejects(adapter.catalog(), error => !error.message.includes('secret'));
    }
  }
  const adapter = createAdapter(loadConfig(subsonic), async () => {
    throw new Error('https://user:secret@server/');
  });
  await assert.rejects(adapter.catalog(), error => !error.message.includes('secret'));
});

test('invalid and huge upstream records cannot escape the requested result limit', async () => {
  const songs = [null, { title: 'missing id' }, ...Array.from({ length: 10001 }, (_, id) => ({ id: `${id}` }))];
  const adapter = createAdapter(loadConfig(subsonic), async () => json({
    'subsonic-response': { status: 'ok', searchResult3: { song: songs } },
  }));
  assert.equal((await adapter.catalog('', 0, 100)).length, 100);
  for (const args of [[null], [12], ['', -1], ['', 1.5], ['', 0, 0], ['', 0, 101], ['x'.repeat(513)]]) {
    await assert.rejects(adapter.catalog(...args));
  }
});

test('HTTP catalog and stream expose only local proxy URLs, never upstream credentials', async t => {
  const requests = [];
  const base = await serve(t, subsonic, async (url, options) => {
    requests.push({ url: new URL(url), options });
    if (new URL(url).pathname.endsWith('search3.view')) {
      return json({ 'subsonic-response': { status: 'ok', searchResult3: { song: [subsonicSong] } } });
    }
    return new Response('audio bytes', { status: 206, headers: {
      'content-type': 'audio/flac', 'content-range': 'bytes 2-12/20', 'accept-ranges': 'bytes',
    } });
  });
  const manifest = await (await fetch(`${base}/manifest.json`)).json();
  assert.deepEqual(manifest.resources, ['search', 'stream']);
  assert.equal(manifest.contentType, 'music');
  const response = await fetch(`${base}/search?q=${encodeURIComponent('雪 & +')}`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.tracks[0].id, 'song/雪');
  assert.equal(body.tracks[0].title, 'Song 🎵');
  assert.ok(body.tracks[0].artworkURL.startsWith(`${base}/cover/`));
  const streamResponse = await fetch(`${base}/stream/${encodeURIComponent(body.tracks[0].id)}`);
  const stream = await streamResponse.json();
  assert.ok(stream.url.startsWith(`${base}/audio/`));
  for (const value of [JSON.stringify(body), JSON.stringify(stream), JSON.stringify(manifest)]) {
    for (const secret of [subsonic.SUBSONIC_USER, subsonic.SUBSONIC_PASSWORD, 'music.test', 't=']) {
      assert.ok(!value.includes(secret), `response leaks ${secret}`);
    }
  }
  const audio = await fetch(stream.url,{ headers: { Range: 'bytes=2-12' } });
  assert.equal(audio.status, 206);
  assert.equal(audio.headers.get('content-range'), 'bytes 2-12/20');
  assert.equal(await audio.text(), 'audio bytes');
  assert.equal(requests.at(-1).options.headers.Range, 'bytes=2-12');
  assert.equal(requests.at(-1).url.searchParams.get('id'), 'song/雪');
  const image = await fetch(body.tracks[0].artworkURL);
  assert.equal(image.status, 206);
  assert.equal(requests.at(-1).url.searchParams.get('id'), 'cover/1');
});

test('Jellyfin media proxy keeps its API key in upstream headers and encodes path IDs', async t => {
  const requests = [];
  const base = await serve(t, jellyfin, async (url, options) => {
    requests.push({ url: new URL(url), options });
    return new Response('media', { headers: { 'content-type': 'audio/flac' } });
  });
  const audio = await fetch(`${base}/audio/${encodeURIComponent('jellyfin:雪/1')}`);
  assert.equal(audio.status, 200);
  assert.equal(await audio.text(), 'media');
  assert.equal(requests[0].url.pathname, '/base/Audio/%E9%9B%AA%2F1/stream');
  assert.equal(requests[0].url.searchParams.has('api_key'), false);
  assert.equal(requests[0].options.headers['X-Emby-Token'], jellyfin.JELLYFIN_API_KEY);
  const image = await fetch(`${base}/cover/${encodeURIComponent('jellyfin:雪/1')}`);
  assert.equal(image.status, 200);
  assert.equal(requests[1].url.pathname, '/base/Items/%E9%9B%AA%2F1/Images/Primary');
});

test('server blocks browser cross-origin access, rebinding hosts and invalid requests', async t => {
  let upstreamCalls = 0;
  const base = await serve(t, subsonic, async () => { upstreamCalls++; return json({}); });
  for (const [path, options, status] of [
    ['/manifest.json', { headers: { Origin: 'https://evil.test' } }, 403],
    ['/manifest.json', { method: 'POST' }, 405],
    ['/missing', {}, 404],
    ['/audio/jellyfin:wrong', {}, 400],
    ['/audio/subsonic:%00', {}, 400],
    ['/audio/subsonic:%2E%2E', {}, 400],
    ['/audio/%zz', {}, 400],
    [`/search?q=${'x'.repeat(513)}`, {}, 400],
    ['/stream/%00', {}, 400],
  ]) {
    assert.equal((await fetch(`${base}${path}`, options)).status, status, path);
  }
  // Native fetch normalizes Host; use node:http to exercise the actual rebinding boundary.
  const reboundStatus = await new Promise((resolve, reject) => {
    const request = httpRequest(`${base}/manifest.json`, { headers: { Host: 'evil.test' } }, response => {
      response.resume();
      resolve(response.statusCode);
    });
    request.on('error', reject);
    request.end();
  });
  assert.equal(reboundStatus, 403);
  const allowed = await fetch(`${base}/manifest.json`, { headers: { Origin: 'http://tauri.localhost' } });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://tauri.localhost');
  const preflight = await fetch(`${base}/audio/subsonic:1`, {
    method: 'OPTIONS', headers: { Origin: 'http://localhost:1420' },
  });
  assert.equal(preflight.status, 204);
  assert.equal(upstreamCalls, 0);
});

test('health verifies authorized Subsonic/Jellyfin sessions and rejects failed authentication', async t => {
  for (const config of [subsonic, jellyfin]) {
    const base = await serve(t, config, async () => config.PROVIDER === 'subsonic'
      ? json({ 'subsonic-response': { status: 'ok' } }) : json({ ServerName: 'Personal server' }));
    assert.deepEqual(await (await fetch(`${base}/health`)).json(), { ok: true });
    for (const result of [json({ 'subsonic-response': { status: 'failed' } }),
      new Response('private-error', { status: 401 })]) {
      const adapter = createAdapter(loadConfig(config), async () => result);
      if (config.PROVIDER === 'subsonic' || result.status === 401) await assert.rejects(adapter.ping());
    }
  }
});

test('CLI starts an actual loopback-only adapter and reports invalid environment without secrets', async t => {
  const serverFile = new URL('./server.mjs', import.meta.url);
  const probe = createServer(loadConfig(subsonic));
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const child = spawn(process.execPath, [fileURLToPath(serverFile)], {
    env: { ...process.env, ...subsonic, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => { child.kill(); });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('CLI failed to start')), 5000);
    child.stdout.once('data', data => { clearTimeout(timer); assert.match(String(data), /Manifest: http:\/\/127.0.0.1/); resolve(); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', () => { clearTimeout(timer); reject(new Error('CLI exited before startup')); });
  });
  assert.equal((await fetch(`http://127.0.0.1:${port}/manifest.json`)).status, 200);
  const invalid = spawn(process.execPath, [fileURLToPath(serverFile)], {
    env: { ...process.env, PROVIDER: 'invalid' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const errors = [];
  invalid.stderr.on('data', data => errors.push(String(data)));
  assert.equal((await once(invalid, 'exit'))[0], 1);
  assert.match(errors.join(''), /Invalid server environment/);
});

test('concurrent catalog calls keep salted authorization independent', async () => {
  const salts = [];
  const adapter = createAdapter(loadConfig(subsonic), async url => {
    salts.push(new URL(url).searchParams.get('s'));
    return json({ 'subsonic-response': { status: 'ok' } });
  });
  await Promise.all(Array.from({ length: 20 }, (_, offset) => adapter.catalog('雪', offset)));
  assert.equal(new Set(salts).size, 20);
});

test('loopback server rate limits requests without making upstream calls', async t => {
  const base = await serve(t, subsonic, async () => { throw new Error('must not reach upstream'); });
  for (let i = 0; i < 600; i++) assert.equal((await fetch(`${base}/missing`)).status, 404);
  assert.equal((await fetch(`${base}/manifest.json`)).status, 429);
});

test('upstream errors are generic over HTTP and stream errors preserve range status without leaking secrets', async t => {
  const base = await serve(t, jellyfin, async url => {
    if (new URL(url).pathname.endsWith('/stream')) return new Response('private-error', { status: 416 });
    throw new Error('authorized-api-key');
  });
  const catalog = await fetch(`${base}/search?q=x`);
  assert.equal(catalog.status, 502);
  assert.equal((await catalog.json()).error, 'Upstream request failed');
  const audio = await fetch(`${base}/audio/jellyfin:1`);
  assert.equal(audio.status, 416);
  assert.ok(!(await audio.text()).includes('private-error'));
});
