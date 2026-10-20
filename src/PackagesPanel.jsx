import { useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';
import { registerUnsaved } from './unsavedChanges';
import './packages.css';

// Inviter reward paid for every paid invite after the 10th (database rule).
const REFERRAL_REWARD_TSH = 3000;
const emptyPackage = () => ({ id: '', name: '', price: '', referral_price: '', duration_days: 60, description: '', features: [], active: false, archived: false, sort_order: 0, revision: 0, course_mode: 'selected', course_ids: [], counts_for_referrals: false, includes_member_tools: false });
const money = n => `TSh ${Number(n).toLocaleString('en-TZ')}`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
// Suggests a permanent ID from the name; the admin can still edit it.
const slug = text => {
  const id = String(text).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^[^a-z]+/, '').replace(/-+$/, '').slice(0, 60);
  return id.length >= 2 ? id : '';
};
const sortedIds = ids => [...(ids || [])].sort();
const sameCourses = (a, b) => JSON.stringify(sortedIds(a)) === JSON.stringify(sortedIds(b));
async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) {
    throw new Error(error.code === '40001' ? 'Another session changed this package. Refresh before saving.'
      : /failed to fetch|network/i.test(error.message || '') ? 'Could not reach the server. Check your connection and try again.'
      : error.message);
  }
  return data;
}

export default function PackagesPanel() {
  const [packages, setPackages] = useState([]);
  const [courses, setCourses] = useState([]);
  const [editor, setEditor] = useState(null);
  const [idTouched, setIdTouched] = useState(false);
  const [coursesOpen, setCoursesOpen] = useState(false);
  const [features, setFeatures] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [original, setOriginal] = useState('');
  const [history, setHistory] = useState(null);
  const load = async () => {
    setBusy(true); setError('');
    try { const value = await rpc('admin_package_catalog'); setPackages(value.packages); setCourses(value.courses || []); setLoaded(true); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  useEffect(() => { load(); }, []);
  // Unsaved editor changes survive neither a tab switch nor opening another
  // package without an explicit "discard".
  const snapshot = (value, text) => JSON.stringify({ ...value, features: text });
  const dirty = !!editor && snapshot(editor, features) !== original;
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  useEffect(() => registerUnsaved(() => dirtyRef.current), []);
  const discardOk = () => !dirtyRef.current || window.confirm('Discard your unsaved changes to this package?');
  const edit = p => {
    if (!discardOk()) return;
    const next = { ...p, referral_price: p.referral_price ?? '' };
    const text = p.features.join('\n');
    setEditor(next); setOriginal(snapshot(next, text)); setIdTouched(p.revision > 0); setFeatures(text);
    setCoursesOpen(p.course_mode !== 'selected' || (p.course_ids || []).length > 0); setError(''); setNotice('');
  };
  const cancelEdit = () => { if (discardOk()) setEditor(null); };
  // Who changed what, from the private audit log.
  const showHistory = async p => {
    if (history?.id === p.id) { setHistory(null); return; }
    setHistory({ id: p.id, entries: null });
    try {
      const entries = await rpc('admin_package_history', { p_package: p.id, p_limit: 20 });
      setHistory(h => h?.id === p.id ? { id: p.id, entries } : h);
    } catch (e) { setHistory(null); setError(e.message); }
  };
  const showValue = (value, field) => value == null ? '—' : typeof value === 'object'
    ? (Array.isArray(value) ? `${value.length} item${value.length === 1 ? '' : 's'}` : 'changed')
    : typeof value === 'boolean' ? (value ? 'yes' : 'no')
    : ['price', 'referral_price'].includes(field) ? money(value) : String(value);
  const update = (key, value) => setEditor(p => ({ ...p, [key]: value }));
  const save = async (event) => {
    event.preventDefault();
    const price = Number(editor.price);
    const referralPrice = editor.referral_price === '' ? null : Number(editor.referral_price);
    const duration = Number(editor.duration_days);
    const sortOrder = Number(editor.sort_order);
    const lines = features.split('\n').map(f => f.trim()).filter(Boolean);
    if (!/^[a-z][a-z0-9_-]{1,59}$/.test(editor.id) || editor.id === 'free') {
      setError('Use a package ID of 2-60 lowercase letters, numbers, hyphens or underscores, starting with a letter ("free" is reserved).'); return;
    }
    if (!editor.revision && packages.some(p => p.id === editor.id)) { setError('A package with this ID already exists. Choose another ID.'); return; }
    if (!Number.isInteger(price) || price < 500 || price > 100000000
      || (referralPrice != null && (!Number.isInteger(referralPrice) || referralPrice < 500 || referralPrice > price))) {
      setError('Use whole TSh amounts from 500 to 100,000,000. Referral price cannot exceed the standard price.'); return;
    }
    if (!Number.isInteger(duration) || duration < 1 || duration > 3650) { setError('Use a whole-number duration from 1 to 3650 days.'); return; }
    if (!Number.isInteger(sortOrder) || sortOrder < -10000 || sortOrder > 10000) { setError('Display order must be a whole number from -10000 to 10000.'); return; }
    if (lines.length > 50 || lines.some(f => f.length > 200)) { setError('Use up to 50 included items, each no longer than 200 characters.'); return; }
    const saved = packages.find(p => p.id === editor.id && editor.revision);
    const members = saved?.active_members ?? 0;
    const warnings = [];
    if (saved && members > 0 && (saved.course_mode !== editor.course_mode || !sameCourses(saved.course_ids, editor.course_ids))) {
      warnings.push(`${plural(members, 'current member')} will gain or lose in-app course access as soon as you save.`);
    }
    if (saved && members > 0 && saved.includes_member_tools !== editor.includes_member_tools) {
      warnings.push(`${plural(members, 'current member')} will ${editor.includes_member_tools ? 'gain' : 'lose'} member tools as soon as you save.`);
    }
    if (editor.counts_for_referrals && (referralPrice ?? price) < REFERRAL_REWARD_TSH * 2) {
      warnings.push(`Referral rewards are on. After an inviter's 10th paid invite, each further sale of this package pays them ${money(REFERRAL_REWARD_TSH)}, and 10 paid invites give them lifetime access. That is a lot for a ${money(referralPrice ?? price)} sale.`);
    }
    if (saved && ['business', 'premium'].includes(editor.id) && (saved.price !== price || saved.referral_price !== referralPrice || saved.duration_days !== duration)) {
      warnings.push('Business and Premium prices also appear on the landing page. Update them in Landing CMS after saving.');
    }
    if (!window.confirm([`Save ${editor.name} at ${money(price)}${referralPrice == null ? '' : ` (invited: ${money(referralPrice)})`} for ${duration} days?`,
      ...warnings, 'Price and duration changes affect future purchases only.'].join('\n\n'))) return;
    await persist({ ...editor, access_tier: editor.id, price, referral_price: referralPrice, duration_days: duration, features: lines, sort_order: sortOrder, active: editor.archived ? false : editor.active });
  };
  const persist = async p => {
    setBusy(true); setError(''); setNotice('');
    try {
      const saved = await rpc('admin_save_package', { p_package: p, p_expected_revision: p.revision });
      // Keep the live counts until the next refresh; the save response omits them.
      setPackages(rows => {
        const previous = rows.find(row => row.id === saved.id);
        return [...rows.filter(row => row.id !== saved.id), { active_members: 0, has_community: false, ...previous, ...saved }]
          .sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id));
      });
      setEditor(null);
      setNotice(`${saved.name} saved.${saved.active ? '' : ' It is not on sale until you publish it.'} Set its WhatsApp group in Community settings.`);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  const togglePublish = p => {
    if (!discardOk()) return;
    if (p.active) {
      if (window.confirm(`Pause sales of ${p.name}? It disappears from the payment page. Current members keep their access.`)) persist({ ...p, active: false });
      return;
    }
    const warnings = [];
    if (!p.has_community) warnings.push('It has no WhatsApp group link yet, so buyers will not get a group. Add one in Community settings.');
    if (p.course_mode === 'selected' && !p.course_ids?.length && !p.includes_member_tools) {
      warnings.push('It unlocks no in-app courses and no member tools. Buyers get only the benefits you listed.');
    }
    if (window.confirm([`Publish ${p.name} at ${money(p.price)} for ${p.duration_days} days? It appears on the payment page immediately.`, ...warnings].join('\n\n'))) {
      persist({ ...p, active: true });
    }
  };
  const archive = p => {
    if (!discardOk()) return;
    const members = p.active_members ? ` ${plural(p.active_members, 'current member')} keep their access and group until their term ends.` : ' Current members keep their access.';
    if (window.confirm(`Remove ${p.name} from sale? It will be archived, not erased.${members} Pending payments can still complete.`)) {
      persist({ ...p, active: false, archived: true });
    }
  };
  const restore = p => {
    if (!discardOk()) return;
    if (window.confirm(`Restore ${p.name} as a draft? It stays off the payment page until you publish it.`)) persist({ ...p, archived: false, active: false });
  };
  const live = packages.filter(p => !p.archived);
  const archived = packages.filter(p => p.archived);
  const row = p => <article className="package-row" key={p.id}>
    <div><h3>{p.name} <small className="package-id">{p.id}</small></h3>
      <p>{p.archived ? 'Archived' : p.active ? 'On sale' : 'Draft / paused'} · {p.course_mode === 'all' ? 'All in-app courses' : p.course_mode === 'legacy' ? 'Original in-app course rules' : p.course_ids?.length ? `${p.course_ids.length} selected in-app courses` : 'No paid in-app courses'} · {p.duration_days} days · order {p.sort_order}</p>
      <p>{money(p.price)} · {p.referral_price == null ? 'No referral discount' : `Invited: ${money(p.referral_price)}`} · {p.counts_for_referrals ? 'Counts for referral rewards' : 'No referral rewards'} · {p.includes_member_tools ? 'Member tools included' : 'No member tools'}</p>
      <p>{plural(p.active_members ?? 0, 'active member')} · {p.has_community ? 'WhatsApp group set' : <strong className="package-warn">No WhatsApp group link</strong>}</p>
      {p.features?.length > 0 && <p>{plural(p.features.length, 'included item')} · {p.features.slice(0, 2).join(' · ')}{p.features.length > 2 ? ' …' : ''}</p>}
      {history?.id === p.id && <div className="package-history" role="region" aria-label={`${p.name} change history`}>
        {!history.entries && <p>Loading history…</p>}
        {history.entries && !history.entries.length && <p>No changes recorded yet.</p>}
        {history.entries?.map((entry, i) => <div key={`${entry.at}-${i}`}>
          <p><strong>{new Date(entry.at).toLocaleString()}</strong> · {entry.admin || 'admin'}{entry.created ? ' · created' : ''}</p>
          <ul>{entry.changes.map(change => <li key={change.field}>{change.field.replace(/_/g, ' ')}: {entry.created ? showValue(change.after, change.field) : `${showValue(change.before, change.field)} → ${showValue(change.after, change.field)}`}</li>)}</ul>
        </div>)}
      </div>}
    </div>
    <div className="package-actions"><button className="secondary" disabled={busy} onClick={() => edit(p)}>Edit</button>
      {!p.archived && <button className="secondary" disabled={busy} onClick={() => togglePublish(p)}>{p.active ? 'Pause sales' : 'Publish'}</button>}
      {!p.archived && <button className="danger" disabled={busy} onClick={() => archive(p)}>Delete / archive</button>}
      {p.archived && <button className="secondary" disabled={busy} onClick={() => restore(p)}>Restore as draft</button>}
      <button className="secondary" disabled={busy} aria-expanded={history?.id === p.id} onClick={() => showHistory(p)}>{history?.id === p.id ? 'Hide history' : 'History'}</button>
    </div>
  </article>;
  return <section className="card package-admin">
    <div className="card-head"><h2>Packages & pricing</h2>
      <p>Create independent packages for live classes, in-app courses, services or any other benefits you offer. No in-app course is required. Set each package’s price and membership duration. Every package gets its own entry in Community for a separate WhatsApp group link.</p>
    </div>
    {error && <div className="alert error" role="alert">{error}</div>}
    {notice && <div className="alert success" role="status">{notice}</div>}
    <div className="package-actions">
      <button className="primary" disabled={busy} onClick={() => edit(emptyPackage())}>Add package</button>
      <button className="secondary" disabled={busy} onClick={load}>Refresh packages</button>
    </div>
    {editor && <form className="compose package-editor" onSubmit={save}>
      <h3>{editor.revision ? `Edit ${editor.name}` : 'New package (starts as a draft)'}</h3>
      <fieldset disabled={busy}>
        <label>Package name<input required maxLength={80} value={editor.name} onChange={e => { const name = e.target.value; setEditor(p => ({ ...p, name, ...(!p.revision && !idTouched ? { id: slug(name) } : {}) })); }} /></label>
        <label>Package ID (permanent, used in links and reports)<input required pattern="[a-z][a-z0-9_\-]{1,59}" maxLength={60} disabled={editor.revision > 0} value={editor.id} onChange={e => { setIdTouched(true); update('id', e.target.value.toLowerCase()); }} placeholder="example: digital-marketing" /></label>
        <label>Description<textarea rows={3} maxLength={1500} value={editor.description} onChange={e => update('description', e.target.value)} /></label>
        <label>What is included? (one item per line)<textarea rows={8} value={features} onChange={e => setFeatures(e.target.value)} placeholder={'Live AI business classes on Google Meet\nDigital marketing workshop\nWeekly questions and answers\nWhatsApp community and support'} /></label>
        <p className="hint">Write any live course, class, service or benefit here, even if it is not uploaded to the app. These items appear on the payment page, next to the real in-app access chosen below. Private joining links belong in Community, not this public list.</p>
        <details className="package-course-options" open={coursesOpen} onToggle={e => setCoursesOpen(e.currentTarget.open)}>
        <summary>In-app course access (optional)</summary>
        <p className="hint">Only use this section if this package should also unlock uploaded courses. For a live-only package, leave the paid courses unchecked. Free courses remain available to everyone.</p>
        {editor.course_mode === 'legacy' && <p className="hint">This existing package keeps its original course rules (the Free/Business/Premium tier set on each course). Selecting a course below switches it to its own selection, and that cannot be switched back.</p>}
        <label className="package-check"><input type="checkbox" checked={editor.course_mode === 'all'} onChange={e => setEditor(p => ({ ...p, course_mode: e.target.checked ? 'all' : 'selected', course_ids: e.target.checked ? [] : (p.course_ids || []) }))} />All published courses, including future courses</label>
        {editor.course_mode !== 'all' && <div className="package-course-list">{courses.map(course => {
          const included = editor.course_mode === 'legacy' ? (editor.id === 'premium' || course.is_free || course.access_tier !== 'premium') : (editor.course_ids || []).includes(course.id);
          return <label className="package-check" key={course.id}><input type="checkbox" checked={course.is_free || included} disabled={course.is_free} onChange={e => {
            const current = editor.course_mode === 'legacy' ? courses.filter(c => editor.id === 'premium' || c.is_free || c.access_tier !== 'premium').map(c => c.id) : (editor.course_ids || []);
            setEditor(p => ({ ...p, course_mode: 'selected', course_ids: e.target.checked ? [...new Set([...current, course.id])] : current.filter(id => id !== course.id) }));
          }} />{course.title}{course.is_free ? ' · Free for everyone' : ''}{!course.is_published ? ' · Draft' : ''}</label>;
        })}</div>}
        {!courses.length && <p className="hint">No uploaded courses found. You can still save this package with your own live classes and benefits above.</p>}
        <p className="hint">Typing an uploaded course name above does not unlock it: select it here if access is included. Changing this selection changes access for current members too. New courses are added automatically only with “All published courses”.</p>
        </details>
        <label className="package-check"><input type="checkbox" checked={editor.includes_member_tools === true} onChange={e => update('includes_member_tools', e.target.checked)} />Includes member tools: materials library, exercises, exams and certificates, the idea contest and Uliza questions in the mobile app</label>
        <p className="hint">Leave this off for a live-only or service package. Business and Premium include member tools. The public Uliza assistant on the website stays free for everyone and is not controlled here. These tools are one bundle; changing it applies to current members immediately.</p>
        <label>Standard price (TSh)<input type="number" min="500" max="100000000" step="1" required value={editor.price} onChange={e => update('price', e.target.value)} /></label>
        <label>Invited / referral price (TSh, optional)<input type="number" min="500" max={editor.price || 100000000} step="1" value={editor.referral_price} onChange={e => update('referral_price', e.target.value)} /></label>
        <p className="hint">Blank means no price discount for invited learners.</p>
        <label className="package-check"><input type="checkbox" checked={editor.counts_for_referrals === true} onChange={e => update('counts_for_referrals', e.target.checked)} />Counts toward referral rewards</label>
        <p className="hint">When on, a paid purchase credits the inviter: 10 paid invites give lifetime access, and every paid invite after the 10th pays the inviter {money(REFERRAL_REWARD_TSH)}. Keep it off for low-priced packages.</p>
        <label>Membership duration (days)<input type="number" min="1" max="3650" step="1" required value={editor.duration_days} onChange={e => update('duration_days', e.target.value)} /></label>
        <p className="hint">Starts after successful payment or a manual grant. Renewing the same package adds these days after the current expiry. Existing members and pending purchases keep their original duration when you change this setting.</p>
        <label>Display order (lower appears first)<input type="number" step="1" min="-10000" max="10000" required value={editor.sort_order} onChange={e => update('sort_order', e.target.value)} /></label>
        <label className="package-check"><input type="checkbox" checked={editor.archived} onChange={e => setEditor(p => ({ ...p, archived: e.target.checked, active: e.target.checked ? false : p.active }))} />Archived</label>
        <label className="package-check"><input type="checkbox" disabled={editor.archived} checked={editor.active} onChange={e => update('active', e.target.checked)} />Available for purchase</label>
        <div className="package-actions"><button className="primary" type="submit">{busy ? 'Saving…' : 'Save package'}</button><button type="button" className="secondary" onClick={cancelEdit}>Cancel</button></div>
      </fieldset>
    </form>}
    {busy && <p role="status">Working…</p>}
    {!loaded && !error && <p role="status">Loading packages…</p>}
    {!loaded && error && <p><button className="secondary" onClick={load}>Retry loading packages</button></p>}
    {loaded && !busy && !packages.length && <p>No packages found. Add your first package above.</p>}
    {live.map(row)}
    {archived.length > 0 && <details className="package-archived"><summary>Archived packages ({archived.length})</summary>{archived.map(row)}</details>}
  </section>;
}
