// Timetable editing in the Admin Panel: next group letter, tidy saving shape,
// and the same plain reasons the server gives.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clean, newLesson, nextLabel, problem, range, sameTimetable } from '../src/timetableDraft.js';

const lesson = (patch = {}) => ({ weekday: 1, start: '19:00', minutes: 60, topic: 'Intro to AI', ...patch });

test('the next group takes the first free letter', () => {
  assert.equal(nextLabel([]), 'A');
  assert.equal(nextLabel([{ label: 'A' }, { label: 'B' }]), 'C');
  assert.equal(nextLabel([{ label: 'A' }, { label: 'C' }]), 'B', 'a removed group frees its letter');
  assert.equal(nextLabel([...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map(label => ({ label }))), null);
});

test('a new lesson copies the day, time and length of the one before', () => {
  assert.deepEqual(newLesson(), { weekday: 1, start: '19:00', minutes: 60, topic: '' });
  assert.deepEqual(newLesson(lesson({ weekday: 3, start: '18:30', minutes: 90 })), { weekday: 3, start: '18:30', minutes: 90, topic: '' });
});

test('only real changes count as changes', () => {
  const saved = [{ label: 'A', lessons: [lesson()] }];
  assert.ok(sameTimetable([{ label: 'a ', lessons: [lesson({ topic: ' Intro to AI ', weekday: '1' })] }], saved));
  assert.ok(!sameTimetable([{ label: 'A', lessons: [lesson({ start: '19:30' })] }], saved));
  assert.deepEqual(clean([{ label: 'b', extra: 1, lessons: [{ ...lesson(), id: 9 }] }]), [{ label: 'B', lessons: [lesson()] }]);
});

test('problems are found before saving, in plain words', () => {
  assert.equal(problem([{ label: 'A', lessons: [lesson()] }]), '');
  assert.match(problem([{ label: 'A', lessons: [] }, { label: 'a', lessons: [] }]), /Group A appears twice/);
  assert.match(problem([{ label: 'A', lessons: [lesson({ topic: ' ' })] }]), /a topic/);
  assert.match(problem([{ label: 'A', lessons: [lesson({ start: '' })] }]), /a start time/);
  assert.match(problem([{ label: 'A', lessons: [lesson({ minutes: 5 })] }]), /15 to 480/);
  assert.match(problem([{ label: 'Group A', lessons: [] }]), /one or two letters/);
});

test('a lesson reads as a time range, across midnight too', () => {
  assert.equal(range('19:00', 90), '19:00 to 20:30');
  assert.equal(range('23:30', 60), '23:30 to 00:30');
  assert.equal(range('', 60), '');
});
