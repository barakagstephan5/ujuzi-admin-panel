import { useRef, useState } from 'react';
import { adminCall } from './adminApi';

// A gap between batches keeps half the provider's rate limit free for live checkouts.
const PAUSE_MS = 12_000;
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const EMPTY = { checked: 0, closed: 0, possibly_paid: 0, still_pending: 0, unavailable: 0, left: null };

/**
 * Old payments parked for review were never checked with Snippe. This checks them
 * in the background of this page. Stop any time: it carries on where it left off.
 */
export default function OldPaymentCheck({ onFinished }) {
  const [totals, setTotals] = useState(EMPTY);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const stop = useRef(false);

  const start = async () => {
    stop.current = false; setRunning(true); setError(''); setTotals(EMPTY);
    try {
      while (!stop.current) {
        const batch = await adminCall('admin-general', { action: 'payment_sweep_old' });
        setTotals(sum => ({
          checked: sum.checked + batch.checked, closed: sum.closed + batch.closed, possibly_paid: sum.possibly_paid + batch.possibly_paid,
          still_pending: sum.still_pending + batch.still_pending, unavailable: sum.unavailable + batch.unavailable, left: batch.left,
        }));
        if (!batch.left || !batch.checked) break;
        await wait(PAUSE_MS);
      }
    } catch (e) {
      setError(e.message);
    }
    setRunning(false);
    onFinished?.();
  };

  const started = totals.left !== null;
  return <div className="old-payment-check">
    <div>
      <strong>Check old payments with Snippe</strong>
      <small>Closes payments that failed or expired. Anything paid stays here for you to decide, and nothing is granted automatically.</small>
      {started && <small>
        Checked {totals.checked}: {totals.closed} closed, {totals.possibly_paid} may have been paid, {totals.still_pending} still pending
        {totals.unavailable ? `, ${totals.unavailable} could not be checked` : ''}. {totals.left} left.
      </small>}
      {error && <small className="old-payment-check__error">{error}</small>}
    </div>
    {running
      ? <button type="button" className="primary soft" onClick={() => { stop.current = true; }}>Stop</button>
      : <button type="button" className="primary soft" onClick={start}>{started ? 'Check more' : 'Start checking'}</button>}
  </div>;
}
