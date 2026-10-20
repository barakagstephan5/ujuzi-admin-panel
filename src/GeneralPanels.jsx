import { useEffect, useRef, useState } from 'react';
import { Bell, BarChart3, RefreshCw, Send, Trash2, Users } from 'lucide-react';
import { adminCall } from './adminApi';
import { supabase } from './supabase';
import { registerUnsaved } from './unsavedChanges';
import './general.css';

export function AnalyticsPanel({ reportError }) {
  const [data, setData] = useState(null);
  const load = async () => { try { setData(await adminCall('admin-general', { action: 'analytics' })); } catch (e) { reportError(e.message); } };
  useEffect(() => { load(); }, []);
  if (!data) return <div className="loading">Loading analytics…</div>;
  const max = Math.max(1, ...data.ranking.map((item) => item.enrollments));
  return <><section className="metrics"><div className="metric green"><Users/><div><strong>{data.paidUsers}</strong><span>Active paid users</span></div></div>{data.premiumUsers !== undefined && <><div className="metric blue"><Users/><div><strong>{data.businessUsers}</strong><span>Business</span></div></div><div className="metric orange"><Users/><div><strong>{data.premiumUsers}</strong><span>Premium</span></div></div></>}<div className="metric orange"><BarChart3/><div><strong>{data.enrollments}</strong><span>Total enrollments</span></div></div><div className="metric blue"><BarChart3/><div><strong>{data.publishedCourses}</strong><span>Published courses</span></div></div></section>{data.packages?.length > 0 && <section className="card package-stats"><div className="card-head"><h2>Active members by package</h2><p>Every package, including paused and archived ones whose members still have access.</p></div>{data.packages.map((p) => <div className="history-row" key={p.id}><div><strong>{p.name}</strong><small>{p.archived ? 'Archived' : p.active ? 'On sale' : 'Draft / paused'}</small></div><div className="counts"><strong>{p.active_members}</strong><small>active members</small></div></div>)}</section>}<section className="card"><div className="card-head row"><div><h2>Course ranking</h2><p>Enrollment performance across every course.</p></div><button className="icon-btn" onClick={load}><RefreshCw/></button></div><div className="ranking">{data.ranking.map((item, index) => <div className="rank-row" key={item.id}><b>{index + 1}</b><div><strong>{item.title}</strong><span>{item.is_published ? 'Published' : 'Draft'}</span><i style={{width:`${item.enrollments / max * 100}%`}} /></div><em>{item.enrollments}</em></div>)}</div></section></>;
}

export function NotificationsPanel({ reportError }) {
  const [data, setData] = useState({ notifications: [], whatsapp_url: '' }); const [form, setForm] = useState({ title: '', message: '', push: true }); const [busy, setBusy] = useState(false);
  const load = async () => { try { setData(await adminCall('admin-general', { action: 'general' })); } catch (e) { reportError(e.message); } };
  useEffect(() => { load(); }, []);
  const send = async () => { setBusy(true); try { await adminCall(form.push ? 'send-push-notification' : 'admin-general', form.push ? { title: form.title, message: form.message, topic: 'all_users' } : { action: 'send_in_app', title: form.title, message: form.message }); setForm({ title: '', message: '', push: form.push }); await load(); } catch (e) { reportError(e.message); } finally { setBusy(false); } };
  const remove = async (id) => { if (!window.confirm('Delete this broadcast notification?')) return; await adminCall('admin-general', { action: 'delete_notification', id }); await load(); };
  return <><section className="card compose"><div className="card-head"><h2>Send notification</h2><p>Broadcast in-app and optionally send to phones with Firebase.</p></div><label>Title<input maxLength={120} value={form.title} onChange={(e)=>setForm({...form,title:e.target.value})}/></label><label>Message<textarea rows="4" maxLength={2000} value={form.message} onChange={(e)=>setForm({...form,message:e.target.value})}/></label><label className="inline-check"><input type="checkbox" checked={form.push} onChange={(e)=>setForm({...form,push:e.target.checked})}/> Send push notification to phones</label><button className="primary" disabled={busy||!form.title||!form.message} onClick={send}><Send/>{busy?'Sending…':'Send notification'}</button></section><section className="card"><div className="card-head"><h2>Recent broadcasts</h2></div>{data.notifications.map((item)=><div className="notification-row" key={item.id}><Bell/><div><strong>{item.title}</strong><p>{item.message}</p><small>{new Date(item.created_at).toLocaleString()}</small></div><button className="danger-link" onClick={()=>remove(item.id)}><Trash2/></button></div>)}</section></>;
}

export function CommunityPanel({ reportError }) {
  const [packages,setPackages]=useState([]); const [busy,setBusy]=useState(false); const [saved,setSaved]=useState('');
  const [loadState,setLoadState]=useState('loading'); const [stored,setStored]=useState({});
  // Typed but unsaved links are protected like the package editor.
  const dirtyRef=useRef(false);
  dirtyRef.current=packages.some(p=>(stored[p.id]??'')!==p.whatsapp_url);
  useEffect(()=>registerUnsaved(()=>dirtyRef.current),[]);
  const load=async()=>{
    if(dirtyRef.current&&!window.confirm('Discard the group links you have not saved?'))return;
    setBusy(true);reportError('');setLoadState(s=>s==='ready'?'ready':'loading');
    try{const {data,error}=await supabase.rpc('admin_package_communities');if(error)throw error;
      setPackages(data||[]);setStored(Object.fromEntries((data||[]).map(p=>[p.id,p.whatsapp_url])));setLoadState('ready');}
    catch(e){setLoadState('error');reportError(e.message);}finally{setBusy(false);}};
  useEffect(()=>{load();},[]);
  const save=async(pkg)=>{setBusy(true);setSaved('');reportError('');try{
    const {data,error}=await supabase.rpc('admin_save_package_community',{p_package:pkg.id,p_url:pkg.whatsapp_url.trim(),p_expected_revision:pkg.revision});
    if(error)throw error;
    setPackages(rows=>rows.map(p=>p.id===pkg.id?{...p,whatsapp_url:data.whatsapp_url,revision:data.revision}:p));
    setStored(s=>({...s,[pkg.id]:data.whatsapp_url}));setSaved(pkg.id);
  }catch(e){reportError(e.message);}finally{setBusy(false);}};
  return <section className="card compose"><div className="card-head"><h2>Community settings</h2><p>Every package appears here automatically. Set a separate WhatsApp group for each. Learners receive only the link for the package they actually paid for; an empty link never falls back to another group.</p></div>
    <button className="secondary" disabled={busy} onClick={load}>Refresh packages</button>
    {loadState==='loading'&&<p role="status">Loading packages…</p>}
    {loadState==='error'&&<div className="alert error">Could not load the package list. <button className="secondary" onClick={load}>Retry</button></div>}
    {loadState==='ready'&&!packages.length&&<p>No packages yet. Create one in Packages &amp; pricing.</p>}
    {packages.map(pkg=><div className="package-community-row" key={pkg.id}><h3>{pkg.name}</h3><p className="hint">{pkg.archived?'Archived — existing members retain their group':pkg.active?'On sale':'Draft / paused'}{(stored[pkg.id]??'')!==pkg.whatsapp_url?' · not saved yet':''}</p>
      <label>WhatsApp group link<input type="url" maxLength={500} placeholder="https://chat.whatsapp.com/..." disabled={busy} value={pkg.whatsapp_url} onChange={e=>{setSaved('');setPackages(rows=>rows.map(p=>p.id===pkg.id?{...p,whatsapp_url:e.target.value}:p));}} /></label>
      <button className="primary" disabled={busy} onClick={()=>save(pkg)}>{saved===pkg.id?'Saved':`Save ${pkg.name} group`}</button>
    </div>)}
  </section>;
}
