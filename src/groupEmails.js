// Helpers for Group access: reading a pasted list of emails, and describing
// what happened to each one. Kept apart from the screen so they can be tested.

export const MAX_GROUP_EMAILS = 500;

const EMAIL_IN_TEXT = /[^\s<>,;:"'()[\]]+@[^\s<>,;:"'()[\]]+/g;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Accepts one per line, commas, semicolons or spaces, and "Name <email>" as
// copied from Gmail or a spreadsheet. A line with no email in it is reported,
// never silently dropped, so a typo like "john.gmail.com" is noticed.
export function parseEmails(text) {
  const emails = [];
  const seen = new Set();
  const invalid = [];
  let repeated = 0;
  for (const entry of String(text ?? '').split(/[\n\r,;]+/)) {
    const line = entry.trim();
    if (!line) continue;
    const found = line.match(EMAIL_IN_TEXT);
    if (!found) { invalid.push(line); continue; }
    for (const raw of found) {
      const email = raw.replace(/[.]+$/, '').toLowerCase();
      if (!EMAIL.test(email) || email.length > 254) { invalid.push(raw); continue; }
      if (seen.has(email)) { repeated += 1; continue; }
      seen.add(email);
      emails.push(email);
    }
  }
  return { emails, invalid, repeated };
}

// kind: "done" was applied now, "covered" already had as much or more, and
// "action" still needs the admin. Shown in this order.
export const OUTCOMES = {
  granted: { kind: 'done', label: 'Access given' },
  extended: { kind: 'done', label: 'Already had this package: days added after their current end date' },
  upgraded: { kind: 'done', label: 'Moved up from Business to Premium' },
  lifetime: { kind: 'covered', label: 'Already has lifetime access' },
  has_higher: { kind: 'covered', label: 'Already has Premium' },
  not_registered: { kind: 'action', label: 'Not registered in the app', help: 'Ask them to sign up with this email, then add them again.' },
  not_verified: { kind: 'action', label: 'Signed up but has not confirmed their email', help: 'Ask them to open the confirmation email, then add them again.' },
  invalid: { kind: 'action', label: 'Not a valid email address', help: 'Check the spelling.' },
  other_package: { kind: 'action', label: 'Has a different package right now', help: 'Use Manual payment access for each of them, which asks before ending their current package.' },
  payment_in_progress: { kind: 'action', label: 'Has a payment in progress', help: 'Check it in Manual payment access, then add them again.' },
};

// Results grouped by outcome, in the order above, each with its emails. An
// outcome this screen does not know yet is shown as needing the admin.
export function groupResults(results) {
  const groups = new Map(Object.keys(OUTCOMES).map(key => [key, []]));
  for (const r of results ?? []) {
    if (!groups.has(r.outcome)) groups.set(r.outcome, []);
    groups.get(r.outcome).push(r.email);
  }
  return [...groups].filter(([, emails]) => emails.length)
    .map(([outcome, emails]) => ({ outcome, emails, ...(OUTCOMES[outcome] ?? { kind: 'action', label: outcome }) }));
}
