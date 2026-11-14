import { useEffect, useState } from 'react';
import {
  ArrowDown, ArrowUp, BookOpen, Calculator, ChartColumn, Eye, EyeOff, FileSpreadsheet, FileText, Globe, Image, LayoutTemplate,
  Megaphone, Package, Palette, PenTool, Plus, Presentation, Save, Sparkles, Trash2, Upload, Video, WandSparkles, X,
} from 'lucide-react';
import { supabase } from './supabase';
import { adminCall } from './adminApi';
import { makeCover } from './coverImage';
import { useConfirm } from './confirmDialog';
import './tools.css';

// Tools in the app's Library (Library > Tools): the owner's web apps, opened
// inside the mobile app with no address bar. The database checks everything
// again (admin_app_tool_*); the app only ever sees names, lines and icons, and
// gets a tool's link when a signed-in learner opens it.

export const TOOL_ICONS = {
  presentation: Presentation, package: Package, 'file-text': FileText, image: Image, video: Video, 'pen-tool': PenTool,
  calculator: Calculator, sparkles: Sparkles, 'layout-template': LayoutTemplate, megaphone: Megaphone, 'book-open': BookOpen,
  'wand-sparkles': WandSparkles, 'chart-column': ChartColumn, palette: Palette, 'file-spreadsheet': FileSpreadsheet, globe: Globe,
};

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

const blank = () => ({ name: '', description: '', url: '', icon: 'sparkles', image_url: '', is_active: true });

function ToolIcon({ tool, size = 22 }) {
  const Icon = TOOL_ICONS[tool.icon] || Sparkles;
  return <span className="tl-icon">{tool.image_url ? <img src={tool.image_url} alt="" /> : <Icon width={size} height={size} />}</span>;
}

function Editor({ initial, onSaved, onClose }) {
  const [tool, setTool] = useState(initial ? { ...blank(), ...initial, image_url: initial.image_url || '' } : blank());
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const set = (key, value) => setTool((t) => ({ ...t, [key]: value }));

  const uploadLogo = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const logo = await makeCover(file);
      const { url } = await adminCall('shop-upload', { type: 'cover', filename: file.name, content_type: logo.type, file_b64: await fileBase64(logo) });
      set('image_url', url);
    } catch (err) { setError(err.message); } finally { setUploading(false); }
  };

  const save = async () => {
    setError('');
    if (tool.name.trim().length < 2) return setError('Give the tool a name.');
    if (!/^https:\/\/\S+$/.test(tool.url.trim())) return setError('The link must start with https://');
    setBusy(true);
    try {
      onSaved(await rpc('admin_app_tool_save', { p_tool: { ...tool, url: tool.url.trim() } }));
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <section className="card tl">
      <div className="tl-head">
        <div><h2>{tool.id ? 'Edit tool' : 'Add a tool'}</h2><p className="tl-muted">Learners see the name, the short line and the icon. The link is never shown in the app.</p></div>
        <button type="button" className="tl-round" onClick={onClose} aria-label="Close"><X /></button>
      </div>
      <div className="tl-two">
        <label className="tl-field">Name<input value={tool.name} maxLength={60} placeholder="Presentation creator" onChange={(e) => set('name', e.target.value)} /></label>
        <label className="tl-field">Short line<input value={tool.description} maxLength={160} placeholder="Tengeneza slides kwa dakika chache" onChange={(e) => set('description', e.target.value)} /></label>
      </div>
      <label className="tl-field">Link<input value={tool.url} maxLength={500} placeholder="https://..." onChange={(e) => set('url', e.target.value)} /></label>
      <div className="tl-field">Icon
        <div className="tl-icons">
          {Object.entries(TOOL_ICONS).map(([key, Icon]) => (
            <button type="button" key={key} className={tool.icon === key ? 'active' : ''} onClick={() => set('icon', key)} aria-label={key} title={key}><Icon /></button>
          ))}
        </div>
      </div>
      <div className="tl-field">Logo (optional, shown instead of the icon)
        <div className="tl-row-inline">
          <ToolIcon tool={tool} />
          {uploading ? <span className="tl-muted">Uploading…</span> : <label className="tl-btn"><Upload />{tool.image_url ? 'Replace' : 'Upload'}<input type="file" accept="image/*" hidden onChange={uploadLogo} /></label>}
          {tool.image_url && !uploading && <button type="button" className="tl-btn danger" onClick={() => set('image_url', '')}><Trash2 />Remove</button>}
        </div>
      </div>
      <label className="tl-check"><input type="checkbox" checked={tool.is_active} onChange={(e) => set('is_active', e.target.checked)} />Show in the app</label>
      {error && <p className="tl-error" role="alert">{error}</p>}
      <div className="tl-actions">
        <span className="tl-spacer" />
        <button type="button" className="tl-btn" onClick={onClose}>Cancel</button>
        <button type="button" className="tl-btn primary" disabled={busy || uploading} onClick={save}><Save />{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </section>
  );
}

export default function ToolsPanel({ reportError }) {
  const [tools, setTools] = useState(null);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirmBox, ask] = useConfirm();

  const load = async () => {
    try { setTools(await rpc('admin_app_tools')); } catch (e) { reportError(e.message); }
  };
  useEffect(() => { load(); }, []);

  const act = async (work) => {
    setBusy(true);
    try { await work(); } catch (e) { reportError(e.message); } finally { setBusy(false); }
  };
  const move = (i, by) => act(async () => {
    const ids = tools.map((t) => t.id);
    [ids[i], ids[i + by]] = [ids[i + by], ids[i]];
    setTools(await rpc('admin_app_tools_order', { p_ids: ids }));
  });
  const toggle = (t) => act(async () => { await rpc('admin_app_tool_save', { p_tool: { ...t, is_active: !t.is_active } }); await load(); });
  const remove = async (t) => {
    if (!(await ask(`Delete "${t.name}"?`, { action: 'Delete', danger: true, detail: 'It disappears from the app for everyone.' }))) return;
    act(async () => { await rpc('admin_app_tool_delete', { p_tool: t.id }); await load(); });
  };

  if (editing) {
    return <Editor initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />;
  }
  return (
    <section className="card tl">
      {confirmBox}
      <div className="tl-head">
        <div><h2>Tools</h2><p className="tl-muted">Your web apps in the app's Library &gt; Tools. They open inside the app, and learners must be signed in. Changes show in the app within about a minute.</p></div>
        <button type="button" className="tl-btn primary" onClick={() => setEditing('new')}><Plus />Add a tool</button>
      </div>
      {!tools ? <div className="loading">Loading tools…</div> : !tools.length ? <div className="empty">No tools yet. Press Add a tool.</div> : tools.map((t, i) => (
        <div className="tl-item" key={t.id}>
          <ToolIcon tool={t} />
          <div className="tl-item-main">
            <strong>{t.name}</strong>
            <small>{t.description || 'No short line'} · {t.is_active ? 'Shown' : 'Hidden'} · opened {Number(t.open_count || 0).toLocaleString()} {Number(t.open_count) === 1 ? 'time' : 'times'}</small>
          </div>
          <button type="button" className="tl-round" disabled={busy || i === 0} onClick={() => move(i, -1)} aria-label="Move up"><ArrowUp /></button>
          <button type="button" className="tl-round" disabled={busy || i === tools.length - 1} onClick={() => move(i, 1)} aria-label="Move down"><ArrowDown /></button>
          <button type="button" className="tl-btn" disabled={busy} onClick={() => toggle(t)}>{t.is_active ? <EyeOff /> : <Eye />}{t.is_active ? 'Hide' : 'Show'}</button>
          <button type="button" className="tl-btn" onClick={() => setEditing(t)}>Edit</button>
          <button type="button" className="tl-round danger" disabled={busy} onClick={() => remove(t)} aria-label={`Delete ${t.name}`}><Trash2 /></button>
        </div>
      ))}
    </section>
  );
}
