import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Plus, Trash2 } from 'lucide-react';
import { Chips, Empty, Skeleton, rpc, useData, when } from './marketplace/parts';
import { DAYS, LENGTHS, MAX_GROUPS, MAX_LESSONS, clean, newLesson, nextLabel, problem, range, sameTimetable } from './timetableDraft';
import './timetables.css';

// Class groups A, B, C ... with weekly lessons for each in-app chat group.
// Learners see them from the chat and can turn on a reminder 45 minutes before
// each lesson. Saving tells open chats at once.
export default function CommunityTimetables() {
  const data = useData(() => rpc('admin_community_timetables'));
  const chats = data.data ?? [];
  const [chatId, setChatId] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');

  useEffect(() => { if (!chatId && chats.length) setChatId(chats[0].id); }, [chats, chatId]);
  const chat = chats.find(c => c.id === chatId);
  const draft = chat ? drafts[chat.id] ?? clean(chat.groups) : [];
  const dirty = chat ? !sameTimetable(draft, chat.groups) : false;
  const issue = useMemo(() => problem(draft), [draft]);

  const edit = (fn) => {
    setSaved(''); setError('');
    setDrafts(d => ({ ...d, [chat.id]: fn(structuredClone(d[chat.id] ?? clean(chat.groups))) }));
  };
  const addGroup = () => edit(g => { const label = nextLabel(g); if (label) g.push({ label, lessons: [newLesson()] }); return g; });
  const removeGroup = (i) => {
    const g = draft[i];
    if (g.lessons.length && !window.confirm(`Remove Group ${g.label} and its ${g.lessons.length} ${g.lessons.length === 1 ? 'lesson' : 'lessons'}? Learners' reminders for it stop after you save.`)) return;
    edit(list => { list.splice(i, 1); return list; });
  };
  const addLesson = (gi) => edit(list => { const ls = list[gi].lessons; ls.push(newLesson(ls[ls.length - 1])); return list; });
  const removeLesson = (gi, li) => edit(list => { list[gi].lessons.splice(li, 1); return list; });
  const setLesson = (gi, li, patch) => edit(list => { Object.assign(list[gi].lessons[li], patch); return list; });

  const save = async () => {
    if (!chat || issue || !dirty) return;
    setBusy(true); setError(''); setSaved('');
    try {
      const fresh = await rpc('admin_community_timetable_save', { p_group: chat.id, p_expected_version: chat.version, p_groups: clean(draft) });
      data.setData(list => list.map(c => (c.id === chat.id ? { ...c, ...fresh } : c)));
      setDrafts(d => { const next = { ...d }; delete next[chat.id]; return next; });
      setSaved('Saved. Open chats show it now; other phones get it the next time they open the app or the timetable.');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  const discard = () => { setDrafts(d => { const next = { ...d }; delete next[chat.id]; return next; }); setError(''); setSaved(''); };

  if (data.error) return <section className="mkt"><div className="mkt-error">{data.error} <button type="button" className="mkt-btn ghost sm tt-pill" onClick={data.reload}>Try again</button></div></section>;
  if (!data.data) return <section className="mkt"><div className="mkt-card"><Skeleton rows={4} /></div></section>;

  return (
    <section className="mkt tt">
      <div className="mkt-card">
        <h3>Timetables</h3>
        <p className="mkt-hint">Class groups A, B, C with weekly lessons. Times are East Africa Time. Learners open the timetable from the chat and can turn on a reminder 45 minutes before each lesson.</p>
        <Chips value={chatId} onChange={(id) => { setChatId(id); setError(''); setSaved(''); }}
          options={chats.map(c => ({ value: c.id, label: `${c.name}${drafts[c.id] && !sameTimetable(drafts[c.id], c.groups) ? ' (unsaved)' : ''}`, count: c.groups.length }))} />

        {chat && <>
          <p className="mkt-hint tt-meta">{chat.groups.length ? `${chat.groups.length} ${chat.groups.length === 1 ? 'group' : 'groups'} live` : 'No timetable yet'}{chat.version ? ` · version ${chat.version}` : ''}{!chat.is_active ? ' · this chat is hidden in the app' : ''}</p>
          {draft.length === 0 && <Empty icon={CalendarDays} text="No groups yet. Add Group A to start." />}
          {draft.map((g, gi) => (
            <div key={g.label} className="tt-group">
              <div className="tt-group-head">
                <span className="tt-badge" aria-hidden="true"><small>Group</small>{g.label}</span>
                <strong>Group {g.label}</strong>
                <span className="tt-count">{g.lessons.length} {g.lessons.length === 1 ? 'lesson' : 'lessons'} a week</span>
                <button type="button" className="mkt-btn ghost sm tt-pill" onClick={() => removeGroup(gi)}><Trash2 size={14} /> Remove group</button>
              </div>
              {g.lessons.map((l, li) => (
                <div key={li} className="tt-lesson">
                  <label>Day<select value={l.weekday} onChange={(e) => setLesson(gi, li, { weekday: Number(e.target.value) })}>
                    {DAYS.map((d, i) => <option key={d} value={i + 1}>{d}</option>)}
                  </select></label>
                  <label>Starts<Time24 value={l.start} onChange={(start) => setLesson(gi, li, { start })} /></label>
                  <label>Length<select value={l.minutes} onChange={(e) => setLesson(gi, li, { minutes: Number(e.target.value) })}>
                    {[...new Set([...LENGTHS, l.minutes])].sort((a, b) => a - b).map(m => <option key={m} value={m}>{m < 60 ? `${m} min` : `${m / 60} h`}</option>)}
                  </select></label>
                  <label className="tt-topic">Topic<input value={l.topic} maxLength={120} placeholder="For example: Prompt writing basics" onChange={(e) => setLesson(gi, li, { topic: e.target.value })} /></label>
                  <span className="tt-range">{range(l.start, l.minutes)}</span>
                  <button type="button" className="tt-icon" aria-label={`Remove this ${DAYS[l.weekday - 1]} lesson`} onClick={() => removeLesson(gi, li)}><Trash2 size={16} /></button>
                </div>
              ))}
              <button type="button" className="mkt-btn ghost sm tt-pill" disabled={g.lessons.length >= MAX_LESSONS} onClick={() => addLesson(gi)}><Plus size={14} /> Add lesson</button>
            </div>
          ))}
          <div className="tt-actions">
            <button type="button" className="mkt-btn ghost tt-pill" disabled={draft.length >= MAX_GROUPS} onClick={addGroup}><Plus size={16} /> Add Group {nextLabel(draft) ?? ''}</button>
            <span className="tt-spacer" />
            {dirty && <button type="button" className="mkt-btn ghost tt-pill" disabled={busy} onClick={discard}>Discard changes</button>}
            <button type="button" className="mkt-btn primary tt-pill" disabled={busy || !dirty || !!issue} onClick={save}>{busy ? 'Saving…' : 'Save timetable'}</button>
          </div>
          {dirty && issue && <div className="mkt-error">{issue}</div>}
          {error && <div className="mkt-error">{error} {/changed since you opened it/.test(error) && <button type="button" className="mkt-btn ghost sm tt-pill" onClick={() => { discard(); data.reload(); }}>Load the latest</button>}</div>}
          {saved && <p className="tt-saved" role="status">{saved}</p>}
          {chat.updated_at && <p className="mkt-hint">Last saved {when(chat.updated_at)}</p>}
        </>}
      </div>
    </section>
  );
}

const HOURS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'));
const MINUTES = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'));

// Always 24-hour (19:00), whatever language the browser uses. A plain time
// input shows 7:00 PM on many computers.
function Time24({ value, onChange }) {
  const [h = '19', m = '00'] = String(value || '').split(':');
  const minutes = MINUTES.includes(m) ? MINUTES : [...MINUTES, m].sort();
  return (
    <span className="tt-time">
      <select aria-label="Hour" value={h} onChange={(e) => onChange(`${e.target.value}:${m}`)}>
        {HOURS.map(x => <option key={x} value={x}>{x}</option>)}
      </select>
      <b aria-hidden="true">:</b>
      <select aria-label="Minutes" value={m} onChange={(e) => onChange(`${h}:${e.target.value}`)}>
        {minutes.map(x => <option key={x} value={x}>{x}</option>)}
      </select>
    </span>
  );
}
