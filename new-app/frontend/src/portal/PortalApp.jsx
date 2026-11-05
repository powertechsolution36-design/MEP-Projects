import { useState, useEffect, useCallback, useRef, useId, createContext, useContext } from 'react';
import { Routes, Route, Navigate, useNavigate, useParams, useLocation, Link } from 'react-router-dom';
import { portalApi, setPortalToken, getPortalToken, fetchAttachmentUrl } from './portalApi';
import { ANDROID_APK_URL, IOS_APP_URL } from '../config';
import { appDownloadOptions } from '../utils/appLinks';
import {
  attachPortalAppChrome, registerPortalServiceWorker, isInstalled, isApple,
  pushSupported, notificationPermission, currentPushSubscription, enablePush, disablePush,
} from './pwa';

/**
 * The customer portal (owner decision, 27 Oct 2026).
 *
 * A separate little application under /portal, with its own session, its own
 * header and no staff navigation. It is mounted outside the staff
 * ProtectedRoute, so nothing here can reach a staff screen and the staff
 * login page is untouched.
 *
 * Everything shown comes from /api/portal, which answers only for the one
 * AMC / Warranty client the session is bound to.
 *
 * WHO READS THIS: an AMC or Warranty client, often on a phone, often not a
 * confident computer user. So: plain words, one obvious action per screen,
 * no staff vocabulary, and nothing on the page that the client cannot act
 * on. Every figure shown is one the server actually holds — nothing here
 * computes a statistic to fill space.
 *
 * It borrows the application's design tokens (tokens.css) and its .btn and
 * .status-badge components, so it reads as the same product, but its layout
 * is its own: wider type, taller controls, one column on a phone.
 */

const PortalAuthContext = createContext(null);
const usePortal = () => useContext(PortalAuthContext);

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Dates a client reads, not dates a clerk reads: "5 Nov 2026", never
 * "2026-11-05". The staff screens keep the ISO form (utils/format.fmtDate);
 * this is deliberately separate so changing one never changes the other.
 */
function fmtLong(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return String(value);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * A phone number as a client reads it, and a tel: link that works from a
 * phone. A number stored with the country code keeps it; a plain ten-digit
 * number is dialled as an Indian number. Anything else is shown as stored
 * rather than reformatted into something that might not dial.
 */
function localDigits(value) {
  const d = String(value || '').replace(/\D/g, '');
  if (/^91\d{10}$/.test(d)) return d.slice(2);
  if (/^0\d{10}$/.test(d)) return d.slice(1);
  return d;
}

/** Shown the way the owner writes it: the ten digits, nothing else. */
function fmtPhone(value) {
  return localDigits(value);
}

/**
 * Dialled as a full international number. A phone rejects a number that
 * carries a country code without the +, which is what went wrong on
 * 31 Oct 2026, so the + is always put back here rather than hoped for in
 * the stored value.
 */
function telHref(value) {
  const d = localDigits(value);
  if (!d) return '';
  return `tel:${d.length === 10 ? `+91${d}` : d}`;
}

/**
 * Owner decision (31 Oct 2026): a client who has just registered a complaint
 * is told how long it will be before somebody comes, and given a number to
 * ring if it cannot wait.
 */
const RESPONSE_HOURS = 48;

const STATUS_CLASS = {
  Registered: 'status-pending',
  Assigned: 'status-open',
  Scheduled: 'status-open',
  Completed: 'status-won',
};

/** What each status means to the client, in their words rather than ours. */
const STATUS_HELP = {
  Registered: 'We have your complaint. An engineer will be assigned shortly.',
  Assigned: 'An engineer has been assigned to your complaint.',
  Scheduled: 'A visit has been arranged.',
  Completed: 'The visit is finished.',
};

/* ---- Icons -------------------------------------------------------
   Drawn inline rather than pulled from an icon font, so the portal makes
   no extra request and every icon inherits the colour around it. They are
   decorative: the control beside them always carries the words. */
const icon = (d, extra) => (
  <svg className="portal-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d={d} />
    {extra}
  </svg>
);
const IconBack = () => icon('M15 18l-6-6 6-6');
const IconPlus = () => icon('M12 5v14M5 12h14');
const IconCamera = () => icon('M4 8h3l1.5-2h7L17 8h3v11H4z', <circle cx="12" cy="13" r="3.2" />);
const IconShield = () => icon('M12 3l7 3v5.5c0 4.3-3 7.6-7 9-4-1.4-7-4.7-7-9V6z');
const IconCheck = () => icon('M4.5 12.5l5 5 10-11');
const IconUser = () => icon('M4.5 20a7.5 7.5 0 0 1 15 0', <circle cx="12" cy="7.5" r="3.8" />);
const IconClock = () => icon('M12 7v5.2l3.2 2', <circle cx="12" cy="12" r="9" />);
const IconSite = () => icon('M3 20h18M6 20V9l6-4 6 4v11M10 20v-5h4v5');
const IconPhone = () => icon('M7 2.5h10v19H7z', <path d="M10.5 18.6h3" />);
const IconBell = () => icon('M18 16V11a6 6 0 1 0-12 0v5l-1.6 2.4h15.2zM10 21h4');
const IconShare = () => icon('M12 16V4m0 0L8 8m4-4 4 4M5 14v5.5h14V14');
const IconDownload = () => icon('M12 4v11m-4.5-4.5L12 15l4.5-4.5M5 19.5h14');
const IconList = () => icon('M8 7h12M8 12h12M8 17h12M4 7h.01M4 12h.01M4 17h.01');

/* ------------------------------------------------------------------ *
 * Shell
 * ------------------------------------------------------------------ */

function PortalShell({ children, profile, onLogout, narrow }) {
  return (
    <div className="portal">
      <a className="portal-skip" href="#portal-content">Skip to content</a>
      <header className="portal-head">
        <div className="portal-head-id">
          <span className="portal-brand">{profile?.company?.name || 'Service portal'}</span>
          {/* The client's own name on the contract, or — for a project client
              with no contract — the name they registered with. */}
          {profile?.client?.customer || profile?.account?.name
            ? <span className="portal-sub">{profile.client?.customer || profile.account.name}</span>
            : <span className="portal-sub">AMC &amp; Warranty clients</span>}
        </div>
        {onLogout && (
          <button className="btn sec portal-btn" type="button" onClick={onLogout}>Sign out</button>
        )}
      </header>

      <main id="portal-content" className={`portal-main${narrow ? ' portal-main-narrow' : ''}`}>
        {children}
      </main>

      <footer className="portal-foot">
        {profile?.company?.serviceNumber || profile?.company?.whatsappNumber
          ? (() => {
            const num = profile.company.serviceNumber || profile.company.whatsappNumber;
            return <>Need help? Call or message us on <a href={telHref(num)}>{fmtPhone(num)}</a>.</>;
          })()
          : <>Your service portal for complaints and visit history.</>}
      </footer>
    </div>
  );
}

/** One form field: label, optional hint, optional inline error. */
function Field({ label, optional, hint, error, children }) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  return (
    <label className={`portal-field${error ? ' is-invalid' : ''}`}>
      <span className="portal-label">
        {label}
        {optional && <span className="portal-optional">Optional</span>}
      </span>
      {children({ 'aria-describedby': [hintId, errId].filter(Boolean).join(' ') || undefined, 'aria-invalid': error ? 'true' : undefined })}
      {hint && <span className="portal-hint" id={hintId}>{hint}</span>}
      {error && <span className="portal-err" id={errId}>{error}</span>}
    </label>
  );
}

/** A short message at the top of a card: something went wrong, or went right. */
function Notice({ kind = 'bad', children }) {
  return (
    <div className={`portal-notice portal-notice-${kind}`} role={kind === 'bad' ? 'alert' : 'status'}>
      <span className="portal-notice-icon">{kind === 'bad' ? icon('M12 8v5M12 16.2v.1', <circle cx="12" cy="12" r="9" />) : <IconCheck />}</span>
      <span>{children}</span>
    </div>
  );
}

/** Grey bars while something loads, so the page keeps its shape. */
function Skeleton({ rows = 3 }) {
  return (
    <div className="portal-skeleton" role="status" aria-live="polite">
      <span className="portal-sr">Loading…</span>
      {Array.from({ length: rows }).map((_, i) => <span key={i} className="portal-skel-bar" />)}
    </div>
  );
}

function Empty({ icon: Ico, title, children }) {
  return (
    <div className="portal-empty">
      <span className="portal-empty-icon"><Ico /></span>
      <p className="portal-empty-title">{title}</p>
      {children && <p className="portal-empty-text">{children}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Signed out
 * ------------------------------------------------------------------ */

function PortalLogin() {
  const { signIn } = usePortal();
  const navigate = useNavigate();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try {
      await signIn(phone.trim(), password);
      navigate('/portal', { replace: true });
    } catch (err) {
      setError(err.message || 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <PortalShell narrow>
      <form className="portal-card portal-auth" onSubmit={submit} noValidate={false}>
        <h1>Sign in</h1>
        <p className="portal-lede">Raise a complaint and follow it through to the visit.</p>

        {error && <Notice>{error}</Notice>}

        <Field label="Mobile number" hint="The number on your service contract.">
          {(a) => (
            <input {...a} className="portal-input" inputMode="tel" autoComplete="tel"
              value={phone} onChange={(e) => setPhone(e.target.value)} required />
          )}
        </Field>

        <Field label="Password">
          {(a) => (
            <span className="portal-input-wrap">
              <input {...a} className="portal-input" type={show ? 'text' : 'password'} autoComplete="current-password"
                value={password} onChange={(e) => setPassword(e.target.value)} required />
              <button className="portal-reveal" type="button" aria-pressed={show}
                onClick={() => setShow((s) => !s)}>{show ? 'Hide' : 'Show'}</button>
            </span>
          )}
        </Field>

        <button className="btn pri portal-btn portal-btn-block" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="portal-aside">
          New here? <Link to="/portal/register">Register for an account</Link>
        </p>
        <PortalAppLinks />
      </form>
    </PortalShell>
  );
}


/**
 * The mobile app, where one has been published (owner decision, 31 Oct
 * 2026). The URLs come from configuration, exactly as the staff login page
 * takes them; nothing is shown when they are not set, so an unverified
 * package is never offered.
 */
function PortalAppLinks() {
  const apps = appDownloadOptions({ androidApkUrl: ANDROID_APK_URL, iosAppUrl: IOS_APP_URL });
  if (!apps.android.available && !apps.ios.available) return null;
  return (
    <p className="portal-aside">
      Or get the app:{' '}
      {apps.android.available && <a href={apps.android.url}>Android</a>}
      {apps.android.available && apps.ios.available && ' · '}
      {apps.ios.available && <a href={apps.ios.url}>iPhone</a>}
    </p>
  );
}

function PortalRegister() {
  const [form, setForm] = useState({ name: '', phone: '', site: '', email: '', password: '' });
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  /*
   * A link we sent (owner decision, 31 Oct 2026).
   *
   * `?invite=…` tells the server which client is registering, so the mobile
   * number no longer has to match the one on the contract — a new phone, a
   * colleague's, the office line all work. It does not sign anybody in: the
   * account still waits for staff to approve it.
   *
   * An unusable link (spent, switched off, mistyped) is not an error here.
   * The page simply behaves as it does without one, and the number is
   * matched the ordinary way.
   */
  const location = useLocation();
  const inviteToken = new URLSearchParams(location.search).get('invite') || '';
  const [invite, setInvite] = useState(null);

  useEffect(() => {
    if (!inviteToken) return undefined;
    let alive = true;
    portalApi.get(`/api/portal/invites/${encodeURIComponent(inviteToken)}`)
      .then((d) => { if (alive) setInvite(d); })
      .catch(() => { if (alive) setInvite({ usable: false }); });
    return () => { alive = false; };
  }, [inviteToken]);

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try {
      await portalApi.post('/api/portal/auth/register', {
        ...form, name: form.name.trim(), phone: form.phone.trim(), email: form.email.trim(),
        invite: inviteToken || undefined,
      });
      setDone(true);
    } catch (err) {
      setError(err.message || 'Could not register.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <PortalShell narrow>
        <div className="portal-card portal-auth portal-done">
          <span className="portal-done-mark"><IconCheck /></span>
          <h1>Thank you</h1>
          <p>
            Our team will check your details against your service contract and switch your
            account on. You will be able to sign in once they have.
          </p>
          <Link className="btn sec portal-btn portal-btn-block" to="/portal/login">Back to sign in</Link>
        </div>
      </PortalShell>
    );
  }

  return (
    <PortalShell narrow>
      <form className="portal-card portal-auth" onSubmit={submit}>
        <h1>Register</h1>
        {invite && invite.usable ? (
          <p className="portal-lede">
            Registering{invite.customerName ? <> as <strong>{invite.customerName}</strong></> : ''}
            {invite.site ? <> ({invite.site})</> : ''}. Any mobile number you can be reached on is fine.
          </p>
        ) : (
          <p className="portal-lede">
            Use the mobile number on your service contract so we can find your record.
          </p>
        )}

        {error && <Notice>{error}</Notice>}

        <Field label="Your name">
          {(a) => <input {...a} className="portal-input" autoComplete="name" value={form.name}
            onChange={(e) => set('name', e.target.value)} required minLength={2} />}
        </Field>

        <Field label="Mobile number" hint={invite && invite.usable ? 'Any number we can reach you on.' : 'The number on your service contract.'}>
          {(a) => <input {...a} className="portal-input" inputMode="tel" autoComplete="tel" value={form.phone}
            onChange={(e) => set('phone', e.target.value)} required />}
        </Field>

        <Field label="Site" optional hint="Where the equipment is, if you have more than one.">
          {(a) => <input {...a} className="portal-input" value={form.site}
            onChange={(e) => set('site', e.target.value)} />}
        </Field>

        <Field label="Email" optional>
          {(a) => <input {...a} className="portal-input" type="email" autoComplete="email" value={form.email}
            onChange={(e) => set('email', e.target.value)} />}
        </Field>

        <Field label="Choose a password" hint="At least 8 characters.">
          {(a) => <input {...a} className="portal-input" type="password" autoComplete="new-password"
            minLength={8} value={form.password} onChange={(e) => set('password', e.target.value)} required />}
        </Field>

        <button className="btn pri portal-btn portal-btn-block" type="submit" disabled={busy}>
          {busy ? 'Sending…' : 'Register'}
        </button>

        <p className="portal-aside">
          Already registered? <Link to="/portal/login">Sign in</Link>
        </p>
      </form>
    </PortalShell>
  );
}

/* ------------------------------------------------------------------ *
 * Dashboard
 * ------------------------------------------------------------------ */

function ComplaintRow({ c }) {
  return (
    <Link className="portal-row" to={`/portal/complaints/${c.id}`}>
      <span className="portal-row-main">
        <span className="portal-row-title">PSC-{c.complaintNumber}</span>
        <span className="portal-row-meta">Raised {fmtLong(c.registeredDate)}</span>
        {c.complaintDescription && <span className="portal-row-desc">{c.complaintDescription}</span>}
      </span>
      <span className="portal-row-side">
        <span className={`status-badge ${STATUS_CLASS[c.status] || 'status-pending'}`}>{c.status}</span>
        {c.status === 'Completed'
          ? <span className="portal-row-meta">Service report</span>
          : c.engineerName && <span className="portal-row-meta">{c.engineerName}</span>}
      </span>
      <span className="portal-row-chevron" aria-hidden="true">{icon('M9 6l6 6-6 6')}</span>
    </Link>
  );
}


/* ------------------------------------------------------------------ *
 * Projects — "what stage is my project at" (owner decision, 30 Oct 2026)
 *
 * The client sees their own HVAC, Solar or MEP work: the stage it has
 * reached, when the earlier stages were reached, and whatever the project
 * manager has chosen to tell them. Which projects these are is decided by
 * staff and sent by the server; this screen asks for nothing and can show
 * nothing else.
 *
 * "Live" here is honest about what it is: the page asks again every half
 * minute while the client is looking at it. There is no socket in this
 * application, and pretending otherwise would be a lie in the interface.
 * ------------------------------------------------------------------ */


/**
 * A photograph of the work. The bytes sit behind the client's own session,
 * so this cannot be a plain <img src>: fetched with the token and handed to
 * the browser as a blob URL, revoked when the thumbnail goes away.
 */
function PortalPhoto({ src, alt, onOpen }) {
  const [url, setUrl] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    let made = '';
    (async () => {
      try {
        const token = getPortalToken();
        const res = await fetch(src, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
        if (!res.ok) throw new Error(String(res.status));
        made = URL.createObjectURL(await res.blob());
        if (alive) setUrl(made); else URL.revokeObjectURL(made);
      } catch { if (alive) setFailed(true); }
    })();
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
  }, [src]);

  if (failed) return null;
  return (
    <button type="button" className="portal-photo" onClick={onOpen} aria-label={alt || 'Open the photograph'}>
      {url ? <img src={url} alt={alt || ''} /> : <span className="portal-photo-wait" aria-hidden="true" />}
    </button>
  );
}

const POLL_MS = 30000;

/**
 * Fetch, then keep fetching while the tab is in front. Polling stops when
 * the client switches away — a phone left on this screen in a pocket should
 * not spend its battery or their data.
 */
function useLive(path, pick) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [at, setAt] = useState(null);
  const pickRef = useRef(pick);
  pickRef.current = pick;

  useEffect(() => {
    let alive = true;
    let timer = null;

    const stop = () => { if (timer) { clearTimeout(timer); timer = null; } };

    const tick = async (first) => {
      if (!alive) return;
      try {
        const d = await portalApi.get(path);
        if (!alive) return;
        setData(pickRef.current(d));
        setAt(new Date());
        setError('');
      } catch (e) {
        if (!alive) return;
        // A later poll failing must not blank a page that is already
        // showing good data — say so quietly instead.
        setError(e.message);
        if (first) setData(null);
      }
      if (alive && !document.hidden) timer = setTimeout(() => tick(false), POLL_MS);
    };

    const onVisible = () => {
      if (document.hidden) stop();
      else if (!timer) tick(false);
    };

    tick(true);
    document.addEventListener('visibilitychange', onVisible);
    return () => { alive = false; stop(); document.removeEventListener('visibilitychange', onVisible); };
  }, [path]);

  return { data, error, at };
}

/** "just now", "4 minutes ago" — when the figures on screen were read. */
function sinceText(at) {
  if (!at) return '';
  const mins = Math.floor((Date.now() - at.getTime()) / 60000);
  if (mins < 1) return 'Updated just now';
  if (mins === 1) return 'Updated a minute ago';
  return `Updated ${mins} minutes ago`;
}

function Meter({ percent, label, finished = false }) {
  return (
    <div className={`portal-meter${finished ? ' is-done' : ''}`} role="img" aria-label={label}>
      <span className="portal-meter-fill" style={{ width: `${Math.max(2, percent)}%` }} />
    </div>
  );
}

function ProjectRow({ p }) {
  return (
    <Link className="portal-row" to={`/portal/projects/${p.id}`}>
      <span className="portal-row-main">
        <span className="portal-row-title">{p.name}</span>
        <span className="portal-row-meta">
          {p.division}{p.capacity ? ` · ${p.capacity}` : ''}
        </span>
        <Meter percent={p.progressPercent} label={`${p.progressPercent}% complete`} finished={p.finished} />
        {/* `finished` is the server's answer, not the raw status: the last
            stage of a division's list IS "Completed", and a site standing on
            it used to read "In progress · Now at: Completed". */}
        <span className="portal-row-meta">
          {p.finished ? 'Finished' : `Now at: ${p.stage}`} · {p.progressPercent}%
        </span>
      </span>
      <span className="portal-row-side">
        <span className={`status-badge ${p.finished ? 'status-won' : 'status-pending'}`}>
          {p.finished ? 'Completed' : 'In progress'}
        </span>
        {p.lastUpdateAt && <span className="portal-row-meta">Latest {fmtLong(p.lastUpdateAt)}</span>}
      </span>
      <span className="portal-row-chevron" aria-hidden="true">{icon('M9 6l6 6-6 6')}</span>
    </Link>
  );
}

/** The division's stages, with the dates somebody actually recorded. */
function StageTrail({ stages, finished = false }) {
  return (
    <ol className="portal-steps">
      {stages.map((st) => {
        // Once the work is finished nothing is still "happening now" — the
        // last stage carried a clock and the words "Happening now" on a site
        // that was done (owner report, 2 Nov 2026).
        const done = finished ? st.reached : st.reached && !st.current;
        return (
          <li
            key={st.stage}
            className={`portal-step${st.reached ? ' is-done' : ''}${st.current && !finished ? ' is-current' : ''}`}
          >
            <span className="portal-step-mark" aria-hidden="true">
              {/* A stage still in hand is NOT finished, so it must not carry
                  a tick — a client reading quickly would take it for done. */}
              {done ? <IconCheck /> : <IconClock />}
            </span>
            <span className="portal-step-body">
              <span className="portal-step-label">{st.stage}</span>
              <span className="portal-step-when">
                {st.at ? fmtLong(st.at) : done ? 'Done' : st.current ? 'Happening now' : 'Not yet'}
              </span>
            </span>
            <span className="portal-sr">{done ? 'Done' : 'Not done yet'}</span>
          </li>
        );
      })}
    </ol>
  );
}

function PortalProjectDetail() {
  const { profile, signOut } = usePortal();
  const { id } = useParams();
  const { data: p, error, at } = useLive(`/api/portal/projects/${id}`, (d) => d.project);
  const [viewing, setViewing] = useState(null);

  return (
    <PortalShell profile={profile} onLogout={signOut} narrow>
      <Link className="portal-back" to="/portal"><IconBack />Back</Link>

      {error && !p && <div className="portal-card"><Notice>{error}</Notice></div>}
      {!p && !error && <div className="portal-card"><Skeleton rows={4} /></div>}

      {p && (
        <div className="portal-stack">
          <section className="portal-card" aria-labelledby="portal-proj-h">
            <span className="portal-cover-mark" aria-hidden="true"><IconSite /></span>
            <h1 id="portal-proj-h">{p.name}</h1>
            <p className="portal-row-meta">
              {p.division}{p.siteType ? ` · ${p.siteType}` : ''}{p.capacity ? ` · ${p.capacity}` : ''}
            </p>

            <Meter percent={p.progressPercent} label={`${p.progressPercent}% complete`} finished={p.finished} />
            <p className="portal-meter-note">
              <strong>{p.finished ? 'Work completed' : `${p.progressPercent}% complete`}</strong>
              {p.finished
                ? <> — finished{p.completedDate ? ` on ${fmtLong(p.completedDate)}` : ''}.</>
                : <> — currently at <strong>{p.stage}</strong>.</>}
            </p>

            <dl className="portal-facts">
              <div>
                <dt>Started</dt>
                <dd>{p.startDate ? fmtLong(p.startDate) : 'Not recorded'}</dd>
              </div>
              <div>
                <dt>Stage</dt>
                <dd>{p.stage || 'Not recorded'}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{p.finished ? 'Completed' : 'In progress'}</dd>
              </div>
            </dl>
            {at && <p className="portal-cta-note">{sinceText(at)}</p>}
          </section>

          <section className="portal-card" aria-labelledby="portal-trail-h">
            <h2 id="portal-trail-h" className="portal-card-h">Progress</h2>
            <StageTrail stages={p.stages || []} finished={p.finished} />
          </section>

          <section className="portal-card" aria-labelledby="portal-upd-h">
            <h2 id="portal-upd-h" className="portal-card-h">
              Updates from your project manager <span className="portal-count">{(p.updates || []).length}</span>
            </h2>
            {(p.updates || []).length === 0
              ? <Empty icon={IconClock} title="No updates yet">
                  When your project manager posts an update about this site, it will appear here.
                </Empty>
              : <ol className="portal-feed">
                  {p.updates.map((u, i) => (
                    <li key={`${u.date}-${i}`} className="portal-feed-item">
                      <span className="portal-feed-when">{u.date ? fmtLong(u.date) : ''}</span>
                      <span className="portal-feed-note">{u.note}</span>
                      {(u.photos || []).length > 0 && (
                        <span className="portal-photos">
                          {u.photos.map((ph) => (
                            <span key={ph.id} className="portal-photo-wrap">
                              <PortalPhoto
                                src={`/api/portal/projects/${p.id}/photos/${ph.id}`}
                                alt={ph.caption || 'Photograph of the work'}
                                onOpen={() => setViewing({ id: ph.id, caption: ph.caption })}
                              />
                              {ph.caption && <span className="portal-photo-cap">{ph.caption}</span>}
                            </span>
                          ))}
                        </span>
                      )}
                    </li>
                  ))}
                </ol>}
          </section>
        </div>
      )}

      {viewing && (
        <div className="portal-lightbox" role="dialog" aria-modal="true"
          aria-label={viewing.caption || 'Photograph of the work'}
          onClick={() => setViewing(null)}>
          <PortalPhoto src={`/api/portal/projects/${id}/photos/${viewing.id}`} alt={viewing.caption || ''} />
          {viewing.caption && <p className="portal-lightbox-cap">{viewing.caption}</p>}
          <button type="button" className="btn sec portal-btn" onClick={() => setViewing(null)}>Close</button>
        </div>
      )}
    </PortalShell>
  );
}

/**
 * The customer app (owner decision, 31 Oct 2026).
 *
 * The portal IS the app: added to the home screen it opens full screen, with
 * its own icon, and keeps working on a bad signal. This card is the only
 * place that says so, and it says it differently on each platform because
 * installing genuinely is different on each:
 *
 *   · Android / desktop Chrome — the browser offers it; we ask on its behalf.
 *   · iPhone / iPad — Safari has no such offer, so the client is told the
 *     three taps, in Apple's own words ("Share", "Add to Home Screen").
 *   · already installed — nothing to say about installing; the switch for
 *     notifications is what is left.
 *
 * Nothing here is shown when the browser cannot do it. A card offering
 * something that will not work is worse than no card.
 */
/**
 * Cover that has run out (owner request, 31 Oct 2026).
 *
 * A client whose AMC or warranty has ended cannot raise a complaint. They are
 * told why and given the number to ring, rather than a button that fails when
 * they press it. The server refuses it too — this is the courtesy, not the
 * rule.
 */
function CoverEnded({ endDate, number }) {
  return (
    <section className="portal-card portal-ended" aria-labelledby="portal-ended-h">
      <h2 id="portal-ended-h" className="portal-card-h">Your contract has ended</h2>
      <p className="portal-lede">
        {endDate
          ? <>Your cover ran until {fmtLong(endDate)}, so a complaint cannot be raised here.</>
          : <>Your cover has ended, so a complaint cannot be raised here.</>}
        {' '}Call us to renew it and we will take care of the rest.
      </p>
      {number && (
        <p className="portal-promise-call">
          Help: <a className="portal-promise-num" href={telHref(number)}>{fmtPhone(number)}</a>
        </p>
      )}
      <p className="portal-aside">Your past visits and service reports stay here either way.</p>
    </section>
  );
}

function PortalAppCard({ hasCover = true }) {
  const [installEvent, setInstallEvent] = useState(null);
  const [installed, setInstalled] = useState(() => isInstalled());
  const [pushState, setPushState] = useState('loading'); // loading|off|on|denied|unavailable
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    const onPrompt = (e) => { e.preventDefault(); setInstallEvent(e); };
    const onInstalled = () => { setInstalled(true); setInstallEvent(null); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  // What the browser and the server between them actually allow today.
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!pushSupported()) { if (alive) setPushState('unavailable'); return; }
      const key = await portalApi.get('/api/portal/push/key').catch(() => null);
      if (!alive) return;
      if (!key || !key.enabled) { setPushState('unavailable'); return; }
      if (notificationPermission() === 'denied') { setPushState('denied'); return; }
      const sub = await currentPushSubscription();
      if (alive) setPushState(sub ? 'on' : 'off');
    })();
    return () => { alive = false; };
  }, []);

  async function install() {
    if (!installEvent) return;
    setBusy(true);
    try {
      installEvent.prompt();
      const choice = await installEvent.userChoice;
      if (choice && choice.outcome === 'accepted') setInstalled(true);
      setInstallEvent(null);
    } finally { setBusy(false); }
  }

  async function toggleNotifications() {
    setBusy(true); setNote('');
    try {
      if (pushState === 'on') {
        await disablePush();
        setPushState('off');
        return;
      }
      const res = await enablePush();
      if (res.ok) { setPushState('on'); return; }
      if (res.reason === 'denied') {
        setPushState('denied');
      } else if (res.reason === 'unsupported' || res.reason === 'not-configured') {
        setPushState('unavailable');
      } else {
        setNote('Not switched on. You can try again whenever you like.');
      }
    } catch {
      setNote('That did not work. Please try again.');
    } finally { setBusy(false); }
  }

  const canOfferInstall = Boolean(installEvent) && !installed;
  const appleSteps = !installed && isApple();
  const showPush = pushState !== 'unavailable';
  if (!canOfferInstall && !appleSteps && !showPush) return null;

  return (
    <section className="portal-card portal-app" aria-labelledby="portal-app-h">
      <h2 id="portal-app-h" className="portal-card-h"><IconPhone />The app on your phone</h2>

      {canOfferInstall && (
        <>
          <p className="portal-lede">
            Add this to your home screen and it opens like any other app — full screen,
            with its own icon, and it still opens where the signal is poor.
          </p>
          <button className="btn pri portal-btn portal-btn-block" type="button" onClick={install} disabled={busy}>
            Install the app
          </button>
        </>
      )}

      {appleSteps && !canOfferInstall && (
        <div className="portal-steps-plain">
          <p className="portal-lede">To keep this on your home screen, three taps in Safari:</p>
          <ol className="portal-list">
            <li>Tap <strong>Share</strong> <span className="portal-inline-icon" aria-hidden="true"><IconShare /></span> at the bottom of the screen.</li>
            <li>Scroll down and tap <strong>Add to Home Screen</strong>.</li>
            <li>Tap <strong>Add</strong>.</li>
          </ol>
        </div>
      )}

      {installed && !showPush && (
        <p className="portal-lede">The app is on your home screen. Open it from there next time.</p>
      )}

      {showPush && (
        <div className="portal-app-row">
          <span className="portal-app-row-icon" aria-hidden="true"><IconBell /></span>
          <span className="portal-app-row-body">
            {/* A client with no cover never gets a complaint notification, so
                they are not promised one. */}
            <span className="portal-app-row-title">
              {hasCover ? 'Tell me when my complaint moves' : 'Tell me when my project moves'}
            </span>
            <span className="portal-app-row-sub">
              {pushState === 'denied'
                ? 'Notifications are blocked for this site in your phone’s settings. Allow them there and come back.'
                : hasCover
                  ? 'An engineer assigned, a visit arranged, the service report ready.'
                  : 'An update or a photograph published on your project.'}
            </span>
          </span>
          {pushState !== 'denied' && (
            <button
              className={`btn ${pushState === 'on' ? 'sec' : 'pri'} portal-btn`}
              type="button"
              onClick={toggleNotifications}
              disabled={busy || pushState === 'loading'}
              aria-pressed={pushState === 'on'}
            >
              {pushState === 'on' ? 'On' : 'Turn on'}
            </button>
          )}
        </div>
      )}

      {note && <p className="portal-aside">{note}</p>}
    </section>
  );
}

function PortalDashboard() {
  const { profile, signOut } = usePortal();
  const [complaints, setComplaints] = useState(null);
  const [error, setError] = useState('');
  // Owner decision (30 Oct 2026). Kept apart from the complaints request:
  // a client with no linked project still gets their service history, and a
  // client with projects still gets them if the complaints call fails.
  const { data: projects } = useLive('/api/portal/projects', (d) => d.projects || []);

  useEffect(() => {
    let alive = true;
    portalApi.get('/api/portal/complaints')
      .then((d) => { if (alive) setComplaints(d.complaints || []); })
      .catch((e) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, []);

  const client = profile?.client || {};
  const open = (complaints || []).filter((c) => c.status !== 'Completed');
  const done = (complaints || []).filter((c) => c.status === 'Completed');

  return (
    <PortalShell profile={profile} onLogout={signOut}>
      <div className="portal-grid">
        {/* One column on a phone, the left-hand column on a wide screen:
            the cover card and the app card belong together. */}
        <div className="portal-side">
        {/* Owner request (31 Oct 2026): a client may be here only to follow
            their project, with no AMC or warranty at all. They are told what
            their login is for rather than shown an empty service card and a
            button that would be refused. */}
        {!profile?.client ? (
          <section className="portal-card portal-cover" aria-labelledby="portal-cover-h">
            <span className="portal-cover-mark" aria-hidden="true"><IconSite /></span>
            <h2 id="portal-cover-h">Your project</h2>
            <p className="portal-lede">
              This login follows your project. You will see how far along it is and the
              updates and photographs we publish.
            </p>
            <p className="portal-cta-note">
              For a service complaint, or to ask about an AMC, please call us
              {profile?.company?.serviceNumber || profile?.company?.whatsappNumber
                ? <> on <a href={telHref(profile.company.serviceNumber || profile.company.whatsappNumber)}>
                  {fmtPhone(profile.company.serviceNumber || profile.company.whatsappNumber)}</a></>
                : null}.
            </p>
          </section>
        ) : (
        <section className="portal-card portal-cover" aria-labelledby="portal-cover-h">
          <span className="portal-cover-mark" aria-hidden="true"><IconShield /></span>
          <h2 id="portal-cover-h">Your service</h2>

          <dl className="portal-facts">
            <div>
              <dt>Site</dt>
              <dd>{client.site || 'Not recorded'}</dd>
            </div>
            <div>
              <dt>Cover</dt>
              <dd>{client.category || 'Not recorded'}{client.amcType ? ` · ${client.amcType}` : ''}</dd>
            </div>
            <div>
              <dt>Covered until</dt>
              <dd>{client.endDate ? fmtLong(client.endDate) : 'Not recorded'}</dd>
            </div>
          </dl>

          {client.canRaiseComplaint === false
            ? (
              <p className="portal-cta-note">
                This cover has ended. See below for how to renew it.
              </p>
            )
            : (
              <>
                <Link className="btn pri portal-btn portal-btn-block portal-cta" to="/portal/complaints/new">
                  <IconPlus />Raise a complaint
                </Link>
                <p className="portal-cta-note">
                  Tell us what is wrong and attach a photograph. We will assign an engineer.
                </p>
              </>
            )}
        </section>

        )}

        {profile?.client && client.canRaiseComplaint === false && (
          <CoverEnded
            endDate={client.endDate}
            number={profile?.company?.serviceNumber || profile?.company?.whatsappNumber}
          />
        )}

        <PortalAppCard hasCover={Boolean(profile?.client)} />
        </div>

        <div className="portal-stack">
          {error && <div className="portal-card"><Notice>{error}</Notice></div>}
          {complaints === null && !error && <div className="portal-card"><Skeleton rows={3} /></div>}

          {projects && projects.length > 0 && (
            <section className="portal-card" aria-labelledby="portal-proj-h">
              <h2 id="portal-proj-h" className="portal-card-h">
                Your projects <span className="portal-count">{projects.length}</span>
              </h2>
              <div className="portal-rows">{projects.map((p) => <ProjectRow key={p.id} p={p} />)}</div>
            </section>
          )}

          {/* A client with no cover has no service history and never will
              while that is true: the two lists are not shown empty at them. */}
          {complaints && profile?.client && (
            <>
              <section className="portal-card" aria-labelledby="portal-open-h">
                <h2 id="portal-open-h" className="portal-card-h">
                  In progress <span className="portal-count">{open.length}</span>
                </h2>
                {open.length === 0
                  ? <Empty icon={IconCheck} title="Nothing open at the moment">
                      When you raise a complaint it will appear here until the visit is finished.
                    </Empty>
                  : <div className="portal-rows">{open.map((c) => <ComplaintRow key={c.id} c={c} />)}</div>}
              </section>

              <section className="portal-card" aria-labelledby="portal-done-h">
                <h2 id="portal-done-h" className="portal-card-h">
                  Past visits <span className="portal-count">{done.length}</span>
                </h2>
                {done.length === 0
                  ? <Empty icon={IconClock} title="No completed visits yet">
                      Finished visits stay here so you can look back at what was done.
                    </Empty>
                  : <div className="portal-rows">{done.map((c) => <ComplaintRow key={c.id} c={c} />)}</div>}
              </section>
            </>
          )}
        </div>
      </div>
    </PortalShell>
  );
}

/* ------------------------------------------------------------------ *
 * Raising a complaint
 * ------------------------------------------------------------------ */

const MAX_IMAGES = 5;
const MAX_BYTES = 3 * 1024 * 1024;
const ACCEPT = 'image/jpeg,image/png,image/webp';

function PortalComplaintNew() {
  const { profile, signOut } = usePortal();
  const navigate = useNavigate();
  const fileRef = useRef(null);
  const [description, setDescription] = useState('');
  const [descError, setDescError] = useState('');
  const [images, setImages] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function addFiles(e) {
    setError('');
    const files = Array.from(e.target.files || []);
    if (images.length + files.length > MAX_IMAGES) {
      setError(`You can attach at most ${MAX_IMAGES} photographs.`);
      e.target.value = '';
      return;
    }
    files.forEach((file) => {
      if (file.size > MAX_BYTES) {
        setError(`“${file.name}” is larger than 3 MB. Please choose a smaller photograph.`);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => setImages((prev) => (
        prev.length >= MAX_IMAGES ? prev : [...prev, { name: file.name, dataUrl: reader.result }]
      ));
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  }

  async function submit(e) {
    e.preventDefault();
    if (busy) return;                      // a second tap cannot send it twice
    const text = description.trim();
    if (text.length < 3) {
      setDescError('Please tell us what the problem is.');
      return;
    }
    setDescError('');
    setBusy(true); setError('');
    try {
      const d = await portalApi.post('/api/portal/complaints', {
        complaintDescription: text,
        images: images.map((i) => i.dataUrl),
      });
      navigate(`/portal/complaints/${d.complaint.id}`, { replace: true, state: { justRaised: true } });
    } catch (err) {
      // Whatever went wrong on the server, the client sees a sentence, never
      // an error code or a stack.
      setError(err.message || 'Could not send your complaint. Please try again.');
      setBusy(false);
    }
  }

  // Reached by its own URL, or still open when the cover lapsed: the form is
  // not drawn at all rather than shown and then refused.
  if (profile?.client?.canRaiseComplaint === false) {
    return (
      <PortalShell profile={profile} onLogout={signOut} narrow>
        <Link className="portal-back" to="/portal"><IconBack />Back</Link>
        <CoverEnded
          endDate={profile?.client?.endDate}
          number={profile?.company?.serviceNumber || profile?.company?.whatsappNumber}
        />
      </PortalShell>
    );
  }

  return (
    <PortalShell profile={profile} onLogout={signOut} narrow>
      <Link className="portal-back" to="/portal"><IconBack />Back</Link>

      <form className="portal-card" onSubmit={submit}>
        <h1>Raise a complaint</h1>
        <p className="portal-lede">
          For {profile?.client?.site || 'your site'}. We will come back to you with an engineer
          and a visit date.
        </p>

        {error && <Notice>{error}</Notice>}

        <Field
          label="What is the problem?"
          hint="A sentence or two is plenty — for example, “the indoor unit in the hall is leaking water”."
          error={descError}
        >
          {(a) => (
            <textarea {...a} className="portal-input portal-textarea" rows={5} value={description}
              maxLength={4000}
              onChange={(e) => { setDescription(e.target.value); if (descError) setDescError(''); }} />
          )}
        </Field>

        <div className="portal-field">
          <span className="portal-label">
            Photographs<span className="portal-optional">Optional</span>
          </span>
          <span className="portal-hint" id="portal-upload-hint">
            JPG, PNG or WebP · up to 3 MB each · up to {MAX_IMAGES} photographs
          </span>

          <button
            className="portal-drop" type="button"
            aria-describedby="portal-upload-hint"
            disabled={images.length >= MAX_IMAGES}
            onClick={() => fileRef.current && fileRef.current.click()}
          >
            <span className="portal-drop-icon"><IconCamera /></span>
            <span className="portal-drop-text">
              {images.length >= MAX_IMAGES
                ? `All ${MAX_IMAGES} photographs added`
                : images.length === 0 ? 'Add a photograph' : 'Add another photograph'}
            </span>
            <span className="portal-drop-note">{images.length} of {MAX_IMAGES} added</span>
          </button>

          {/* The real control. Kept in the page (not display:none) so it still
              works with the keyboard and with automated checks; the styled
              button above is what people see. */}
          <input ref={fileRef} className="portal-file" type="file" accept={ACCEPT} multiple
            tabIndex={-1} aria-hidden="true" onChange={addFiles} />
        </div>

        {images.length > 0 && (
          <ul className="portal-thumbs">
            {images.map((img, i) => (
              <li key={i} className="portal-thumb">
                <img src={img.dataUrl} alt={`Photograph ${i + 1}: ${img.name}`} />
                <button type="button" className="portal-thumb-x"
                  onClick={() => setImages((p) => p.filter((_, n) => n !== i))}>
                  <span className="portal-sr">Remove photograph {i + 1}</span>
                  <span aria-hidden="true">{icon('M6 6l12 12M18 6L6 18')}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="portal-actions">
          <button className="btn pri portal-btn" type="submit" disabled={busy}>
            {busy ? 'Sending…' : 'Send complaint'}
          </button>
          <Link className="btn sec portal-btn" to="/portal">Cancel</Link>
        </div>
      </form>
    </PortalShell>
  );
}

/* ------------------------------------------------------------------ *
 * One complaint
 * ------------------------------------------------------------------ */

function AttachmentImage({ id, index }) {
  const [url, setUrl] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    let made = '';
    fetchAttachmentUrl(id)
      .then((u) => { if (alive) { made = u; setUrl(u); } })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
  }, [id]);

  if (failed) return <li className="portal-thumb portal-thumb-failed" aria-label="This photograph could not be loaded" />;
  if (!url) return <li className="portal-thumb portal-thumb-loading" aria-hidden="true" />;
  return (
    <li className="portal-thumb">
      <a href={url} target="_blank" rel="noopener noreferrer" aria-label={`Open photograph ${index + 1} at full size`}>
        <img src={url} alt={`Photograph ${index + 1} you attached`} />
      </a>
    </li>
  );
}

/**
 * Where the complaint has got to. Every step is read from a field the
 * server actually holds — an engineer's name, an appointment date, the
 * status itself. Nothing is inferred, and a step that has not happened
 * says so rather than showing an invented date.
 */
function Progress({ c }) {
  const steps = [
    { key: 'registered', label: 'Complaint received', done: true, when: fmtLong(c.registeredDate), Ico: IconCheck },
    {
      key: 'assigned', label: 'Engineer assigned', done: Boolean(c.engineerName),
      when: c.engineerName || 'Not yet', Ico: IconUser,
    },
    {
      key: 'scheduled', label: 'Visit arranged', done: Boolean(c.appointmentDate),
      when: c.appointmentDate
        ? `${fmtLong(c.appointmentDate)}${c.appointmentTime ? ` at ${c.appointmentTime}` : ''}`
        : 'To be arranged',
      Ico: IconClock,
    },
    { key: 'done', label: 'Work completed', done: c.status === 'Completed', when: c.status === 'Completed' ? 'Finished' : 'Not yet', Ico: IconCheck },
  ];
  return (
    <ol className="portal-steps">
      {steps.map((s) => (
        <li key={s.key} className={`portal-step${s.done ? ' is-done' : ''}`}>
          <span className="portal-step-mark" aria-hidden="true"><s.Ico /></span>
          <span className="portal-step-body">
            <span className="portal-step-label">{s.label}</span>
            <span className="portal-step-when">{s.when}</span>
          </span>
          <span className="portal-sr">{s.done ? 'Done' : 'Not done yet'}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * What a client is promised while the complaint is still open, and the
 * number to ring if it cannot wait that long. Shown at the foot of every
 * complaint that is not yet finished — the moment it is registered most of
 * all, which is the screen the client lands on from the form.
 */
function ResponsePromise({ number }) {
  return (
    <section className="portal-card portal-promise" aria-labelledby="portal-promise-h">
      <h2 id="portal-promise-h" className="portal-card-h">What happens next</h2>
      <p className="portal-promise-lead">
        Your call will be attended within {RESPONSE_HOURS} hours.
      </p>
      {number && (
        <p className="portal-promise-call">
          Help: <a className="portal-promise-num" href={telHref(number)}>{fmtPhone(number)}</a>
        </p>
      )}
    </section>
  );
}

/**
 * A finished visit, shown to the client as the service report rather than as
 * a progress trail — owner decision, 31 Oct 2026. Once the work is done the
 * stages have nothing left to tell anybody; what the client wants on the
 * screen is what was wrong, who came, what was done and what was used.
 *
 * Owner's pick of four designs (5 Nov 2026): "one page to keep" — the report
 * is drawn as a receipt. One sheet, the company at the top, the particulars
 * down the middle, the closing line at the foot above a torn edge. It reads
 * the same on the screen as it does on paper, which is the point: a client
 * keeps it, prints it, or sends it on without anything being lost.
 *
 * Every line is omitted when the engineer did not record it, so the report
 * never shows an empty row or invents a value to fill one.
 */
function ServiceReport({ c, company }) {
  const unit = c.unit || {};
  const unitLine = [unit.make, unit.model, unit.capacity, unit.type].filter(Boolean).join(' · ');
  const visitWhen = c.completedAt
    ? fmtLong(c.completedAt)
    : (c.appointmentDate ? fmtLong(c.appointmentDate) : '');
  const gasLine = c.gasFilled
    ? [c.gasType, c.gasQtyKg ? `${c.gasQtyKg} kg` : ''].filter(Boolean).join(' · ') || 'Topped up'
    : '';

  const rows = [
    ['Client', (company && company.customer) || ''],
    ['Site', c.site || ''],
    ['Unit', unitLine],
    ['Engineer', c.engineerName || ''],
    ['Cover', c.coverage || ''],
    ['Reported on', fmtLong(c.registeredDate)],
  ].filter(([, v]) => v);

  // One table for everything the engineer put into the unit on this visit:
  // the parts, the material and the gas, in the order they were recorded.
  const used = [
    ...(c.partsWork || []).map((p) => [p.part, p.action]),
    ...(c.materialUsed ? [[c.materialUsed, 'Material']] : []),
    ...(gasLine ? [[c.gasType ? `${c.gasType} gas` : 'Gas', c.gasQtyKg ? `${c.gasQtyKg} kg` : gasLine]] : []),
  ].filter(([item]) => item);

  return (
    <section className="portal-receipt" aria-labelledby="portal-report-h">
      <header className="portal-receipt-head">
        <div className="portal-receipt-brand">
          <p className="portal-receipt-co">{(company && company.name) || 'Service report'}</p>
          {company && company.serviceNumber && (
            <p className="portal-receipt-sub">
              <a href={telHref(company.serviceNumber)}>{fmtPhone(company.serviceNumber)}</a>
            </p>
          )}
        </div>
        <p className="portal-receipt-kicker">Service report</p>
      </header>

      <div className="portal-receipt-no">
        <h1 id="portal-report-h">PSC-{c.complaintNumber}</h1>
        {visitWhen && <span>{visitWhen}</span>}
      </div>

      <dl className="portal-receipt-rows">
        {rows.map(([k, v]) => (
          <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
        ))}
      </dl>

      <div className="portal-receipt-note">
        {c.complaintDescription && (
          <div>
            <h2>Reported</h2>
            <p className="portal-quote">{c.complaintDescription}</p>
          </div>
        )}
        <div>
          <h2>Attended</h2>
          <p className="portal-quote">{c.serviceDescription || 'The visit is complete.'}</p>
        </div>
        {c.customerRemark && (
          <div>
            <h2>What you told the engineer</h2>
            <p className="portal-quote">{c.customerRemark}</p>
          </div>
        )}
      </div>

      {used.length > 0 && (
        <table className="portal-receipt-used">
          <caption>Used on this visit</caption>
          <tbody>
            {used.map(([item, what], i) => (
              <tr key={`${item}-${i}`}><td>{item}</td><td>{what}</td></tr>
            ))}
          </tbody>
        </table>
      )}

      <footer className="portal-receipt-foot">
        <span className="portal-receipt-closed">
          <span className="portal-receipt-tick"><IconCheck /></span>
          Complaint closed
        </span>
        {visitWhen && <span className="portal-receipt-when">{visitWhen}</span>}
      </footer>

      <div className="portal-receipt-tear" aria-hidden="true" />
    </section>
  );
}

function PortalComplaintDetail() {
  const { profile, signOut } = usePortal();
  const { id } = useParams();
  const [c, setC] = useState(null);
  const [error, setError] = useState('');
  const location = useLocation();
  // Only on the way in from the form, and only while it is still new: a
  // completed visit should not greet the client with "we have it".
  const justRaised = Boolean(location.state && location.state.justRaised);
  const reportCompany = {
    name: (profile && profile.company && profile.company.name) || '',
    serviceNumber: (profile && profile.company && profile.company.serviceNumber) || '',
    customer: (profile && profile.client && profile.client.customer) || '',
  };

  useEffect(() => {
    let alive = true;
    setC(null); setError('');
    portalApi.get(`/api/portal/complaints/${id}`)
      .then((d) => { if (alive) setC(d.complaint); })
      .catch((e) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [id]);

  return (
    <PortalShell profile={profile} onLogout={signOut} narrow>
      <Link className="portal-back" to="/portal"><IconBack />Back</Link>

      {error && <div className="portal-card"><Notice>{error}</Notice></div>}
      {!c && !error && <div className="portal-card"><Skeleton rows={4} /></div>}

      {/* Finished work is a report, not a progress trail: the stages are
          dropped once there is nothing left to follow. While the complaint is
          open it is the other way round — the stages are the whole point, and
          the report does not exist yet. */}
      {c && c.status === 'Completed' && (
        <>
          <ServiceReport c={c} company={reportCompany} />

          {c.attachments?.length > 0 && (
            <section className="portal-card" aria-labelledby="portal-photos-h">
              <h2 id="portal-photos-h" className="portal-card-h">Photographs you sent</h2>
              <ul className="portal-thumbs">
                {c.attachments.map((a, i) => <AttachmentImage key={a.id} id={a.id} index={i} />)}
              </ul>
            </section>
          )}

          <p className="portal-receipt-keep">
            Keep this for your records. Every visit on your cover has one, and they stay in the app.
          </p>

          <div className="portal-receipt-actions">
            <button type="button" className="btn sec portal-btn" onClick={() => window.print()}>
              <IconDownload />Save
            </button>
            <Link className="btn sec portal-btn" to="/portal"><IconList />All visits</Link>
          </div>
        </>
      )}

      {c && c.status !== 'Completed' && (
        <>
          <div className="portal-card">
            {justRaised && c.status === 'Registered' && (
              <Notice kind="ok">
                Your complaint has been sent. Keep the number PSC-{c.complaintNumber} for reference.
              </Notice>
            )}

            <div className="portal-title-row">
              <h1>PSC-{c.complaintNumber}</h1>
              <span className={`status-badge ${STATUS_CLASS[c.status] || 'status-pending'}`}>{c.status}</span>
            </div>
            <p className="portal-lede">{STATUS_HELP[c.status] || ''}</p>

            <Progress c={c} />

            {/* Raised date and engineer are already in the steps above; this
                is only what the steps do not say. */}
            <dl className="portal-facts portal-facts-2">
              <div><dt>Site</dt><dd>{c.site || 'Not recorded'}</dd></div>
              <div><dt>Cover</dt><dd>{c.coverage}</dd></div>
            </dl>
          </div>

          {c.complaintDescription && (
            <section className="portal-card" aria-labelledby="portal-said-h">
              <h2 id="portal-said-h" className="portal-card-h">What you told us</h2>
              <p className="portal-quote">{c.complaintDescription}</p>
            </section>
          )}

          {c.attachments?.length > 0 && (
            <section className="portal-card" aria-labelledby="portal-photos-h">
              <h2 id="portal-photos-h" className="portal-card-h">Photographs you sent</h2>
              <ul className="portal-thumbs">
                {c.attachments.map((a, i) => <AttachmentImage key={a.id} id={a.id} index={i} />)}
              </ul>
            </section>
          )}

          <ResponsePromise number={profile?.company?.serviceNumber || profile?.company?.whatsappNumber} />
        </>
      )}
    </PortalShell>
  );
}

/* ------------------------------------------------------------------ */

function RequirePortalAuth({ children }) {
  const { ready, profile } = usePortal();
  if (!ready) return <PortalShell narrow><div className="portal-card"><Skeleton rows={3} /></div></PortalShell>;
  if (!profile) return <Navigate to="/portal/login" replace />;
  return children;
}

export default function PortalApp() {
  const [profile, setProfile] = useState(null);
  const [ready, setReady] = useState(false);

  const load = useCallback(async () => {
    if (!getPortalToken()) { setProfile(null); setReady(true); return; }
    try {
      setProfile(await portalApi.get('/api/portal/me'));
    } catch {
      setPortalToken(null);
      setProfile(null);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /**
   * The customer app. Mounted here and nowhere else: the manifest, the icon
   * and the service worker belong to /portal, and the staff application must
   * never advertise itself as the client's app or be controlled by a worker.
   */
  useEffect(() => {
    const detach = attachPortalAppChrome();
    registerPortalServiceWorker();
    return detach;
  }, []);

  useEffect(() => {
    const onOut = () => setProfile(null);
    window.addEventListener('mep:portal-unauthorized', onOut);
    return () => window.removeEventListener('mep:portal-unauthorized', onOut);
  }, []);

  const signIn = useCallback(async (phone, password) => {
    const d = await portalApi.post('/api/portal/auth/login', { phone, password });
    setPortalToken(d.token);
    setProfile(await portalApi.get('/api/portal/me'));
  }, []);

  const signOut = useCallback(async () => {
    // Notifications go with the session: a phone that has been signed out of
    // must not keep buzzing about somebody's service calls.
    try { await disablePush(); } catch { /* the sign-out matters more */ }
    try { await portalApi.post('/api/portal/auth/logout'); } catch { /* the token is going anyway */ }
    setPortalToken(null);
    setProfile(null);
  }, []);

  const value = { profile, ready, signIn, signOut };

  return (
    <PortalAuthContext.Provider value={value}>
      <Routes>
        <Route path="login" element={<PortalLogin />} />
        <Route path="register" element={<PortalRegister />} />
        <Route index element={<RequirePortalAuth><PortalDashboard /></RequirePortalAuth>} />
        <Route path="projects/:id" element={<RequirePortalAuth><PortalProjectDetail /></RequirePortalAuth>} />
        <Route path="complaints/new" element={<RequirePortalAuth><PortalComplaintNew /></RequirePortalAuth>} />
        <Route path="complaints/:id" element={<RequirePortalAuth><PortalComplaintDetail /></RequirePortalAuth>} />
        <Route path="*" element={<Navigate to="/portal" replace />} />
      </Routes>
    </PortalAuthContext.Provider>
  );
}
