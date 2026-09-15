import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

assert(process.argv[2], 'Usage: node scripts/check-ffmpeg-opus.mjs <ffmpeg.exe>');
const ffmpeg = resolve(process.argv[2]);
const work = mkdtempSync(join(tmpdir(), 'aideo-opus-'));

function run(args, input) {
    const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', ...args], {
        input, timeout: 30000, windowsHide: true, maxBuffer: 4 * 1024 * 1024,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr.toString());
    // FFmpeg 8.0.1 exits successfully despite logging the Opus EOF parser error.
    assert.equal(result.stderr.toString().trim(), '', 'FFmpeg emitted an error');
    return result.stdout;
}

try {
    const pcm = Buffer.alloc(48000 * 2 * 2);
    for (let frame = 0; frame < 48000; frame++) {
        const sample = Math.round(8000 * Math.sin(2 * Math.PI * 440 * frame / 48000));
        pcm.writeInt16LE(sample, frame * 4);
        pcm.writeInt16LE(sample, frame * 4 + 2);
    }
    const source = join(work, 'tone.webm');
    run(['-f', 's16le', '-ar', '48000', '-ac', '2', '-i', 'pipe:0',
        '-c:a', 'opus', '-strict', '-2', '-f', 'matroska', source], pcm);

    const decode = ['-f', 'wav', '-acodec', 'pcm_s16le', '-ar', '44100', '-ac', '2', 'pipe:1'];
    const fromFile = run(['-i', source, ...decode]);
    const fromPipe = run(['-probesize', '32768', '-analyzeduration', '100000',
        '-i', 'pipe:0', ...decode], readFileSync(source));
    assert.deepEqual(fromPipe, fromFile, 'Pipe decoding changed the audio');
    assert(fromPipe.length > 44100 * 4, 'Decoded audio is shorter than the one-second fixture');
    console.log('PASS: Opus file and pipe decoding match, with no FFmpeg errors at EOF.');
} finally {
    rmSync(work, { recursive: true, force: true });
}
