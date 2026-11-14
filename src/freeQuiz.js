// Plain helpers for the Free class quiz page (quiz.ujuzikidigitali.com), kept
// apart from the screen so they can be tested without a browser.

export const QUIZ_SITE = 'https://quiz.ujuzikidigitali.com';

/** "Siku ya 1: Utangulizi" -> "siku-ya-1-utangulizi", at most 40 characters. */
export function slugify(text) {
  return String(text || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 40).replace(/-+$/g, '');
}

export const slugOk = (slug) => /^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/.test(slug);

/** Where learners open a quiz: the bare site for the featured one, else ?q=. */
export const quizLink = (quiz) => (quiz.featured ? QUIZ_SITE : `${QUIZ_SITE}/?q=${quiz.slug}`);

// The server checks the first bytes; this only picks the declared type.
const AUDIO_BY_EXT = { m4a: 'audio/mp4', mp4: 'audio/mp4', aac: '', mp3: 'audio/mpeg', ogg: 'audio/ogg', opus: 'audio/ogg', oga: 'audio/ogg', webm: 'audio/webm', weba: 'audio/webm' };
const AUDIO_TYPES = new Set(['audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/mpeg', 'audio/mp3', 'audio/ogg', 'audio/webm']);

/** The type to send for an audio file, or '' when the site cannot play it. */
export function audioType(file) {
  const declared = String(file?.type || '').split(';')[0].trim().toLowerCase();
  if (AUDIO_TYPES.has(declared)) return declared;
  const ext = String(file?.name || '').toLowerCase().split('.').pop();
  return AUDIO_BY_EXT[ext] || '';
}

/** The best recording format this browser offers: M4A plays everywhere, WebM is the fallback. */
export function recorderType(isSupported) {
  for (const type of ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']) {
    try { if (isSupported(type)) return type; } catch { /* keep looking */ }
  }
  return '';
}

/** A blank question: three answers, the first marked right until the admin chooses. */
export const blankQuestion = () => ({
  question: '', options: ['', '', ''], correct: 0, explain_right: '', explain_wrong: '',
  audio_question: '', audio_right: '', audio_wrong: '',
});

export const blankQuiz = () => ({
  slug: '', title: '', intro: '', intro_audio: '', status: 'draft', featured: false,
  finish_kind: 'none', finish_title: '', finish_text: '', finish_audio: '',
  ebook_url: '', ebook_name: '', link_url: '', link_label: '', questions: [blankQuestion()],
});

/** What the server needs: empty trailing answers dropped, the right answer kept in place. */
export function quizForSave(quiz) {
  return {
    ...quiz,
    slug: quiz.slug.trim().toLowerCase(),
    questions: quiz.questions.map((q) => {
      const options = [...q.options];
      while (options.length > 2 && !options[options.length - 1].trim() && options.length - 1 > q.correct) options.pop();
      return { ...q, options: options.map((o) => o.trim()) };
    }),
  };
}

/** Problems worth fixing before saving, in the order they appear. */
export function quizProblems(quiz) {
  const out = [];
  if (quiz.title.trim().length < 2) out.push('Give the quiz a title.');
  if (!slugOk(quiz.slug.trim().toLowerCase())) out.push('Give it a link name of small letters, numbers and dashes, for example siku-1.');
  if (quiz.status === 'open' && !quiz.questions.length) out.push('Add at least one question before opening the quiz.');
  quizForSave(quiz).questions.forEach((q, i) => {
    if (q.question.trim().length < 2) out.push(`Question ${i + 1}: write the question.`);
    if (q.options.some((o) => !o)) out.push(`Question ${i + 1}: fill in every answer or remove the empty one.`);
  });
  if (quiz.finish_kind === 'ebook' && !quiz.ebook_url) out.push('Upload the e-book for the ending.');
  if (quiz.finish_kind === 'link' && !/^https:\/\/\S+$/.test(quiz.link_url.trim())) out.push('The ending link must start with https://');
  return out;
}

const EAT = { timeZone: 'Africa/Dar_es_Salaam', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false };
export function eatTime(iso) {
  if (!iso) return '';
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', EAT).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

/** "255712345678" -> "0712 345 678". */
export function localPhone(p) {
  const d = String(p || '');
  if (!/^255[0-9]{9}$/.test(d)) return d;
  const l = '0' + d.slice(3);
  return `${l.slice(0, 4)} ${l.slice(4, 7)} ${l.slice(7)}`;
}

/** One quiz result as a cell: "4/5", "started", or empty. */
export function resultCell(result) {
  if (!result) return '';
  if (result.finished_at && result.total != null) return `${result.score}/${result.total}`;
  return 'started';
}

const csvCell = (value) => {
  let s = String(value ?? '');
  // A cell starting with = + - @ would run as a formula in a spreadsheet.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * The contacts as CSV for the SMS company's portal: Name, Phone in 255 form,
 * when they joined (EAT), and their result in each quiz. The byte order mark
 * keeps Swahili names readable in Excel.
 */
export function contactsCsv(contacts, quizzes) {
  const header = ['Name', 'Phone', 'Joined (EAT)', ...quizzes.map((q) => q.title)];
  const rows = contacts.map((c) => [c.name, c.phone, eatTime(c.joined_at), ...quizzes.map((q) => resultCell(c.results?.[q.id]))]);
  return '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** Contacts filtered by quiz ('' = everyone) and by a search on name or number. */
export function filterContacts(contacts, quizId, search) {
  const s = String(search || '').trim().toLowerCase();
  const digits = s.replace(/[^0-9]/g, '');
  return contacts.filter((c) => {
    if (quizId && !c.results?.[quizId]) return false;
    if (!s) return true;
    if (c.name.toLowerCase().includes(s)) return true;
    if (!digits) return false;
    const local = '0' + c.phone.slice(3);
    return c.phone.includes(digits) || local.includes(digits);
  });
}
