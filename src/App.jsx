import { useEffect, useState } from 'react';
import { LockKeyhole, ShieldCheck } from 'lucide-react';
import { hasSupabaseConfig, supabase } from './supabase';
import AdminPage from './AdminPage';

function Login({ onReady }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event) => {
    event.preventDefault(); setBusy(true); setError('');
    const { data, error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (signInError) { setError(signInError.message); setBusy(false); return; }
    const { data: allowed, error: adminError } = await supabase.rpc('is_admin');
    if (adminError || allowed !== true) {
      await supabase.auth.signOut(); setError('This account is not an administrator.'); setBusy(false); return;
    }
    onReady(data.session);
  };

  return <main className="login-shell"><section className="login-card">
    <div className="brand-mark"><ShieldCheck size={27} /></div>
    <p className="eyebrow">Ujuzi Kidigitali</p><h1>Admin control centre</h1>
    <p className="login-copy">Sign in with an account listed in the protected administrators table.</p>
    <form onSubmit={submit}>
      <label>Email<input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      <label>Password<input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
      {error && <div className="form-error">{error}</div>}
      <button disabled={busy}><LockKeyhole size={17} />{busy ? 'Checking…' : 'Secure sign in'}</button>
    </form>
  </section></main>;
}

export default function App() {
  const [state, setState] = useState({ loading: true, session: null });
  useEffect(() => {
    let active = true;
    if (!hasSupabaseConfig) { setState({ loading: false, session: null }); return () => { active = false; }; }
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      if (!data.session) { setState({ loading: false, session: null }); return; }
      const { data: allowed } = await supabase.rpc('is_admin');
      if (!active) return;
      if (allowed === true) setState({ loading: false, session: data.session });
      else { await supabase.auth.signOut(); setState({ loading: false, session: null }); }
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_, session) => {
      if (!session && active) setState({ loading: false, session: null });
    });
    return () => { active = false; listener.subscription.unsubscribe(); };
  }, []);
  if (!hasSupabaseConfig) return <main className="login-shell"><section className="login-card">
    <div className="brand-mark"><ShieldCheck size={27} /></div>
    <p className="eyebrow">Configuration needed</p><h1>Connect Supabase</h1>
    <p className="login-copy">Create <code>.env.local</code> in the Admin Panel folder and set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>, then restart the development server.</p>
  </section></main>;
  if (state.loading) return <main className="splash"><div className="spinner" />Checking secure session…</main>;
  if (!state.session) return <Login onReady={(session) => setState({ loading: false, session })} />;
  return <AdminPage onSignOut={async () => { await supabase.auth.signOut(); setState({ loading: false, session: null }); }} />;
}
