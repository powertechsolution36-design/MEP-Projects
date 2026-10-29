import { useEffect, useState, useCallback } from 'react';
import { api } from '../../api/client';
import { fmtDate } from '../../utils/format';

/**
 * Customer portal logins, for staff to review (owner decision, 27 Oct 2026).
 *
 * A client who registers in the portal cannot use it until somebody here
 * approves them and says which AMC / Warranty client they are. The server
 * matches the mobile number against the contracts and shows what it found,
 * but the decision is a person's.
 *
 * API: GET  /api/customer-accounts
 *      POST /api/customer-accounts/:id/approve
 *      POST /api/customer-accounts/:id/status
 */

const MATCH_TEXT = {
  matched: 'Matched by mobile number',
  ambiguous: 'That number is on more than one client — choose which',
  'no-match': 'No client has that number — choose one, or reject',
};

export default function CustomerAccounts() {
  const [accounts, setAccounts] = useState(null);
  const [clients, setClients] = useState([]);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [chosen, setChosen] = useState({});

  const load = useCallback(async () => {
    try {
      const [a, c] = await Promise.all([
        api.get('/api/customer-accounts'),
        api.get('/api/contracts/clients?limit=100').catch(() => ({ clients: [] })),
      ]);
      setAccounts(a.accounts || []);
      setClients(c.clients || []);
    } catch (err) {
      setError(err.message || 'Could not load customer accounts.');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function act(id, path, body) {
    setBusyId(id); setError('');
    try {
      await api.post(`/api/customer-accounts/${id}/${path}`, body);
      await load();
    } catch (err) {
      setError(err.message || 'That did not work.');
    } finally {
      setBusyId('');
    }
  }

  const pending = (accounts || []).filter((a) => a.status === 'Pending');
  const decided = (accounts || []).filter((a) => a.status !== 'Pending');

  function card(a, showActions) {
    const pick = chosen[a.id] || a.contractId || '';
    return (
      <div key={a.id} className="panel" style={{ marginTop: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <div>
            <strong>{a.name}</strong>
            <div className="muted" style={{ fontSize: 13 }}>{a.phone}{a.email ? ` · ${a.email}` : ''}</div>
            {a.claimedSite && <div className="muted" style={{ fontSize: 13 }}>Says their site is: {a.claimedSite}</div>}
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Registered {fmtDate(a.createdAt)}</div>
          </div>
          <span className={`status-badge ${a.status === 'Active' ? 'status-won' : a.status === 'Pending' ? 'status-pending' : 'status-lost'}`}>
            {a.status}
          </span>
        </div>

        <p style={{ fontSize: 13, margin: '8px 0 4px' }}>
          {MATCH_TEXT[a.matchResult] || ''}
          {a.contract && <> — <strong>{a.contract.customer}</strong> ({a.contract.site})</>}
        </p>

        {showActions && (
          <>
            <label className="filter-field" style={{ maxWidth: 420 }}>
              AMC / Warranty client
              <select value={pick} onChange={(e) => setChosen((p) => ({ ...p, [a.id]: e.target.value }))}>
                <option value="">— Choose the client —</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.customer} — {c.site}</option>
                ))}
              </select>
            </label>
            <div className="detail-actions">
              <button className="btn pri sm" disabled={busyId === a.id || !pick}
                onClick={() => act(a.id, 'approve', { contractId: pick })}>
                {busyId === a.id ? 'Saving…' : 'Approve'}
              </button>
              <button className="btn danger sm" disabled={busyId === a.id}
                onClick={() => act(a.id, 'status', { status: 'Rejected' })}>
                Reject
              </button>
            </div>
          </>
        )}

        {!showActions && a.status === 'Active' && (
          <div className="detail-actions">
            <button className="btn sec sm" disabled={busyId === a.id}
              onClick={() => act(a.id, 'status', { status: 'Disabled' })}>
              Switch off this login
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="enq-page">
      <h2>Customer logins</h2>
      <p className="muted">
        Clients who have registered for the service portal. Nobody can sign in until you approve
        them and say which AMC / Warranty client they are.
      </p>
      {error && <p className="error">{error}</p>}
      {accounts === null && !error && <p className="muted">Loading…</p>}

      {accounts && (
        <>
          <h3>Waiting for you ({pending.length})</h3>
          {pending.length === 0 ? <p className="muted">Nothing waiting.</p> : pending.map((a) => card(a, true))}

          <h3 style={{ marginTop: 20 }}>Decided ({decided.length})</h3>
          {decided.length === 0 ? <p className="muted">Nothing yet.</p> : decided.map((a) => card(a, false))}
        </>
      )}
    </div>
  );
}
