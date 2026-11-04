import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { adminCall } from './adminApi';
import { supabase } from './supabase';
import { createRequestGuard, sameEmail } from './requestGuard';
import OldPaymentCheck from './OldPaymentCheck';

const money = (amount) => amount == null ? '—' : `TSh ${Number(amount).toLocaleString('en-TZ')}`;
const day = (value) => value ? new Date(value).toLocaleDateString() : '';
const when = (value) => value ? new Date(value).toLocaleString() : '';
const REVIEW_REASONS = {
  completed_not_applied: 'Money was received but access did not change (for example, the learner already had lifetime access or a newer package). Apply this receipt, or refund it and record the refund.',
  historical_completed: 'The provider reported an old payment as completed. It was not applied automatically. Check it, then apply or refund it.',
  missing_provider_reference: 'The provider never confirmed that this checkout started. It no longer blocks the learner after 6 hours.',
  historical_pending: 'An old payment is still pending at the provider.',
};
const REASON_FILTERS = [['', 'All reasons'], ['completed_not_applied', 'Money received, not applied'], ['historical_completed', 'Old payment completed'],
  ['missing_provider_reference', 'Provider never confirmed'], ['historical_pending', 'Old, still pending']];
const PRIORITY = { 1: 'Money received', 2: 'Money possibly received', 3: 'No provider reference', 4: 'Historical' };
const RESOLUTION_LABELS = { applied: 'Applied', refunded: 'Refunded', dismissed: 'No action needed', other: 'Other' };
const RESOLUTIONS = {
  refunded: 'Records that you refunded this payment in the provider dashboard. It does not send money and does not change access.',
  dismissed: 'Marks this item as needing no action (for example, the provider never received it). Access is not changed.',
  other: 'Records your note. Access is not changed.',
};

// Says where a status came from. A stored "pending" after a failed lookup is not a provider answer.
function describeCheck(d) {
  const status = String(d.status || '').toLowerCase().replace(/_/g, ' ');
  const held = d.application_status === 'held_for_review';
  if (d.provider_check === 'checked') {
    if (d.status === 'COMPLETED') return held ? 'The provider confirms the money was received. It is held for review because it could not be applied automatically.'
      : 'The provider confirms this payment completed, and access was applied.';
    return d.status === 'PENDING' ? 'The provider says this payment is still pending.' : `The provider reports: ${status}.`;
  }
  if (d.provider_check === 'final') return `Already settled (${status}${held ? '; money received, waiting to be applied' : ''}). No provider lookup was needed.`;
  if (d.provider_check === 'throttled') return `Checked moments ago. Last known status: ${status}. Try again in ${d.retry_after_seconds || 20} seconds.`;
  if (d.provider_check === 'unavailable') return `Could not verify with the provider right now. Last known status: ${status}.`;
  if (d.provider_check === 'no_reference') return `No provider reference was stored, so the provider cannot be asked. Last known status: ${status}.`;
  return `Last known status: ${status}.`;
}

// Apply a received payment, or record how a review item was resolved. Both ask
// for a note and show what will (and will not) happen before confirming.
function ReviewAction({ item, mode, onDone, onCancel, reportError }) {
  const [resolution, setResolution] = useState('refunded');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [replace, setReplace] = useState(false);
  const [needsReplace, setNeedsReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    const summary = mode === 'apply'
      ? `Apply this received payment (${item.label || 'package'}, ${money(item.amount)}) to ${item.email || 'the learner'}'s account?\n\nIt uses the money already received: no new payment is recorded and the provider is not contacted.${replace ? '\n\nThe learner\'s current package and its remaining days end now.' : ''}`
      : `${RESOLUTIONS[resolution]}${resolution === 'refunded' ? `\n\nRefund reference: ${reference.trim()}` : ''}`;
    if (!window.confirm(summary)) return;
    setBusy(true); reportError('');
    try {
      if (mode === 'apply') await adminCall('admin-general', { action: 'payment_apply', id: item.id, note: note.trim(), confirm_replace: replace });
      else await adminCall('admin-general', { action: 'payment_resolve', kind: item.kind, id: item.id, note: note.trim(), resolution, refund_reference: reference.trim() });
      onDone();
    } catch (e) {
      if (e.code === 'replace_confirmation_required') setNeedsReplace(true);
      reportError(e.message);
    } finally { setBusy(false); }
  };
  return <form className="compose review-action" onSubmit={submit}>
    <fieldset disabled={busy}>
      {mode === 'resolve' && <label>Resolution<select value={resolution} onChange={(e) => setResolution(e.target.value)}>
        <option value="refunded">Refunded (record the provider refund)</option>
        <option value="dismissed">No action needed</option>
        <option value="other">Other</option>
      </select></label>}
      {mode === 'resolve' && resolution === 'refunded' && <label>Refund reference from the provider dashboard
        <input required maxLength={120} value={reference} onChange={(e) => setReference(e.target.value)} /></label>}
      <label>{mode === 'apply' ? 'Why are you applying this receipt?' : 'Note'}
        <textarea required rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></label>
      {mode === 'apply' && needsReplace && <label className="inline-check"><input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
        Replace the learner&apos;s current package and its remaining days</label>}
      <p className="hint">{mode === 'apply' ? 'Applies the money already received. No new payment is recorded and the provider is not contacted.' : RESOLUTIONS[resolution]}</p>
      <div className="package-actions">
        <button type="submit" className="primary">{busy ? 'Saving…' : mode === 'apply' ? 'Apply receipt' : 'Record resolution'}</button>
        <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
      </div>
    </fieldset>
  </form>;
}

export default function AccessPanel({ reportError }) {
  const [email, setEmail] = useState('');
  const [user, setUser] = useState(undefined);
  const [plan, setPlan] = useState('business');
  const [grantKey, setGrantKey] = useState(() => crypto.randomUUID());
  const [confirmed, setConfirmed] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [ignorePending, setIgnorePending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [grants, setGrants] = useState([]);
  const [result, setResult] = useState(null);
  const [packages, setPackages] = useState([]);
  const [checking, setChecking] = useState('');
  const [paymentNote, setPaymentNote] = useState('');
  const [action, setAction] = useState(null);
  const [review, setReview] = useState({ items: [], total: 0, next: null, state: 'loading' });
  const [filters, setFilters] = useState({ reason: '', kind: '', search: '' });
  const [resolutions, setResolutions] = useState(null);
  const [reopening, setReopening] = useState(null);
  const [reopenNote, setReopenNote] = useState('');
  const lookupGuard = useRef(createRequestGuard()).current;
  const emailRef = useRef('');
  const selectedPackage = packages.find(p => p.id === plan);
  const expectedAmount = selectedPackage ? (user?.referred ? selectedPackage.referral_price ?? selectedPackage.price : selectedPackage.price) : null;
  const packageName = id => packages.find(p => p.id === id)?.name || id;
  // The loaded learner must be the one in the email field before anything is granted.
  const identityMatches = !!user && sameEmail(user.email, email);
  // The lookup reports `plan` only while the learner's membership is active.
  const active = !!user?.plan;
  const currentName = user?.package_name || packageName(user?.plan);
  const renewing = active && user.plan === selectedPackage?.id;
  const upgrade = active && user.plan === 'business' && selectedPackage?.id === 'premium';
  const downgrade = active && user.plan === 'premium' && selectedPackage?.id === 'business';
  const replacing = active && !!selectedPackage && !renewing && !upgrade && !downgrade;
  const pending = user?.pending_payment;
  const held = user?.held_payments ?? [];
  // An open form belongs to one place: the learner's held receipts or the review list.
  const isOpen = (where, id) => action?.where === where && action.item.id === id;
  const canGrant = identityMatches && user?.verified && selectedPackage && confirmed && !busy && !user.lifetime && !downgrade
    && !held.length && (!replacing || confirmReplace) && (!pending || ignorePending);

  const loadPackages = async () => {
    const { data, error } = await supabase.from('subscription_packages').select('id,name,access_tier,price,referral_price,revision,duration_days').order('sort_order').order('id');
    if (error) throw error;
    const rows = data || [];
    setPackages(rows);
    setPlan(current => rows.some(p => p.id === current) ? current : rows[0]?.id || '');
  };
  const loadHistory = async () => {
    try {
      const data = await adminCall('admin-general', { action: 'access_recent' });
      setGrants(data.grants || []);
    } catch (e) { reportError(e.message); }
  };
  const loadReview = async ({ more = false, filter = filters } = {}) => {
    setReview(r => ({ ...r, state: more ? 'more' : 'loading' }));
    try {
      const data = await adminCall('admin-general', { action: 'payment_review', limit: 25, reason: filter.reason || null,
        kind: filter.kind || null, search: filter.search.trim() || null, cursor: more ? review.next : null });
      setReview(r => ({ items: more ? [...r.items, ...(data.items || [])] : data.items || [], total: data.total ?? 0, next: data.next_cursor ?? null, state: 'ready' }));
    } catch (e) {
      setReview(r => ({ ...r, state: 'error' }));
      reportError(e.message);
    }
  };
  const loadResolutions = async () => {
    try { setResolutions((await adminCall('admin-general', { action: 'payment_resolutions' })).resolutions || []); }
    catch (e) { reportError(e.message); setResolutions([]); }
  };
  useEffect(() => { loadHistory(); loadReview(); loadPackages().catch(e => reportError(e.message)); }, []);

  // Results from a lookup started for another address, or superseded by a newer
  // lookup, are discarded rather than attached to the current input.
  const refreshLearner = async (address) => {
    const isCurrent = lookupGuard.begin();
    const data = await adminCall('admin-general', { action: 'access_lookup', email: address });
    if (!isCurrent() || !sameEmail(address, emailRef.current)) return undefined;
    setUser(data.user || null);
    return data.user;
  };
  const changeEmail = (value) => {
    lookupGuard.cancel();
    emailRef.current = value;
    setEmail(value); setUser(undefined); setResult(null); setPaymentNote(''); setAction(null);
    setConfirmed(false); setConfirmReplace(false); setIgnorePending(false);
  };
  const lookup = async () => {
    reportError('');
    setResult(null); setPaymentNote('');
    setBusy(true);
    try {
      await loadPackages();
      await refreshLearner(email.trim());
      setConfirmed(false); setConfirmReplace(false); setIgnorePending(false);
    } catch (e) {
      setUser(undefined);
      reportError(e.message);
    } finally { setBusy(false); }
  };

  // Asks the provider about a stored payment. It never charges the learner.
  const checkPayment = async (kind, id) => {
    reportError(''); setPaymentNote('');
    setChecking(id);
    try {
      const data = await adminCall('admin-general', { action: 'payment_check', kind, id });
      setPaymentNote(describeCheck(data));
      if (user?.email) await refreshLearner(user.email);
      await loadReview();
    } catch (e) { reportError(e.message); }
    finally { setChecking(''); }
  };
  const actionDone = async () => {
    setAction(null);
    await loadReview();
    if (resolutions) await loadResolutions();
    if (user?.email) await refreshLearner(user.email).catch(() => {});
  };
  const reopen = async (entry) => {
    if (!reopenNote.trim()) return;
    reportError('');
    try {
      await adminCall('admin-general', { action: 'payment_reopen', resolution_id: entry.id, note: reopenNote.trim() });
      setReopening(null); setReopenNote('');
      await Promise.all([loadResolutions(), loadReview()]);
    } catch (e) { reportError(e.message); }
  };

  const grant = async () => {
    if (!canGrant) return;
    const term = renewing
      ? `Renew ${selectedPackage.name}: ${selectedPackage.duration_days} days are added after the current expiry (${day(user.expires_at)}).`
      : replacing
        ? `Grant ${selectedPackage.name} for ${selectedPackage.duration_days} days. ${currentName} (ends ${day(user.expires_at)}) and its remaining days end now.`
        : `Grant ${selectedPackage.name} access for ${selectedPackage.duration_days} days?`;
    if (!window.confirm(`You verified receipt of ${money(expectedAmount)} for ${user.email}?\n\n${term}`)) return;
    reportError('');
    setBusy(true);
    try {
      const data = await adminCall('admin-general', {
        action: 'access_grant',
        email: user.email,
        plan: selectedPackage.access_tier,
        package_id: selectedPackage.id,
        package_revision: selectedPackage.revision,
        expected_amount: expectedAmount,
        grant_key: grantKey,
        // Compatibility with the previously deployed admin function. This is
        // generated by the app; the admin never enters a wallet reference.
        transfer_reference: `INTERNAL-${grantKey}`,
        confirmed: true,
        confirm_replace: replacing && confirmReplace,
        ignore_pending: !!pending && ignorePending,
      });
      setResult(data.grant);
      setGrantKey(crypto.randomUUID());
      setConfirmed(false); setConfirmReplace(false); setIgnorePending(false);
      await refreshLearner(user.email);
      await loadHistory();
    } catch (e) {
      if (e.code === 'replace_confirmation_required') setConfirmReplace(false);
      if (['pending_payment', 'held_receipt'].includes(e.code)) await refreshLearner(user.email).catch(() => {});
      reportError(/transfer reference has already been used/i.test(e.message)
        ? 'This access request was already recorded. Refresh recent grants before trying again.'
        : e.message);
    }
    finally { setBusy(false); }
  };

  const reviewItem = item => <div className="review-row" key={`${item.kind}:${item.id}`}>
    <div><strong>{item.label || item.kind} · {money(item.amount)}</strong>
      <small><span className={`review-priority p${item.priority}`}>{PRIORITY[item.priority] || 'Review'}</span> {item.email || 'Unknown learner'} · {when(item.created_at)} · {String(item.status).toLowerCase()} · {item.kind} · {item.merchant_reference}</small>
      <small>{REVIEW_REASONS[item.reason] || item.reason}</small>
      {isOpen('review', item.id) && <ReviewAction item={item} mode={action.mode} reportError={reportError} onDone={actionDone} onCancel={() => setAction(null)} />}
    </div>
    <div className="package-actions">
      {item.has_provider_reference && <button type="button" className="secondary" disabled={checking === item.id} onClick={() => checkPayment(item.kind, item.id)}>{checking === item.id ? 'Checking…' : 'Check with provider'}</button>}
      {/* While this item's form is open, its own buttons are the only way forward. */}
      {item.can_apply && !isOpen('review', item.id) && <button type="button" className="primary" onClick={() => setAction({ item, mode: 'apply', where: 'review' })}>Apply receipt</button>}
      {!isOpen('review', item.id) && <button type="button" className="secondary" onClick={() => setAction({ item, mode: 'resolve', where: 'review' })}>Resolve…</button>}
    </div>
  </div>;

  return <>
    <section className="card compose">
      <div className="card-head"><h2>Manual payment access</h2>
        <p>Only for a payment you independently verified in your mobile-money account. The learner must first register and verify their email in the web app.</p>
      </div>
      <label>Learner&apos;s registered email
        <input type="email" value={email} onChange={(e) => changeEmail(e.target.value)} placeholder="student@example.com" />
      </label>
      <button type="button" className="secondary" disabled={busy || !email.trim()} onClick={lookup}><Search />{busy ? 'Checking…' : 'Find account'}</button>
      {user === null && <div className="alert error">No registered account has this email. Ask the learner to sign up first.</div>}
      {user && !identityMatches && <div className="alert error">The email field no longer matches the loaded learner. Find the account again before granting.</div>}
      {user && <div className="send-check">
        <strong>{user.full_name || 'Registered learner'} · {user.email}</strong>
        <p>{user.verified ? 'Email verified' : 'Email not verified — ask the learner to verify it first.'}
          {' · '}Current package: {active ? currentName : 'Free'}{user.lifetime ? ' (lifetime)' : user.expires_at && active ? ` (expires ${day(user.expires_at)})` : ''}</p>
        {user.referred && <p>Referral code linked — use the referred price below.</p>}
        {user.recent_payments?.length > 0 && <div className="access-payments">
          <strong>Recent payments</strong>
          {user.recent_payments.map(p => <p key={p.id}>{when(p.created_at)} · {p.package_name || packageName(p.subscription_tier)} · {money(p.amount)} · {String(p.status).toLowerCase()}{p.access_expires_at ? ` · applied until ${day(p.access_expires_at)}` : ''}{p.reconciliation_review_reason === 'completed_not_applied' && !p.access_applied_at ? ' · received, not applied' : ''} · {p.payment_method || ''}</p>)}
        </div>}
      </div>}
      {user?.lifetime && <div className="alert success">This learner already has lifetime access. No payment or grant is needed.</div>}
      {identityMatches && held.length > 0 && <div className="send-check">
        <strong>Received payment waiting to be applied</strong>
        <p>Apply it (or refund it and record the refund) instead of recording a new payment. Granting is disabled until it is resolved.</p>
        {held.map(p => <div key={p.id} className="review-row">
          <div><strong>{p.package_name || packageName(p.subscription_tier)} · {money(p.amount)}</strong><small>{when(p.created_at)} · {p.merchant_reference}</small>
            {isOpen('held', p.id) && <ReviewAction mode={action.mode} reportError={reportError} onDone={actionDone} onCancel={() => setAction(null)}
              item={{ kind: 'subscription', id: p.id, label: p.package_name, amount: p.amount, email: user.email }} />}
          </div>
          {!isOpen('held', p.id) && <div className="package-actions">
            <button type="button" className="primary" onClick={() => setAction({ item: { kind: 'subscription', id: p.id, label: p.package_name, amount: p.amount, email: user.email }, mode: 'apply', where: 'held' })}>Apply this receipt</button>
            <button type="button" className="secondary" onClick={() => setAction({ item: { kind: 'subscription', id: p.id, label: p.package_name, amount: p.amount, email: user.email }, mode: 'resolve', where: 'held' })}>Refund / resolve…</button>
          </div>}
        </div>)}
      </div>}
      {identityMatches && pending && <div className="send-check">
        <strong>Payment in progress</strong>
        <p>{pending.package_name || packageName(pending.subscription_tier)} · {money(pending.amount)} · {pending.payment_method || 'payment'} · started {when(pending.created_at)}. If it completes, the learner gets access automatically. Granting now could charge them twice.</p>
        <button type="button" className="secondary" disabled={checking === pending.id} onClick={() => checkPayment('subscription', pending.id)}><RefreshCw />{checking === pending.id ? 'Checking…' : 'Check status with the provider'}</button>
        <label className="inline-check"><input type="checkbox" checked={ignorePending} onChange={(e) => setIgnorePending(e.target.checked)} />Grant anyway: I confirmed this payment did not go through</label>
      </div>}
      {paymentNote && <div className="alert success" role="status">{paymentNote}</div>}
      {identityMatches && user?.verified && !user.lifetime && !held.length && <>
        <label>Access plan
          <select value={plan} onChange={(e) => { setPlan(e.target.value); setConfirmed(false); setConfirmReplace(false); }}>
            {packages.map(p => <option key={p.id} value={p.id}>{p.name} — {money(user?.referred ? p.referral_price ?? p.price : p.price)} · {p.duration_days} days</option>)}
          </select>
        </label>
        {renewing && <p className="hint">Renewal: {selectedPackage.duration_days} days are added after the current expiry ({day(user.expires_at)}), so no remaining days are lost.</p>}
        {upgrade && <p className="hint">Upgrade: Business ends and a new {selectedPackage.duration_days}-day Premium term starts now (full price, no top-up).</p>}
        {downgrade && <div className="alert error">This learner has active Premium. It cannot be replaced with Business.</div>}
        {replacing && <label className="inline-check"><input type="checkbox" checked={confirmReplace} onChange={(e) => setConfirmReplace(e.target.checked)} />
          I understand {currentName} (ends {day(user.expires_at)}) and its remaining days end when I grant {selectedPackage.name}.
        </label>}
        <label className="inline-check"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          I checked my own wallet statement and received the full {money(expectedAmount)} for this learner.
        </label>
        {!packages.length && <p>No packages available. Publish a package in Packages & pricing first.</p>}
        <button type="button" className="primary" disabled={!canGrant} onClick={grant}>
          <ShieldCheck />{busy ? 'Granting…' : !selectedPackage ? 'Select a package' : renewing ? `Renew ${selectedPackage.name} (+${selectedPackage.duration_days} days)` : `Grant ${selectedPackage.name} for ${selectedPackage.duration_days} days`}
        </button>
      </>}
      {result && <div className="alert success"><CheckCircle2 />{result.email} has {result.package_name || result.plan} {result.renewed ? 'renewed' : 'access'} {result.expires_at ? `until ${new Date(result.expires_at).toLocaleString()}` : 'for life'}.</div>}
    </section>
    <section className="card">
      <div className="card-head row"><div><h2>Payments needing review</h2><p>Payments the system could not settle on its own, money received first. Check them with the provider, then apply or record how each was resolved.</p></div>
        <button type="button" className="icon-btn" aria-label="Refresh payments needing review" onClick={() => loadReview()}><RefreshCw /></button>
      </div>
      <OldPaymentCheck onFinished={() => loadReview()} />
      <form className="review-filters" onSubmit={(e) => { e.preventDefault(); loadReview(); }}>
        <select aria-label="Reason" value={filters.reason} onChange={(e) => { const next = { ...filters, reason: e.target.value }; setFilters(next); loadReview({ filter: next }); }}>
          {REASON_FILTERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <select aria-label="Payment type" value={filters.kind} onChange={(e) => { const next = { ...filters, kind: e.target.value }; setFilters(next); loadReview({ filter: next }); }}>
          <option value="">All payment types</option><option value="subscription">Packages</option><option value="shop">Shop</option><option value="meeting">Live sessions</option>
        </select>
        <input aria-label="Exact payment reference or learner email" placeholder="Exact payment reference or learner email" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} />
        <button type="submit" className="secondary"><Search />Search</button>
      </form>
      {review.state === 'loading' && <div className="empty">Loading payments needing review…</div>}
      {review.state === 'error' && <div className="alert error">Could not load the review list. <button type="button" className="secondary" onClick={() => loadReview()}>Retry</button></div>}
      {review.state !== 'loading' && review.state !== 'error' && <>
        <p className="hint">{review.total ? `Showing ${review.items.length} of ${review.total}.` : ''}</p>
        {!review.items.length && <div className="empty">{filters.reason || filters.kind || filters.search.trim() ? 'No payments match these filters.' : 'Nothing needs review.'}</div>}
        {review.items.map(reviewItem)}
        {review.next && <button type="button" className="secondary" disabled={review.state === 'more'} onClick={() => loadReview({ more: true })}>{review.state === 'more' ? 'Loading…' : 'Load more'}</button>}
      </>}
      <details className="package-archived" onToggle={(e) => { if (e.currentTarget.open && !resolutions) loadResolutions(); }}>
        <summary>Recently resolved</summary>
        {!resolutions && <p className="hint">Loading…</p>}
        {resolutions && !resolutions.length && <p className="hint">No resolutions recorded yet.</p>}
        {resolutions?.map(entry => <div className="review-row" key={entry.id}>
          <div><strong>{RESOLUTION_LABELS[entry.resolution] || entry.resolution} · {money(entry.amount)}</strong>
            <small>{when(entry.created_at)} · {entry.admin || 'admin'} · {entry.email || 'Unknown learner'} · {entry.merchant_reference}{entry.refund_reference ? ` · refund ref ${entry.refund_reference}` : ''}</small>
            <small>{entry.note}</small>
            {entry.reopened_at && <small>Reopened {when(entry.reopened_at)}: {entry.reopen_note}</small>}
            {reopening === entry.id && <div className="package-actions">
              <input aria-label="Why reopen?" placeholder="Why reopen?" maxLength={500} value={reopenNote} onChange={(e) => setReopenNote(e.target.value)} />
              <button type="button" className="secondary" disabled={!reopenNote.trim()} onClick={() => reopen(entry)}>Reopen</button>
              <button type="button" className="secondary" onClick={() => setReopening(null)}>Cancel</button>
            </div>}
          </div>
          {!entry.reopened_at && entry.resolution !== 'applied' && reopening !== entry.id && <div className="package-actions">
            <button type="button" className="secondary" onClick={() => { setReopening(entry.id); setReopenNote(''); }}>Reopen…</button>
          </div>}
        </div>)}
      </details>
    </section>
    <section className="card">
      <div className="card-head row"><div><h2>Recent manual grants</h2><p>Each grant is recorded automatically for your records.</p></div>
        <button type="button" className="icon-btn" aria-label="Refresh manual grants" onClick={loadHistory}><RefreshCw /></button>
      </div>
      {!grants.length && <div className="empty">No manual grants yet.</div>}
      {grants.map((item) => <div className="history-row" key={item.id}>
        <div><strong>{item.learner_email}</strong><small>{new Date(item.created_at).toLocaleString()}</small></div>
        <div className="counts"><strong>{packageName(item.plan)}</strong><small>{money(item.amount)}</small></div>
      </div>)}
    </section>
  </>;
}
