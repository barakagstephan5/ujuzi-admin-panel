import { useState } from 'react';
import {
  AlertTriangle, BookOpen, Box, CheckCircle2, ChevronRight, ClipboardList, HardDrive, Layers, Pause, Play, RefreshCw, Search, Settings2,
  ShoppingBag, Store, Users, Wallet,
} from 'lucide-react';
import { supabase } from '../supabase';
import { Avatar, Chips, Dialog, Empty, Pill, Skeleton, day, money, phone, rpc, useData, when } from './parts';
import { CourseReview, InstructorDrawer, ProductReview } from './Drawers';
import ExamsSection from './ExamsSection';
import './marketplace.css';

const SECTIONS = [
  { id: 'overview', label: 'Overview', icon: Store },
  { id: 'instructors', label: 'Instructors', icon: Users },
  { id: 'review', label: 'Review', icon: CheckCircle2 },
  { id: 'sales', label: 'Sales', icon: ShoppingBag },
  { id: 'payouts', label: 'Payouts', icon: Wallet },
  { id: 'storage', label: 'Storage', icon: HardDrive },
  { id: 'exams', label: 'Exams', icon: ClipboardList },
  { id: 'settings', label: 'Settings', icon: Settings2 },
];

export default function MarketplacePanel() {
  const [section, setSection] = useState('overview');
  const [jump, setJump] = useState(null); // preset filter when coming from the overview
  const summary = useData(() => rpc('admin_marketplace_summary'));
  const s = summary.data || {};
  const badges = {
    instructors: s.instructors_pending, review: (s.courses_pending || 0) + (s.products_pending || 0),
    payouts: (s.payouts_waiting || 0) + (s.numbers_to_approve || 0),
  };
  const go = (id, preset = null) => { setJump(preset); setSection(id); };
  const changed = () => summary.reload();

  return (
    <section className="mkt">
      <div className="mkt-head">
        <div><h2>Marketplace</h2><p>Instructors, their courses, products and exams, sales and weekly payouts.</p></div>
        <button type="button" className="mkt-icon" aria-label="Refresh" title="Refresh" onClick={changed}><RefreshCw /></button>
      </div>
      <nav className="mkt-tabs" aria-label="Marketplace sections">
        {SECTIONS.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" className={section === id ? 'active' : ''} onClick={() => go(id)}>
            <Icon />{label}{badges[id] > 0 && <b>{badges[id]}</b>}
          </button>
        ))}
      </nav>
      {section === 'overview' && <Overview summary={summary} go={go} />}
      {section === 'instructors' && <Instructors preset={jump} onChanged={changed} />}
      {section === 'review' && <Review preset={jump} onChanged={changed} />}
      {section === 'sales' && <Sales onChanged={changed} />}
      {section === 'payouts' && <Payouts preset={jump} paused={s.payouts_paused} onChanged={changed} />}
      {section === 'storage' && <Storage onChanged={changed} />}
      {section === 'exams' && <ExamsSection onChanged={changed} />}
      {section === 'settings' && <SettingsForm onChanged={changed} />}
    </section>
  );
}

function Overview({ summary, go }) {
  const { data: s, error, reload } = summary;
  if (error) return <div className="mkt-error">{error} <button type="button" className="mkt-btn ghost sm" onClick={reload}>Try again</button></div>;
  if (!s) return <Skeleton rows={5} />;
  const todo = [
    { n: s.courses_pending, text: 'courses to review', to: ['review', 'course'] },
    { n: s.products_pending, text: 'products to review', to: ['review', 'product'] },
    { n: s.numbers_to_approve, text: 'payout numbers to approve', to: ['instructors', 'numbers'] },
    { n: s.payouts_waiting, text: 'payouts need you', to: ['payouts', 'attention'] },
  ].filter(t => t.n > 0);
  return <>
    <div className="mkt-metrics">
      <div><span>Sales, 30 days</span><strong>{money(s.revenue_30d_tsh)}</strong><small>{s.sales_30d} sales</small></div>
      <div><span>Commission, 30 days</span><strong>{money(s.commission_30d_tsh)}</strong><small>Ujuzi's share</small></div>
      <div><span>Storage sold, 30 days</span><strong>{money(s.storage_30d_tsh)}</strong></div>
      <div><span>Owed to instructors</span><strong>{money(s.owed_tsh)}</strong><small>{money(s.paid_out_30d_tsh)} paid in 30 days</small></div>
      <div><span>Instructors</span><strong>{s.instructors_approved}</strong><small>approved</small></div>
      <div><span>Courses on sale</span><strong>{s.courses_live}</strong></div>
    </div>
    <div className="mkt-card">
      <h3>Needs you</h3>
      {s.payouts_paused && <button type="button" className="mkt-row warn" onClick={() => go('payouts')}><Pause /><span>Payouts are paused</span><ChevronRight /></button>}
      {todo.length === 0 && !s.payouts_paused ? <Empty icon={CheckCircle2} text="Nothing waiting. New applications, reviews and payouts show up here." />
        : todo.map(t => (
          <button key={t.text} type="button" className="mkt-row" onClick={() => go(t.to[0], t.to[1])}>
            <b className="mkt-count">{t.n}</b><span>{t.text}</span><ChevronRight />
          </button>
        ))}
    </div>
  </>;
}

function Instructors({ preset, onChanged }) {
  const [status, setStatus] = useState(preset === 'pending' ? 'pending' : preset === 'numbers' ? 'numbers' : null);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(null);
  const list = useData(() => rpc('admin_marketplace_instructors', { p_status: status === 'numbers' ? 'approved' : status, p_search: search || null }), [status, search]);
  const rows = (list.data || []).filter(i => status !== 'numbers' || (i.payout_phone && !i.payout_approved_at));
  const selected = open && (list.data || []).find(i => i.user_id === open);
  const changed = () => { list.reload(); onChanged(); };
  return <div className="mkt-card">
    <div className="mkt-toolbar">
      <Chips value={status} onChange={setStatus} options={[
        { value: null, label: 'All' }, { value: 'approved', label: 'Approved' },
        { value: 'numbers', label: 'Numbers to approve' }, { value: 'suspended', label: 'Suspended' }]} />
      <label className="mkt-search"><Search /><input type="search" placeholder="Name, handle or email" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
    </div>
    {list.error ? <div className="mkt-error">{list.error}</div> : !list.data ? <Skeleton /> : rows.length === 0
      ? <Empty icon={Users} text="No instructors here." />
      : rows.map(i => (
        <button key={i.user_id} type="button" className="mkt-row" onClick={() => setOpen(i.user_id)}>
          <Avatar name={i.display_name} url={i.avatar_url} />
          <span className="mkt-row-main"><strong>{i.display_name}</strong><small>@{i.handle} · {i.email}</small></span>
          <span className="mkt-row-meta">{i.courses_live} live · {i.sales} sales</span>
          {!i.selling_approved_at && <Pill status="pending">Free course first</Pill>}
          {i.payout_phone && !i.payout_approved_at && <Pill status="pending">Number to approve</Pill>}
          <Pill status={i.status} /><ChevronRight />
        </button>
      ))}
    {selected && <InstructorDrawer instructor={selected} onClose={() => setOpen(null)} onChanged={changed} />}
  </div>;
}

function Review({ preset, onChanged }) {
  const [kind, setKind] = useState(preset === 'product' ? 'product' : 'course');
  const [status, setStatus] = useState(kind === 'bundle' ? null : 'pending');
  const [open, setOpen] = useState(null);
  const [dialog, setDialog] = useState(null);
  const list = useData(() => rpc('admin_marketplace_items', { p_kind: kind, p_status: kind === 'bundle' ? null : status }), [kind, status]);
  const changed = () => { list.reload(); onChanged(); };
  const pick = (k) => { setKind(k); setStatus(k === 'bundle' ? null : 'pending'); };
  const icon = kind === 'course' ? BookOpen : kind === 'product' ? Box : Layers;
  return <div className="mkt-card">
    <div className="mkt-toolbar">
      <div className="mkt-segment">
        {[['course', 'Courses'], ['product', 'Products'], ['bundle', 'Bundles']].map(([k, label]) => (
          <button key={k} type="button" className={kind === k ? 'active' : ''} onClick={() => pick(k)}>{label}</button>))}
      </div>
      {kind !== 'bundle' && <Chips value={status} onChange={setStatus} options={[
        { value: 'pending', label: 'Waiting' }, { value: 'approved', label: 'Approved' }, { value: 'rejected', label: 'Changes requested' },
        { value: 'suspended', label: 'Suspended' }, { value: null, label: 'All' }]} />}
    </div>
    {list.error ? <div className="mkt-error">{list.error}</div> : !list.data ? <Skeleton /> : list.data.length === 0
      ? <Empty icon={icon} text={status === 'pending' ? 'Nothing waiting for review.' : 'Nothing here.'} />
      : list.data.map(item => kind === 'bundle' ? (
        <div key={item.id} className="mkt-row static">
          <span className="mkt-thumb"><Layers /></span>
          <span className="mkt-row-main"><strong>{item.title}</strong><small>{item.instructor.display_name} · {item.courses} courses · {money(item.price_tsh)}</small>
            {item.suspended_reason && <small className="mkt-warn">Suspended: {item.suspended_reason}</small>}</span>
          <Pill status={item.suspended_at ? 'suspended' : item.is_published ? 'live' : 'unlisted'}>{item.suspended_at ? 'Suspended' : item.is_published ? 'On sale' : 'Not listed'}</Pill>
          {item.suspended_at
            ? <button type="button" className="mkt-btn ghost sm" onClick={() => setDialog({ item, suspend: false })}>Lift</button>
            : <button type="button" className="mkt-btn ghost sm" onClick={() => setDialog({ item, suspend: true })}>Suspend</button>}
        </div>
      ) : (
        <button key={item.id} type="button" className="mkt-row" onClick={() => setOpen(item.id)}>
          {(item.thumbnail_url || item.cover_url) ? <img className="mkt-thumb" src={item.thumbnail_url || item.cover_url} alt="" /> : <span className="mkt-thumb">{kind === 'course' ? <BookOpen /> : <Box />}</span>}
          <span className="mkt-row-main"><strong>{item.title}</strong>
            <small>{item.instructor.display_name} · {kind === 'course' ? `${item.lessons} modules · ` : ''}{item.is_free ? 'Free' : money(item.price_tsh)}</small></span>
          <span className="mkt-row-meta">{item.submitted_at ? `Sent ${day(item.submitted_at)}` : ''}{item.sales ? ` · ${item.sales} sales` : ''}</span>
          <Pill status={item.review_status} /><ChevronRight />
        </button>
      ))}
    {open && kind === 'course' && <CourseReview id={open} onClose={() => setOpen(null)} onChanged={changed} />}
    {open && kind === 'product' && <ProductReview id={open} onClose={() => setOpen(null)} onChanged={changed} />}
    {dialog && <Dialog title={dialog.suspend ? `Suspend "${dialog.item.title}"?` : `Lift the suspension of "${dialog.item.title}"?`}
      message={dialog.suspend ? 'It comes off sale. The instructor can list it again after you lift the suspension.' : 'The instructor can list it again.'}
      confirmLabel={dialog.suspend ? 'Suspend' : 'Lift'} danger={dialog.suspend} reason={dialog.suspend}
      onConfirm={(note) => rpc('admin_suspend_bundle', { p_bundle: dialog.item.id, p_reason: note || '', p_suspend: dialog.suspend }).then(changed)}
      onClose={() => setDialog(null)} />}
  </div>;
}

const ITEM_LABEL = { course: 'Course', bundle: 'Bundle', product: 'Product' };
function Sales({ onChanged }) {
  const [status, setStatus] = useState('COMPLETED');
  const [refund, setRefund] = useState(null);
  const list = useData(() => rpc('admin_marketplace_sales', { p_status: status, p_limit: 200 }), [status]);
  const total = (list.data || []).reduce((n, x) => n + (x.status === 'COMPLETED' ? x.amount : 0), 0);
  return <div className="mkt-card">
    <div className="mkt-toolbar">
      <Chips value={status} onChange={setStatus} options={[{ value: 'COMPLETED', label: 'Paid' }, { value: 'PENDING', label: 'Waiting' },
        { value: 'FAILED', label: 'Failed' }, { value: 'REFUNDED', label: 'Refunded' }, { value: null, label: 'All' }]} />
      {status === 'COMPLETED' && list.data?.length > 0 && <span className="mkt-muted">{list.data.length} shown · {money(total)}</span>}
    </div>
    {list.error ? <div className="mkt-error">{list.error}</div> : !list.data ? <Skeleton /> : list.data.length === 0 ? <Empty icon={ShoppingBag} text="No sales here yet." />
      : <div className="mkt-table" role="table">
        <div className="mkt-tr head" role="row"><span>Item</span><span>Buyer</span><span>Instructor</span><span className="num">Amount</span><span>Status</span><span /></div>
        {list.data.map(x => (
          <div key={x.id} className="mkt-tr" role="row">
            <span><strong>{x.item_title}</strong><small>{ITEM_LABEL[x.item_type]} · {when(x.completed_at || x.created_at)}</small></span>
            <span className="mkt-ellipsis">{x.buyer}<small>{phone(x.phone)}</small></span>
            <span>{x.instructor?.display_name}<small>@{x.instructor?.handle}</small></span>
            <span className="num">{money(x.amount)}<small>{money(Math.round(x.amount * x.commission_bps / 10000))} commission</small></span>
            <span><Pill status={x.status} />{x.refund_reason && <small>{x.refund_reason}</small>}</span>
            <span>{x.status === 'COMPLETED' && <button type="button" className="mkt-btn ghost sm" onClick={() => setRefund(x)}>Refund</button>}</span>
          </div>
        ))}
      </div>}
    {refund && <Dialog title={`Refund ${money(refund.amount)}?`} danger reason confirmLabel="Mark refunded"
      message={`${refund.buyer} loses access to "${refund.item_title}" and the instructor's share is reversed. Send the money back to ${phone(refund.phone) || 'the buyer'} yourself in Snippe.`}
      onConfirm={(note) => rpc('admin_refund_purchase', { p_purchase: refund.id, p_reason: note }).then(() => { list.reload(); onChanged(); })}
      onClose={() => setRefund(null)} />}
  </div>;
}

function Payouts({ preset, paused, onChanged }) {
  const [status, setStatus] = useState(preset === 'attention' ? 'attention' : null);
  const [dialog, setDialog] = useState(null);
  const list = useData(() => rpc('admin_marketplace_payouts', { p_status: status, p_limit: 200 }), [status]);
  const changed = () => { list.reload(); onChanged(); };
  const dialogs = {
    run: { title: 'Prepare payouts now?', message: 'Everyone with at least the minimum available balance gets a payout for today. New or changed numbers and large amounts wait for you. Payouts also run every Monday at 09:00.',
      confirmLabel: 'Prepare payouts', onConfirm: () => rpc('prepare_payout_run', {}).then(changed) },
    pause: { title: paused ? 'Resume payouts?' : 'Pause all payouts?', message: paused ? 'Queued payouts start sending again.' : 'Nothing is sent until you resume. Balances keep growing.',
      confirmLabel: paused ? 'Resume' : 'Pause', danger: !paused, onConfirm: () => rpc('admin_save_marketplace_settings', { p_settings: { payouts_paused: !paused } }).then(changed) },
  };
  const rowDialog = (p, kind) => ({
    approve: { title: `Send ${money(p.amount_tsh)} to ${p.instructor?.display_name}?`, message: `To ${phone(p.phone)} (${p.recipient_name}).${p.instructor?.payout_approved_at ? '' : ' This also approves the number.'}`,
      confirmLabel: 'Approve and send', onConfirm: () => rpc('admin_approve_payout', { p_payout: p.id }).then(changed) },
    cancel: { title: 'Cancel this payout?', message: 'The money goes back to the instructor\'s balance.', confirmLabel: 'Cancel payout', danger: true, reason: true,
      onConfirm: (note) => rpc('admin_cancel_payout', { p_payout: p.id, p_reason: note }).then(changed) },
    paid: { title: 'Mark as paid?', message: 'Only if the Snippe dashboard shows this payout completed.', confirmLabel: 'Mark paid', reason: true, reasonLabel: 'What you checked',
      onConfirm: (note) => rpc('admin_resolve_payout', { p_payout: p.id, p_result: 'completed', p_reason: note }).then(changed) },
    failed: { title: 'Mark as failed?', message: 'Only if Snippe shows it failed or it was never sent. The money goes back to the instructor.', confirmLabel: 'Mark failed', danger: true, reason: true, reasonLabel: 'What you checked',
      onConfirm: (note) => rpc('admin_resolve_payout', { p_payout: p.id, p_result: 'failed', p_reason: note }).then(changed) },
  })[kind];
  return <div className="mkt-card">
    {paused && <div className="mkt-banner"><AlertTriangle />Payouts are paused. Nothing is sent until you resume.</div>}
    <div className="mkt-toolbar">
      <Chips value={status} onChange={setStatus} options={[{ value: 'attention', label: 'Needs you' }, { value: 'active', label: 'In progress' },
        { value: 'completed', label: 'Paid' }, { value: 'failed', label: 'Failed' }, { value: null, label: 'All' }]} />
      <span className="mkt-grow" />
      <button type="button" className="mkt-btn ghost" onClick={() => setDialog(dialogs.pause)}>{paused ? <><Play />Resume</> : <><Pause />Pause</>}</button>
      <button type="button" className="mkt-btn primary" disabled={paused} onClick={() => setDialog(dialogs.run)}><Wallet />Prepare payouts</button>
    </div>
    {list.error ? <div className="mkt-error">{list.error}</div> : !list.data ? <Skeleton /> : list.data.length === 0
      ? <Empty icon={Wallet} text={status === 'attention' ? 'No payouts need you.' : 'No payouts here yet.'} />
      : list.data.map(p => (
        <div key={p.id} className="mkt-row static">
          <span className="mkt-row-main"><strong>{money(p.amount_tsh)} to {p.instructor?.display_name}</strong>
            <small>{phone(p.phone)} · {p.recipient_name} · week of {day(p.period_start)} · fee {money(p.fee_tsh)}</small>
            {(p.hold_reason || p.failure_reason) && <small className="mkt-warn">{p.failure_reason || p.hold_reason}</small>}
            {p.snippe_reference && <small>Snippe {p.snippe_reference}</small>}</span>
          <Pill status={p.status} />
          <span className="mkt-actions">
            {p.status === 'awaiting_approval' && <button type="button" className="mkt-btn primary sm" onClick={() => setDialog(rowDialog(p, 'approve'))}>Approve</button>}
            {['awaiting_approval', 'queued'].includes(p.status) && <button type="button" className="mkt-btn ghost sm" onClick={() => setDialog(rowDialog(p, 'cancel'))}>Cancel</button>}
            {p.status === 'review' && <><button type="button" className="mkt-btn ghost sm" onClick={() => setDialog(rowDialog(p, 'paid'))}>Paid</button>
              <button type="button" className="mkt-btn ghost sm" onClick={() => setDialog(rowDialog(p, 'failed'))}>Failed</button></>}
          </span>
        </div>
      ))}
    {dialog && <Dialog {...dialog} onClose={() => setDialog(null)} />}
  </div>;
}

function Storage({ onChanged }) {
  const [refund, setRefund] = useState(null);
  const list = useData(() => rpc('admin_storage_orders', { p_limit: 200 }));
  return <div className="mkt-card">
    {list.error ? <div className="mkt-error">{list.error}</div> : !list.data ? <Skeleton /> : list.data.length === 0 ? <Empty icon={HardDrive} text="No storage bought yet." />
      : list.data.map(o => {
        const running = o.status === 'COMPLETED' && Date.parse(o.ends_at) > Date.now();
        return (
          <div key={o.id} className="mkt-row static">
            <span className="mkt-thumb"><HardDrive /></span>
            <span className="mkt-row-main"><strong>{o.gb} GB for {o.months} {o.months === 1 ? 'month' : 'months'} · {money(o.amount)}</strong>
              <small>{o.instructor?.display_name} · {when(o.created_at)}{o.ends_at ? ` · ${running ? 'ends' : 'ended'} ${day(o.ends_at)}` : ''}</small>
              {o.refund_reason && <small className="mkt-warn">{o.refund_reason}</small>}</span>
            <Pill status={o.status} />
            {o.status === 'COMPLETED' && <button type="button" className="mkt-btn ghost sm" onClick={() => setRefund(o)}>Refund</button>}
          </div>
        );
      })}
    {refund && <Dialog title={`Refund ${money(refund.amount)}?`} danger reason confirmLabel="Mark refunded"
      message="The extra space ends now. Files stay, but uploads pause if they are over their space. Send the money back yourself in Snippe."
      onConfirm={(note) => rpc('admin_refund_storage_order', { p_order: refund.id, p_reason: note }).then(() => { list.reload(); onChanged(); })}
      onClose={() => setRefund(null)} />}
  </div>;
}

const GB = 1024 ** 3, MB = 1024 ** 2;
const FIELDS = [
  { group: 'Money', items: [
    ['commission_bps', 'Ujuzi commission', '%', 100], ['processor_fee_bps', 'Payment fee charged to instructors', '%', 100],
    ['min_course_price_tsh', 'Lowest course price', 'TSh', 1], ['max_course_price_tsh', 'Highest course price', 'TSh', 1]] },
  { group: 'Payouts', items: [
    ['hold_days', 'Hold earnings for', 'days', 1], ['min_payout_tsh', 'Smallest payout', 'TSh', 1], ['payout_fee_tsh', 'Fee per payout', 'TSh', 1],
    ['max_auto_payout_tsh', 'Larger payouts wait for you above', 'TSh', 1], ['max_run_tsh', 'Most sent in one run', 'TSh', 1]] },
  { group: 'Storage', items: [
    ['free_storage_bytes', 'Free storage per instructor', 'GB', GB], ['storage_price_per_gb_tsh', 'Extra storage per GB a month', 'TSh', 1],
    ['max_video_bytes', 'Largest video', 'GB', GB], ['max_file_bytes', 'Largest other file', 'MB', MB]] },
];
function SettingsForm({ onChanged }) {
  const current = useData(async () => {
    const { data, error } = await supabase.from('marketplace_settings').select('*').limit(1).single();
    if (error) throw new Error(error.message); return data;
  });
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState('');
  const [error, setError] = useState('');
  const base = current.data;
  const value = (k, scale) => form?.[k] ?? (base ? String(+(base[k] / scale).toFixed(2)) : '');
  const dirty = form && Object.keys(form).length > 0;
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setError(''); setSaved('');
    const out = {};
    for (const { items } of FIELDS) for (const [k, , , scale] of items) if (form?.[k] !== undefined) out[k] = Math.round(Number(form[k]) * scale);
    try { await rpc('admin_save_marketplace_settings', { p_settings: out }); setForm(null); await current.reload(); onChanged(); setSaved('Settings saved. New prices and fees apply to new sales only.'); }
    catch (err) { setError(err.message.includes('check constraint') ? 'One of the values is outside what is allowed. Check the numbers and try again.' : err.message); }
    finally { setBusy(false); }
  };
  if (current.error) return <div className="mkt-error">{current.error}</div>;
  if (!base) return <Skeleton rows={6} />;
  return <form className="mkt-card mkt-settings" onSubmit={save}>
    {FIELDS.map(({ group, items }) => (
      <fieldset key={group}><legend>{group}</legend>
        {items.map(([k, label, unit, scale]) => (
          <label key={k} className="mkt-field row">{label}
            <span className="mkt-unit"><input type="number" step="any" min={0} value={value(k, scale)} onChange={(e) => setForm(f => ({ ...(f || {}), [k]: e.target.value }))} /><i>{unit}</i></span>
          </label>
        ))}
      </fieldset>
    ))}
    <p className="mkt-hint">Sales keep the commission and fee they were sold with. Last changed {when(base.updated_at)}.</p>
    {error && <div className="mkt-error">{error}</div>}
    {saved && <div className="mkt-success">{saved}</div>}
    <div className="mkt-actions end">
      {dirty && <button type="button" className="mkt-btn ghost" onClick={() => setForm(null)}>Discard</button>}
      <button type="submit" className="mkt-btn primary" disabled={!dirty || busy}>{busy ? 'Saving…' : 'Save settings'}</button>
    </div>
  </form>;
}
