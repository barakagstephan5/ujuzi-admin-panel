import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cancelUpload, fileKey, formatBytes, formatDuration, timeLeft, uploadVideo } from '../src/videoUpload.js';

const MB = 1024 * 1024;
const fakeFile = (size, name = 'Somo.mp4') => ({
  name, size, type: 'video/mp4', lastModified: 1700000000000,
  slice: (start, end) => ({ size: Math.min(end, size) - start, start }),
});
const memoryStore = () => {
  const data = new Map();
  return { data, get: (k) => data.get(k) ?? null, set: (k, v) => data.set(k, v), remove: (k) => data.delete(k) };
};

/** A fake admin-media and R2: parts land in `r2`, part size 16 MB like the server. */
function fakeServer({ partSize = 16 * MB } = {}) {
  const r2 = new Map();
  const calls = [];
  let file = null;
  const parts = () => Math.ceil(file.bytes / partSize);
  const call = async (action, body) => {
    calls.push(action);
    if (action === 'start') {
      file = { id: 'asset-1', bytes: body.bytes, gone: false };
      return { asset_id: 'asset-1', part_size: partSize, parts: parts() };
    }
    if (file?.gone) throw new Error('This upload expired. Start it again.');
    if (action === 'status') return { part_size: partSize, parts: parts(), done: [...r2.keys()].sort((a, b) => a - b) };
    if (action === 'sign') return { links: Object.fromEntries(body.parts.map((n) => [n, `https://r2.test/part/${n}`])) };
    if (action === 'complete') {
      if (r2.size !== parts()) throw new Error('Some parts are missing. Resume the upload.');
      return { asset: { id: 'asset-1', bytes: file.bytes } };
    }
    if (action === 'abort') { file.gone = true; return { ok: true }; }
    throw new Error('unexpected ' + action);
  };
  return { r2, calls, call, forget: () => { file.gone = true; } };
}
const instant = async () => {};

test('a video goes up part by part, retrying a failed part, and reports progress to 100%', async () => {
  const server = fakeServer();
  let failures = 2;
  const put = async (url, blob, { onProgress }) => {
    const n = Number(url.split('/').pop());
    if (n === 2 && failures-- > 0) throw Object.assign(new Error('network'), { status: 0 });
    onProgress?.(blob.size);
    server.r2.set(n, blob.size);
  };
  const seen = [];
  const store = memoryStore();
  const asset = await uploadVideo(fakeFile(40 * MB), { call: server.call, put, store, wait: instant, onProgress: (p) => seen.push(p) });
  assert.equal(asset.id, 'asset-1');
  assert.deepEqual([...server.r2.keys()].sort(), [1, 2, 3]);
  assert.equal(seen.at(-1).sent, 40 * MB);
  assert.equal(store.data.size, 0, 'the resume entry goes once the video is ready');
});

test('Pause keeps the upload; choosing the same file again sends only the missing parts', async () => {
  const server = fakeServer();
  const store = memoryStore();
  const file = fakeFile(64 * MB);
  const stop = new AbortController();
  const put = async (url, blob) => {
    const n = Number(url.split('/').pop());
    if (n === 3) { stop.abort(); throw new DOMException('Stopped', 'AbortError'); }
    server.r2.set(n, blob.size);
  };
  await assert.rejects(uploadVideo(file, { call: server.call, put, store, wait: instant, signal: stop.signal, concurrency: 1 }), { name: 'AbortError' });
  assert.equal(store.data.get(fileKey(file)).asset_id, 'asset-1');

  const sent = [];
  const resumePut = async (url, blob) => { const n = Number(url.split('/').pop()); sent.push(n); server.r2.set(n, blob.size); };
  const asset = await uploadVideo(file, { call: server.call, put: resumePut, store, wait: instant });
  assert.equal(asset.id, 'asset-1');
  assert.deepEqual(sent.sort(), [3, 4], 'parts 1 and 2 were already on R2');
  assert.equal(server.calls.filter((c) => c === 'start').length, 1, 'no second upload was opened');
});

test('a saved upload that expired starts over instead of failing', async () => {
  const server = fakeServer();
  const store = memoryStore();
  const file = fakeFile(20 * MB);
  store.set(fileKey(file), { asset_id: 'old-asset' });
  await server.call('start', { bytes: 1 });
  server.forget();
  const put = async (url, blob) => server.r2.set(Number(url.split('/').pop()), blob.size);
  const asset = await uploadVideo(file, { call: server.call, put, store, wait: instant });
  assert.equal(asset.id, 'asset-1');
  assert.equal(server.calls.filter((c) => c === 'start').length, 2);
});

test('a part R2 lost is sent again before the video is joined', async () => {
  const server = fakeServer();
  let dropped = false;
  const put = async (url, blob) => {
    const n = Number(url.split('/').pop());
    if (n === 1 && !dropped) { dropped = true; return; } // looked fine, never arrived
    server.r2.set(n, blob.size);
  };
  const asset = await uploadVideo(fakeFile(40 * MB), { call: server.call, put, store: memoryStore(), wait: instant });
  assert.equal(asset.id, 'asset-1');
  assert.equal(server.r2.size, 3);
});

test('a part that keeps failing stops with a sentence a person can act on', async () => {
  const server = fakeServer();
  const put = async () => { throw Object.assign(new Error('network'), { status: 0 }); };
  await assert.rejects(uploadVideo(fakeFile(20 * MB), { call: server.call, put, store: memoryStore(), wait: instant }), /press Resume/);
});

test('Cancel drops the upload on R2 and forgets it', async () => {
  const server = fakeServer();
  const store = memoryStore();
  const file = fakeFile(20 * MB);
  await server.call('start', { bytes: file.size });
  store.set(fileKey(file), { asset_id: 'asset-1' });
  await cancelUpload(file, { call: server.call, store });
  assert.equal(store.data.size, 0);
  assert.ok(server.calls.includes('abort'));
});

test('sizes, durations and time left read naturally', () => {
  assert.equal(formatBytes(12 * MB), '12 MB');
  assert.equal(formatBytes(1.4 * 1024 * MB), '1.4 GB');
  assert.equal(formatDuration(3909), '1:05:09');
  assert.equal(formatDuration(724), '12:04');
  assert.equal(timeLeft(100 * MB, 1 * MB), 'About 2 min left');
  assert.equal(timeLeft(10 * MB, 1 * MB), 'Less than a minute left');
  assert.equal(timeLeft(10, 0), '');
});
