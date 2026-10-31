import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';
import { ANDROID_APK_URL, IOS_APP_URL } from '../config';
import { appDownloadOptions } from '../utils/appLinks';

/**
 * A client's own link to the service portal (owner decision, 31 Oct 2026).
 *
 * Sits on the AMC/Warranty client screen and on the project screen. Mint a
 * link, send it on WhatsApp, and it stays on the record so it can be sent
 * again months later — the owner asked for exactly that.
 *
 * WHAT THE LINK DOES AND DOES NOT DO, because it is worth being plain about:
 * it tells the portal WHO is registering, so a client can use any number
 * they like and still reach the right record. It does NOT activate them. The
 * registration still lands in Customer Logins for somebody here to approve.
 * A link that activated on its own would hand this client's projects and
 * service history to whoever it was forwarded to.
 *
 * API: GET/POST /api/customer-accounts/invites
 *      POST      /api/customer-accounts/invites/:id/revoke
 */
export default function PortalInvitePanel({ contractId, projectId, customerName }) {
  const [invites, setInvites] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');

  const query = contractId ? `contractId=${contractId}` : `projectId=${projectId}`;

  const load = useCallback(async () => {
    try {
      const d = await api.get(`/api/customer-accounts/invites?${query}`);
      setInvites(d.invites || []);
    } catch (e) {
      setError(e.message || 'Could not load the links.');
      setInvites([]);
    }
  }, [query]);

  useEffect(() => { load(); }, [load]);

  async function mint() {
    setBusy(true); setError('');
    try {
      await api.post('/api/customer-accounts/invites', {
        contractId: contractId || undefined,
        projectIds: projectId ? [projectId] : undefined,
      });
      await load();
    } catch (e) {
      setError(e.message || 'Could not make a link.');
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id) {
    if (!confirm('Switch this link off? Anyone who still has it will not be able to register with it.')) return;
    setBusy(true); setError('');
    try {
      await api.post(`/api/customer-accounts/invites/${id}/revoke`);
      await load();
    } catch (e) {
      setError(e.message || 'Could not switch it off.');
    } finally {
      setBusy(false);
    }
  }

  async function copy(url) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(url);
      setTimeout(() => setCopied(''), 2000);
    } catch {
      setError('Could not copy — select the link and copy it by hand.');
    }
  }

  const apps = appDownloadOptions({ androidApkUrl: ANDROID_APK_URL, iosAppUrl: IOS_APP_URL });
  const live = (invites || []).filter((i) => !i.revokedAt);

  const whatsappText = (url) =>
    `Hello${customerName ? ` ${customerName}` : ''}, you can follow your work and raise service requests here: ${url}`;

  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <h3>Client portal link</h3>
      <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
        Send this to the client so they can register. It works from any mobile number, it does not expire,
        and it stays here so you can send it again. You still approve them in Customer Logins before they
        can sign in.
      </p>

      {error && <p className="error">{error}</p>}
      {invites === null && <p className="muted">Loading…</p>}

      {invites && live.length === 0 && (
        <div className="detail-actions">
          <button className="btn pri sm" disabled={busy} onClick={mint}>
            {busy ? 'Making…' : 'Make a link'}
          </button>
        </div>
      )}

      {live.map((i) => (
        <div key={i.id} style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border-subtle)' }}>
          <code style={{ fontSize: 12, wordBreak: 'break-all' }}>{i.url}</code>
          <div style={{ fontSize: 12, marginTop: 4 }} className="muted">
            {i.used
              ? <>Already used{i.usedAt ? ` on ${String(i.usedAt).slice(0, 10)}` : ''} — make a new one if they need to register again.</>
              : 'Not used yet.'}
          </div>
          <div className="detail-actions">
            <button className="btn sec sm" onClick={() => copy(i.url)}>
              {copied === i.url ? 'Copied' : 'Copy link'}
            </button>
            <a
              className="btn sec sm"
              href={`https://wa.me/?text=${encodeURIComponent(whatsappText(i.url))}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Send on WhatsApp
            </a>
            <button className="btn danger sm" disabled={busy} onClick={() => revoke(i.id)}>Switch off</button>
          </div>
        </div>
      ))}

      {invites && live.length > 0 && (
        <div className="detail-actions" style={{ marginTop: 8 }}>
          <button className="btn sec sm" disabled={busy} onClick={mint}>Make another link</button>
        </div>
      )}

      {(apps.android.available || apps.ios.available) && (
        <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
          The client can also install the app:{' '}
          {apps.android.available && <a href={apps.android.url}>Android</a>}
          {apps.android.available && apps.ios.available && ' · '}
          {apps.ios.available && <a href={apps.ios.url}>iPhone</a>}
        </p>
      )}
    </div>
  );
}
