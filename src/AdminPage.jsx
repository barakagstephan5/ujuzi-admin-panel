import { useCallback, useEffect, useState } from 'react';
import { BarChart3, BookOpen, CheckCircle2, KeyRound, LogOut, Mail, Megaphone, MessageSquareText, Moon, RefreshCw, Send, ShieldCheck, Store, Sun, Users, XCircle } from 'lucide-react';
import { adminCall } from './adminApi';
import CourseManager from './CourseManager';
import { AnalyticsPanel, NotificationsPanel, CommunityPanel } from './GeneralPanels';
import { CommercePanel, RequestsPanel } from './CommercePanel';
import AssessmentsPanel from './AssessmentsPanel';
import IdeasPanel from './IdeasPanel';
import AccessPanel from './AccessPanel';
import LandingCMS from './LandingCMS';
import PackagesPanel from './PackagesPanel';
import MarketplacePanel from './marketplace/MarketplacePanel';
import CommunityChat from './CommunityChat';
import { TwoStepPanel } from './TwoStep';
import { confirmDiscard } from './unsavedChanges';

function Metric({ icon: Icon, label, value, tone = '' }) {
  return <div className={`metric ${tone}`}><Icon /><div><strong>{value ?? '—'}</strong><span>{label}</span></div></div>;
}

// SMS length the way networks bill it. Plain GSM text: 160 characters in one
// SMS, 153 per part once it is longer. Any emoji or other character outside
// GSM switches the whole message to Unicode: 70, then 67 per part. Five GSM
// characters (^ { } \ [ ] ~ | and the euro sign) take two places each.
const GSM_BASIC = new Set("@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà");
const GSM_EXTENDED = new Set('^{}\[~]|€');
function smsInfo(text) {
  let units = 0;
  let unicode = false;
  for (const ch of text) {
    if (GSM_BASIC.has(ch)) units += 1;
    else if (GSM_EXTENDED.has(ch)) units += 2;
    else { unicode = true; break; }
  }
  const length = unicode ? [...text].reduce((n, ch) => n + (ch.codePointAt(0) > 0xffff ? 2 : 1), 0) : units;
  const single = unicode ? 70 : 160;
  const part = unicode ? 67 : 153;
  const parts = length === 0 ? 0 : length <= single ? 1 : Math.ceil(length / part);
  const limit = parts <= 1 ? single : parts * part;
  return { length, parts, limit, unicode, left: limit - length };
}

export default function AdminPage({ onSignOut }) {
  const [tab, setTab] = useState('upload');
  // Leaving a tab with unsaved edits (for example an open package editor) asks first.
  const go = (next) => { if (next !== tab && confirmDiscard()) setTab(next); };
  const [overview, setOverview] = useState(null);
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyCourse, setBusyCourse] = useState('');
  const [campaign, setCampaign] = useState({ channel: 'email', sms_provider: 'nextsms', name: '', subject: '', message: '' });
  const [previewCount, setPreviewCount] = useState(null);
  const [previewInfo, setPreviewInfo] = useState(null);
  const [testPhone, setTestPhone] = useState(() => localStorage.getItem('_uk_admin_test_phone') || '');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [confirmText, setConfirmText] = useState('');
  const [theme, setTheme] = useState(() => localStorage.getItem('_uk_admin_theme') || 'dark');

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('_uk_admin_theme', theme);
  }, [theme]);

  const loadOverview = useCallback(async () => { setLoading(true); setError(''); try { setOverview(await adminCall('admin-dashboard', { action: 'overview' })); } catch (e) { setError(e.message); } finally { setLoading(false); } }, []);
  const loadCourses = useCallback(async () => { setLoading(true); setError(''); try { const value = await adminCall('admin-dashboard', { action: 'courses' }); setCourses(value.courses || []); } catch (e) { setError(e.message); } finally { setLoading(false); } }, []);
  useEffect(() => { loadOverview(); }, [loadOverview]);
  useEffect(() => { if (tab === 'courses' && !courses.length) loadCourses(); }, [tab, courses.length, loadCourses]);

  const toggleCourse = async (course) => {
    setBusyCourse(course.id); setError('');
    try { const value = await adminCall('admin-dashboard', { action: 'set_course_published', course_id: course.id, published: !course.is_published }); setCourses((items) => items.map((item) => item.id === course.id ? value.course : item)); }
    catch (e) { setError(e.message); } finally { setBusyCourse(''); }
  };
  const preview = async () => { setSending(true); setError(''); try { const value = await adminCall('campaign-send', { ...campaign, dry_run: true }); setPreviewCount(value.recipient_count ?? 0); setPreviewInfo(value); } catch (e) { setError(e.message); } finally { setSending(false); } };
  const send = async () => {
    if (confirmText !== 'SEND') return; setSending(true); setError(''); setResult(null);
    try { const value = await adminCall('campaign-send', { ...campaign, dry_run: false }); setResult(value); setConfirmText(''); setPreviewCount(null); setCampaign({ channel: campaign.channel, sms_provider: campaign.sms_provider, name: '', subject: '', message: '' }); await loadOverview(); }
    catch (e) { setError(e.message); } finally { setSending(false); }
  };
  // Errors show inside the test box, next to the button, not only at the top.
  const sendTest = async () => {
    setTesting(true); setTestResult(null);
    try {
      localStorage.setItem('_uk_admin_test_phone', testPhone);
      const value = await adminCall('campaign-send', { ...campaign, action: 'test', test_phone: testPhone });
      setTestResult(value);
      if (value.message_id && campaign.sms_provider === 'sprint') setTimeout(() => checkDelivery(value), 8000);
    } catch (e) { setTestResult({ ok: false, note: e.message }); } finally { setTesting(false); }
  };
  const checkDelivery = async (sent) => {
    setTestResult((r) => r && r.message_id === sent.message_id ? { ...r, delivery: { status: 'Checking…' } } : r);
    try {
      const delivery = await adminCall('campaign-send', { channel: 'sms', sms_provider: 'sprint', action: 'test_status', message_id: sent.message_id });
      setTestResult((r) => r && r.message_id === sent.message_id ? { ...r, delivery } : r);
    } catch (e) {
      setTestResult((r) => r && r.message_id === sent.message_id ? { ...r, delivery: { status: 'Unknown', detail: e.message } } : r);
    }
  };
  const update = (key, value) => { setCampaign((current) => ({ ...current, [key]: value })); setPreviewCount(null); setResult(null); };
  const metrics = overview?.metrics || {};

  return <div className="admin-shell"><header><div className="brand"><ShieldCheck /><div><span>Ujuzi Kidigitali</span><h1>Admin control centre</h1></div></div><div className="header-actions"><button className="icon-btn" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} title="Switch colour theme" aria-label="Switch colour theme">{theme === 'dark' ? <Sun /> : <Moon />}</button><button className="icon-btn" onClick={loadOverview} title="Refresh"><RefreshCw /></button><button className="signout" onClick={onSignOut}><LogOut />Sign out</button></div></header>
    <nav>
      <button className={tab === 'upload' ? 'active' : ''} onClick={() => go('upload')}><BookOpen />Upload</button>
      <button className={tab === 'manage' ? 'active' : ''} onClick={() => go('manage')}><BookOpen />Manage</button>
      <button className={tab === 'categories' ? 'active' : ''} onClick={() => go('categories')}><BookOpen />Categories</button>
      <button className={tab === 'analytics' ? 'active' : ''} onClick={() => go('analytics')}><BarChart3 />Analytics</button>
      <button className={tab === 'notifications' ? 'active' : ''} onClick={() => go('notifications')}><Megaphone />Notify</button>
      <button className={tab === 'community' ? 'active' : ''} onClick={() => go('community')}><Users />Community</button>
      <button className={tab === 'access' ? 'active' : ''} onClick={() => go('access')}><KeyRound />Access</button>
      <button className={tab === 'packages' ? 'active' : ''} onClick={() => go('packages')}><KeyRound />Packages & pricing</button>
      <button className={tab === 'marketplace' ? 'active' : ''} onClick={() => go('marketplace')}><Store />Marketplace</button>
      <button className={tab === 'shop' ? 'active' : ''} onClick={() => go('shop')}><BookOpen />Shop</button>
      <button className={tab === 'requests' ? 'active' : ''} onClick={() => go('requests')}><Users />Requests</button>
      <button className={tab === 'exams' ? 'active' : ''} onClick={() => go('exams')}><BookOpen />Exams</button>
      <button className={tab === 'ideas' ? 'active' : ''} onClick={() => go('ideas')}><Megaphone />Ideas</button>
      <button className={tab === 'campaigns' ? 'active' : ''} onClick={() => go('campaigns')}><Megaphone />Campaigns</button>
      <button className={tab === 'cms' ? 'active' : ''} onClick={() => go('cms')}><BookOpen />Landing CMS</button>
      <button className={tab === 'security' ? 'active' : ''} onClick={() => go('security')}><ShieldCheck />Security</button>
    </nav>
    {error && <div className="alert error"><XCircle />{error}</div>}{loading && tab === 'overview' && <div className="loading">Loading admin data…</div>}
    {!loading && tab === 'overview' && <><section className="metrics"><Metric icon={Users} label="Registered users" value={metrics.users} /><Metric icon={CheckCircle2} label="Paid users" value={metrics.paidUsers} tone="green" /><Metric icon={BookOpen} label="Published courses" value={`${metrics.publishedCourses ?? 0}/${metrics.courses ?? 0}`} tone="blue" /><Metric icon={BarChart3} label="Enrollments" value={metrics.enrollments} tone="orange" /><Metric icon={Mail} label="Email audience" value={metrics.emailAudience} tone="violet" /><Metric icon={MessageSquareText} label="SMS audience" value={metrics.smsAudience} tone="teal" /></section><section className="card"><div className="card-head"><h2>Recent campaigns</h2><p>Only users who explicitly opted in are included.</p></div>{!overview?.campaigns?.length ? <div className="empty">No campaigns sent yet.</div> : <div className="history">{overview.campaigns.map((item) => <div className="history-row" key={item.id}><span className={`channel ${item.channel}`}>{item.channel === 'email' ? <Mail /> : <MessageSquareText />}</span><div><strong>{item.name}</strong><small>{new Date(item.created_at).toLocaleString()}{item.channel === 'sms' && item.sms_provider ? ` · ${item.sms_provider === 'sprint' ? 'Sprint' : 'NextSMS'}` : ''}</small></div><div className="counts"><strong>{item.sent_count}/{item.recipient_count}</strong><small>{item.status}</small></div></div>)}</div>}</section></>}
    {tab === 'upload' && <CourseManager key="upload" startNew reportError={setError} />}
    {tab === 'manage' && <CourseManager key="manage" reportError={setError} />}
    {tab === 'categories' && <CourseManager key="categories" categoriesOnly reportError={setError} />}
    {tab === 'analytics' && <AnalyticsPanel reportError={setError} />}
    {tab === 'notifications' && <NotificationsPanel reportError={setError} />}
    {tab === 'community' && <><CommunityChat /><CommunityPanel reportError={setError} /></>}
    {tab === 'access' && <AccessPanel reportError={setError} />}
    {tab === 'packages' && <PackagesPanel />}
    {tab === 'cms' && <LandingCMS />}
    {tab === 'security' && <TwoStepPanel />}
    {tab === 'marketplace' && <MarketplacePanel />}
    {tab === 'shop' && <CommercePanel reportError={setError} />}
    {tab === 'requests' && <RequestsPanel reportError={setError} />}
    {tab === 'exams' && <AssessmentsPanel reportError={setError} />}
    {tab === 'ideas' && <IdeasPanel reportError={setError} />}
    {tab === 'campaigns' && <section className="card compose"><div className="card-head"><h2>New campaign</h2><p>Provider credentials remain protected in Supabase.</p></div><div className="segmented"><button className={campaign.channel === 'email' ? 'active' : ''} onClick={() => update('channel', 'email')}><Mail />Email</button><button className={campaign.channel === 'sms' ? 'active' : ''} onClick={() => update('channel', 'sms')}><MessageSquareText />Bulk SMS</button></div>{campaign.channel === 'sms' && <label>SMS company<select value={campaign.sms_provider} onChange={(e) => update('sms_provider', e.target.value)}><option value="nextsms">NextSMS</option><option value="sprint">Sprint</option></select></label>}<label>Campaign name<input value={campaign.name} maxLength={120} onChange={(e) => update('name', e.target.value)} /></label>{campaign.channel === 'email' && <label>Subject<input value={campaign.subject} maxLength={160} onChange={(e) => update('subject', e.target.value)} /></label>}<label>Message<textarea value={campaign.message} maxLength={campaign.channel === 'sms' ? 1500 : 10000} onChange={(e) => update('message', e.target.value)} rows={8} /></label>{campaign.channel === 'sms' && (() => { const info = smsInfo(campaign.message); return <p className="hint" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginTop: -8, color: info.parts > 1 ? '#b45309' : undefined }}><span>{info.unicode ? 'Unicode (emoji or special letters): 70 characters per SMS' : 'Plain text: 160 characters per SMS'}</span><strong>{info.length} / {info.limit} · {info.parts} SMS{info.parts > 1 ? ` (${info.left} left in this one)` : ''}</strong></p>; })()}{campaign.channel === 'sms' && previewCount > 0 && smsInfo(campaign.message).parts > 0 && <p className="hint">{previewCount} recipients × {smsInfo(campaign.message).parts} SMS = {previewCount * smsInfo(campaign.message).parts} SMS billed.</p>}{campaign.channel === 'sms' && <div className="send-check"><strong>Send a test first</strong><p>Goes only to this number, right away, through {campaign.sms_provider === 'sprint' ? 'Sprint' : 'NextSMS'}. It costs one SMS.</p><input value={testPhone} inputMode="tel" placeholder="0712 345 678" onChange={(e) => { setTestPhone(e.target.value); setTestResult(null); }} /><button className="primary soft" disabled={testing || !campaign.message || !testPhone.trim()} onClick={sendTest}><Send />{testing ? 'Sending test…' : 'Send test'}</button>{testResult && <div className={`alert ${testResult.ok ? 'success' : 'error'}`} style={{ flexDirection: 'column', alignItems: 'stretch', marginBottom: 0 }}><span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{testResult.ok ? <CheckCircle2 /> : <XCircle />}{testResult.ok ? `Accepted for ${testResult.phone}` : testResult.phone ? `Not sent to ${testResult.phone}` : 'Test not sent'}</span><small style={{ fontWeight: 500 }}>{testResult.note}{testResult.message_id ? ` · Message ${testResult.message_id}` : ''}{testResult.http_status ? ` · HTTP ${testResult.http_status}` : ''}</small>{testResult.delivery && <small style={{ fontWeight: 700 }}>Delivery: {testResult.delivery.status}{testResult.delivery.detail ? ` · ${testResult.delivery.detail}` : ''}</small>}{testResult.message_id && campaign.sms_provider === 'sprint' && <button type="button" className="primary soft" style={{ marginTop: 8 }} onClick={() => checkDelivery(testResult)}><RefreshCw />Check delivery</button>}{testResult.reply && <details><summary style={{ cursor: 'pointer', fontSize: '.76rem' }}>What the SMS company replied</summary><code style={{ display: 'block', whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: '.74rem', marginTop: 6, color: '#334155' }}>{testResult.reply}</code></details>}</div>}</div>}<button className="primary soft" disabled={sending || !campaign.name || !campaign.message || (campaign.channel === 'email' && !campaign.subject)} onClick={preview}>Preview audience</button>{previewCount !== null && <div className="send-check"><strong>{previewCount} opted-in recipients</strong>{campaign.channel === 'sms' && <p>Sends through {campaign.sms_provider === 'sprint' ? 'Sprint' : 'NextSMS'}.{previewInfo?.balance ? ` Balance: ${previewInfo.balance.amount.toLocaleString()} ${previewInfo.balance.currency}`.trimEnd() + '.' : ''}</p>}{previewInfo?.provider_ready === false && <p className="hint">This SMS company is not set up yet. Add its API settings in Supabase first.</p>}<p>This sends real messages and may incur provider charges. Type <b>SEND</b> to confirm.</p><input value={confirmText} onChange={(e) => setConfirmText(e.target.value.toUpperCase())} placeholder="Type SEND" /><button className="primary" disabled={sending || confirmText !== 'SEND' || previewCount === 0 || previewInfo?.provider_ready === false} onClick={send}><Send />{sending ? 'Sending…' : 'Send campaign'}</button></div>}{result && <div className="alert success"><CheckCircle2 />Sent {result.sent_count}; failed {result.failed_count}.</div>}</section>}
  </div>;
}
