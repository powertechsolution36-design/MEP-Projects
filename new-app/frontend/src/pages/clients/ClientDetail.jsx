/**
 * Everything we hold on one client (owner request, 17 Nov 2026):
 * "each client should hold all their data — all service call, all project,
 * all quotation", extended in the same conversation to their AMC contracts,
 * sales orders and payments.
 *
 * None of those records stores a client id, so their history is MATCHED on
 * the customer name or the phone number (see clientService). Records raised
 * after a client is picked from the directory carry the id and match
 * exactly. Two limits worth knowing: two firms sharing a name pool
 * together, and a record where both the name and the number were typed
 * differently will not be found.
 *
 * A section the viewer is not allowed to see is reported by the server as
 * null, and says so rather than pretending the client has none. This page
 * is a different way into records, never a way around their rules.
 */
import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { fmtDate, money } from '../../utils/format';

const title = (c) => c.companyName || c.clientName || 'Client';

/** One history section: its own heading, count, and table or reason. */
function Section({ heading, rows, columns, onOpen, empty }) {
  if (rows === null) {
    return (
      <div className="panel" style={{ maxWidth: 1000 }}>
        <h3>{heading}</h3>
        <p className="muted">Not yours to see — this login does not have {heading.toLowerCase()}.</p>
      </div>
    );
  }
  return (
    <div className="panel" style={{ maxWidth: 1000 }}>
      <h3>{heading} <span className="muted" style={{ fontWeight: 400 }}>({rows.length})</span></h3>
      {rows.length === 0 ? (
        <p className="muted">{empty}</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table" style={{ fontSize: 13 }}>
            <thead>
              <tr>{columns.map((col) => <th key={col.key}>{col.label}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className={onOpen ? 'clickable-row' : undefined}
                  onClick={onOpen ? () => onOpen(r) : undefined}
                >
                  {columns.map((col) => <td key={col.key}>{col.cell(r)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** The client's leads, each with the quotations raised from it beneath. */
function EnquirySection({ rows, navigate }) {
  if (rows === null) {
    return (
      <div className="panel" style={{ maxWidth: 1000 }}>
        <h3>Enquiries</h3>
        <p className="muted">Not yours to see — this login does not have enquiries.</p>
      </div>
    );
  }
  return (
    <div className="panel" style={{ maxWidth: 1000 }}>
      <h3>Enquiries <span className="muted" style={{ fontWeight: 400 }}>({rows.length})</span></h3>
      {rows.length === 0 ? (
        <p className="muted">No enquiries on record for them.</p>
      ) : rows.map((e) => (
        <div key={e.id} className="panel" style={{ margin: '10px 0', background: 'transparent' }}>
          <div
            className="clickable-row"
            style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', cursor: 'pointer' }}
            onClick={() => navigate(`/enquiries/${e.id}`)}
          >
            <strong>{e.name || '—'}</strong>
            <span className="status-badge">{e.status || '—'}</span>
            <span className="muted" style={{ fontSize: 13 }}>
              {[e.segment, e.siteType, e.estimatedValue == null ? null : money(e.estimatedValue)]
                .filter(Boolean).join(' · ')}
            </span>
          </div>
          {(e.quotations || []).length === 0 ? (
            <p className="muted" style={{ fontSize: 13, margin: '6px 0 0' }}>No quotation raised from this enquiry.</p>
          ) : (
            <div className="table-wrap" style={{ marginTop: 6 }}>
              <table className="data-table" style={{ fontSize: 13 }}>
                <thead>
                  <tr><th>Quotation</th><th>Date</th><th>Status</th><th>Value</th></tr>
                </thead>
                <tbody>
                  {e.quotations.map((q) => (
                    <tr key={q.id} className="clickable-row" onClick={() => navigate(`/quotations/${q.id}`)}>
                      <td>{q.quotationNumber || '—'}</td>
                      <td>{fmtDate(q.date) || '—'}</td>
                      <td>{q.status || '—'}</td>
                      <td>{q.grandTotal == null ? '—' : money(q.grandTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default function ClientDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await api.get(`/api/clients/${id}/records`));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="enq-page"><p className="muted">Loading…</p></div>;
  if (error) return <div className="enq-page"><p className="err">{error}</p></div>;
  if (!data) return null;

  const c = data.client;
  const dash = (v) => (v === null || v === undefined || v === '' ? '—' : v);

  return (
    <div className="enq-page">
      <button className="btn sec sm" onClick={() => navigate('/clients')}>&larr; All clients</button>

      <div className="panel" style={{ maxWidth: 1000 }}>
        <div className="detail-head"><h2>{title(c)}</h2></div>
        <div className="detail-grid">
          {/* Owner's wording (23 Nov 2026): the firm is the Site, the
              person is the Customer Name. */}
          <div><strong>Site:</strong> {dash(c.companyName)}</div>
          <div><strong>Customer Name:</strong> {dash(c.clientName)}{c.designation ? ` (${c.designation})` : ''}</div>
          <div><strong>Phone:</strong> {dash(c.phone)}</div>
          <div><strong>GST:</strong> {dash(c.gst)}</div>
          <div><strong>Email:</strong> {dash(c.email)}</div>
          <div><strong>Address:</strong> {dash(c.address)}</div>
        </div>
        {(c.contacts || []).length > 0 && (
          <div style={{ marginTop: 10 }}>
            <strong>Contacts</strong>
            {c.contacts.map((p, k) => (
              <div key={k} style={{ fontSize: 13 }}>
                {p.name}{p.designation ? ` (${p.designation})` : ''}{p.phone ? ` · ${p.phone}` : ''}
              </div>
            ))}
          </div>
        )}
        {/* Owner request (23 Nov 2026): the firm's other places, listed on
            the client itself. */}
        {(c.sites || []).length > 0 && (
          <div style={{ marginTop: 10 }}>
            <strong>Other sites</strong>
            {c.sites.map((x, k) => (
              <div key={k} style={{ fontSize: 13 }}>
                {x.name}{x.address ? ` \u00b7 ${x.address}` : ''}
              </div>
            ))}
          </div>
        )}
        {c.notes && <p style={{ marginTop: 10 }}>{c.notes}</p>}
      </div>

      <Section
        heading="Service Calls"
        rows={data.serviceCalls}
        empty="No service calls on record for them."
        onOpen={(r) => navigate(`/service-calls/${r.id}`)}
        columns={[
          { key: 'n', label: '#', cell: (r) => dash(r.complaintNumber) },
          { key: 'type', label: 'Type', cell: (r) => dash(r.type) },
          { key: 'site', label: 'Site', cell: (r) => dash(r.site) },
          { key: 'div', label: 'Division', cell: (r) => dash(r.division) },
          { key: 'reg', label: 'Registered', cell: (r) => fmtDate(r.registeredDate) },
          { key: 'st', label: 'Status', cell: (r) => (
            <>
              <span className="status-badge">{dash(r.status)}</span>
              {r.unattended && <span className="sc-waited">waiting</span>}
            </>
          ) },
        ]}
      />

      <Section
        heading="Projects"
        rows={data.projects}
        empty="No projects on record for them."
        onOpen={(r) => navigate(`/projects/${r.id}`)}
        columns={[
          { key: 'name', label: 'Project', cell: (r) => dash(r.name) },
          { key: 'div', label: 'Division', cell: (r) => dash(r.division) },
          { key: 'stage', label: 'Stage', cell: (r) => dash(r.stage) },
          { key: 'status', label: 'Status', cell: (r) => dash(r.status) },
          { key: 'start', label: 'Started', cell: (r) => fmtDate(r.startDate) },
        ]}
      />

      {/* Owner request (21 Nov 2026): "in client segment if we click any
          client then all enquiries of that client and enquiries wise quote
          can check." Each lead carries its own quotations, so a quotation
          is read under the lead it belongs to. */}
      <EnquirySection rows={data.enquiries} navigate={navigate} />

      <Section
        heading="AMC / PM Contracts"
        rows={data.contracts}
        empty="No AMC or warranty contracts on record for them."
        onOpen={(r) => navigate(`/contracts/${r.id}`)}
        columns={[
          { key: 'site', label: 'Site', cell: (r) => dash(r.site) },
          { key: 'cat', label: 'Cover', cell: (r) => `${dash(r.category)}${r.amcType ? ` · ${r.amcType}` : ''}` },
          { key: 'div', label: 'Division', cell: (r) => dash(r.division) },
          { key: 'from', label: 'From', cell: (r) => fmtDate(r.startDate) },
          { key: 'to', label: 'To', cell: (r) => fmtDate(r.endDate) },
          { key: 'amt', label: 'Amount', cell: (r) => (r.amount == null ? '—' : money(r.amount)) },
        ]}
      />

      <Section
        heading="Sales Orders"
        rows={data.salesOrders}
        empty="No sales orders on record for them."
        onOpen={(r) => navigate(`/sales-orders/${r.id}`)}
        columns={[
          { key: 'n', label: 'SO', cell: (r) => dash(r.orderNumber) },
          { key: 'name', label: 'Project', cell: (r) => dash(r.projectName) },
          { key: 'div', label: 'Division', cell: (r) => dash(r.division) },
          { key: 'start', label: 'Started', cell: (r) => fmtDate(r.startDate) },
          { key: 'cost', label: 'Value', cell: (r) => (r.totalCost == null ? '—' : money(r.totalCost)) },
        ]}
      />

      <Section
        heading="Payments"
        rows={data.payments}
        empty="No payments on record for them."
        columns={[
          { key: 'ref', label: 'For', cell: (r) => dash(r.projectOrReference) },
          { key: 'amt', label: 'Amount', cell: (r) => (r.amount == null ? '—' : money(r.amount)) },
          { key: 'status', label: 'Status', cell: (r) => dash(r.status) },
          { key: 'recd', label: 'Received', cell: (r) => fmtDate(r.receivedDate) },
        ]}
      />
    </div>
  );
}
