import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Film, Link2, Library, Pause, Play, RotateCcw, Trash2, Upload, X } from 'lucide-react';
import { adminCall } from './adminApi';
import { useConfirm } from './confirmDialog';
import { canPrepareVideos, clearPreparedVideos, prepareVideo } from './videoPrepare';
import { cancelUpload, formatBytes, formatDuration, timeLeft, uploadCopy, uploadVideo } from './videoUpload';
import './lesson-video.css';

const call = (action, body = {}) => adminCall('admin-media', { action, ...body });

// Preparing writes to one scratch folder in the browser, so only one video is
// prepared and uploaded at a time; another lesson waits its turn.
let turn = Promise.resolve();
function oneAtATime(job) {
  const run = turn.then(job, job);
  turn = run.catch(() => {});
  return run;
}

/** The video's length from the browser, or null. */
function readDuration(file) {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);
    const done = (value) => { URL.revokeObjectURL(url); resolve(value); };
    video.preload = 'metadata';
    video.onloadedmetadata = () => done(Number.isFinite(video.duration) ? video.duration : null);
    video.onerror = () => done(null);
    setTimeout(() => done(null), 15000);
    video.src = url;
  });
}

/**
 * A lesson's video: a link as before, or a video uploaded straight to R2.
 * onChange(patch) updates the lesson; onBusy(true/false) holds Save while an
 * upload runs.
 */
export default function LessonVideoField({ module, onChange, onBusy }) {
  const uploaded = Boolean(module.video_asset_id);
  const [mode, setMode] = useState(uploaded ? 'upload' : 'link');
  const [job, setJob] = useState(null);
  const [library, setLibrary] = useState(false);
  const [preview, setPreview] = useState(null);
  const [confirmBox, ask] = useConfirm();
  const input = useRef(null);
  const stop = useRef(null);
  const release = useRef(null);
  const speed = useRef({ at: 0, sent: 0, rate: 0 });
  const alive = useRef(true);
  // Kept in a ref: a new callback from the parent must never stop an upload.
  const reportBusy = useRef(onBusy);
  reportBusy.current = onBusy;

  const busy = Boolean(job && job.phase !== 'error' && job.phase !== 'paused');
  useEffect(() => { reportBusy.current?.(Boolean(job)); }, [job]);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; stop.current?.abort(); release.current?.(); reportBusy.current?.(false); };
  }, []);
  useEffect(() => {
    if (!job) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [job]);

  const progress = useCallback(({ sent, total }) => {
    const now = Date.now(), last = speed.current;
    if (now - last.at > 1500) {
      const rate = last.at ? (sent - last.sent) / ((now - last.at) / 1000) : 0;
      speed.current = { at: now, sent, rate: last.rate ? last.rate * 0.6 + rate * 0.4 : rate };
    }
    setJob((j) => j && { ...j, phase: 'upload', sent, total });
  }, []);

  // Sends the prepared files. Called again by Resume with the same files.
  const send = useCallback(async (prepared, seconds) => {
    stop.current = new AbortController();
    speed.current = { at: 0, sent: 0, rate: 0 };
    setJob((j) => ({ ...j, phase: 'upload', message: '' }));
    try {
      const asset = await uploadVideo(prepared.main, { call, onProgress: progress, signal: stop.current.signal, durationSeconds: seconds });
      setJob((j) => ({ ...j, phase: 'copies' }));
      let missedCopy = false;
      for (const label of ['low', 'audio']) {
        if (!prepared[label]) continue;
        try { await uploadCopy(asset.id, label, prepared[label], { call, signal: stop.current.signal }); } catch { missedCopy = true; }
      }
      onChange({ video_asset_id: asset.id, video_url: '', duration_seconds: Math.round(seconds || asset.duration_seconds || 0) || module.duration_seconds,
        video_asset: { id: asset.id, original_name: prepared.original.name, bytes: asset.bytes, duration_seconds: seconds,
          note: missedCopy ? 'The data saver copy did not upload. Learners get the full video.' : '' } });
      setJob(null);
      clearPreparedVideos();
      release.current?.();
    } catch (e) {
      if (e?.name === 'AbortError') setJob((j) => j && { ...j, phase: 'paused' });
      else setJob((j) => j && { ...j, phase: 'error', message: e.message || 'The upload stopped. Press Resume to continue.' });
    }
  }, [module.duration_seconds, onChange, progress]);

  const start = (file) => {
    if (!file) return;
    if (!/^video\/(mp4|webm|quicktime)$/.test(file.type)) {
      setJob({ phase: 'error', message: 'Choose an MP4, WebM or MOV video.', file: null });
      return;
    }
    setJob({ phase: 'waiting', file, sent: 0, total: file.size, prepare: 0 });
    oneAtATime(() => new Promise((free) => {
      release.current = free;
      if (!alive.current) { free(); return; } // the lesson was removed while waiting
      (async () => {
        const seconds = await readDuration(file);
        stop.current = new AbortController();
        let prepared = { main: file };
        if (await canPrepareVideos()) {
          setJob((j) => ({ ...j, phase: 'prepare', prepare: 0 }));
          try { prepared = await prepareVideo(file, { onProgress: (p) => setJob((j) => j && { ...j, prepare: p }), signal: stop.current.signal }); }
          catch (e) {
            if (e?.name === 'AbortError' || stop.current.signal.aborted) { setJob(null); free(); return; }
            prepared = { main: file }; // this video cannot be prepared here: send it as it is
          }
        }
        prepared.original = file;
        setJob((j) => ({ ...j, prepared, seconds: prepared.seconds || seconds }));
        await send(prepared, prepared.seconds || seconds);
      })();
    }));
  };

  const pause = () => stop.current?.abort();
  const resume = () => job?.prepared && send(job.prepared, job.seconds);
  const cancel = async () => {
    stop.current?.abort();
    if (job?.prepared) await cancelUpload(job.prepared.main, { call });
    clearPreparedVideos();
    setJob(null);
    release.current?.();
  };

  const showPreview = async (assetId) => {
    try { setPreview((await call('preview', { asset_id: assetId })).url); }
    catch (e) { setJob({ phase: 'error', message: e.message }); }
  };

  const asset = module.video_asset;
  const sent = job?.sent || 0, total = job?.total || 1;
  const percent = job?.phase === 'prepare' ? Math.round((job.prepare || 0) * 100) : Math.round((sent / total) * 100);

  return (
    <div className="lv wide">
      <div className="lv-head">
        <span className="lv-label">Video</span>
        <div className="lv-switch" role="tablist">
          <button type="button" role="tab" aria-selected={mode === 'upload'} className={mode === 'upload' ? 'on' : ''} disabled={busy} onClick={() => setMode('upload')}><Upload />Upload</button>
          <button type="button" role="tab" aria-selected={mode === 'link'} className={mode === 'link' ? 'on' : ''} disabled={busy || Boolean(job)} onClick={() => setMode('link')}><Link2 />Link</button>
        </div>
      </div>

      {mode === 'link' && (
        <>
          <input value={module.video_url || ''} placeholder="Wistia, YouTube or Google Drive link or embed code"
            onChange={(e) => onChange({ video_url: e.target.value, video_asset_id: null, video_asset: null })} />
          {uploaded && <p className="lv-note">Saving with a link replaces the uploaded video for this lesson.</p>}
        </>
      )}

      {mode === 'upload' && !job && (
        uploaded ? (
          <div className="lv-file">
            <span className="lv-icon"><Film /></span>
            <div className="lv-meta">
              <strong>{asset?.original_name || 'Uploaded video'}</strong>
              <small>{[asset?.bytes && formatBytes(asset.bytes), (asset?.duration_seconds || module.duration_seconds) && formatDuration(asset?.duration_seconds || module.duration_seconds)].filter(Boolean).join(' · ')}</small>
              {asset?.note && <small className="lv-warn">{asset.note}</small>}
            </div>
            <div className="lv-actions">
              <button type="button" className="secondary" onClick={() => showPreview(module.video_asset_id)}><Play />Watch</button>
              <button type="button" className="secondary" onClick={() => input.current?.click()}><Upload />Replace</button>
              <button type="button" className="secondary" onClick={() => setLibrary(true)}><Library />Library</button>
            </div>
          </div>
        ) : (
          <div className="lv-drop" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); start(e.dataTransfer.files?.[0]); }}>
            <button type="button" className="primary lv-pick" onClick={() => input.current?.click()}><Upload />Choose video</button>
            <button type="button" className="secondary" onClick={() => setLibrary(true)}><Library />From library</button>
            <small>MP4, WebM or MOV. It is made lighter on this computer, then uploaded.</small>
          </div>
        )
      )}

      {job && (
        <div className={`lv-job ${job.phase}`}>
          <div className="lv-job-top">
            <strong>{job.file?.name || 'Video'}</strong>
            <span>
              {job.phase === 'waiting' && 'Waiting for the other video'}
              {job.phase === 'prepare' && `Making it lighter ${percent}%`}
              {job.phase === 'upload' && `Uploading ${percent}%`}
              {job.phase === 'copies' && 'Adding the data saver copy'}
              {job.phase === 'paused' && `Paused at ${percent}%`}
              {job.phase === 'error' && 'Stopped'}
            </span>
          </div>
          {job.phase !== 'error' && <div className="lv-bar" aria-hidden="true"><i style={{ width: `${job.phase === 'copies' ? 100 : percent}%` }} /></div>}
          {job.phase === 'upload' && <small>{formatBytes(sent)} of {formatBytes(total)}{speed.current.rate > 0 ? ` · ${timeLeft(total - sent, speed.current.rate)}` : ''}</small>}
          {job.message && <p className="lv-error" role="alert">{job.message}</p>}
          <div className="lv-actions">
            {job.phase === 'upload' && <button type="button" className="secondary" onClick={pause}><Pause />Pause</button>}
            {(job.phase === 'paused' || (job.phase === 'error' && job.prepared)) && <button type="button" className="primary" onClick={resume}><RotateCcw />Resume</button>}
            {job.phase === 'error' && !job.prepared && <button type="button" className="secondary" onClick={() => setJob(null)}>OK</button>}
            {job.phase !== 'copies' && (job.prepared || job.phase === 'prepare') && <button type="button" className="danger-link" onClick={async () => { if (await ask('Stop this upload?', { action: 'Stop upload', danger: true, detail: 'What was uploaded so far is removed.' })) cancel(); }}><X />Cancel</button>}
          </div>
        </div>
      )}

      <input ref={input} type="file" accept="video/mp4,video/webm,video/quicktime" hidden
        onChange={(e) => { start(e.target.files?.[0]); e.target.value = ''; }} />
      {library && <VideoLibrary current={module.video_asset_id} ask={ask} onClose={() => setLibrary(false)}
        onPick={(video) => { onChange({ video_asset_id: video.id, video_url: '', video_asset: video, duration_seconds: video.duration_seconds || module.duration_seconds }); setLibrary(false); }} />}
      {preview && <VideoPreview url={preview} onClose={() => setPreview(null)} />}
      {confirmBox}
    </div>
  );
}

function Sheet({ title, onClose, children, wide }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div className="lv-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className={`lv-sheet${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="lv-sheet-head"><h3>{title}</h3><button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><X /></button></div>
        {children}
      </section>
    </div>, document.body);
}

function VideoPreview({ url, onClose }) {
  return <Sheet title="Watch video" onClose={onClose} wide><video className="lv-player" src={url} controls autoPlay playsInline /></Sheet>;
}

function VideoLibrary({ current, ask, onClose, onPick }) {
  const [videos, setVideos] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    setError('');
    call('library').then((r) => setVideos(r.videos)).catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const remove = async (video) => {
    if (!(await ask(`Delete “${video.original_name}”?`, { action: 'Delete video', danger: true, detail: 'It is removed from storage for good.' }))) return;
    try { await call('delete', { asset_id: video.id }); load(); } catch (e) { setError(e.message); }
  };

  return (
    <Sheet title="Video library" onClose={onClose}>
      {error && <p className="lv-error" role="alert">{error} <button type="button" className="secondary" onClick={load}>Try again</button></p>}
      {!videos && !error && <div className="lv-skeleton">{[0, 1, 2].map((i) => <span key={i} />)}</div>}
      {videos?.length === 0 && <p className="lv-empty">No uploaded videos yet.</p>}
      {videos?.length > 0 && (
        <ul className="lv-list">
          {videos.map((video) => (
            <li key={video.id} className={video.id === current ? 'current' : ''}>
              <span className="lv-icon"><Film /></span>
              <div className="lv-meta">
                <strong>{video.original_name}</strong>
                <small>{[formatBytes(video.bytes), video.duration_seconds && formatDuration(video.duration_seconds),
                  video.used_in.length ? `In ${video.used_in.length} lesson${video.used_in.length === 1 ? '' : 's'}` : 'Not used'].filter(Boolean).join(' · ')}</small>
              </div>
              <div className="lv-actions">
                {video.id === current ? <span className="lv-chip">Chosen</span>
                  : <button type="button" className="secondary" onClick={() => onPick(video)}>Use</button>}
                {video.used_in.length === 0 && <button type="button" className="danger-link" aria-label="Delete video" onClick={() => remove(video)}><Trash2 /></button>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
