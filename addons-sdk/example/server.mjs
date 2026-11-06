// Minimal Aideo addon: three generated sine-wave tracks, no dependencies, no credentials.
// Run: node addons-sdk/example/server.mjs   (Node >= 22)
// Install in Aideo with the printed manifest URL: http://127.0.0.1:7100/manifest.json
// Protocol reference: docs/ADDON_DEVELOPMENT.md
import { createServer as httpServer } from 'node:http';
import { pathToFileURL } from 'node:url';

const SAMPLE_RATE = 44_100;
const SECONDS = 3;
const TRACKS = [
  { id: 'tone-220', title: 'A3 Tone', hz: 220 },
  { id: 'tone-440', title: 'A4 Tone', hz: 440 },
  { id: 'tone-880', title: 'A5 Tone', hz: 880 },
];

const MANIFEST = {
  id: 'com.example.tonegen', // lowercase, dotted, [a-z0-9-] segments
  name: 'Tone Generator',
  version: '1.0.0',
  description: 'Example addon that serves generated sine waves',
  resources: ['search', 'stream'], // search + stream is the minimum for a music addon
  contentType: 'music',
};

const wavCache = new Map();

/** 16-bit mono PCM WAV, generated once per tone. */
export function wav(hz) {
  if (wavCache.has(hz)) return wavCache.get(hz);
  const samples = SAMPLE_RATE * SECONDS;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    buffer.writeInt16LE(Math.round(Math.sin((2 * Math.PI * hz * i) / SAMPLE_RATE) * 0.3 * 32767), 44 + i * 2);
  }
  wavCache.set(hz, buffer);
  return buffer;
}

function send(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

function sendAudio(request, response, audio) {
  const headers = { 'Content-Type': 'audio/wav', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
  const range = request.headers.range;
  if (!range) {
    response.writeHead(200, { ...headers, 'Content-Length': audio.length });
    response.end(audio);
    return;
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  const start = match?.[1] ? Number(match[1]) : NaN;
  const end = match?.[2] ? Math.min(Number(match[2]), audio.length - 1) : audio.length - 1;
  if (!match || !Number.isInteger(start) || start > end) {
    response.writeHead(416, { 'Content-Range': `bytes */${audio.length}` });
    response.end();
    return;
  }
  response.writeHead(206, {
    ...headers,
    'Content-Length': end - start + 1,
    'Content-Range': `bytes ${start}-${end}/${audio.length}`,
  });
  response.end(audio.subarray(start, end + 1));
}

export function createServer() {
  const server = httpServer((request, response) => {
    const port = server.address().port;
    // Reject foreign Host headers so a web page cannot reach this server through DNS rebinding.
    if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(request.headers.host)) {
      send(response, 403, { error: 'Loopback clients only' });
      return;
    }
    if (request.method !== 'GET') {
      send(response, 405, { error: 'GET required' });
      return;
    }
    const url = new URL(request.url, `http://127.0.0.1:${port}`);

    if (url.pathname === '/manifest.json') {
      send(response, 200, MANIFEST);
      return;
    }

    if (url.pathname === '/search') {
      const query = (url.searchParams.get('q') ?? '').toLowerCase();
      const tracks = TRACKS.filter((track) => track.title.toLowerCase().includes(query)).map((track) => ({
        id: track.id, // Aideo prefixes it with the addon id, so keep it provider-local
        title: track.title,
        artist: 'Tone Generator',
        album: 'Sine Waves',
        duration: SECONDS,
        codec: 'wav',
        lossless: true,
        sampleRate: SAMPLE_RATE,
        bitDepth: 16,
      }));
      send(response, 200, { tracks });
      return;
    }

    const stream = /^\/stream\/([^/]+)$/.exec(url.pathname);
    if (stream) {
      const track = TRACKS.find((entry) => entry.id === decodeURIComponent(stream[1]));
      if (!track) {
        send(response, 404, { error: 'Unknown track' });
        return;
      }
      // Aideo may send ?quality=best_available|standard_lossless|data_saver; this addon has one rendition.
      send(response, 200, {
        url: `http://127.0.0.1:${port}/audio/${track.id}`,
        codec: 'wav',
        sampleRate: SAMPLE_RATE,
        bitDepth: 16,
      });
      return;
    }

    const audio = /^\/audio\/([^/]+)$/.exec(url.pathname);
    const track = audio && TRACKS.find((entry) => entry.id === decodeURIComponent(audio[1]));
    if (track) {
      sendAudio(request, response, wav(track.hz));
      return;
    }

    send(response, 404, { error: 'Not found' });
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 7100);
  const server = createServer();
  server.on('error', (error) => {
    process.stderr.write(`Example addon failed to start: ${error.code ?? error.message}\n`);
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => {
    process.stdout.write(`Manifest: http://127.0.0.1:${port}/manifest.json\n`);
  });
}
