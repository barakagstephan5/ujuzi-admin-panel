import { useCallback, useEffect, useState } from 'react';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { supabase } from './supabase';

const CODE = /^\d{6}$/;
const friendly = (error, fallback) => (error?.code === 'mfa_verification_failed' || /invalid|expired/i.test(error?.message || '')
  ? 'That code did not work. Check your authenticator app and try again.' : fallback);

/** True when this session has a verified factor but has not entered a code yet. */
export async function needsCode() {
  const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  return data?.nextLevel === 'aal2' && data?.currentLevel !== 'aal2';
}

async function verifyCode(factorId, code) {
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) throw error;
}

const CodeField = ({ value, onChange }) => (
  <label>Code from your authenticator app
    <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} required autoFocus value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))} />
  </label>
);

/** The second sign-in step, shown after the password. */
export function CodeStep({ onDone, onCancel }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const { data, error: listError } = await supabase.auth.mfa.listFactors();
      if (listError) throw listError;
      const factor = data?.totp?.[0];
      if (!factor) throw new Error('no factor');
      await verifyCode(factor.id, code);
      await onDone();
    } catch (e) {
      setError(friendly(e, 'We could not check your code. Try again.'));
      setBusy(false);
    }
  };
  return <main className="login-shell"><section className="login-card">
    <div className="brand-mark"><ShieldCheck size={27} /></div>
    <p className="eyebrow">Ujuzi Kidigitali</p><h1>Enter your code</h1>
    <form onSubmit={submit}>
      <CodeField value={code} onChange={setCode} />
      {error && <div className="form-error">{error}</div>}
      <button disabled={busy || !CODE.test(code)}><KeyRound size={17} />{busy ? 'Checking…' : 'Continue'}</button>
    </form>
    <button type="button" className="link-btn" onClick={onCancel}>Use another account</button>
  </section></main>;
}

/** Set up two-step sign-in, and require it for every admin. */
export function TwoStepPanel() {
  const [status, setStatus] = useState(null);
  const [factor, setFactor] = useState(undefined);
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    const [{ data: state, error: stateError }, { data: factors }] = await Promise.all([
      supabase.rpc('admin_two_step_status'), supabase.auth.mfa.listFactors(),
    ]);
    if (stateError) { setError('We could not load this. Refresh to try again.'); return; }
    setStatus(state);
    setFactor(factors?.totp?.[0] ?? null);
  }, []);
  useEffect(() => { load(); }, [load]);

  const start = async () => {
    setBusy(true); setError('');
    const { data, error: enrollError } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Admin ${Date.now()}` });
    setBusy(false);
    if (enrollError) { setError('Two-step sign-in is not available right now. Check that TOTP is enabled in Supabase Auth settings.'); return; }
    setSetup(data); setCode('');
  };
  const confirm = async (event) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await verifyCode(setup.id, code);
      setSetup(null);
      await load();
    } catch (e) {
      setError(friendly(e, 'We could not check your code. Try again.'));
    } finally { setBusy(false); }
  };
  const setRequired = async (required) => {
    setBusy(true); setError('');
    const { data, error: saveError } = await supabase.rpc('admin_set_two_step_required', { p_required: required });
    setBusy(false);
    if (saveError) { setError(saveError.code === 'P0001' ? saveError.message : 'We could not save this. Try again.'); return; }
    setStatus(data);
  };

  if (!status || factor === undefined) return error ? <div className="form-error">{error}</div> : <div className="spinner" />;
  const everyoneReady = status.admins.every(a => a.ready);
  return <section className="card two-step">
    <div className="card-head"><h2>Two-step sign-in</h2>
      <p>A code from an authenticator app, as well as the password. It protects refunds, payouts and learner data if a password leaks.</p></div>

    {factor ? <p><ShieldCheck size={16} /> Set up on this account.</p>
      : setup ? <form onSubmit={confirm} className="two-step__setup">
        <p>Scan this with Google Authenticator or a similar app, then enter the code it shows.</p>
        <img src={setup.totp.qr_code} alt="QR code for your authenticator app" width={180} height={180} />
        <p className="muted">Or enter this key by hand: <code>{setup.totp.secret}</code></p>
        <CodeField value={code} onChange={setCode} />
        <button className="primary" disabled={busy || !CODE.test(code)}>{busy ? 'Checking…' : 'Confirm'}</button>
      </form>
      : <button className="primary" onClick={start} disabled={busy}>{busy ? 'Starting…' : 'Set up on this account'}</button>}

    <h3>Admins</h3>
    <ul className="two-step__admins">
      {status.admins.map(a => <li key={a.email}><span>{a.email}</span><strong>{a.ready ? 'Ready' : 'Not set up'}</strong></li>)}
    </ul>

    <h3>Require it for every admin</h3>
    {status.required
      ? <><p>Required. Sessions without a code have no admin access.</p><button className="primary soft" onClick={() => setRequired(false)} disabled={busy}>Stop requiring it</button></>
      : <><p className="muted">{everyoneReady && status.this_session_verified ? 'Everyone is ready.'
        : !everyoneReady ? 'Every admin must set it up first, so nobody gets locked out.' : 'Sign out and back in with your code, then turn this on.'}</p>
        <button className="primary" onClick={() => setRequired(true)} disabled={busy || !everyoneReady || !status.this_session_verified}>Require it</button></>}
    {error && <div className="form-error">{error}</div>}
  </section>;
}
