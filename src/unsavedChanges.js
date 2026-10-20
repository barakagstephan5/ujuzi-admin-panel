// Panels register a "has unsaved changes" check. Switching tabs, opening another
// record or closing the page asks before discarding them. Financial
// confirmations are never restored automatically.
const checks = new Set();

export function registerUnsaved(check) {
  checks.add(check);
  return () => { checks.delete(check); };
}

export function hasUnsavedChanges() {
  for (const check of checks) {
    try { if (check()) return true; } catch { /* a broken check never blocks navigation */ }
  }
  return false;
}

export function confirmDiscard(message = 'You have unsaved changes. Discard them?') {
  return !hasUnsavedChanges() || window.confirm(message);
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (event) => {
    if (!hasUnsavedChanges()) return;
    event.preventDefault();
    event.returnValue = '';
  });
}
