import { Component, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import './theme.css';

document.documentElement.dataset.theme = localStorage.getItem('_uk_admin_theme') || 'dark';

// Without this, any render error unmounts the whole tree and the admin sees a
// blank page with no clue what happened.
class ErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('Admin panel crashed:', error, info?.componentStack); }
  render() {
    if (!this.state.error) return this.props.children;
    return <main className="login-shell"><section className="login-card">
      <p className="eyebrow">Something went wrong</p><h1>The admin panel hit an error</h1>
      <p className="login-copy">{String(this.state.error?.message || this.state.error)}</p>
      <button onClick={() => window.location.reload()}>Reload</button>
    </section></main>;
  }
}

createRoot(document.getElementById('root')).render(<StrictMode><ErrorBoundary><App /></ErrorBoundary></StrictMode>);
