import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { money, fmtDate } from '../../utils/format';
import '../enquiries/enquiry.css';

/**
 * Contract Detail — PWA `vContract(x)` / `vPM()`'s detail view exact
 * reproduction.
 *
 * PWA FACT: no edit/delete on Contract — read-only plus the PM visit
 * schedule display. No division or role restriction on viewing.
 *
 * Sections:
 *   - Identity (customer, phone, email, site, capacity)
 *   - Contract info (category, amcType, amount, start, end, status)
 *   - Originating Project link (if from conversion)
 *   - Scheduled Visits / PM calendar (month, completed date, due state)
 *
 * PWA FACT: no "Service Call" creation from this page — that is explicitly
 * out of scope for Pass 3B per instruction.
 */

function computeStatus(c) {
  if (!c.endDate) return 'Expired';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(c.endDate);
  end.setHours(0, 0, 0, 0);
  if (end < today) return 'Expired';
  const soonMs = 45 * 24 * 60 * 60 * 1000;
  if (today >= new Date(end.getTime() - soonMs)) return 'Expiring Soon';
  return 'Active';
}

function statusClass(status) {
  if (status === 'Active') return 'status-open';
  if (status === 'Expiring Soon') return 'status-pending';
  if (status === 'Expired') return 'status-lost';
  return '';
}

function computeCurrentMonth() {
  const now = new Date();
  return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
}

export default function ContractDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [contract, setContract] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get(`/api/contracts/${id}`);
      setContract(data.contract);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="enq-page"><p className="muted">Loading...</p></div>;
  if (error) return <div className="enq-page"><p style={{ color: 'red' }}>{error}</p></div>;
  if (!contract) return <div className="enq-page"><p className="muted">Contract not found.</p></div>;

  const status = computeStatus(contract);
  const tm = computeCurrentMonth();

  return (
    <div className="enq-page">
      <div className="detail-head">
        <button className="btn sec sm" onClick={() => navigate('/contracts')}>Back</button>
        <h2>Contract Detail</h2>
        <span className={`status-badge ${statusClass(status)}`}>{status}</span>
      </div>

      {/* Identity */}
      <div className="panel">
        <h3>Customer Information</h3>
        <div className="detail-grid">
          <div><strong>Customer</strong><br />{contract.customer || '—'}</div>
          <div><strong>Phone</strong><br />{contract.phone || '—'}</div>
          <div><strong>Email</strong><br />{contract.email || '—'}</div>
          <div><strong>Site</strong><br />{contract.site || '—'}</div>
          <div><strong>Capacity</strong><br />{contract.capacity || '—'}</div>
        </div>
      </div>

      {/* Contract Info */}
      <div className="panel">
        <h3>Contract Information</h3>
        <div className="detail-grid">
          <div><strong>Category</strong><br />{contract.category}</div>
          <div><strong>AMC Type</strong><br />{contract.amcType}</div>
          <div><strong>Amount</strong><br />{money(contract.amount)}</div>
          <div><strong>Start Date</strong><br />{fmtDate(contract.startDate)}</div>
          <div><strong>End Date</strong><br />{fmtDate(contract.endDate)}</div>
          <div><strong>Status</strong><br /><span className={`status-badge ${statusClass(status)}`}>{status}</span></div>
        </div>
      </div>

      {/* Originating Project */}
      {contract.originatingProjectId && (
        <div className="panel">
          <h3>Originating Project</h3>
          <button
            className="btn sec sm"
            onClick={() => navigate(`/projects/${contract.originatingProjectId}`)}
          >
            View Project
          </button>
        </div>
      )}

      {/* Scheduled Visits / PM Calendar */}
      <div className="panel">
        <h3>Scheduled PM Visits</h3>
        {(!contract.scheduledVisits || contract.scheduledVisits.length === 0) ? (
          <p className="muted">No scheduled visits.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Month</th>
                  <th>Status</th>
                  <th>Completed Date</th>
                </tr>
              </thead>
              <tbody>
                {contract.scheduledVisits.map((v, i) => {
                  const isDue = !v.completedDate && v.month <= tm;
                  const isCompleted = !!v.completedDate;
                  const isOverdue = isDue && v.month < tm;
                  let visitStatus = 'Upcoming';
                  if (isCompleted) visitStatus = 'Completed';
                  else if (isOverdue) visitStatus = 'Overdue';
                  else if (isDue) visitStatus = 'Due';

                  return (
                    <tr key={i}>
                      <td>{i + 1}</td>
                      <td>{v.month}</td>
                      <td>
                        <span className={`status-badge ${
                          isCompleted ? 'status-won' :
                          isOverdue ? 'status-lost' :
                          isDue ? 'status-pending' :
                          'status-open'
                        }`}>
                          {visitStatus}
                        </span>
                      </td>
                      <td>{v.completedDate ? fmtDate(v.completedDate) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
