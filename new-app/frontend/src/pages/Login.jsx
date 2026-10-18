import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import { ANDROID_APK_URL, IOS_APP_URL } from '../config';
import { appDownloadOptions } from '../utils/appLinks';

const APPS = appDownloadOptions({ androidApkUrl: ANDROID_APK_URL, iosAppUrl: IOS_APP_URL });

// Generic icons only — deliberately not the Android or Apple brand marks;
// official icon files can replace them once supplied.
function MobileIcon() {
  return (
    <svg className="app-card-icon" viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" focusable="false">
      <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M10.5 18.5h3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}
function TabletIcon() {
  return (
    <svg className="app-card-icon" viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" focusable="false">
      <rect x="3.5" y="2.5" width="17" height="19" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="12" cy="18.3" r="1" fill="currentColor" />
    </svg>
  );
}
function DownloadIcon() {
  return (
    <svg className="app-download-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
      <path d="M12 4v11m-4.5-4.5L12 15l4.5-4.5M5 19.5h14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);

  const from = location.state?.from?.pathname || '/';

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      // PWA parity (owner-approved): username + password only; usernames are
      // unique across the platform, so no company field is needed.
      await login({ username, password });
      navigate(from, { replace: true });
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Login failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-screen">
      <div className="login-stack">
      <form className="login-card" onSubmit={handleSubmit}>
        <img className="login-logo" src="/icons/icon-192.png" alt="" width="76" height="76" />
        <h1 className="login-wordmark">MEP <span>PROJECTS</span></h1>
        <p className="login-subtitle">Total project management</p>

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

        <button type="submit" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>

        {import.meta.env.DEV && (
        <details className="login-help">
          <summary>Dev seed accounts (password: password123)</summary>
          <ul>
            <li>admin, sales, amol (hvac_pm), akshay (solar_pm), ajinkya (mep_pm)</li>
            <li>vinod (engineer), store (inventory), service (service_mgr), israr (service_eng), finance</li>
            <li>Sam (super)</li>
          </ul>
        </details>
        )}
      </form>

      <section className="app-download" aria-labelledby="app-download-title">
        <h2 id="app-download-title">Download the MEP Projects App</h2>
        <div className="app-download-grid">
          <div className="app-card">
            <MobileIcon />
            <span className="app-card-label">Android</span>
            {APPS.android.available ? (
              <a className="app-card-btn app-card-btn-android" href={APPS.android.url} download rel="noopener">
                <DownloadIcon /> Download APK
              </a>
            ) : (
              <button type="button" className="app-card-btn app-card-btn-android" disabled>
                <DownloadIcon /> Download APK
              </button>
            )}
          </div>
          <div className="app-card">
            <TabletIcon />
            <span className="app-card-label">iPhone / iPad</span>
            {APPS.ios.available ? (
              <a className="app-card-btn app-card-btn-ios" href={APPS.ios.url} target="_blank" rel="noopener noreferrer">
                <DownloadIcon /> Download iOS
              </a>
            ) : (
              <button type="button" className="app-card-btn app-card-btn-ios" disabled>
                <DownloadIcon /> Download iOS
              </button>
            )}
          </div>
        </div>
        <p className="app-download-note">Preview only — download buttons must connect to verified app packages before release.</p>
      </section>
      </div>
    </div>
  );
}
