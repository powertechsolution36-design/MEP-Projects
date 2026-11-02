import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import { ANDROID_APK_URL, IOS_APP_URL } from '../config';
import { appDownloadOptions } from '../utils/appLinks';
import {
  isInstalled, isApple, watchInstall, showInstallPrompt,
  attachAppChrome, registerWorker,
} from '../pwa/installable';

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
function ShareIcon() {
  return (
    <svg className="app-download-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
      <path d="M12 16V4m0 0L8 8m4-4 4 4M5 14v5.5h14V14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Putting MEP PROJECTS on a phone (owner request, 2 Nov 2026).
 *
 * This block used to offer "Download APK" above the words "The Android app
 * is available to install". No APK has ever been built, the setting that
 * would point at one has never been filled in, and the button was therefore
 * disabled — while the sentence under it said the opposite. Somebody tapped
 * it, nothing happened, and the page had told them it would.
 *
 * It installs the application itself now, which works today on Android and
 * on iPhone and needs nothing built, signed or hosted. The APK button is
 * kept for the day a native app exists: it appears only when a URL for one
 * is actually configured, and the note says what is true either way.
 */
function GetTheApp() {
  const [installEvent, setInstallEvent] = useState(null);
  const [installed, setInstalled] = useState(() => isInstalled());
  const [busy, setBusy] = useState(false);
  const apple = isApple();

  useEffect(() => watchInstall({
    onPrompt: (e) => setInstallEvent(e),
    onInstalled: () => { setInstalled(true); setInstallEvent(null); },
  }), []);

  // The manifest and the worker are what make the browser offer to install
  // at all. Mounted from the login page, so a client who only ever opens
  // /portal never registers the staff worker.
  useEffect(() => {
    const detach = attachAppChrome({
      manifestUrl: '/staff-app/manifest.json',
      appleIcon: '/staff-app/apple-touch-180.png',
      appleTitle: 'MEP PROJECTS',
      themeColor: '#d92b2b',
    });
    registerWorker('/mep-staff-sw.js', '/');
    return detach;
  }, []);

  async function install() {
    if (!installEvent) return;
    setBusy(true);
    try {
      if (await showInstallPrompt(installEvent)) setInstalled(true);
      setInstallEvent(null);
    } finally { setBusy(false); }
  }

  return (
    <section className="app-download" aria-labelledby="app-download-title">
      <h2 id="app-download-title">Put MEP PROJECTS on your phone</h2>

      {installed ? (
        <p className="app-download-note">
          The app is on this device&rsquo;s home screen. Open it from there next time.
        </p>
      ) : installEvent ? (
        <>
          <button type="button" className="app-card-btn app-card-btn-android" onClick={install} disabled={busy}>
            <DownloadIcon /> Install the app
          </button>
          <p className="app-download-note">
            It gets its own icon and opens full screen, and still opens where the signal is poor.
          </p>
        </>
      ) : apple ? (
        <>
          <ol className="app-install-steps">
            <li>Tap <strong>Share</strong> <ShareIcon /> at the bottom of Safari.</li>
            <li>Scroll down and tap <strong>Add to Home Screen</strong>.</li>
            <li>Tap <strong>Add</strong>.</li>
          </ol>
          <p className="app-download-note">It then opens full screen, with its own icon.</p>
        </>
      ) : (
        <p className="app-download-note">
          On a phone, open this page in Chrome or Safari and use <strong>Add to Home Screen</strong>
          {' '}to install MEP PROJECTS. It then opens full screen, with its own icon.
        </p>
      )}

      {/* Only when a native package genuinely exists. */}
      {(APPS.android.available || APPS.ios.available) && (
        <div className="app-download-grid">
          {APPS.android.available && (
            <div className="app-card">
              <MobileIcon />
              <span className="app-card-label">Android</span>
              <a className="app-card-btn app-card-btn-android" href={APPS.android.url} download rel="noopener">
                <DownloadIcon /> Download APK
              </a>
            </div>
          )}
          {APPS.ios.available && (
            <div className="app-card">
              <TabletIcon />
              <span className="app-card-label">iPhone / iPad</span>
              <a className="app-card-btn app-card-btn-ios" href={APPS.ios.url} target="_blank" rel="noopener noreferrer">
                <DownloadIcon /> Download iOS
              </a>
            </div>
          )}
        </div>
      )}
    </section>
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

      <GetTheApp />
      </div>
    </div>
  );
}
