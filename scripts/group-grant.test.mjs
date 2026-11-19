// Group access: reading pasted email lists and grouping the results.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupResults, parseEmails } from '../src/groupEmails.js';

test('one per line, commas, semicolons, spaces and "Name <email>" all work', () => {
  const text = `Amina@Gmail.com
baraka@gmail.com, chausiku@yahoo.com; dotto@gmail.com
Esther Mushi <esther@gmail.com>
fatma@gmail.com  gift@gmail.com
amina@gmail.com
hamisi@gmail.com.`;
  const { emails, invalid, repeated } = parseEmails(text);
  assert.deepEqual(emails, ['amina@gmail.com', 'baraka@gmail.com', 'chausiku@yahoo.com', 'dotto@gmail.com',
    'esther@gmail.com', 'fatma@gmail.com', 'gift@gmail.com', 'hamisi@gmail.com']);
  assert.deepEqual(invalid, []);
  assert.equal(repeated, 1, 'case does not make a second person');
});

test('lines with no email are reported, not dropped silently', () => {
  const { emails, invalid } = parseEmails('john.gmail.com\nmary@gmail\n\n  \nok@test.co');
  assert.deepEqual(emails, ['ok@test.co']);
  assert.deepEqual(invalid, ['john.gmail.com', 'mary@gmail']);
});

test('empty input gives nothing', () => {
  assert.deepEqual(parseEmails(''), { emails: [], invalid: [], repeated: 0 });
  assert.deepEqual(parseEmails(undefined), { emails: [], invalid: [], repeated: 0 });
});

test('results are grouped: applied, already covered, then each reason needing action', () => {
  const groups = groupResults([
    { email: 'a@x.co', outcome: 'not_registered' },
    { email: 'b@x.co', outcome: 'granted' },
    { email: 'c@x.co', outcome: 'not_registered' },
    { email: 'd@x.co', outcome: 'extended' },
    { email: 'e@x.co', outcome: 'something_new' },
    { email: 'f@x.co', outcome: 'lifetime' },
  ]);
  assert.deepEqual(groups.map(g => [g.outcome, g.emails, g.kind]), [
    ['granted', ['b@x.co'], 'done'],
    ['extended', ['d@x.co'], 'done'],
    ['lifetime', ['f@x.co'], 'covered'],
    ['not_registered', ['a@x.co', 'c@x.co'], 'action'],
    ['something_new', ['e@x.co'], 'action'],
  ]);
  assert.equal(groups[3].label, 'Not registered in the app');
  assert.equal(groups[4].label, 'something_new', 'an unknown outcome still shows, as needing action');
});
