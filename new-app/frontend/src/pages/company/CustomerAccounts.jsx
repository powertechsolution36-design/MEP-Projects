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
 * An approved client is also told which PROJECTS they may watch (owner
 * decision, 30 Oct 2026). That is a separate, deliberate step from approving
 * the login: a project is reached only because somebody here ticked it, and
 * the portal reads nothing else. The list below is ordered by how closely
 * each project's name matches the client's — a hint to save hunting, not a
 * decision the server made.
 *
 * API: GET  /api/customer-accounts
 *      POST /api/customer-accounts/:id/approve
 *      POST /api/customer-accounts/:id/status
 *      GET  /api/customer-accounts/:id/project-candidates
 *      PUT  /api/customer-accounts/:id/projects
 */

const MATCH_TEXT = {
  matched: 'Matched by mobile number',
  ambiguous: 'That number is on more than one client — choose which',
  'no-match': 'No client has that number — choose one, or reject',
  // Owner decision (31 Oct 2026): they opened the link we sent, so we know
  // who they are whatever number they used.
  invited: 'Registered from the link we sent them',
};



/**
 * Projects to link at the moment of approval (owner decision, 31 Oct 2026).
 * Folded closed, because most registrations are AMC clients with no project.
 */
function ApproveProjects({ accountId, chosen, onChange }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(null);

  async function load() {
    setOpen(true);
    try {
      const r = await api.get(`/api/customer-accounts/${accountId}/project-candidates`);
      setRows(r.projects || []);
    } catch {
      setRows([]);
    }
  }

  function toggle(id) {
    onChange(chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id]);
  }

  return (
    <div style={{ marginTop: 8, fontSize: 13 }}>
      {!open ? (
        <button type="button" className="btn sec sm" onClick={load}>
          {chosen.length ? `Projects to link: ${chosen.length}` : 'Also link projects (optional)'}
        </button>
      ) : (
        <>
          {rows === null && <span className="muted">Loading projects…</span>}
          {rows && rows.length === 0 && <span className="muted">This company has no projects yet.</span>}
          {rows && rows.length > 0 && (
            <div style={{ maxHeight: 180, overflowY: 'auto', marginTop: 4 }}>
              {rows.map((pr) => (
                <label key={pr.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '4px 0', cursor: 'pointer' }}>
                  <input type="checkbox" checked={chosen.includes(pr.id)} onChange={() => toggle(pr.id)} />
                  <span>
                    <strong>{pr.name}</strong> <span className="muted">{pr.division} · {pr.stage}</span>
                    {pr.score >= 50 && <span style={{ color: 'var(--ok-700)' }}> · looks like this client</span>}
                  </span>
                </label>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Pick the projects one client may watch. Opens closed, because most of the
 * time staff are here to approve a login, not to change links.
 */
function ProjectLinks({ account, onSaved }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(null);
  const [picked, setPicked] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function openPicker() {
    setOpen(true); setErr('');
    try {
      const r = await api.get(`/api/customer-accounts/${account.id}/project-candidates`);
      const list = r.projects || [];
      setRows(list);
      setPicked(new Set(list.filter((p) => p.linked).map((p) => p.id)));
    } catch (e) {
      setErr(e.message || 'Could not load the projects.');
      setRows([]);
    }
  }

  function toggle(id) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function save() {
    setBusy(true); setErr('');
    try {
      await api.put(`/api/customer-accounts/${account.id}/projects`, { projectIds: [...picked] });
      setOpen(false);
      if (onSaved) await onSaved();
    } catch (e) {
      setErr(e.message || 'Could not save that.');
    } finally {
      setBusy(false);
    }
  }

  const linkedCount = (account.linkedProjectIds || []).length;

  return (
    <div style={{ marginTop: 10, borderTop: '1px solid var(--line, #e5e7eb)', paddingTop: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13 }}>
          <strong>Projects this client can follow:</strong>{' '}
          {linkedCount === 0
            ? <span className="muted">none — they see no project progress</span>
            : `${linkedCount} linked`}
        </div>
        {!open && (
          <button className="btn sec sm" onClick={openPicker}>
            {linkedCount === 0 ? 'Link projects' : 'Change'}
          </button>
        )}
      </div>

      {open && (
        <>
          {err && <p className="error" style={{ fontSize: 13 }}>{err}</p>}
          {rows === null && <p className="muted" style={{ fontSize: 13 }}>Loading projects…</p>}
          {rows && rows.length === 0 && <p className="muted" style={{ fontSize: 13 }}>This company has no projects yet.</p>}
          {rows && rows.length > 0 && (
            <div style={{ maxHeight: 280, overflowY: 'auto', marginTop: 8 }}>
              {rows.map((p) => (
                <label
                  key={p.id}
                  style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '6px 4px', fontSize: 13, cursor: 'pointer' }}
                >
                  <input type="checkbox" checked={picked.has(p.id)} onChange={() => toggle(p.id)} />
                  <span>
                    <strong>{p.name}</strong>{' '}
                    <span className="muted">{p.division} · {p.stage} · {p.status}</span>
                    {p.customer && <div className="muted">Billed to: {p.customer}</div>}
                    {p.score >= 50 && <div style={{ color: 'var(--ok, #15803d)' }}>Looks like this client</div>}
                  </span>
                </label>
              ))}
            </div>
          )}
          <div className="detail-actions">
            <button className="btn pri sm" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
            <button className="btn sec sm" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </>
      )}
    </div>
  );
}

export default function CustomerAccounts() {
  const [accounts, setAccounts] = useState(null);
  const [clients, setClients] = useState([]);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [chosen, setChosen] = useState({});
  const [approveProjects, setApproveProjects] = useState({});

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
            {/* Owner decision (31 Oct 2026): choose the projects while
                approving, not on a second visit — an approved client who was
                never linked to a project sees nothing at all. */}
            <ApproveProjects accountId={a.id} chosen={approveProjects[a.id] || []} onChange={(ids) =>
              setApproveProjects((prev) => ({ ...prev, [a.id]: ids }))} />
            <div className="detail-actions">
              <button className="btn pri sm" disabled={busyId === a.id || !pick}
                onClick={() => act(a.id, 'approve', { contractId: pick, projectIds: approveProjects[a.id] || [] })}>
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
          <>
            <ProjectLinks account={a} onSaved={load} />
            <div className="detail-actions">
              <button className="btn sec sm" disabled={busyId === a.id}
                onClick={() => act(a.id, 'status', { status: 'Disabled' })}>
                Switch off this login
              </button>
            </div>
          </>
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
