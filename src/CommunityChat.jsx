import { useState } from 'react';
import { Flag, MessageCircle, ShieldCheck, Star, UserX } from 'lucide-react';
import { Dialog, Empty, Skeleton, rpc, useData, when } from './marketplace/parts';
import './marketplace/marketplace.css';

const ACCESS = { everyone: 'Everyone', package: 'Package members', members: 'People you add' };

// The in-app groups that replace WhatsApp: reports first, then the groups, who is
// in Special, who moderates, and who is paused. Every action is checked again on
// the server.
export default function CommunityChat() {
  const data = useData(() => rpc('admin_community'));
  const [dialog, setDialog] = useState(null);
  const [error, setError] = useState('');
  const d = data.data;
  const run = async (fn) => {
    setError('');
    try { await fn(); await data.reload(); } catch (e) { setError(e.message); }
  };

  if (data.error) return <section className="mkt"><div className="mkt-error">{data.error} <button type="button" className="mkt-btn ghost sm" onClick={data.reload}>Try again</button></div></section>;
  if (!d) return <section className="mkt"><div className="mkt-card"><Skeleton rows={5} /></div></section>;
  const special = d.groups.find(g => g.access === 'members');

  return (
    <section className="mkt">
      <div className="mkt-head"><div><h2>In-app community</h2><p>Groups inside the app. Free is open to everyone, package groups follow active packages, Special is by invitation.</p></div></div>
      {error && <div className="mkt-error">{error}</div>}

      <div className="mkt-card">
        <h3>Reported messages</h3>
        {d.reports.length === 0 ? <Empty icon={Flag} text="Nothing reported." /> : d.reports.map(r => (
          <div key={r.message_id} className="mkt-row static">
            <span className="mkt-row-main">
              <strong>{r.kind === 'poll' ? `Poll: ${r.body}` : r.body || 'Photo'}</strong>
              <small>{r.name} ({r.email}) in {d.groups.find(g => g.id === r.group)?.name ?? r.group} · {when(r.at)} · {r.count} {r.count === 1 ? 'report' : 'reports'}</small>
              {r.reasons?.length > 0 && <small className="mkt-warn">{[...new Set(r.reasons)].join(', ')}</small>}
              {r.image && <a href={r.image} target="_blank" rel="noreferrer"><small>Open photo</small></a>}
            </span>
            <button type="button" className="mkt-btn ghost sm" onClick={() => run(() => rpc('admin_community_resolve', { p_message: r.message_id, p_delete: false }))}>Keep</button>
            <button type="button" className="mkt-btn ghost sm" onClick={() => setDialog({
              title: `Pause ${r.name}'s posting?`, confirmLabel: 'Pause for 7 days',
              message: 'They can still read every group. You can lift it below.',
              onConfirm: () => run(() => rpc('community_mute_member', { p_user: r.user_id, p_hours: 168, p_reason: 'Reported message' })),
            })}>Pause</button>
            <button type="button" className="mkt-btn primary sm" onClick={() => setDialog({
              title: 'Delete this message?', danger: true, confirmLabel: 'Delete',
              message: 'It is removed for everyone in the group.',
              onConfirm: () => run(() => rpc('admin_community_resolve', { p_message: r.message_id, p_delete: true })),
            })}>Delete</button>
          </div>
        ))}
      </div>

      <div className="mkt-card">
        <h3>Groups</h3>
        {d.groups.map(g => <GroupRow key={g.id} group={g} onSave={(patch) => run(() => rpc('admin_community_save_group', { p_group: { id: g.id, ...patch } }))} />)}
      </div>

      {special && (
        <PeopleCard icon={Star} title={`${special.name} members`} empty="Nobody added yet." people={special.members ?? []}
          onAdd={(email) => run(() => rpc('admin_community_person', { p_email: email, p_role: special.id, p_add: true }))}
          onRemove={(p) => run(() => rpc('admin_community_person', { p_email: p.email, p_role: special.id, p_add: false }))} />
      )}

      <PeopleCard icon={ShieldCheck} title="Moderators" hint="They can enter every group, post in announcement groups, pin, delete and pause members."
        empty="No moderators." people={d.moderators}
        onAdd={(email) => run(() => rpc('admin_community_person', { p_email: email, p_role: 'moderator', p_add: true }))}
        onRemove={(p) => run(() => rpc('admin_community_person', { p_email: p.email, p_role: 'moderator', p_add: false }))} />

      <div className="mkt-card">
        <h3>Paused members</h3>
        {d.muted.length === 0 ? <Empty icon={UserX} text="Nobody is paused." /> : d.muted.map(m => (
          <div key={m.user_id} className="mkt-row static">
            <span className="mkt-row-main"><strong>{m.name || m.email}</strong><small>{m.email} · {m.until ? `until ${when(m.until)}` : 'until lifted'}{m.reason ? ` · ${m.reason}` : ''}</small></span>
            <button type="button" className="mkt-btn ghost sm" onClick={() => run(() => rpc('community_mute_member', { p_user: m.user_id, p_hours: 0 }))}>Lift</button>
          </div>
        ))}
      </div>
      {dialog && <Dialog {...dialog} onClose={() => setDialog(null)} />}
    </section>
  );
}

function GroupRow({ group: g, onSave }) {
  const [name, setName] = useState(g.name);
  const [description, setDescription] = useState(g.description);
  const dirty = name !== g.name || description !== g.description;
  return (
    <div className="mkt-row static" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <span className="mkt-row-main" style={{ minWidth: 220 }}>
        <strong><MessageCircle size={14} style={{ verticalAlign: '-2px' }} /> {g.name}{!g.is_active && ' (hidden)'}</strong>
        <small>{ACCESS[g.access]}{g.package_id ? `: ${g.package_id}` : ''} · {g.messages_7d} messages this week{g.last_message_at ? ` · last ${when(g.last_message_at)}` : ''}</small>
        <label className="mkt-field">Name<input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} /></label>
        <label className="mkt-field">Description<input value={description} maxLength={200} onChange={(e) => setDescription(e.target.value)} /></label>
        <span style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 6 }}>
          <label><input type="checkbox" checked={g.posting === 'moderators'} onChange={(e) => onSave({ posting: e.target.checked ? 'moderators' : 'everyone' })} /> Only admins post</label>
          <label><input type="checkbox" checked={g.is_active} onChange={(e) => onSave({ is_active: e.target.checked })} /> Shown in the app</label>
        </span>
      </span>
      {dirty && <button type="button" className="mkt-btn primary sm" disabled={name.trim().length < 2} onClick={() => onSave({ name: name.trim(), description: description.trim() })}>Save</button>}
    </div>
  );
}

function PeopleCard({ icon, title, hint, empty, people, onAdd, onRemove }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const add = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    await onAdd(email.trim());
    setBusy(false);
    setEmail('');
  };
  return (
    <div className="mkt-card">
      <h3>{title}</h3>
      {hint && <p className="mkt-hint">{hint}</p>}
      <form className="mkt-toolbar" onSubmit={add}>
        <label className="mkt-search" style={{ marginLeft: 0, flex: 1 }}>
          <input type="email" placeholder="Their account email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <button type="submit" className="mkt-btn primary sm" disabled={busy || !email.trim()}>{busy ? 'Adding…' : 'Add'}</button>
      </form>
      {people.length === 0 ? <Empty icon={icon} text={empty} /> : people.map(p => (
        <div key={p.user_id} className="mkt-row static">
          <span className="mkt-row-main"><strong>{p.name || p.email}</strong><small>{p.email}</small></span>
          <button type="button" className="mkt-btn ghost sm" onClick={() => onRemove(p)}>Remove</button>
        </div>
      ))}
    </div>
  );
}
