// Uploads an Ujuzi lesson video straight to R2 in parts, through the
// admin-media function. Parts go up three at a time; a failed part is sent
// again with a growing pause; an upload stopped half way (closed tab, lost
// connection, Pause) resumes from the parts R2 already holds when the same
// file is chosen again. Kept apart from the screen so it can be tested.

const RETRIES = 6;
const SIGN_BATCH = 12;

/** The same file (name, size, date) always gets the same resume entry. */
export const fileKey = (file) => `ujuzi-video-upload:${file.name}|${file.size}|${file.lastModified ?? 0}`;

/** Resume entries live in localStorage; a browser that refuses storage simply cannot resume. */
export const browserStore = {
  get(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private window */ } },
  remove(key) { try { localStorage.removeItem(key); } catch { /* private window */ } },
};

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(new DOMException('Stopped', 'AbortError'));
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Stopped', 'AbortError')); }, { once: true });
});

/** PUT with upload progress. Resolves on 2xx; rejects with .status otherwise. */
export function xhrPut(url, body, { headers = {}, onProgress, signal } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (e) => onProgress?.(e.loaded);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(Object.assign(new Error('upload_failed'), { status: xhr.status })));
    xhr.onerror = () => reject(Object.assign(new Error('network'), { status: 0 }));
    xhr.onabort = () => reject(new DOMException('Stopped', 'AbortError'));
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(body);
  });
}

const isAbort = (e) => e?.name === 'AbortError';
// The function's 404 and 410 mean the saved upload is gone: start again.
const isGone = (e) => /not found|expired|Start it again/i.test(String(e?.message || ''));

/**
 * Uploads `file` and returns the finished video { id, name, bytes, duration_seconds }.
 * call(action, body) talks to admin-media; put(url, blob, opts) sends one part.
 * onProgress({ sent, total }) reports bytes on R2 so far.
 */
export async function uploadVideo(file, {
  call, put = xhrPut, store = browserStore, onProgress, signal, durationSeconds = null, concurrency = 3, wait = sleep,
} = {}) {
  const key = fileKey(file);
  let plan = null;
  let done = new Set();
  const saved = store.get(key);
  if (saved?.asset_id) {
    try {
      const status = await call('status', { asset_id: saved.asset_id });
      plan = { asset_id: saved.asset_id, part_size: status.part_size, parts: status.parts };
      done = new Set(status.done);
    } catch (e) {
      if (!isGone(e)) throw e;
      store.remove(key);
    }
  }
  if (!plan) {
    plan = await call('start', { name: file.name, type: file.type || 'video/mp4', bytes: file.size, duration_seconds: durationSeconds });
    store.set(key, { asset_id: plan.asset_id, at: Date.now() });
  }

  const sizeOf = (n) => (n < plan.parts ? plan.part_size : file.size - plan.part_size * (plan.parts - 1));
  const inFlight = new Map();
  let finished = [...done].reduce((sum, n) => sum + sizeOf(n), 0);
  const report = () => onProgress?.({ sent: finished + [...inFlight.values()].reduce((a, b) => a + b, 0), total: file.size });
  report();

  const queue = Array.from({ length: plan.parts }, (_, i) => i + 1).filter((n) => !done.has(n));
  const links = new Map();
  const linkFor = async (n) => {
    if (!links.has(n)) {
      const batch = [n, ...queue.slice(0, SIGN_BATCH - 1)];
      const { links: signed } = await call('sign', { asset_id: plan.asset_id, parts: batch });
      for (const [num, url] of Object.entries(signed)) links.set(Number(num), url);
    }
    return links.get(n);
  };

  const sendPart = async (n) => {
    const blob = file.slice(plan.part_size * (n - 1), plan.part_size * (n - 1) + sizeOf(n));
    for (let attempt = 1; ; attempt++) {
      try {
        await put(await linkFor(n), blob, { signal, onProgress: (loaded) => { inFlight.set(n, loaded); report(); } });
        inFlight.delete(n);
        finished += sizeOf(n);
        report();
        return;
      } catch (e) {
        inFlight.delete(n);
        report();
        if (isAbort(e) || signal?.aborted) throw new DOMException('Stopped', 'AbortError');
        if (attempt >= RETRIES) throw new Error('A part of the video would not upload. Check your connection, then press Resume.');
        if (e?.status === 403) links.delete(n); // the signed link expired: sign again
        await wait(Math.min(30_000, 1000 * 2 ** (attempt - 1)), signal);
      }
    }
  };

  const worker = async () => { while (queue.length) await sendPart(queue.shift()); };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));

  let result;
  try {
    result = await call('complete', { asset_id: plan.asset_id });
  } catch (e) {
    if (!/parts are missing/i.test(String(e?.message))) throw e;
    // R2 is missing a part we thought went up: one more pass fills it in.
    const status = await call('status', { asset_id: plan.asset_id });
    const missing = Array.from({ length: plan.parts }, (_, i) => i + 1).filter((n) => !status.done.includes(n));
    queue.push(...missing);
    finished = status.done.reduce((sum, n) => sum + sizeOf(n), 0);
    links.clear();
    await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
    result = await call('complete', { asset_id: plan.asset_id });
  }
  store.remove(key);
  return result.asset;
}

/** Gives up an upload for good: R2 drops its parts and the resume entry goes. */
export async function cancelUpload(file, { call, store = browserStore }) {
  const saved = store.get(fileKey(file));
  store.remove(fileKey(file));
  if (saved?.asset_id) await call('abort', { asset_id: saved.asset_id }).catch(() => {});
}

/**
 * Sends the small copy or the audio-only copy of a finished video. Learners
 * on slow connections use them; failing here never loses the video itself.
 */
export async function uploadCopy(assetId, label, file, { call, put = xhrPut, signal, onProgress }) {
  const signed = await call('copy_start', { asset_id: assetId, label, bytes: file.size });
  await put(signed.upload_url, file, { headers: { 'Content-Type': signed.content_type }, signal, onProgress });
  return call('copy_complete', { copy_id: signed.copy_id });
}

/** "12 MB", "1.4 GB". */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
}

/** "1:05:09", "12:04". */
export function formatDuration(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const two = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${two(m)}:${two(r)}` : `${m}:${two(r)}`;
}

/** Time left at the recent speed, "About 4 min left"; empty while unknown. */
export function timeLeft(bytesLeft, bytesPerSecond) {
  if (!(bytesPerSecond > 0) || !(bytesLeft > 0)) return '';
  const seconds = bytesLeft / bytesPerSecond;
  if (seconds < 60) return 'Less than a minute left';
  if (seconds < 3600) return `About ${Math.ceil(seconds / 60)} min left`;
  return `About ${(seconds / 3600).toFixed(1)} h left`;
}
