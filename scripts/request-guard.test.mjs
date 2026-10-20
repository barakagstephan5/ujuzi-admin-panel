// Reproduces the re-audit's R6 race against the guard the Access panel uses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequestGuard, sameEmail } from '../src/requestGuard.js';

test('a slow lookup cannot reattach a learner after the email changed', async () => {
  const guard = createRequestGuard();
  let shown;
  let release;
  const lookup = async (address) => {
    const isCurrent = guard.begin();
    const user = await new Promise(resolve => { release = resolve; });
    if (isCurrent()) shown = user;
  };
  const inFlight = lookup('first@example.test');
  guard.cancel(); // the admin edits the email field
  release({ email: 'first@example.test' });
  await inFlight;
  assert.equal(shown, undefined);
});

test('only the newest of overlapping lookups is applied', async () => {
  const guard = createRequestGuard();
  const shown = [];
  const resolvers = [];
  const lookup = async () => {
    const isCurrent = guard.begin();
    const user = await new Promise(resolve => resolvers.push(resolve));
    if (isCurrent()) shown.push(user);
  };
  const first = lookup(), second = lookup();
  resolvers[1]('second'); resolvers[0]('first');
  await Promise.all([first, second]);
  assert.deepEqual(shown, ['second']);
});

test('email identity ignores case and surrounding spaces only', () => {
  assert.equal(sameEmail(' Learner@Example.test ', 'learner@example.test'), true);
  assert.equal(sameEmail('first@example.test', 'second@example.test'), false);
});
