import { useEffect, useState } from 'react';
import { Bell, BarChart3, RefreshCw, Send, Trash2, Users } from 'lucide-react';
import { adminCall } from './adminApi';
import './general.css';

export function AnalyticsPanel({ reportError }) {
  const [data, setData] = useState(null);
  const load = async () => { try { setData(await adminCall('admin-general', { action: 'analytics' })); } catch (e) { reportError(e.message); } };
  useEffect(() => { load(); }, []);
  if (!data) return <div className="loading">Loading analytics…</div>;
  const max = Math.max(1, ...data.ranking.map((item) => item.enrollments));
  return <><section className="metrics"><div className="metric green"><Users/><div><strong>{data.paidUsers}</strong><span>Active paid users</span></div></div>{data.premiumUsers !== undefined && <><div className="metric blue"><Users/><div><strong>{data.businessUsers}</strong><span>Business</span></div></div><div className="metric orange"><Users/><div><strong>{data.premiumUsers}</strong><span>Premium</span></div></div></>}<div className="metric orange"><BarChart3/><div><strong>{data.enrollments}</strong><span>Total enrollments</span></div></div><div className="metric blue"><BarChart3/><div><strong>{data.publishedCourses}</strong><span>Published courses</span></div></div></section><section className="card"><div className="card-head row"><div><h2>Course ranking</h2><p>Enrollment performance across every course.</p></div><button className="icon-btn" onClick={load}><RefreshCw/></button></div><div className="ranking">{data.ranking.map((item, index) => <div className="rank-row" key={item.id}><b>{index + 1}</b><div><strong>{item.title}</strong><span>{item.is_published ? 'Published' : 'Draft'}</span><i style={{width:`${item.enrollments / max * 100}%`}} /></div><em>{item.enrollments}</em></div>)}</div></section></>;
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
  const [urls,setUrls]=useState({ business:'', premium:'' }); const [busy,setBusy]=useState(false); const [saved,setSaved]=useState(false);
  useEffect(()=>{adminCall('admin-general',{action:'general'}).then((value)=>setUrls({ business:value.whatsapp_business_url||'', premium:value.whatsapp_premium_url||'' })).catch((e)=>reportError(e.message));},[]);
  const change=(key,value)=>{setSaved(false);setUrls((current)=>({...current,[key]:value}));};
  const save=async()=>{setBusy(true);try{await adminCall('admin-general',{action:'save_community',business_url:urls.business.trim(),premium_url:urls.premium.trim()});setSaved(true);}catch(e){reportError(e.message);}finally{setBusy(false);}};
  return <section className="card compose"><div className="card-head"><h2>Community settings</h2><p>Each package has its own WhatsApp group. Learners only see the link for their active package.</p></div><label>Business WhatsApp group URL<input placeholder="https://chat.whatsapp.com/..." value={urls.business} onChange={(e)=>change('business',e.target.value)}/></label><label>Premium WhatsApp group URL<input placeholder="https://chat.whatsapp.com/..." value={urls.premium} onChange={(e)=>change('premium',e.target.value)}/></label><button className="primary" disabled={busy} onClick={save}>{busy?'Saving…':saved?'Saved':'Save community URLs'}</button></section>;
}
