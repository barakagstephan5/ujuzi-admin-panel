import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { supabase } from './supabase';
import { useConfirm } from './confirmDialog';
import './tools.css';

// "Update the app": the oldest app build that may still be used. A phone on an
// older build shows a full-screen "Update the app" with this download link.
// The database checks everything again (admin_app_release_save).

const CHANNELS = {
  apk: { title: 'Phones with the APK', hint: 'The number in the APK name on GitHub, for example build 127.' },
  play: { title: 'Google Play', hint: 'The Play build: 1000 plus its run, the same as its version code.' },
};

async function rpc(name, params) {
  const { data, error } = await supabase.rpc(name, params);
  if (error) throw new Error(error.message);
  return data;
}

function ChannelRow({ row, onSaved, ask }) {
  const [min, setMin] = useState(String(row.min_build ?? 0));
  const [url, setUrl] = useState(row.update_url || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const info = CHANNELS[row.channel];
  const changed = min !== String(row.min_build ?? 0) || url !== (row.update_url || '');

  const save = async () => {
    setError('');
    setDone(false);
    const value = Number(min);
    if (!Number.isInteger(value) || value < 0) return setError('Use a whole number, 0 for no minimum.');
    if (value > 0 && !/^https:\/\/\S+$/.test(url.trim())) return setError('Add the https:// link people download the new version from.');
    if (value > (row.min_build ?? 0)) {
      const ok = await ask(`Phones older than build ${value} must update before they can continue.`, {
        action: 'Set minimum',
        detail: 'Check first that a build this new is ready to download from the link.',
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      onSaved(await rpc('admin_app_release_save', { p_channel: row.channel, p_min_build: value, p_update_url: url.trim() }));
      setDone(true);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="tl-item" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <div className="tl-item-main" style={{ minWidth: 220 }}>
        <strong>{info?.title || row.channel}</strong>
        <small style={{ whiteSpace: 'normal' }}>{info?.hint}{row.updated_at ? ` Last changed ${new Date(row.updated_at).toLocaleString()}.` : ''}</small>
      </div>
      <div className="tl-two" style={{ flex: '2 1 360px' }}>
        <label className="tl-field">Minimum build (0 = none)<input type="number" min="0" step="1" value={min} onChange={(e) => { setMin(e.target.value); setDone(false); }} /></label>
        <label className="tl-field">Download link<input value={url} maxLength={500} placeholder="https://..." onChange={(e) => { setUrl(e.target.value); setDone(false); }} /></label>
      </div>
      <button type="button" className="tl-btn primary" disabled={busy || !changed} onClick={save}><Save />{busy ? 'Saving…' : done ? 'Saved' : 'Save'}</button>
      {error && <p className="tl-error" role="alert" style={{ flexBasis: '100%' }}>{error}</p>}
    </div>
  );
}

export default function AppUpdatesPanel({ reportError }) {
  const [rows, setRows] = useState(null);
  const [confirmBox, ask] = useConfirm();

  useEffect(() => {
    rpc('admin_app_release_policy').then(setRows).catch((e) => reportError(e.message));
  }, []);

  return (
    <section className="card tl">
      {confirmBox}
      <div className="tl-head">
        <div>
          <h2>App updates</h2>
          <p className="tl-muted">
            Phones running an older build than the minimum see "Update the app" and a button to this link, and cannot
            continue until they update. The app shows its build under Settings. Phones learn a new minimum within about a minute.
          </p>
        </div>
      </div>
      {!rows ? <div className="loading">Loading…</div> : rows.map((row) => (
        <ChannelRow key={`${row.channel}:${row.updated_at}`} row={row} ask={ask} onSaved={setRows} />
      ))}
    </section>
  );
}
