// Free class quiz page helpers: link names, file types, saving, and the CSV
// the owner uploads to the SMS company's portal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  audioType, blankQuiz, contactsCsv, eatTime, filterContacts, localPhone, quizForSave, quizLink, quizProblems,
  recorderType, resultCell, slugify, slugOk,
} from '../src/freeQuiz.js';

test('link names come from the title and follow the server rule', () => {
  assert.equal(slugify('Siku ya 1: Utangulizi'), 'siku-ya-1-utangulizi');
  assert.equal(slugify('  Darasa la Bure!! '), 'darasa-la-bure');
  assert.equal(slugify('Kozi ya Ujuzi wa Kidijitali kwa Vijana wa Tanzania leo'), 'kozi-ya-ujuzi-wa-kidijitali-kwa-vijana-w', 'cut at 40 characters');
  assert.ok(slugOk('siku-1'));
  assert.ok(!slugOk('Siku 1'));
  assert.ok(!slugOk('-siku'));
  assert.equal(quizLink({ slug: 'siku-2', featured: false }), 'https://quiz.ujuzikidigitali.com/?q=siku-2');
  assert.equal(quizLink({ slug: 'siku-1', featured: true }), 'https://quiz.ujuzikidigitali.com');
});

test('audio files get a type the server accepts, or none', () => {
  assert.equal(audioType({ name: 'swali1.m4a', type: '' }), 'audio/mp4');
  assert.equal(audioType({ name: 'swali1.M4A', type: 'audio/x-m4a' }), 'audio/x-m4a');
  assert.equal(audioType({ name: 'a.mp3', type: 'audio/mpeg' }), 'audio/mpeg');
  assert.equal(audioType({ name: 'whatsapp.opus', type: '' }), 'audio/ogg');
  assert.equal(audioType({ name: 'a.wav', type: 'audio/wav' }), '');
  assert.equal(audioType({ name: 'a.aac', type: 'audio/aac' }), '');
  assert.equal(recorderType((t) => t.startsWith('audio/webm')), 'audio/webm;codecs=opus');
  assert.equal(recorderType((t) => t === 'audio/mp4'), 'audio/mp4');
  assert.equal(recorderType(() => false), '');
});

test('saving drops empty extra answers but never moves the right one', () => {
  const quiz = { ...blankQuiz(), title: 'Siku 1', slug: 'Siku-1 ' };
  quiz.questions = [
    { ...quiz.questions[0], question: 'Swali?', options: ['A', 'B', ''], correct: 1 },
    { ...quiz.questions[0], question: 'Swali 2?', options: ['A', '', ''], correct: 2 },
  ];
  const saved = quizForSave(quiz);
  assert.equal(saved.slug, 'siku-1');
  assert.deepEqual(saved.questions[0].options, ['A', 'B']);
  assert.deepEqual(saved.questions[1].options, ['A', '', ''], 'the right answer is the empty third one, so it stays');
  assert.deepEqual(quizProblems(quiz), ['Question 2: fill in every answer or remove the empty one.']);
  assert.deepEqual(quizProblems({ ...blankQuiz(), status: 'open', questions: [], finish_kind: 'link', link_url: 'http://x' }), [
    'Give the quiz a title.',
    'Give it a link name of small letters, numbers and dashes, for example siku-1.',
    'Add at least one question before opening the quiz.',
    'The ending link must start with https://',
  ]);
});

const quizzes = [{ id: 'q1', title: 'Siku 1' }, { id: 'q2', title: 'Siku 2, "kesho"' }];
const contacts = [
  { name: 'Neema Juma', phone: '255712345678', joined_at: '2026-11-16T07:05:00Z', results: { q1: { score: 4, total: 5, finished_at: '2026-11-16T07:20:00Z' }, q2: { score: null, total: null, finished_at: null } } },
  { name: '=HYPERLINK("x")', phone: '255765000111', joined_at: '2026-11-16T07:06:00Z', results: {} },
];

test('the CSV has names, 255 numbers, East Africa time and each quiz result', () => {
  const csv = contactsCsv(contacts, quizzes);
  assert.ok(csv.startsWith('﻿'));
  const lines = csv.slice(1).trimEnd().split('\r\n');
  assert.deepEqual(lines, [
    'Name,Phone,Joined (EAT),Siku 1,"Siku 2, ""kesho"""',
    'Neema Juma,255712345678,2026-11-16 10:05,4/5,started',
    `"'=HYPERLINK(""x"")",255765000111,2026-11-16 10:06,,`,
  ]);
  assert.equal(eatTime('2026-11-16T22:30:00Z'), '2026-11-17 01:30');
  assert.equal(resultCell(undefined), '');
  assert.equal(localPhone('255712345678'), '0712 345 678');
});

test('contacts filter by quiz and by name or number, written either way', () => {
  assert.deepEqual(filterContacts(contacts, 'q1', '').map((c) => c.phone), ['255712345678']);
  assert.equal(filterContacts(contacts, '', 'neema').length, 1);
  assert.equal(filterContacts(contacts, '', '0712 345').length, 1);
  assert.equal(filterContacts(contacts, '', '255765').length, 1);
  assert.equal(filterContacts(contacts, '', '').length, 2);
});
