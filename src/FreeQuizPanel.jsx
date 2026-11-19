import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, BookOpen, Check, Copy, Download, ExternalLink, Mic, Plus, RefreshCw, Save, Square, Trash2, Upload, Users, X } from 'lucide-react';
import { supabase } from './supabase';
import { adminCall } from './adminApi';
import { registerUnsaved } from './unsavedChanges';
import { useConfirm } from './confirmDialog';
import {
  QUIZ_SITE, audioType, blankQuestion, blankQuiz, collectedStats, contactsCsv, eatDay, eatTime, filterContacts, localPhone,
  newestContacts, quizForSave,
  quizLink, quizProblems, recorderType, resultCell, slugify,
} from './freeQuiz';
import './free-quiz.css';

// Free class quizzes at quiz.ujuzikidigitali.com: the owner writes questions,
// records their voice for each, and downloads who joined as CSV for the SMS
// company's portal. The database checks everything again (admin_free_quiz_*).

async function rpc(name, params) {
  const { data, error } = await supabase.rpc(name, params);
  if (error) throw new Error(error.message);
  return data;
}

const fileBase64 = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(',')[1]);
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

async function uploadQuizFile(blob, filename, contentType) {
  const { url } = await adminCall('shop-upload', { type: 'free_quiz', filename, content_type: contentType, file_b64: await fileBase64(blob) });
  return url;
}

const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const STATUS = { draft: 'Draft', open: 'Open', closed: 'Closed' };
const MAX_RECORDING = 120;

function CopyText({ text, label }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1600); } catch { /* clipboard blocked */ }
  };
  return <button type="button" className="fq-btn" onClick={copy}>{done ? <Check /> : <Copy />}{done ? 'Copied' : label}</button>;
}

/** Record in the browser or upload a file; shows a player once there is a clip. Course quizzes use it too. */
export function VoiceField({ label, value, onChange }) {
  const [mode, setMode] = useState('idle');
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState('');
  const recorder = useRef(null);
  const stream = useRef(null);
  const chunks = useRef([]);
  const timer = useRef(null);
  const cancelled = useRef(false);

  const release = () => {
    clearInterval(timer.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  };
  useEffect(() => () => { cancelled.current = true; if (recorder.current?.state === 'recording') recorder.current.stop(); release(); }, []);

  const upload = async (blob, name, type) => {
    setMode('uploading');
    setError('');
    try { onChange(await uploadQuizFile(blob, name, type)); } catch (e) { setError(e.message); } finally { setMode('idle'); }
  };

  const start = async () => {
    setError('');
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('This browser cannot record. Upload a voice file instead.');
      return;
    }
    const type = recorderType((t) => MediaRecorder.isTypeSupported(t));
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      setError('Allow the microphone for this page, then press Record again.');
      return;
    }
    const rec = new MediaRecorder(stream.current, type ? { mimeType: type, audioBitsPerSecond: 32000 } : undefined);
    chunks.current = [];
    cancelled.current = false;
    rec.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
    rec.onstop = () => {
      release();
      const mime = (rec.mimeType || type || 'audio/webm').split(';')[0];
      const blob = new Blob(chunks.current, { type: mime });
      if (cancelled.current) { setMode('idle'); return; }
      if (blob.size < 800) { setError('Nothing was recorded. Check the microphone and try again.'); setMode('idle'); return; }
      upload(blob, `voice.${mime === 'audio/mp4' ? 'm4a' : mime.split('/')[1]}`, mime);
    };
    recorder.current = rec;
    rec.start(250);
    setSeconds(0);
    setMode('recording');
    const began = Date.now();
    timer.current = setInterval(() => {
      const s = Math.floor((Date.now() - began) / 1000);
      setSeconds(s);
      if (s >= MAX_RECORDING && rec.state === 'recording') rec.stop();
    }, 250);
  };
  const stop = () => { if (recorder.current?.state === 'recording') recorder.current.stop(); };
  const cancel = () => { cancelled.current = true; stop(); };

  const pick = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const type = audioType(file);
    if (!type) { setError('Use an M4A, MP3, OGG or WebM voice file.'); return; }
    if (file.size > 5 * 1024 * 1024) { setError('Keep each voice clip under 5 MB.'); return; }
    upload(file, file.name, type);
  };

  return (
    <div className="fq-voice">
      <span className="fq-label">{label}</span>
      {mode === 'recording' ? (
        <div className="fq-voice-row">
          <span className="fq-rec"><i />Recording {clock(seconds)}</span>
          <button type="button" className="fq-btn primary-pill" onClick={stop}><Square />Stop and save</button>
          <button type="button" className="fq-btn" onClick={cancel}><X />Cancel</button>
        </div>
      ) : mode === 'uploading' ? (
        <div className="fq-voice-row"><span className="fq-muted">Saving the voice clip…</span></div>
      ) : value ? (
        <div className="fq-voice-row">
          <audio controls preload="none" src={value} />
          <button type="button" className="fq-btn danger" onClick={() => onChange('')}><Trash2 />Remove</button>
        </div>
      ) : (
        <div className="fq-voice-row">
          <button type="button" className="fq-btn" onClick={start}><Mic />Record</button>
          <label className="fq-btn"><Upload />Upload<input type="file" accept="audio/*,.m4a,.mp3,.ogg,.opus,.webm" onChange={pick} hidden /></label>
        </div>
      )}
      {error && <small className="fq-error">{error}</small>}
    </div>
  );
}

function EbookField({ url, onChange }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!(file.type === 'application/pdf' || /\.pdf$/i.test(file.name))) { setError('Upload the e-book as a PDF.'); return; }
    if (file.size > 30 * 1024 * 1024) { setError('Keep the e-book under 30 MB.'); return; }
    setBusy(true);
    setError('');
    try { onChange(await uploadQuizFile(file, file.name, 'application/pdf')); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <div className="fq-voice">
      <span className="fq-label">E-book (PDF)</span>
      <div className="fq-voice-row">
        {busy ? <span className="fq-muted">Uploading the e-book…</span> : url ? <>
          <a className="fq-btn" href={url} target="_blank" rel="noreferrer"><ExternalLink />Open</a>
          <label className="fq-btn"><Upload />Replace<input type="file" accept="application/pdf,.pdf" onChange={pick} hidden /></label>
        </> : <label className="fq-btn"><Upload />Upload PDF<input type="file" accept="application/pdf,.pdf" onChange={pick} hidden /></label>}
      </div>
      {error && <small className="fq-error">{error}</small>}
    </div>
  );
}

function QuestionEditor({ q, index, count, stats, onChange, onMove, onRemove }) {
  const set = (key, value) => onChange({ ...q, [key]: value });
  const setOption = (i, value) => set('options', q.options.map((o, k) => (k === i ? value : o)));
  const removeOption = (i) => {
    const options = q.options.filter((_, k) => k !== i);
    const correct = q.correct === i ? 0 : q.correct > i ? q.correct - 1 : q.correct;
    onChange({ ...q, options, correct });
  };
  const s = q.id && stats?.[q.id];
  return (
    <div className="fq-question">
      <div className="fq-question-head">
        <strong>Question {index + 1}</strong>
        {s && s.answered > 0 && <span className="fq-chip">{s.right} of {s.answered} right ({Math.round((s.right * 100) / s.answered)}%)</span>}
        <span className="fq-spacer" />
        <button type="button" className="fq-icon" disabled={index === 0} onClick={() => onMove(-1)} aria-label="Move up"><ArrowUp /></button>
        <button type="button" className="fq-icon" disabled={index === count - 1} onClick={() => onMove(1)} aria-label="Move down"><ArrowDown /></button>
        <button type="button" className="fq-icon danger" onClick={onRemove} aria-label="Remove question"><Trash2 /></button>
      </div>
      <label className="fq-field">Question<textarea rows="2" maxLength={400} value={q.question} onChange={(e) => set('question', e.target.value)} /></label>
      <VoiceField label="Voice reading the question" value={q.audio_question} onChange={(v) => set('audio_question', v)} />
      <div className="fq-label">Answers (choose the right one)</div>
      <div className="fq-options">
        {q.options.map((option, i) => (
          <div className={`fq-option ${q.correct === i ? 'right' : ''}`} key={i}>
            <input type="radio" name={`right-${index}`} checked={q.correct === i} onChange={() => set('correct', i)} aria-label={`Answer ${i + 1} is right`} />
            <input value={option} maxLength={160} placeholder={`Answer ${String.fromCharCode(65 + i)}`} onChange={(e) => setOption(i, e.target.value)} />
            {q.options.length > 2 && <button type="button" className="fq-icon" onClick={() => removeOption(i)} aria-label="Remove answer"><X /></button>}
          </div>
        ))}
        {q.options.length < 4 && <button type="button" className="fq-btn" onClick={() => set('options', [...q.options, ''])}><Plus />Answer</button>}
      </div>
      <div className="fq-two">
        <div>
          <label className="fq-field">When right: short explanation (optional)<textarea rows="2" maxLength={500} value={q.explain_right} onChange={(e) => set('explain_right', e.target.value)} /></label>
          <VoiceField label="Voice: correct, and why" value={q.audio_right} onChange={(v) => set('audio_right', v)} />
        </div>
        <div>
          <label className="fq-field">When wrong: short explanation (optional)<textarea rows="2" maxLength={500} value={q.explain_wrong} onChange={(e) => set('explain_wrong', e.target.value)} /></label>
          <VoiceField label="Voice: not correct, and the right answer" value={q.audio_wrong} onChange={(v) => set('audio_wrong', v)} />
        </div>
      </div>
    </div>
  );
}

/** The admin JSON as an editable draft: nulls become empty strings. */
function toDraft(quiz) {
  const text = (v) => v ?? '';
  return {
    id: quiz.id, slug: quiz.slug, title: quiz.title, intro: text(quiz.intro), intro_audio: text(quiz.intro_audio),
    status: quiz.status, featured: Boolean(quiz.featured), finish_kind: quiz.finish_kind, finish_title: text(quiz.finish_title),
    finish_text: text(quiz.finish_text), finish_audio: text(quiz.finish_audio), ebook_url: text(quiz.ebook_url),
    ebook_name: text(quiz.ebook_name), link_url: text(quiz.link_url), link_label: text(quiz.link_label),
    questions: (quiz.questions || []).map((q) => ({
      id: q.id, question: q.question, options: [...q.options], correct: q.correct, explain_right: text(q.explain_right),
      explain_wrong: text(q.explain_wrong), audio_question: text(q.audio_question), audio_right: text(q.audio_right), audio_wrong: text(q.audio_wrong),
    })),
  };
}

function QuizEditor({ initial, onSaved, onClose }) {
  const start = useMemo(() => (initial ? toDraft(initial) : blankQuiz()), [initial]);
  const [quiz, setQuiz] = useState(start);
  const [slugTouched, setSlugTouched] = useState(Boolean(initial));
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState([]);
  const [confirmBox, ask] = useConfirm();
  // 'both' offers the e-book download and the link together.
  const hasBook = quiz.finish_kind === 'ebook' || quiz.finish_kind === 'both';
  const hasLink = quiz.finish_kind === 'link' || quiz.finish_kind === 'both';
  const startJson = useRef(JSON.stringify(start));
  const latest = useRef(quiz);
  latest.current = quiz;
  useEffect(() => registerUnsaved(() => JSON.stringify(latest.current) !== startJson.current), []);

  const set = (key, value) => setQuiz((q) => {
    const next = { ...q, [key]: value };
    if (key === 'title' && !slugTouched) next.slug = slugify(value);
    if (key === 'status' && value !== 'open') next.featured = false;
    return next;
  });
  const setQuestion = (i, value) => setQuiz((q) => ({ ...q, questions: q.questions.map((x, k) => (k === i ? value : x)) }));
  const move = (i, by) => setQuiz((q) => {
    const list = [...q.questions];
    [list[i], list[i + by]] = [list[i + by], list[i]];
    return { ...q, questions: list };
  });

  const save = async () => {
    const found = quizProblems(quiz);
    setProblems(found);
    if (found.length) return;
    setBusy(true);
    try {
      const saved = await rpc('admin_free_quiz_save', { p_quiz: quizForSave(quiz) });
      startJson.current = JSON.stringify(toDraft(saved));
      latest.current = toDraft(saved);
      onSaved(saved);
    } catch (e) {
      setProblems([e.message]);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!(await ask(`Delete "${quiz.title}"?`, { action: 'Delete', danger: true, detail: 'This cannot be undone.' }))) return;
    setBusy(true);
    try {
      await rpc('admin_free_quiz_delete', { p_quiz: quiz.id });
      startJson.current = JSON.stringify(latest.current);
      onSaved(null);
    } catch (e) { setProblems([e.message]); } finally { setBusy(false); }
  };
  const close = async () => {
    const changed = JSON.stringify(latest.current) !== startJson.current;
    if (changed && !(await ask('Discard your changes to this quiz?', { action: 'Discard', danger: true }))) return;
    startJson.current = JSON.stringify(latest.current);
    onClose();
  };

  return (
    <section className="card fq">
      {confirmBox}
      <div className="fq-head">
        <div><h2>{quiz.id ? 'Edit quiz' : 'New quiz'}</h2><p className="fq-muted">Learners open it at {quiz.featured ? QUIZ_SITE.replace('https://', '') : `${QUIZ_SITE.replace('https://', '')}/?q=${quiz.slug || 'link-name'}`}</p></div>
        <button type="button" className="fq-icon" onClick={close} aria-label="Close"><X /></button>
      </div>

      <div className="fq-two">
        <label className="fq-field">Topic (title)<input value={quiz.title} maxLength={120} placeholder="Jinsi ya kutengeneza bidhaa za kidijitali" onChange={(e) => set('title', e.target.value)} /></label>
        <label className="fq-field">Link name<input value={quiz.slug} maxLength={40} placeholder="siku-1" onChange={(e) => { setSlugTouched(true); set('slug', e.target.value.toLowerCase()); }} /></label>
      </div>
      <div className="fq-field">Status
        <div className="fq-seg">{Object.entries(STATUS).map(([key, label]) => <button type="button" key={key} className={quiz.status === key ? 'active' : ''} onClick={() => set('status', key)}>{label}</button>)}</div>
        <small className="fq-muted">Draft is hidden. Open takes new players. Closed tells visitors the quiz has ended and keeps the scores.</small>
      </div>
      <label className="fq-check"><input type="checkbox" checked={quiz.featured} disabled={quiz.status !== 'open'} onChange={(e) => set('featured', e.target.checked)} />
        Show this quiz at {QUIZ_SITE.replace('https://', '')} (only one quiz at a time)</label>
      <label className="fq-field">Prize (zawadi) shown on the start page<textarea rows="2" maxLength={600} value={quiz.intro} placeholder="E-book bure: Mwongozo wa Kutengeneza Bidhaa za Kidijitali" onChange={(e) => set('intro', e.target.value)} />
        <small className="fq-muted">The start page shows only: Karibu Ujuzi Kidigitali Quiz, the title as the topic, this prize, then name and phone.</small></label>
      <VoiceField label="Welcome voice (optional)" value={quiz.intro_audio} onChange={(v) => set('intro_audio', v)} />

      <h3 className="fq-section">Questions</h3>
      {quiz.questions.map((q, i) => (
        <QuestionEditor key={q.id || `new-${i}`} q={q} index={i} count={quiz.questions.length} stats={initial?.stats}
          onChange={(v) => setQuestion(i, v)} onMove={(by) => move(i, by)}
          onRemove={async () => { if (await ask(`Remove question ${i + 1}?`, { action: 'Remove', danger: true })) setQuiz((x) => ({ ...x, questions: x.questions.filter((_, k) => k !== i) })); }} />
      ))}
      <button type="button" className="fq-btn" onClick={() => setQuiz((q) => ({ ...q, questions: [...q.questions, blankQuestion()] }))}><Plus />Add question</button>

      <h3 className="fq-section">At the end</h3>
      <div className="fq-seg wide">
        {[['none', 'Score only'], ['ebook', 'E-book download'], ['link', 'Link (for example sign up)'], ['both', 'E-book and link']].map(([key, label]) => (
          <button type="button" key={key} className={quiz.finish_kind === key ? 'active' : ''} onClick={() => set('finish_kind', key)}>{label}</button>
        ))}
      </div>
      <div className="fq-two">
        <label className="fq-field">Heading<input value={quiz.finish_title} maxLength={120} placeholder={quiz.finish_kind === 'link' ? 'Hatua inayofuata' : 'Zawadi yako: E-book'} onChange={(e) => set('finish_title', e.target.value)} /></label>
        {hasBook && <label className="fq-field">Download name<input value={quiz.ebook_name} maxLength={120} placeholder="Mwongozo wa Ujuzi Kidigitali" onChange={(e) => set('ebook_name', e.target.value)} /></label>}
        {hasLink && <label className="fq-field">Button text<input value={quiz.link_label} maxLength={60} placeholder="Jisajili upate kitabu bure" onChange={(e) => set('link_label', e.target.value)} /></label>}
      </div>
      {hasBook && <EbookField url={quiz.ebook_url} onChange={(v) => set('ebook_url', v)} />}
      {hasLink && <label className="fq-field">Link<input value={quiz.link_url} maxLength={500} placeholder="https://app.ujuzikidigitali.com/..." onChange={(e) => set('link_url', e.target.value)} /></label>}
      <label className="fq-field">Message<textarea rows="2" maxLength={600} value={quiz.finish_text} placeholder="Kesho tutaendelea na somo la pili." onChange={(e) => set('finish_text', e.target.value)} /></label>
      <VoiceField label="Voice at the end (optional)" value={quiz.finish_audio} onChange={(v) => set('finish_audio', v)} />

      {problems.length > 0 && <div className="fq-problems" role="alert">{problems.map((p) => <p key={p}>{p}</p>)}</div>}
      <div className="fq-actions">
        {quiz.id && initial?.joined === 0 && <button type="button" className="fq-btn danger" disabled={busy} onClick={remove}><Trash2 />Delete</button>}
        <span className="fq-spacer" />
        <button type="button" className="fq-btn" onClick={close}>Cancel</button>
        <button type="button" className="fq-btn primary-pill" disabled={busy} onClick={save}><Save />{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </section>
  );
}

function Contacts({ reportError }) {
  const [data, setData] = useState(null);
  const [quizId, setQuizId] = useState('');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmBox, ask] = useConfirm();
  const load = async () => {
    setBusy(true);
    try { setData(await rpc('admin_free_quiz_contacts')); } catch (e) { reportError(e.message); } finally { setBusy(false); }
  };
  useEffect(() => { load(); }, []);
  const [last, setLast] = useState('');
  const shown = useMemo(() => (data ? filterContacts(data.contacts, quizId, search) : []), [data, quizId, search]);
  const stats = useMemo(() => (data ? collectedStats(data.contacts) : null), [data]);
  const quizzes = data?.quizzes || [];
  const columns = quizId ? quizzes.filter((q) => q.id === quizId) : quizzes;
  const lastN = Math.floor(Number(last)) > 0 ? Math.floor(Number(last)) : 0;
  const toDownload = useMemo(() => newestContacts(shown, lastN), [shown, lastN]);

  const download = () => {
    const csv = contactsCsv(toDownload, columns);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    const quiz = quizzes.find((q) => q.id === quizId);
    a.href = url;
    a.download = `ujuzi-quiz-${quiz ? quiz.slug : 'contacts'}${lastN ? `-last-${toDownload.length}` : ''}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const removeContact = async (c) => {
    if (!(await ask(`Remove ${c.name} (${localPhone(c.phone)}) and their scores?`, { action: 'Remove', danger: true, detail: 'Use this when someone asks to stop getting SMS.' }))) return;
    try { await rpc('admin_free_quiz_contact_delete', { p_contact: c.id }); await load(); } catch (e) { reportError(e.message); }
  };

  return (
    <section className="card fq">
      {confirmBox}
      <div className="fq-head">
        <div><h2>Contacts</h2><p className="fq-muted">Everyone who joined a quiz and agreed to SMS. Upload the CSV straight to the SMS company's portal: opening and saving it in Excel can turn long numbers into 2.56E+11.</p></div>
        <button type="button" className="fq-icon" onClick={load} aria-label="Refresh"><RefreshCw /></button>
      </div>
      {stats && (
        <div className="fq-stats">
          <div><span>This week</span><strong>{stats.thisWeek}</strong><small>since {eatDay(stats.week)}</small></div>
          <div><span>Two weeks</span><strong>{stats.twoWeeks}</strong><small>since {eatDay(stats.twoWeeksFrom)}</small></div>
          <div><span>All numbers</span><strong>{stats.all}</strong><small>since the start</small></div>
        </div>
      )}
      <div className="fq-filters">
        <select value={quizId} onChange={(e) => setQuizId(e.target.value)}>
          <option value="">Every quiz</option>
          {quizzes.map((q) => <option key={q.id} value={q.id}>{q.title}</option>)}
        </select>
        <input type="search" value={search} placeholder="Search name or number" onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div className="fq-actions">
        <strong>{shown.length} {shown.length === 1 ? 'person' : 'people'}</strong>
        <span className="fq-spacer" />
        <CopyText text={toDownload.map((c) => c.phone).join('\n')} label="Copy numbers" />
        <label className="fq-last">
          Last
          <input type="number" min="1" step="1" inputMode="numeric" placeholder="All" value={last}
            aria-label="How many of the newest numbers to download" onChange={(e) => setLast(e.target.value.replace(/[^0-9]/g, ''))} />
        </label>
        <button type="button" className="fq-btn primary-pill" disabled={!toDownload.length} onClick={download}>
          <Download />{lastN ? `Download last ${toDownload.length}` : 'Download CSV'}
        </button>
      </div>
      {busy && !data ? <div className="loading">Loading contacts…</div> : !shown.length ? <div className="empty">Nobody yet.</div> : (
        <div className="fq-table-wrap">
          <table className="fq-table">
            <thead><tr><th>Name</th><th>Phone</th><th>Joined</th>{columns.map((q) => <th key={q.id}>{q.title}</th>)}<th /></tr></thead>
            <tbody>{shown.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td><td className="fq-num">{localPhone(c.phone)}</td><td className="fq-num">{eatTime(c.joined_at)}</td>
                {columns.map((q) => <td key={q.id} className="fq-num">{resultCell(c.results?.[q.id])}</td>)}
                <td><button type="button" className="fq-icon danger" onClick={() => removeContact(c)} aria-label={`Remove ${c.name}`}><Trash2 /></button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default function FreeQuizPanel({ reportError }) {
  const [view, setView] = useState('quizzes');
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setBusy(true);
    try { setData(await rpc('admin_free_quizzes')); } catch (e) { reportError(e.message); } finally { setBusy(false); }
  };
  useEffect(() => { load(); }, []);

  if (editing) {
    // A new key after each save loads the saved quiz (with its id) into a fresh editor.
    return <>
      {notice && <div className="alert success fq-notice"><Check />{notice}</div>}
      <QuizEditor key={editing === 'new' ? 'new' : `${editing.id}:${editing.updated_at}`} initial={editing === 'new' ? null : editing}
        onClose={() => { setEditing(null); setNotice(''); }}
        onSaved={(saved) => { setEditing(saved || null); setNotice(saved ? 'Saved.' : 'Quiz deleted.'); load(); }} />
    </>;
  }
  return (
    <>
      <div className="fq-tabs">
        <button type="button" className={view === 'quizzes' ? 'active' : ''} onClick={() => setView('quizzes')}><BookOpen />Quizzes</button>
        <button type="button" className={view === 'contacts' ? 'active' : ''} onClick={() => setView('contacts')}><Users />Contacts{data ? ` (${data.contacts})` : ''}</button>
      </div>
      {notice && <div className="alert success fq-notice"><Check />{notice}</div>}
      {view === 'contacts' ? <Contacts reportError={reportError} /> : (
        <section className="card fq">
          <div className="fq-head">
            <div><h2>Free class quizzes</h2><p className="fq-muted">At {QUIZ_SITE.replace('https://', '')}. No account: learners give a name and phone number, hear your voice, and get your e-book or link at the end.</p></div>
            <button type="button" className="fq-btn primary-pill" onClick={() => { setNotice(''); setEditing('new'); }}><Plus />New quiz</button>
          </div>
          {busy && !data ? <div className="loading">Loading quizzes…</div> : !data?.quizzes.length ? <div className="empty">No quizzes yet. Press New quiz to write the first one.</div> : data.quizzes.map((q) => (
            <div className="fq-row" key={q.id}>
              <div className="fq-row-main">
                <strong>{q.title}</strong>
                <small>
                  <span className={`fq-status ${q.status}`}>{STATUS[q.status]}</span>
                  {q.featured && <span className="fq-status live">Live at quiz.ujuzikidigitali.com</span>}
                  {q.questions.length} questions · {q.joined} joined · {q.finished} finished{q.average != null ? ` · average ${q.average}%` : ''}
                </small>
              </div>
              <CopyText text={quizLink(q)} label="Copy link" />
              <button type="button" className="fq-btn" onClick={() => { setNotice(''); setEditing(q); }}>Edit</button>
            </div>
          ))}
        </section>
      )}
    </>
  );
}
