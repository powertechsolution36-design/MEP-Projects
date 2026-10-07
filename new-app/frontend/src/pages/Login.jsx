import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [companyId, setCompanyId] = useState('company_demo');
  const [isSuper, setIsSuper] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);

  const from = location.state?.from?.pathname || '/';

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      await login({ username, password, companyId: isSuper ? null : companyId });
      navigate(from, { replace: true });
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Login failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1>MEP Powertech</h1>
        <p className="login-subtitle">New App — Dev Sign In</p>

        {formError && <div className="alert alert-error">{formError}</div>}

        <label className="field">
          <span>Username</span>
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
        </label>

        <label className="field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>

        <label className="field checkbox-field">
          <input type="checkbox" checked={isSuper} onChange={(e) => setIsSuper(e.target.checked)} />
          <span>Platform (Super Admin) login — no company</span>
        </label>

        {!isSuper && (
          <label className="field">
            <span>Company ID</span>
            <input value={companyId} onChange={(e) => setCompanyId(e.target.value)} required />
          </label>
        )}

        <button type="submit" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>

        <details className="login-help">
          <summary>Dev seed accounts (password: password123)</summary>
          <ul>
            <li>admin / company_demo</li>
            <li>sales / company_demo</li>
            <li>amol (hvac_pm) / company_demo</li>
            <li>akshay (solar_pm) / company_demo</li>
            <li>ajinkya (mep_pm) / company_demo</li>
            <li>vinod (engineer) / company_demo</li>
            <li>store (inventory) / company_demo</li>
            <li>service (service_mgr) / company_demo</li>
            <li>israr (service_eng) / company_demo</li>
            <li>finance (finance) / company_demo</li>
            <li>Sam (super) — check "Platform" above</li>
          </ul>
        </details>
      </form>
    </div>
  );
}
