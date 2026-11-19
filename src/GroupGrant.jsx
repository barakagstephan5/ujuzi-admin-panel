import { useEffect, useMemo, useState } from 'react';
import { Check, Copy, RefreshCw, Users } from 'lucide-react';
import { supabase } from './supabase';
import { MAX_GROUP_EMAILS, groupResults, parseEmails } from './groupEmails';
import './group-grant.css';

const money = (amount) => amount == null ? '' : `TSh ${Number(amount).toLocaleString('en-TZ')}`;
const when = (value) => value ? new Date(value).toLocaleString() : '';

async function rpc(name, params) {
  const { data, error } = await supabase.rpc(name, params);
  if (error) throw error;
  return data;
}

function CopyButton({ emails, label = 'Copy emails' }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(emails.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* Clipboard blocked: the emails are on screen to select by hand. */ }
  };
  return <button type="button" className="secondary gg-pill" onClick={copy}>{copied ? <Check /> : <Copy />}{copied ? 'Copied' : label}</button>;
}

// One batch's outcome: what was applied and who was already covered (folded
// away), then everyone who still needs action, grouped by reason with the
// emails ready to copy.
function BatchResult({ batch }) {
  const groups = groupResults(batch.results);
  const settled = groups.filter(g => g.kind !== 'action');
  const notDone = groups.filter(g => g.kind === 'action');
  const failed = notDone.flatMap(g => g.emails);
  const covered = groups.filter(g => g.kind === 'covered').reduce((n, g) => n + g.emails.length, 0);
  return <div className="gg-result">
    <div className="gg-summary">
      <span className="gg-chip ok">{batch.applied_count} given {batch.package_name}</span>
      {covered > 0 && <span className="gg-chip">{covered} already covered</span>}
      {failed.length > 0 && <span className="gg-chip warn">{failed.length} not done</span>}
    </div>
    {settled.map(g => <details key={g.outcome} className="gg-group">
      <summary>{g.label} <b>{g.emails.length}</b></summary>
      <p className="gg-emails">{g.emails.join(', ')}</p>
    </details>)}
    {notDone.map(g => <div key={g.outcome} className="gg-group open">
      <div className="gg-group-head">
        <div><strong>{g.label} · {g.emails.length}</strong>{g.help && <small>{g.help}</small>}</div>
        <CopyButton emails={g.emails} />
      </div>
      <ul className="gg-list">{g.emails.map(email => <li key={email}>{email}</li>)}</ul>
    </div>)}
    {notDone.length > 1 && <CopyButton emails={failed} label="Copy every email not done" />}
  </div>;
}

export default function GroupGrant({ reportError }) {
  const [packages, setPackages] = useState([]);
  const [packageId, setPackageId] = useState('');
  const [sponsor, setSponsor] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [text, setText] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  // Kept while the inputs are unchanged, so resending after a lost reply returns
  // the first result instead of granting twice.
  const [grantId, setGrantId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [recent, setRecent] = useState(null);

  const parsed = useMemo(() => parseEmails(text), [text]);
  const pkg = packages.find(p => p.id === packageId);
  const amountDigits = amount.replace(/[^\d]/g, '');
  const amountValue = amountDigits === '' ? null : Number(amountDigits);
  const tooMany = parsed.emails.length > MAX_GROUP_EMAILS;
  // False until the server update that adds group access is live.
  const [serverReady, setServerReady] = useState(true);
  const canSend = serverReady && !!pkg && sponsor.trim().length >= 2 && parsed.emails.length > 0 && !tooMany && confirmed && !busy
    && (amountValue == null || Number.isSafeInteger(amountValue));

  const loadPackages = async () => {
    const { data, error } = await supabase.from('subscription_packages').select('id,name,duration_days,revision,active,archived')
      .eq('active', true).eq('archived', false).order('sort_order').order('id');
    if (error) throw error;
    setPackages(data || []);
    setPackageId(current => (data || []).some(p => p.id === current) ? current : data?.[0]?.id || '');
    return data || [];
  };
  const loadRecent = async () => {
    try { setRecent(await rpc('admin_package_group_grants', { p_limit: 10 })); setServerReady(true); }
    catch (e) {
      setRecent([]);
      // PostgREST's "function not found": the database has not been updated yet.
      if (e.code === 'PGRST202') setServerReady(false);
      else reportError(e.message);
    }
  };
  useEffect(() => { loadPackages().catch(e => reportError(e.message)); loadRecent(); }, []);

  const edit = (setter) => (event) => {
    setter(event.target.value);
    setGrantId(crypto.randomUUID());
    setResult(null);
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!canSend) return;
    const count = parsed.emails.length;
    const message = `Give ${pkg.name} for ${pkg.duration_days} days to ${count} ${count === 1 ? 'person' : 'people'}, paid for by ${sponsor.trim()}?`
      + `\n\nPeople who already have ${pkg.name} get ${pkg.duration_days} days added after their current end date.`
      + '\nNo payment is recorded for each person, and no referral rewards are given.';
    if (!window.confirm(message)) return;
    reportError(''); setBusy(true);
    try {
      // The revision is read fresh, so a package edited a moment ago is refused, not granted.
      const current = (await loadPackages()).find(p => p.id === pkg.id);
      if (!current) throw new Error('This package is no longer available. Choose another.');
      const batch = await rpc('admin_grant_package_group', {
        p_grant_id: grantId, p_package: current.id, p_expected_revision: current.revision, p_emails: parsed.emails,
        p_sponsor: sponsor.trim(), p_note: note.trim(), p_amount_received: amountValue,
      });
      setResult(batch);
      setGrantId(crypto.randomUUID());
      setConfirmed(false);
      await loadRecent();
    } catch (e) {
      reportError(e.message);
    } finally { setBusy(false); }
  };

  return <>
    <section className="card compose group-grant">
      <div className="card-head">
        <h2>Group access</h2>
        <p>Give one package to many people who were paid for together, for example by a church or a company.
          Each email gets its own result, and anyone not registered in the app is listed so you can follow up.</p>
      </div>
      {!serverReady && <div className="alert error">Group access needs a server update that is not live yet. You can prepare the list, but it cannot be sent until the update is applied.</div>}
      <form className="compose" onSubmit={submit}>
        <fieldset disabled={busy} className="gg-fields">
          <label>Package
            <select value={packageId} onChange={edit(setPackageId)}>
              {packages.map(p => <option key={p.id} value={p.id}>{p.name} · {p.duration_days} days</option>)}
            </select>
          </label>
          <div className="gg-row">
            <label>Who paid
              <input value={sponsor} maxLength={120} onChange={edit(setSponsor)} placeholder="For example: St. Joseph Youth, Arusha" />
            </label>
            <label>Amount received (optional)
              <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="TSh" />
            </label>
          </div>
          <label>Emails
            <textarea rows={8} value={text} onChange={edit(setText)}
              placeholder={'One per line, or separated by commas.\nname@gmail.com\nanother@gmail.com'} />
          </label>
          <p className="hint" aria-live="polite">
            {parsed.emails.length} {parsed.emails.length === 1 ? 'email' : 'emails'}
            {parsed.repeated > 0 && ` · ${parsed.repeated} repeated, counted once`}
            {parsed.invalid.length > 0 && ` · ${parsed.invalid.length} not an email and left out: ${parsed.invalid.slice(0, 5).join(', ')}${parsed.invalid.length > 5 ? '…' : ''}`}
          </p>
          {tooMany && <div className="alert error">Add at most {MAX_GROUP_EMAILS} emails at a time. Split the list and send it in parts.</div>}
          <label>Note (optional)
            <input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="For example: AI training, November intake" />
          </label>
          <label className="inline-check"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            I received payment for this group.
          </label>
          <p className="hint">No payment is recorded for each person, so income and referral rewards are not affected. The amount above is kept with this group for your records.</p>
          <button type="submit" className="primary gg-pill" disabled={!canSend}>
            <Users />{busy ? 'Giving access…' : pkg && parsed.emails.length
              ? `Give ${pkg.name} to ${parsed.emails.length} ${parsed.emails.length === 1 ? 'person' : 'people'}` : 'Give access'}
          </button>
        </fieldset>
      </form>
      {result && <BatchResult batch={result} />}
    </section>
    <section className="card group-grant">
      <div className="card-head row"><div><h2>Recent group access</h2><p>Who paid, which package, and anyone still waiting.</p></div>
        <button type="button" className="icon-btn" aria-label="Refresh recent group access" onClick={loadRecent}><RefreshCw /></button>
      </div>
      {recent === null && <div className="empty">Loading…</div>}
      {recent?.length === 0 && <div className="empty">No group access given yet.</div>}
      {recent?.map(batch => <details key={batch.id} className="gg-batch">
        <summary>
          <div><strong>{batch.sponsor} · {batch.package_name}</strong>
            <small>{when(batch.created_at)}{batch.amount_received != null ? ` · ${money(batch.amount_received)}` : ''}{batch.note ? ` · ${batch.note}` : ''}</small></div>
          <span className="gg-counts">{batch.applied_count} of {batch.emails_count} given</span>
        </summary>
        <BatchResult batch={batch} />
      </details>)}
    </section>
  </>;
}
