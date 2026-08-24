import { useState } from 'react';
import { useStore } from '../store/useStore';

export default function Login() {
  const login = useStore(s => s.login);
  const loading = useStore(s => s.loading);
  const [un, setUn] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');

  async function onSubmit(e) {
    e.preventDefault();
    setErr('');
    try { await login(un.trim(), pw); }
    catch (e) { setErr(e.message || 'Login failed'); }
  }

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="login-brand">
          <h1><span className="red">MEP</span> PROJECTS</h1>
          <p>TOTAL PROJECT MANAGEMENT</p>
        </div>
        <form className="login-form" onSubmit={onSubmit}>
          <label>Username</label>
          <input value={un} onChange={e => setUn(e.target.value)} autoFocus autoComplete="username" required />
          <label>Password</label>
          <input type="password" value={pw} onChange={e => setPw(e.target.value)} autoComplete="current-password" required />
          {err && <div className="login-error">{err}</div>}
          <button className="btn" type="submit" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
