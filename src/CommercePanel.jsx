import { useEffect, useState } from 'react';
import { Download, Eye, EyeOff, FileDown, Plus, Save, Trash2 } from 'lucide-react';
import { adminCall } from './adminApi';
import { supabase } from './supabase';
import MeetingsPanel from './MeetingsPanel';
import './commerce.css';

const blanks = {
  products: { title: '', description: '', type: 'ebook', price_tsh: 7000, storage_key: '', cover_url: '', is_active: true, is_special: false },
  services: { title: '', tagline: '', highlights: [], sort_order: 0, is_active: true },
  materials: { title: '', description: '', cover_url: '', pdf_storage_key: '', pdf_title: '', sort_order: 0, is_active: true },
};
const labels = { products: 'Products', services: 'Services', materials: 'Materials', meetings: 'Meetings & payouts' };
const fileBase64 = (file) => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file); });
const slug = (value) => String(value || 'cover').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'cover';

async function uploadCover(file, folder, title) {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const path = `${folder}/${Date.now()}_${slug(title)}.${ext}`;
  const { error } = await supabase.storage.from('course-images').upload(path, file, { upsert: true, contentType: file.type || undefined });
  if (error) throw error;
  return supabase.storage.from('course-images').getPublicUrl(path).data.publicUrl;
}

export function CommercePanel({ reportError }) {
  const [tab, setTab] = useState('products');
  const [data, setData] = useState({ products: [], services: [], materials: [], requests: [] });
  const [edit, setEdit] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = async () => { setBusy(true); try { setData(await adminCall('admin-commerce', { action: 'list' })); } catch (e) { reportError(e.message); } finally { setBusy(false); } };
  useEffect(() => { load(); }, []);

  const save = async () => {
    setBusy(true); reportError('');
    try {
      const item = { ...edit };
      if (item._file) {
        const uploaded = await adminCall('shop-upload', { type: tab === 'products' ? item.type : 'file', filename: item._file.name, file_b64: await fileBase64(item._file) });
        if (tab === 'products') item.storage_key = uploaded.key; else item.pdf_storage_key = uploaded.key;
      }
      if (item._coverFile) item.cover_url = await uploadCover(item._coverFile, tab, item.title);
      delete item._file; delete item._coverFile;
      if (tab === 'services' && typeof item.highlights === 'string') item.highlights = item.highlights.split('\n').map((x) => x.trim()).filter(Boolean);
      await adminCall('admin-commerce', { action: 'save', table: tab, item });
      setEdit(null); await load();
    } catch (e) { reportError(e.message); } finally { setBusy(false); }
  };
  const remove = async (item) => { if (!confirm(`Delete “${item.title}”?`)) return; try { await adminCall('admin-commerce', { action: 'delete', table: tab, id: item.id }); await load(); } catch (e) { reportError(e.message); } };
  const toggle = async (item) => { try { await adminCall('admin-commerce', { action: 'save', table: tab, item: { ...item, is_active: !item.is_active } }); await load(); } catch (e) { reportError(e.message); } };

  return <><div className="subnav">{Object.keys(labels).map((key) => <button className={tab === key ? 'active' : ''} onClick={() => { setTab(key); setEdit(null); }} key={key}>{labels[key]}</button>)}</div>
    {tab === 'meetings' ? <MeetingsPanel reportError={reportError} /> : edit ? <section className="card commerce-form"><h2>{edit.id ? 'Edit' : 'Add'} {labels[tab].slice(0, -1)}</h2>
      <label>Title<input required value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></label>
      {tab !== 'services' && <label>Description<textarea rows="3" value={edit.description || ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></label>}
      {tab === 'products' && <><label>Type<select value={edit.type} onChange={(e) => setEdit({ ...edit, type: e.target.value })}><option value="ebook">E-book</option><option value="template">Template</option><option value="skills_md">Skills MD</option></select></label><label>Price (TZS)<input type="number" min="0" value={edit.price_tsh} onChange={(e) => setEdit({ ...edit, price_tsh: Number(e.target.value) })} /></label><label>Product file{!edit.id && ' (required)'}<input type="file" onChange={(e) => setEdit({ ...edit, _file: e.target.files[0] })} /></label>{edit.storage_key && <small>Stored: {edit.storage_key}</small>}<label className="inline-check"><input type="checkbox" checked={!!edit.is_special} onChange={(e) => setEdit({ ...edit, is_special: e.target.checked })} />Special referral-unlock product</label></>}
      {tab === 'materials' && <><label>PDF file{!edit.id && ' (required)'}<input type="file" accept="application/pdf,.pdf" onChange={(e) => setEdit({ ...edit, _file: e.target.files[0] })} /></label>{edit.pdf_storage_key && <small>Stored: {edit.pdf_storage_key}</small>}<label>PDF title<input value={edit.pdf_title || ''} onChange={(e) => setEdit({ ...edit, pdf_title: e.target.value })} /></label></>}
      {tab === 'services' && <><label>Tagline<input value={edit.tagline || ''} onChange={(e) => setEdit({ ...edit, tagline: e.target.value })} /></label><label>Highlights, one per line<textarea rows="5" value={Array.isArray(edit.highlights) ? edit.highlights.join('\n') : edit.highlights || ''} onChange={(e) => setEdit({ ...edit, highlights: e.target.value })} /></label></>}
      {tab !== 'services' && <><label>Cover image<input type="file" accept="image/*" onChange={(e) => setEdit({ ...edit, _coverFile: e.target.files[0] })} /></label><label>Or cover URL<input value={edit.cover_url || ''} onChange={(e) => setEdit({ ...edit, cover_url: e.target.value })} /></label>{edit.cover_url && <img className="cover-preview" src={edit.cover_url} alt="Cover preview" />}</>}
      {tab !== 'products' && <label>Sort order<input type="number" value={edit.sort_order || 0} onChange={(e) => setEdit({ ...edit, sort_order: Number(e.target.value) })} /></label>}
      <label className="inline-check"><input type="checkbox" checked={edit.is_active !== false} onChange={(e) => setEdit({ ...edit, is_active: e.target.checked })} />Active</label>
      <div className="row"><button className="secondary" onClick={() => setEdit(null)}>Cancel</button><button className="primary" disabled={busy || !edit.title || (!edit.id && tab === 'products' && !edit._file) || (!edit.id && tab === 'materials' && !edit._file)} onClick={save}><Save />{busy ? 'Saving…' : 'Save'}</button></div>
    </section> : <section className="card"><div className="card-head row"><div><h2>{labels[tab]}</h2><p>Manage the learner-facing catalog.</p></div><button className="primary" onClick={() => setEdit({ ...blanks[tab] })}><Plus />Add</button></div>{busy ? <div className="loading">Loading…</div> : data[tab].length ? data[tab].map((item) => <div className="catalog-row" key={item.id}><div><strong>{item.title}</strong><small>{item.is_active ? 'Active' : 'Hidden'}{item.sort_order != null ? ` · order ${item.sort_order}` : ''}{item.is_special ? ' · special' : ''}</small></div><button className="secondary" onClick={() => toggle(item)}>{item.is_active ? <EyeOff /> : <Eye />}{item.is_active ? 'Hide' : 'Show'}</button><button className="secondary" onClick={() => setEdit({ ...item })}>Edit</button><button className="danger-link" onClick={() => remove(item)}><Trash2 />Delete</button></div>) : <div className="empty">No {labels[tab].toLowerCase()} yet.</div>}</section>}
  </>;
}

function requestMarkdown(r) {
  const value = (x) => x === null || x === undefined || x === '' ? '—' : String(x);
  return [`# Service Request — ${value(r.name)}`, '', `- **Service:** ${value(r.service)}`, `- **Status:** ${value(r.status)}`, `- **Submitted:** ${r.created_at ? new Date(r.created_at).toLocaleString() : '—'}`, `- **WhatsApp:** ${value(r.whatsapp)}`, `- **Email:** ${value(r.email)}`, `- **Budget:** ${value(r.budget)}`, `- **Timeline:** ${value(r.timeline)}`, `- **Has materials:** ${value(r.has_materials)}`, `- **Attachment:** ${value(r.attachment_name)}`, '', '## Project description', '', value(r.description), '', '## Anything else', '', value(r.notes), ''].join('\n');
}

export function RequestsPanel({ reportError }) {
  const [data, setData] = useState([]);
  const [filter, setFilter] = useState('all');
  const load = () => adminCall('admin-commerce', { action: 'list' }).then((v) => setData(v.requests)).catch((e) => reportError(e.message));
  useEffect(() => { load(); }, []);
  const status = async (id, value) => { try { await adminCall('admin-commerce', { action: 'request_status', id, status: value }); await load(); } catch (e) { reportError(e.message); } };
  const remove = async (id) => { if (!confirm('Delete this service request?')) return; try { await adminCall('admin-commerce', { action: 'delete_request', id }); await load(); } catch (e) { reportError(e.message); } };
  const attachment = async (item) => { try { const v = await adminCall('service-upload', { mode: 'get', key: item.attachment_key, filename: item.attachment_name, download: true }); window.open(v.url, '_blank', 'noopener,noreferrer'); } catch (e) { reportError(e.message); } };
  const exportRequest = (item) => { const blob = new Blob([requestMarkdown(item)], { type: 'text/markdown;charset=utf-8' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `${slug(item.name)}-${String(item.id).slice(0, 8)}.md`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
  const rows = filter === 'all' ? data : data.filter((x) => x.status === filter);
  return <section className="card"><div className="card-head row"><div><h2>Service requests</h2><p>Review, export and track client enquiries.</p></div><select value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">All</option><option value="new">New</option><option value="contacted">Contacted</option><option value="closed">Closed</option></select></div>{rows.length ? rows.map((item) => <div className="request-card" key={item.id}><div><strong>{item.name} · {item.service}</strong><p>{item.description}</p><small>{item.whatsapp} {item.email && `· ${item.email}`} · {new Date(item.created_at).toLocaleString()}</small></div>{item.attachment_key && <button className="secondary" onClick={() => attachment(item)}><Download />Attachment</button>}<button className="secondary" onClick={() => exportRequest(item)}><FileDown />Markdown</button><select value={item.status} onChange={(e) => status(item.id, e.target.value)}><option value="new">New</option><option value="contacted">Contacted</option><option value="closed">Closed</option></select><button className="danger-link" onClick={() => remove(item.id)}><Trash2 /></button></div>) : <div className="empty">No requests in this status.</div>}</section>;
}
