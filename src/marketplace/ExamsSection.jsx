import { useState } from 'react';
import { ClipboardList, Eye, Pause, Play, SlidersHorizontal, Users } from 'lucide-react';
import { Chips, Dialog, Drawer, Empty, Pill, Skeleton, day, rpc, useData, when } from './parts';

// Instructor exams sat on exam.ujuzikidigitali.com: limits, AI use, every exam
// with a pause switch, and per-instructor limits. Ujuzi's own exams live in
// the Assessments panel.
export default function ExamsSection({ onChanged }) {
  const data = useData(() => rpc('admin_instructor_exams'));
  const [filter, setFilter] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [limits, setLimits] = useState(null);
  const changed = () => { data.reload(); onChanged?.(); };

  if (data.error) return <div className="mkt-error">{data.error} <button type="button" className="mkt-btn ghost sm" onClick={data.reload}>Try again</button></div>;
  if (!data.data) return <Skeleton rows={6} />;
  const { settings, month, exams, instructors } = data.data;
  const shown = exams.filter(e => !filter || (filter === 'live' ? e.is_published && !e.admin_hold : filter === 'paused' ? e.admin_hold : !e.is_published));

  return <>
    <div className="mkt-metrics">
      <div><span>Students this month</span><strong>{month.sittings}</strong><small>exam sittings, all instructors</small></div>
      <div><span>AI drafts this month</span><strong>{month.ai_drafts}</strong>
        <small>{Math.round(month.ai_input_tokens / 1000)}k in · {Math.round(month.ai_output_tokens / 1000)}k out tokens</small></div>
      <div><span>Exams</span><strong>{exams.length}</strong><small>{exams.filter(e => e.is_published).length} live</small></div>
    </div>

    <ExamSettings settings={settings} onSaved={changed} />

    <div className="mkt-card">
      <div className="mkt-toolbar">
        <Chips value={filter} onChange={setFilter} options={[{ value: null, label: 'All' }, { value: 'live', label: 'Live' },
          { value: 'paused', label: 'Paused', count: exams.filter(e => e.admin_hold).length }, { value: 'draft', label: 'Drafts' }]} />
      </div>
      {shown.length === 0 ? <Empty icon={ClipboardList} text="No instructor exams here yet." /> : shown.map(e => (
        <div key={e.id} className="mkt-row static">
          <span className="mkt-thumb"><ClipboardList /></span>
          <span className="mkt-row-main"><strong>{e.title}</strong>
            <small>{e.instructor} · @{e.handle} · created {day(e.created_at)}</small>
            <small>{e.sittings} {e.sittings === 1 ? 'sitting' : 'sittings'} ({e.sittings_month} this month) · {e.passed} passed
              {e.closes_at ? ` · closes ${when(e.closes_at)}` : ''}</small>
            {e.admin_hold && <small className="mkt-warn">Paused: {e.admin_hold_reason}</small>}</span>
          {e.admin_hold ? <Pill status="suspended">Paused</Pill> : !e.is_published ? <Pill status="draft">Draft</Pill>
            : !e.link_enabled ? <Pill status="unlisted">Link off</Pill> : <Pill status="live">Live</Pill>}
          <span className="mkt-actions">
            <button type="button" className="mkt-btn ghost sm" onClick={() => setViewing(e)}><Eye />Questions</button>
            {e.admin_hold
              ? <button type="button" className="mkt-btn ghost sm" onClick={() => setDialog({ title: `Resume "${e.title}"?`, message: 'Students can start it again.', confirmLabel: 'Resume',
                onConfirm: () => rpc('admin_hold_exam', { p_exam: e.id, p_hold: false }).then(changed) })}><Play />Resume</button>
              : <button type="button" className="mkt-btn ghost sm" onClick={() => setDialog({ title: `Pause "${e.title}"?`, danger: true, reason: true, reasonLabel: 'Reason the instructor sees',
                message: 'New students cannot start it. Anyone sitting it now can finish.', confirmLabel: 'Pause exam',
                onConfirm: (note) => rpc('admin_hold_exam', { p_exam: e.id, p_hold: true, p_reason: note }).then(changed) })}><Pause />Pause</button>}
          </span>
        </div>
      ))}
    </div>

    <div className="mkt-card">
      <h3>Instructors using exams</h3>
      {instructors.length === 0 ? <Empty icon={Users} text="No instructor has made an exam yet." /> : instructors.map(i => (
        <div key={i.user_id} className="mkt-row static">
          <span className="mkt-row-main"><strong>{i.display_name}</strong>
            <small>@{i.handle} · {i.sittings_used}/{i.sittings_limit} students · {i.ai_used}/{i.ai_limit} AI drafts · {i.live_used} live
              {i.exam_monthly_sittings != null || i.exam_monthly_ai != null ? ' · custom limits' : ''}</small></span>
          {i.exams_blocked && <Pill status="suspended">Exams off</Pill>}
          <button type="button" className="mkt-btn ghost sm" onClick={() => setLimits(i)}><SlidersHorizontal />Limits</button>
        </div>
      ))}
    </div>

    {dialog && <Dialog {...dialog} onClose={() => setDialog(null)} />}
    {viewing && <ExamQuestions exam={viewing} onClose={() => setViewing(null)} />}
    {limits && <LimitsDialog instructor={limits} settings={settings} onSaved={changed} onClose={() => setLimits(null)} />}
  </>;
}

function ExamSettings({ settings, onSaved }) {
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const value = (k) => form?.[k] ?? settings[k];
  const set = (k, v) => setForm(f => ({ ...(f || {}), [k]: v }));
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    const out = {};
    for (const [k, v] of Object.entries(form)) out[k] = typeof v === 'boolean' ? v : Math.round(Number(v));
    try { await rpc('admin_save_exam_settings', { p_settings: out }); setForm(null); onSaved(); }
    catch (err) { setError(err.message.includes('check constraint') ? 'One of the values is outside what is allowed.' : err.message); }
    finally { setBusy(false); }
  };
  return <form className="mkt-card mkt-settings" onSubmit={save}>
    <fieldset><legend>Exam limits for every instructor</legend>
      <label className="mkt-field row">Instructor exams are on
        <input type="checkbox" checked={value('enabled')} onChange={(e) => set('enabled', e.target.checked)} />
      </label>
      {[['monthly_sittings', 'Students per month', 'sittings'], ['monthly_ai_generations', 'AI drafts per month', 'drafts'],
        ['max_live_exams', 'Live exams at a time', 'exams']].map(([k, label, unit]) => (
        <label key={k} className="mkt-field row">{label}
          <span className="mkt-unit"><input type="number" min={0} step={1} value={value(k)} onChange={(e) => set(k, e.target.value)} /><i>{unit}</i></span>
        </label>
      ))}
    </fieldset>
    <p className="mkt-hint">Turning exams off pauses every instructor exam at once. Months reset on the 1st. Last changed {when(settings.updated_at)}.</p>
    {error && <div className="mkt-error">{error}</div>}
    <div className="mkt-actions end">
      {form && <button type="button" className="mkt-btn ghost" onClick={() => setForm(null)}>Discard</button>}
      <button type="submit" className="mkt-btn primary" disabled={!form || busy}>{busy ? 'Saving…' : 'Save limits'}</button>
    </div>
  </form>;
}

function LimitsDialog({ instructor, settings, onSaved, onClose }) {
  const [sittings, setSittings] = useState(instructor.exam_monthly_sittings ?? '');
  const [ai, setAi] = useState(instructor.exam_monthly_ai ?? '');
  const [blocked, setBlocked] = useState(instructor.exams_blocked);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    setBusy(true); setError('');
    try {
      await rpc('admin_set_instructor_exam_limits', { p_user: instructor.user_id, p_sittings: sittings === '' ? null : Number(sittings),
        p_ai: ai === '' ? null : Number(ai), p_blocked: blocked });
      onSaved(); onClose();
    } catch (err) { setError(err.message); setBusy(false); }
  };
  return (
    <div className="mkt-overlay center mkt-dialog" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="mkt-modal" role="dialog" aria-modal="true" aria-label={`Exam limits for ${instructor.display_name}`}>
        <h3>Exam limits for {instructor.display_name}</h3>
        <p className="mkt-muted">Leave a box empty to use the default.</p>
        <label className="mkt-field">Students per month<input type="number" min={0} placeholder={`Default ${settings.monthly_sittings}`} value={sittings} onChange={(e) => setSittings(e.target.value)} /></label>
        <label className="mkt-field">AI drafts per month<input type="number" min={0} placeholder={`Default ${settings.monthly_ai_generations}`} value={ai} onChange={(e) => setAi(e.target.value)} /></label>
        <label className="mkt-field row">Turn exams off for this instructor<input type="checkbox" checked={blocked} onChange={(e) => setBlocked(e.target.checked)} /></label>
        {error && <div className="mkt-error">{error}</div>}
        <div className="mkt-actions end">
          <button type="button" className="mkt-btn ghost" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="button" className="mkt-btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

function ExamQuestions({ exam, onClose }) {
  const detail = useData(() => rpc('admin_exam', { p_exam: exam.id }), [exam.id]);
  const e = detail.data;
  return (
    <Drawer title={exam.title} subtitle={`${exam.instructor} · @${exam.handle}`} onClose={onClose}>
      {detail.error ? <div className="mkt-error">{detail.error}</div> : !e ? <Skeleton rows={6} /> : <>
        <p className="mkt-muted">{e.duration_minutes} min · pass {e.pass_mark}% · {e.attempts_allowed} {e.attempts_allowed === 1 ? 'attempt' : 'attempts'}
          {e.retake_wait_hours ? ` · ${e.retake_wait_hours}h between attempts` : ''} · {e.max_violations} screen exits allowed</p>
        {e.description && <p>{e.description}</p>}
        {e.papers.map(p => (
          <div key={p.version} className="mkt-card">
            <h3>Paper {p.version}</h3>
            {p.questions.map((q, i) => (
              <div key={i} className="mkt-field">
                <strong>{i + 1}. {q.question}</strong>
                {q.kind === 'mcq'
                  ? <small>{q.options.map((o, k) => (k === q.correct_option_index ? `[${o}]` : o)).join(' · ')}</small>
                  : <small>Model answer: {q.model_answer}</small>}
              </div>
            ))}
          </div>
        ))}
      </>}
    </Drawer>
  );
}
