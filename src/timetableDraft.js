// Helpers for editing a chat group's timetable in the Admin Panel. The server
// checks everything again; these give the same answers before saving.

export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const LENGTHS = [30, 45, 60, 90, 120, 150, 180, 240];
export const MAX_GROUPS = 26;
export const MAX_LESSONS = 30;

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

// The first letter not used yet: A, then B, ... A removed group frees its letter.
export function nextLabel(groups) {
  const used = new Set(groups.map(g => g.label));
  return [...LETTERS].find(l => !used.has(l)) ?? null;
}

export const newLesson = (previous) => ({
  weekday: previous?.weekday ?? 1,
  start: previous?.start ?? '19:00',
  minutes: previous?.minutes ?? 60,
  topic: '',
});

// Only what the server stores, in a stable shape, so "changed?" is a plain compare.
export function clean(groups) {
  return (groups ?? []).map(g => ({
    label: String(g.label ?? '').trim().toUpperCase(),
    lessons: (g.lessons ?? []).map(l => ({
      weekday: Number(l.weekday), start: String(l.start ?? ''), minutes: Number(l.minutes), topic: String(l.topic ?? '').trim(),
    })),
  }));
}

export const sameTimetable = (a, b) => JSON.stringify(clean(a)) === JSON.stringify(clean(b));

// The first problem in plain words, or '' when it can be saved.
export function problem(groups) {
  const list = clean(groups);
  if (list.length > MAX_GROUPS) return `A chat can have at most ${MAX_GROUPS} groups.`;
  const seen = new Set();
  for (const g of list) {
    if (!/^[A-Z0-9]{1,2}$/.test(g.label)) return 'Group names are one or two letters or numbers, like A or B2.';
    if (seen.has(g.label)) return `Group ${g.label} appears twice.`;
    seen.add(g.label);
    if (g.lessons.length > MAX_LESSONS) return `Group ${g.label} can have at most ${MAX_LESSONS} lessons.`;
    for (const l of g.lessons) {
      if (!(l.weekday >= 1 && l.weekday <= 7)) return `Choose a day for every lesson in group ${g.label}.`;
      if (!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(l.start)) return `Give every lesson in group ${g.label} a start time.`;
      if (!(l.minutes >= 15 && l.minutes <= 480)) return `Lessons in group ${g.label} last 15 to 480 minutes.`;
      if (l.topic.length < 2 || l.topic.length > 120) return `Give every lesson in group ${g.label} a topic.`;
    }
  }
  return '';
}

// "19:00 to 20:30" for a start and a length in minutes.
export function range(start, minutes) {
  const [h, m] = String(start).split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return '';
  const end = (h * 60 + m + Number(minutes)) % 1440;
  const pad = (n) => String(n).padStart(2, '0');
  return `${start} to ${pad(Math.floor(end / 60))}:${pad(end % 60)}`;
}
