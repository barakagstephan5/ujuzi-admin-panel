import { useCallback, useEffect, useState } from 'react';
import { BarChart3, BookOpen, CheckCircle2, LogOut, Mail, Megaphone, MessageSquareText, RefreshCw, Send, ShieldCheck, Users, XCircle } from 'lucide-react';
import { supabase } from './supabase';

async function adminCall(functionName, body) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Your session expired. Please sign in again.');
  const { data, error } = await supabase.functions.invoke(functionName, { body, headers: { Authorization: `Bearer ${session.access_token}` } });
  if (error || data?.error) throw new Error(data?.error || error?.message || 'Request failed');
  return data;
}

function Metric({ icon: Icon, label, value, tone = '' }) {
  return <div className={`metric ${tone}`}><Icon /><div><strong>{value ?? '—'}</strong><span>{label}</span></div></div>;
}

export default function AdminPage({ onSignOut }) {
  const [tab, setTab] = useState('overview');
  const [overview, setOverview] = useState(null);
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyCourse, setBusyCourse] = useState('');
  const [campaign, setCampaign] = useState({ channel: 'email', name: '', subject: '', message: '' });
  const [previewCount, setPreviewCount] = useState(null);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [confirmText, setConfirmText] = useState('');

  const loadOverview = useCallback(async () => { setLoading(true); setError(''); try { setOverview(await adminCall('admin-dashboard', { action: 'overview' })); } catch (e) { setError(e.message); } finally { setLoading(false); } }, []);
  const loadCourses = useCallback(async () => { setLoading(true); setError(''); try { const value = await adminCall('admin-dashboard', { action: 'courses' }); setCourses(value.courses || []); } catch (e) { setError(e.message); } finally { setLoading(false); } }, []);
  useEffect(() => { loadOverview(); }, [loadOverview]);
  useEffect(() => { if (tab === 'courses' && !courses.length) loadCourses(); }, [tab, courses.length, loadCourses]);

  const toggleCourse = async (course) => {
    setBusyCourse(course.id); setError('');
    try { const value = await adminCall('admin-dashboard', { action: 'set_course_published', course_id: course.id, published: !course.is_published }); setCourses((items) => items.map((item) => item.id === course.id ? value.course : item)); }
    catch (e) { setError(e.message); } finally { setBusyCourse(''); }
  };
  const preview = async () => { setSending(true); setError(''); try { const value = await adminCall('campaign-send', { ...campaign, dry_run: true }); setPreviewCount(value.recipient_count ?? 0); } catch (e) { setError(e.message); } finally { setSending(false); } };
  const send = async () => {
    if (confirmText !== 'SEND') return; setSending(true); setError(''); setResult(null);
    try { const value = await adminCall('campaign-send', { ...campaign, dry_run: false }); setResult(value); setConfirmText(''); setPreviewCount(null); setCampaign({ channel: campaign.channel, name: '', subject: '', message: '' }); await loadOverview(); }
    catch (e) { setError(e.message); } finally { setSending(false); }
  };
  const update = (key, value) => { setCampaign((current) => ({ ...current, [key]: value })); setPreviewCount(null); setResult(null); };
  const metrics = overview?.metrics || {};

  return <div className="admin-shell"><header><div className="brand"><ShieldCheck /><div><span>Ujuzi Kidigitali</span><h1>Admin control centre</h1></div></div><div className="header-actions"><button className="icon-btn" onClick={tab === 'courses' ? loadCourses : loadOverview} title="Refresh"><RefreshCw /></button><button className="signout" onClick={onSignOut}><LogOut />Sign out</button></div></header>
    <nav><button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}><BarChart3 />Overview</button><button className={tab === 'courses' ? 'active' : ''} onClick={() => setTab('courses')}><BookOpen />Courses</button><button className={tab === 'campaigns' ? 'active' : ''} onClick={() => setTab('campaigns')}><Megaphone />Campaigns</button></nav>
    {error && <div className="alert error"><XCircle />{error}</div>}{loading && <div className="loading">Loading admin data…</div>}
    {!loading && tab === 'overview' && <><section className="metrics"><Metric icon={Users} label="Registered users" value={metrics.users} /><Metric icon={CheckCircle2} label="Paid users" value={metrics.paidUsers} tone="green" /><Metric icon={BookOpen} label="Published courses" value={`${metrics.publishedCourses ?? 0}/${metrics.courses ?? 0}`} tone="blue" /><Metric icon={BarChart3} label="Enrollments" value={metrics.enrollments} tone="orange" /><Metric icon={Mail} label="Email audience" value={metrics.emailAudience} tone="violet" /><Metric icon={MessageSquareText} label="SMS audience" value={metrics.smsAudience} tone="teal" /></section><section className="card"><div className="card-head"><h2>Recent campaigns</h2><p>Only users who explicitly opted in are included.</p></div>{!overview?.campaigns?.length ? <div className="empty">No campaigns sent yet.</div> : <div className="history">{overview.campaigns.map((item) => <div className="history-row" key={item.id}><span className={`channel ${item.channel}`}>{item.channel === 'email' ? <Mail /> : <MessageSquareText />}</span><div><strong>{item.name}</strong><small>{new Date(item.created_at).toLocaleString()}</small></div><div className="counts"><strong>{item.sent_count}/{item.recipient_count}</strong><small>{item.status}</small></div></div>)}</div>}</section></>}
    {!loading && tab === 'courses' && <section className="card"><div className="card-head"><h2>Course visibility</h2><p>Publish or hide courses from any device.</p></div><div className="course-list">{courses.map((course) => <div className="course-row" key={course.id}><div><strong>{course.title}</strong><small>{course.is_free ? 'Free' : `${Number(course.price || 0).toLocaleString()} TZS`}</small></div><button disabled={busyCourse === course.id} className={course.is_published ? 'published' : ''} onClick={() => toggleCourse(course)}>{busyCourse === course.id ? 'Saving…' : course.is_published ? 'Published' : 'Draft'}</button></div>)}</div></section>}
    {!loading && tab === 'campaigns' && <section className="card compose"><div className="card-head"><h2>New campaign</h2><p>Provider credentials remain protected in Supabase.</p></div><div className="segmented"><button className={campaign.channel === 'email' ? 'active' : ''} onClick={() => update('channel', 'email')}><Mail />Email</button><button className={campaign.channel === 'sms' ? 'active' : ''} onClick={() => update('channel', 'sms')}><MessageSquareText />Bulk SMS</button></div><label>Campaign name<input value={campaign.name} maxLength={120} onChange={(e) => update('name', e.target.value)} /></label>{campaign.channel === 'email' && <label>Subject<input value={campaign.subject} maxLength={160} onChange={(e) => update('subject', e.target.value)} /></label>}<label>Message<textarea value={campaign.message} maxLength={campaign.channel === 'sms' ? 1500 : 10000} onChange={(e) => update('message', e.target.value)} rows={8} /></label>{campaign.channel === 'sms' && <p className="hint">Emoji and Unicode can increase the number of billable SMS segments.</p>}<button className="primary soft" disabled={sending || !campaign.name || !campaign.message || (campaign.channel === 'email' && !campaign.subject)} onClick={preview}>Preview audience</button>{previewCount !== null && <div className="send-check"><strong>{previewCount} opted-in recipients</strong><p>This sends real messages and may incur provider charges. Type <b>SEND</b> to confirm.</p><input value={confirmText} onChange={(e) => setConfirmText(e.target.value.toUpperCase())} placeholder="Type SEND" /><button className="primary" disabled={sending || confirmText !== 'SEND' || previewCount === 0} onClick={send}><Send />{sending ? 'Sending…' : 'Send campaign'}</button></div>}{result && <div className="alert success"><CheckCircle2 />Sent {result.sent_count}; failed {result.failed_count}.</div>}</section>}
  </div>;
}
