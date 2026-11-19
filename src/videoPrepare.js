// A copy of instructor-app/src/lib/videoPrepare.js in the Learning App repo. Keep the two the same.
//
// Prepares a lesson video on the admin's own computer before upload, using
// the browser's hardware video encoder. Learners get a compressed main video, a
// small copy for slow connections and an audio-only copy, and Ujuzi pays for no
// video servers. Browsers that cannot do this upload the original file as before,
// so this only ever makes things better.
//
// Files are written to the browser's private disk (OPFS) rather than memory, so an
// hour-long lesson does not fill the tab's memory, and moved to R2 from there.

const MAIN = { shortEdge: 720, bitrate: 1_400_000, frameRate: 30 };
const LOW = { shortEdge: 360, bitrate: 350_000, frameRate: 24 };
const AUDIO_BITRATE = 48_000;
const MAIN_AUDIO_BITRATE = 96_000;
// A source this light is already fine: leave it alone rather than lose quality.
const KEEP_ORIGINAL_BITRATE = 2_200_000;
const WORK_DIR = 'ujuzi-video-prepare';

let library = null;
const loadLibrary = () => (library ??= import('mediabunny'));

export async function canPrepareVideos() {
  if (typeof VideoEncoder === 'undefined' || typeof VideoDecoder === 'undefined' || !navigator.storage?.getDirectory) return false;
  try {
    const { canEncodeVideo } = await loadLibrary();
    return await canEncodeVideo('avc', { width: 1280, height: 720, bitrate: MAIN.bitrate });
  } catch {
    return false;
  }
}

const workDir = async () => (await navigator.storage.getDirectory()).getDirectoryHandle(WORK_DIR, { create: true });

export async function clearPreparedVideos() {
  try { await (await navigator.storage.getDirectory()).removeEntry(WORK_DIR, { recursive: true }); } catch { /* nothing to clear */ }
}

// Scales the short edge, so a phone video recorded upright stays upright.
const size = ({ width, height }, shortEdge) => (width >= height ? { height: Math.min(height, shortEdge) } : { width: Math.min(width, shortEdge) });

// A track dropped for any reason except our own request would lose the sound or
// the picture without warning, so that counts as failure.
const lostTrack = (conversion) => !conversion.isValid || conversion.discardedTracks.some(d => d.reason !== 'discarded_by_user');

const AUDIO_PACKETS_PER_SECOND = 50;
const packetLimit = (seconds, perSecond) => Math.ceil(seconds * (perSecond || 60) * 1.1) + 100;

async function convert(lib, file, name, seconds, { video, audio }, onProgress, signal) {
  const dir = await workDir();
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  const start = (audioOptions) => {
    const input = new lib.Input({ source: new lib.BlobSource(file), formats: lib.ALL_FORMATS });
    // Fast start: the index sits at the front, so playback and seeking need no
    // extra trips to the far end of the file.
    const output = new lib.Output({ format: new lib.Mp4OutputFormat({ fastStart: 'reserve' }), target: new lib.StreamTarget(writable) });
    // That space is reserved up front from how many packets each track can have.
    // Going over stops the conversion, and the original file is uploaded instead.
    const addVideo = output.addVideoTrack.bind(output);
    const addAudio = output.addAudioTrack.bind(output);
    output.addVideoTrack = (source, meta) => addVideo(source, { ...meta, maximumPacketCount: packetLimit(seconds, video?.frameRate) });
    output.addAudioTrack = (source, meta) => addAudio(source, { ...meta, maximumPacketCount: packetLimit(seconds, AUDIO_PACKETS_PER_SECOND) });
    return lib.Conversion.init({ input, output, video, audio: audioOptions }).then(conversion => ({ conversion, input }));
  };
  // Not every browser can encode AAC. Copying the original sound still works.
  let { conversion, input } = await start(audio);
  if (lostTrack(conversion)) ({ conversion, input } = await start({}));
  if (lostTrack(conversion)) throw new Error('video_not_convertible');
  const stop = () => { conversion.cancel().catch(() => {}); };
  signal?.addEventListener('abort', stop, { once: true });
  conversion.onProgress = onProgress;
  try {
    await conversion.execute();
  } finally {
    signal?.removeEventListener('abort', stop);
    input.dispose?.();
  }
  if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
  return handle.getFile();
}

/**
 * Returns { main, low, audio }. main is the file to upload as the video (the
 * original if it is already light enough); low and audio may be null.
 * Throws on any failure, and the caller uploads the original.
 */
export async function prepareVideo(file, { onProgress, signal } = {}) {
  const lib = await loadLibrary();
  const probe = new lib.Input({ source: new lib.BlobSource(file), formats: lib.ALL_FORMATS });
  const track = await probe.getPrimaryVideoTrack();
  if (!track) throw new Error('no_video_track');
  const source = { width: await track.getDisplayWidth(), height: await track.getDisplayHeight() };
  const seconds = await probe.computeDuration();
  const codec = await track.getCodec();
  const hasAudio = !!(await probe.getPrimaryAudioTrack());
  const mime = await probe.getMimeType().catch(() => '');
  probe.dispose?.();
  if (!seconds) throw new Error('no_duration');

  const shortEdge = Math.min(source.width, source.height);
  const bitrate = (file.size * 8) / seconds;
  const keepMain = shortEdge <= MAIN.shortEdge && bitrate <= KEEP_ORIGINAL_BITRATE && codec === 'avc' && String(mime).includes('mp4');
  const makeLow = shortEdge > LOW.shortEdge;
  const audioAt = (rate) => ({ codec: 'aac', numberOfChannels: 1, bitrate: rate });

  // The quick steps go first, so an instructor who stops early still gets some value.
  const steps = [];
  if (hasAudio) steps.push({ key: 'audio', weight: 0.05 });
  if (makeLow) steps.push({ key: 'low', weight: 0.45 });
  if (!keepMain) steps.push({ key: 'main', weight: 0.5 });
  const total = steps.reduce((sum, step) => sum + step.weight, 0) || 1;
  let done = 0;
  const made = { main: file, low: null, audio: null };
  for (const step of steps) {
    const report = (p) => onProgress?.(Math.min(1, (done + step.weight * p) / total));
    try {
      if (step.key === 'audio') {
        made.audio = await convert(lib, file, 'audio.m4a', seconds, { video: { discard: true }, audio: audioAt(AUDIO_BITRATE) }, report, signal);
      } else if (step.key === 'low') {
        made.low = await convert(lib, file, 'low.mp4', seconds, {
          video: { ...size(source, LOW.shortEdge), codec: 'avc', bitrate: LOW.bitrate, frameRate: LOW.frameRate, forceTranscode: true },
          audio: audioAt(AUDIO_BITRATE),
        }, report, signal);
      } else {
        const compressed = await convert(lib, file, 'main.mp4', seconds, {
          video: { ...size(source, MAIN.shortEdge), codec: 'avc', bitrate: MAIN.bitrate, frameRate: MAIN.frameRate, forceTranscode: true },
          audio: audioAt(MAIN_AUDIO_BITRATE),
        }, report, signal);
        // Only use it if it really is smaller. An already-tight file can come out bigger.
        if (compressed.size < file.size) made.main = new File([compressed], file.name.replace(/\.[^.]+$/, '') + '.mp4', { type: 'video/mp4' });
      }
    } catch (error) {
      // Skipped or failed part way: keep what finished. With nothing finished,
      // the caller uploads the original.
      if (signal?.aborted || made.audio || made.low) break;
      throw error;
    }
    done += step.weight;
  }
  // A copy that is not smaller than the video it serves is pointless.
  if (made.low && made.low.size >= made.main.size) made.low = null;
  if (made.audio && made.audio.size >= made.main.size) made.audio = null;
  onProgress?.(1);
  return { ...made, seconds };
}
