import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { supabase } from '../supabase';
import { adminCall } from '../adminApi';

export const money = (n) => `TSh ${Math.round(Number(n) || 0).toLocaleString('en-US')}`;
export const when = (v) => (v ? new Date(v).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Dar_es_Salaam' }) : '');
export const day = (v) => (v ? new Date(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Dar_es_Salaam' }) : '');
export const bytes = (n) => {
  const v = Number(n) || 0;
  if (v >= 1024 ** 3) return `${(v / 1024 ** 3).toFixed(v >= 10 * 1024 ** 3 ? 0 : 1)} GB`;
  if (v >= 1024 ** 2) return `${Math.round(v / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(v / 1024))} KB`;
};
export const phone = (d) => (d ? `0${String(d).slice(3)}`.replace(/^(\d{4})(\d{3})(\d{3})$/, '$1 $2 $3') : '');
export const initials = (name) => String(name || '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();

// Database messages are written for people; network failures get a sentence.
export async function rpc(name, args = {}) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) {
    throw new Error(/failed to fetch|network/i.test(error.message || '') ? 'Could not reach the server. Check your connection and try again.'
      : error.message || 'Something went wrong');
  }
  return data;
}

// A short-lived link to a stored video or file (admins may open any).
export async function fileUrl({ moduleId, assetId }) {
  const value = await adminCall('instructor-media', { action: 'access', ...(moduleId ? { module_id: moduleId } : { asset_id: assetId }) });
  return value.url;
}

export function useData(load, deps = []) {
  const [state, setState] = useState({ data: null, error: '', loading: true });
  const seq = useRef(0);
  const reload = async () => {
    const mine = ++seq.current;
    setState(s => ({ ...s, loading: true, error: '' }));
    try { const data = await load(); if (mine === seq.current) setState({ data, error: '', loading: false }); }
    catch (e) { if (mine === seq.current) setState(s => ({ ...s, error: e.message, loading: false })); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); }, deps);
  return { ...state, reload, setData: (fn) => setState(s => ({ ...s, data: typeof fn === 'function' ? fn(s.data) : fn })) };
}

const TONES = {
  pending: 'warn', awaiting_approval: 'warn', review: 'warn', queued: 'info', sending: 'info', pending_provider: 'info', PENDING: 'info',
  approved: 'ok', completed: 'ok', COMPLETED: 'ok', live: 'ok',
  rejected: 'bad', suspended: 'bad', failed: 'bad', cancelled: 'muted', reversed: 'bad', FAILED: 'bad', VOIDED: 'muted', EXPIRED: 'muted',
  REFUNDED: 'muted', REJECTED_AMOUNT_MISMATCH: 'bad', REJECTED_CURRENCY_MISMATCH: 'bad', draft: 'muted', unlisted: 'muted',
};
const LABELS = {
  awaiting_approval: 'Needs approval', review: 'Check in Snippe', pending_provider: 'With Snippe', sending: 'Sending',
  PENDING: 'Waiting', COMPLETED: 'Paid', FAILED: 'Failed', VOIDED: 'Cancelled', EXPIRED: 'Expired', REFUNDED: 'Refunded',
  REJECTED_AMOUNT_MISMATCH: 'Wrong amount', REJECTED_CURRENCY_MISMATCH: 'Wrong currency', rejected: 'Changes requested',
};
export function Pill({ status, children }) {
  const label = children ?? LABELS[status] ?? String(status || '').replace(/_/g, ' ');
  return <span className={`mkt-pill ${TONES[status] || 'muted'}`}>{label}</span>;
}

export function Avatar({ name, url, size = 40 }) {
  return url
    ? <img className="mkt-avatar" src={url} alt="" style={{ width: size, height: size }} />
    : <span className="mkt-avatar" style={{ width: size, height: size, fontSize: size * 0.36 }}>{initials(name)}</span>;
}

export function Drawer({ title, subtitle, onClose, children, footer }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.mkt-dialog')) onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [onClose]);
  return (
    <div className="mkt-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="mkt-drawer" role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
          <button type="button" className="mkt-icon" aria-label="Close" onClick={onClose}><X /></button>
        </header>
        <div className="mkt-drawer-body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </aside>
    </div>
  );
}

// Confirms an action; with `reason` it asks for a short note that is saved
// with the decision (and shown to the instructor where relevant).
export function Dialog({ title, message, confirmLabel, danger, reason, reasonLabel = 'Reason', reasonRequired = true, onConfirm, onClose }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ok = !reason || !reasonRequired || note.trim().length >= 3;
  const confirm = async () => {
    setBusy(true); setError('');
    try { await onConfirm(note.trim()); onClose(); } catch (e) { setError(e.message); setBusy(false); }
  };
  return (
    <div className="mkt-overlay center mkt-dialog" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="mkt-modal" role="alertdialog" aria-modal="true" aria-label={title}>
        <h3>{title}</h3>
        {message && <p className="mkt-muted">{message}</p>}
        {reason && (
          <label className="mkt-field">{reasonLabel}
            <textarea rows={3} value={note} maxLength={500} autoFocus onChange={(e) => setNote(e.target.value)} />
          </label>
        )}
        {error && <div className="mkt-error">{error}</div>}
        <div className="mkt-actions end">
          <button type="button" className="mkt-btn ghost" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="button" className={`mkt-btn ${danger ? 'danger' : 'primary'}`} disabled={busy || !ok} onClick={confirm}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Empty({ icon: Icon, text }) {
  return <div className="mkt-empty">{Icon && <span><Icon /></span>}<p>{text}</p></div>;
}

export function Skeleton({ rows = 4 }) {
  return <div className="mkt-skeleton">{Array.from({ length: rows }, (_, i) => <div key={i} />)}</div>;
}

export function Chips({ value, options, onChange }) {
  return (
    <div className="mkt-chips" role="tablist">
      {options.map(o => (
        <button key={o.value ?? 'all'} type="button" role="tab" aria-selected={value === o.value}
          className={value === o.value ? 'active' : ''} onClick={() => onChange(o.value)}>
          {o.label}{o.count > 0 && <b>{o.count}</b>}
        </button>
      ))}
    </div>
  );
}
