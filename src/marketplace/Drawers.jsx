import { useState } from 'react';
import { BadgeCheck, CheckCircle2, Download, ExternalLink, FileText, Film, HardDrive, Phone, PlayCircle } from 'lucide-react';
import { Avatar, Dialog, Drawer, Pill, Skeleton, bytes, day, fileUrl, money, phone, rpc, useData, when } from './parts';

const minutes = (s) => (s ? `${Math.round(s / 60)} min` : '');

function FileButton({ label, moduleId, assetId, icon: Icon = Download }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const open = async () => {
    setBusy(true); setError('');
    try { window.open(await fileUrl({ moduleId, assetId }), '_blank', 'noopener'); } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  return <>
    <button type="button" className="mkt-btn ghost sm" disabled={busy} onClick={open}><Icon />{busy ? 'Opening…' : label}</button>
    {error && <span className="mkt-error inline">{error}</span>}
  </>;
}

function VideoPreview({ lesson }) {
  const [src, setSrc] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (lesson.video_url) {
    return <a className="mkt-link" href={lesson.video_url} target="_blank" rel="noreferrer"><ExternalLink />{new URL(lesson.video_url).hostname.replace(/^www\./, '')} video</a>;
  }
  if (!lesson.video) return <span className="mkt-warn">No video</span>;
  if (src) return <video className="mkt-video" src={src} controls autoPlay preload="metadata" />;
  const load = async () => {
    setBusy(true); setError('');
    try { setSrc(await fileUrl({ moduleId: lesson.id })); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return <>
    <button type="button" className="mkt-btn ghost sm" disabled={busy} onClick={load}><PlayCircle />{busy ? 'Loading…' : `Play ${bytes(lesson.video.bytes)} upload`}</button>
    {error && <span className="mkt-error inline">{error}</span>}
  </>;
}

// Approve, request changes, suspend or reinstate, by the item's state.
function Decisions({ status, kindLabel, onDecide }) {
  const [dialog, setDialog] = useState(null);
  const open = (decision) => setDialog(decision);
  const config = {
    approved: { title: `Approve this ${kindLabel}?`, message: 'It goes on sale straight away.', label: 'Approve' },
    rejected: { title: 'Request changes', message: 'The instructor sees your note and can send it again.', label: 'Send note', reason: true, reasonLabel: 'What needs to change' },
    suspended: { title: `Suspend this ${kindLabel}?`, message: 'It comes off sale and buyers lose access until you reinstate it.', label: 'Suspend', reason: true, danger: true },
  };
  return <>
    {status === 'pending' && <>
      <button type="button" className="mkt-btn ghost" onClick={() => open('rejected')}>Request changes</button>
      <button type="button" className="mkt-btn primary" onClick={() => open('approved')}><CheckCircle2 />Approve</button>
    </>}
    {status === 'approved' && <button type="button" className="mkt-btn danger" onClick={() => open('suspended')}>Suspend</button>}
    {status === 'suspended' && <button type="button" className="mkt-btn primary" onClick={() => open('approved')}>Reinstate</button>}
    {status === 'rejected' && <span className="mkt-muted">Waiting for the instructor to send it again</span>}
    {dialog && <Dialog {...config[dialog]} confirmLabel={config[dialog].label} reasonLabel={config[dialog].reasonLabel}
      onConfirm={(note) => onDecide(dialog, note)} onClose={() => setDialog(null)} />}
  </>;
}

export function CourseReview({ id, onClose, onChanged }) {
  const { data, error, reload } = useData(() => rpc('admin_course_review', { p_course: id }), [id]);
  const c = data?.course;
  const decide = async (decision, note) => {
    await rpc('admin_review_course', { p_course: id, p_decision: decision, p_note: note || null });
    await reload(); onChanged();
  };
  const questions = data ? data.lessons.reduce((n, l) => n + l.quizzes.reduce((m, q) => m + q.questions.length, 0), 0) : 0;
  return (
    <Drawer title={c?.title || 'Course'} subtitle={data ? `by ${data.instructor.display_name} · @${data.instructor.handle}` : ''} onClose={onClose}
      footer={c && <div className="mkt-actions end"><Pill status={c.review_status} /><span className="mkt-grow" /><Decisions status={c.review_status} kindLabel="course" onDecide={decide} /></div>}>
      {error ? <div className="mkt-error">{error}</div> : !data ? <Skeleton rows={6} /> : <>
        <div className="mkt-hero">
          {c.thumbnail_url ? <img src={c.thumbnail_url} alt="" /> : <div className="mkt-hero-empty"><Film /></div>}
          <div className="mkt-facts">
            <div><span>Price</span><strong>{c.is_free ? 'Free' : money(c.sale_price_tsh)}</strong></div>
            <div><span>Level</span><strong>{c.level || 'Not set'}</strong></div>
            <div><span>Length</span><strong>{c.duration_minutes ? `${Math.floor(c.duration_minutes / 60)}h ${c.duration_minutes % 60}m` : 'Not set'}</strong></div>
            <div><span>Sent</span><strong>{day(c.submitted_at) || 'Not sent'}</strong></div>
          </div>
        </div>
        {c.review_note && <div className="mkt-note"><b>Last note:</b> {c.review_note}</div>}
        <section className="mkt-section"><h3>Description</h3><p className="mkt-prose">{c.description || <span className="mkt-warn">No description</span>}</p></section>
        {c.community_url && <section className="mkt-section"><h3>Community link</h3><a className="mkt-link" href={c.community_url} target="_blank" rel="noreferrer"><ExternalLink />{c.community_url}</a></section>}
        <section className="mkt-section">
          <h3>Modules <small>{data.lessons.length} modules · {questions} questions</small></h3>
          <ol className="mkt-lessons">
            {data.lessons.map((l, i) => (
              <li key={l.id}>
                <div className="mkt-lesson-head"><span className="mkt-num">{i + 1}</span><strong>{l.title}</strong><small>{minutes(l.duration_seconds)}</small></div>
                <div className="mkt-lesson-media"><VideoPreview lesson={l} /></div>
                {l.quizzes.map((q, qi) => (
                  <details key={qi} className="mkt-quiz">
                    <summary>{q.kind === 'exercise' ? 'Exercise' : 'Quiz'}: {q.questions.length} questions, pass at {q.passing_score}%</summary>
                    <ol>{q.questions.map((qq, k) => (
                      <li key={k}><p>{qq.question}</p><ul>{qq.options.map((o, oi) => (
                        <li key={oi} className={oi === qq.correct_option_index ? 'correct' : ''}>{oi === qq.correct_option_index && <CheckCircle2 />}{o}</li>
                      ))}</ul></li>
                    ))}</ol>
                  </details>
                ))}
              </li>
            ))}
          </ol>
        </section>
        {(data.exercise || data.assignments.length > 0) && (
          <section className="mkt-section">
            <h3>Exercise and assignments</h3>
            {data.exercise && <div className="mkt-file"><FileText /><span>{data.exercise.original_name}<small>{bytes(data.exercise.bytes)}</small></span><FileButton label="Open" assetId={data.exercise.id} /></div>}
            {data.assignments.map((a, i) => (
              <div key={i} className="mkt-assignment">
                <strong>{a.title}</strong><small>Out of {a.max_score}</small>
                {a.instructions && <p>{a.instructions}</p>}
                {a.attachment && <div className="mkt-file"><FileText /><span>{a.attachment.original_name}<small>{bytes(a.attachment.bytes)}</small></span><FileButton label="Open" assetId={a.attachment.id} /></div>}
              </div>
            ))}
          </section>
        )}
      </>}
    </Drawer>
  );
}

export function ProductReview({ id, onClose, onChanged }) {
  const { data, error, reload } = useData(() => rpc('admin_product_review', { p_product: id }), [id]);
  const p = data?.product;
  const decide = async (decision, note) => {
    await rpc('admin_review_product', { p_product: id, p_decision: decision, p_note: note || null });
    await reload(); onChanged();
  };
  return (
    <Drawer title={p?.title || 'Product'} subtitle={data ? `by ${data.instructor.display_name} · @${data.instructor.handle}` : ''} onClose={onClose}
      footer={p && <div className="mkt-actions end"><Pill status={p.review_status} /><span className="mkt-grow" /><Decisions status={p.review_status} kindLabel="product" onDecide={decide} /></div>}>
      {error ? <div className="mkt-error">{error}</div> : !data ? <Skeleton rows={5} /> : <>
        <div className="mkt-hero">
          {p.cover_url ? <img src={p.cover_url} alt="" /> : <div className="mkt-hero-empty"><FileText /></div>}
          <div className="mkt-facts">
            <div><span>Price</span><strong>{money(p.price_tsh)}</strong></div>
            <div><span>Type</span><strong style={{ textTransform: 'capitalize' }}>{p.kind}</strong></div>
            <div><span>Sent</span><strong>{day(p.submitted_at) || 'Not sent'}</strong></div>
          </div>
        </div>
        {p.review_note && <div className="mkt-note"><b>Last note:</b> {p.review_note}</div>}
        <section className="mkt-section"><h3>Description</h3><p className="mkt-prose">{p.description || <span className="mkt-warn">No description</span>}</p></section>
        <section className="mkt-section"><h3>File buyers get</h3>
          {data.file ? <div className="mkt-file"><FileText /><span>{data.file.original_name}<small>{bytes(data.file.bytes)}</small></span><FileButton label="Open" assetId={data.file.id} /></div>
            : <span className="mkt-warn">No file attached</span>}
        </section>
      </>}
    </Drawer>
  );
}

export function InstructorDrawer({ instructor: i, onClose, onChanged }) {
  const [dialog, setDialog] = useState(null);
  const [gb, setGb] = useState(String(Math.round((i.extra_storage_bytes || 0) / 1024 ** 3)));
  const [savingGb, setSavingGb] = useState(false);
  const [gbError, setGbError] = useState('');
  const act = (fn) => async (note) => { await fn(note); onChanged(); };
  const review = (status) => act((note) => rpc('admin_review_instructor', { p_user: i.user_id, p_status: status, p_reason: note || null }));
  const dialogs = {
    approve: { title: `Approve ${i.display_name}?`, message: 'They can create courses and products and sell once each is reviewed.', confirmLabel: 'Approve', onConfirm: review('approved') },
    reject: { title: 'Decline this application?', confirmLabel: 'Decline', danger: true, reason: true, reasonLabel: 'Reason the applicant sees', onConfirm: review('rejected') },
    suspend: { title: `Suspend ${i.display_name}?`, message: 'Everything they sell comes off sale. Buyers keep access.', confirmLabel: 'Suspend', danger: true, reason: true, onConfirm: review('suspended') },
    number: { title: `Approve ${phone(i.payout_phone)}?`, message: `Payouts will go to this number in the name of ${i.payout_name}. Check that it belongs to the instructor.`, confirmLabel: 'Approve number',
      onConfirm: act(() => rpc('admin_approve_payout_account', { p_user: i.user_id })) },
  };
  const saveGb = async () => {
    setSavingGb(true); setGbError('');
    try { await rpc('admin_set_extra_storage', { p_user: i.user_id, p_gb: Number(gb) }); onChanged(); } catch (e) { setGbError(e.message); }
    finally { setSavingGb(false); }
  };
  const verified = i.verified_until && Date.parse(i.verified_until) > Date.now();
  const s = i.storage || {};
  return (
    <Drawer title={i.display_name} subtitle={`@${i.handle} · ${i.email || ''}`} onClose={onClose}
      footer={<div className="mkt-actions end">
        <Pill status={i.status} /><span className="mkt-grow" />
        {i.status === 'pending' && <><button type="button" className="mkt-btn ghost" onClick={() => setDialog('reject')}>Decline</button>
          <button type="button" className="mkt-btn primary" onClick={() => setDialog('approve')}><CheckCircle2 />Approve</button></>}
        {i.status === 'approved' && <button type="button" className="mkt-btn danger" onClick={() => setDialog('suspend')}>Suspend</button>}
        {(i.status === 'suspended' || i.status === 'rejected') && <button type="button" className="mkt-btn primary" onClick={() => setDialog('approve')}>Approve</button>}
      </div>}>
      <div className="mkt-profile">
        <Avatar name={i.display_name} url={i.avatar_url} size={64} />
        <div><strong>{i.display_name}{verified && <BadgeCheck className="mkt-tick" />}</strong><span>Applied {day(i.applied_at)}{i.reviewed_at ? ` · reviewed ${day(i.reviewed_at)}` : ''}</span></div>
      </div>
      {i.status_reason && <div className="mkt-note"><b>Note:</b> {i.status_reason}</div>}
      <section className="mkt-section"><h3>About</h3><p className="mkt-prose">{i.bio || <span className="mkt-muted">No bio yet</span>}</p></section>
      <section className="mkt-section">
        <h3>Numbers</h3>
        <div className="mkt-stats">
          <div><span>Courses</span><strong>{i.courses_live}/{i.courses}</strong><small>live / total</small></div>
          <div><span>Products</span><strong>{i.products}</strong></div>
          <div><span>Sales</span><strong>{i.sales}</strong></div>
          <div><span>Earned</span><strong>{money(i.earned_tsh)}</strong><small>after commission</small></div>
          <div><span>Balance</span><strong>{money(i.balance_tsh)}</strong><small>not yet paid out</small></div>
        </div>
      </section>
      <section className="mkt-section">
        <h3>Payout number</h3>
        {i.payout_phone ? (
          <div className="mkt-file"><Phone /><span>{phone(i.payout_phone)}<small>{i.payout_name}</small></span>
            {i.payout_approved_at ? <Pill status="approved">Approved {day(i.payout_approved_at)}</Pill>
              : <button type="button" className="mkt-btn primary sm" onClick={() => setDialog('number')}>Approve number</button>}
          </div>
        ) : <span className="mkt-muted">Not added yet</span>}
      </section>
      <section className="mkt-section">
        <h3>Storage</h3>
        <div className="mkt-file"><HardDrive /><span>{bytes(s.used_bytes)} of {bytes(s.quota_bytes)} used
          <small>{bytes(s.free_bytes)} free{s.extra_bytes ? ` plus ${bytes(s.extra_bytes)} extra` : ''}</small></span></div>
        <div className="mkt-meter"><span style={{ width: `${Math.min(100, (s.used_bytes / Math.max(1, s.quota_bytes)) * 100)}%` }} /></div>
        <div className="mkt-inline-form">
          <label className="mkt-field">Free extra space (GB)<input type="number" min={0} max={10000} value={gb} onChange={(e) => setGb(e.target.value)} /></label>
          <button type="button" className="mkt-btn ghost" disabled={savingGb} onClick={saveGb}>{savingGb ? 'Saving…' : 'Save'}</button>
        </div>
        {gbError && <div className="mkt-error">{gbError}</div>}
        <p className="mkt-hint">Given on top of the free allowance and any space they paid for. Updated {when(i.updated_at)}.</p>
      </section>
      {dialog && <Dialog {...dialogs[dialog]} onClose={() => setDialog(null)} />}
    </Drawer>
  );
}
