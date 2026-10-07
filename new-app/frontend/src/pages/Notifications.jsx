import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';
import { fmtDate } from '../utils/format';
import './enquiries/enquiry.css';

/**
 * Notifications page — PWA `vNotifs()` exact reproduction.
 *
 * PWA FACT: notifications list shows all notifications for the current user's
 * role, in reverse chronological order. Viewing the page auto-marks them read.
 * PWA FACT: no delete/dismiss. No create from frontend. Backend creates
 * notifications as side effects of business workflows.
 * PWA FACT: notification.text is the message, notification.date is creation date.
 * PWA FACT: notification.roles is an array; user sees it if their role is in the array or '*' is present.
 * PWA FACT: notification.read is an array of user IDs who have read it.
 */

export default function Notifications() {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get('/api/notifications?limit=200');
      const list = data.notifications || [];
      setNotifications(list);

      /* Auto-mark all as read (PWA does this on page view) */
      for (const n of list) {
        const nId = n.id || n._id;
        if (nId && !n.isRead) {
          api.patch(`/api/notifications/${nId}/read`).catch(() => {});
        }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="enq-page">
      <div className="enq-header">
        <h2>Notifications</h2>
      </div>

      {error && <p style={{ color: 'red' }}>{error}</p>}
      {loading && <p className="muted">Loading...</p>}

      {!loading && notifications.length === 0 && (
        <div className="panel">
          <p className="muted">No notifications yet.</p>
        </div>
      )}

      {!loading && notifications.length > 0 && (
        <div className="panel">
          {notifications.map(n => {
            const nId = n.id || n._id;
            return (
              <div key={nId} style={{
                padding: '10px 0',
                borderBottom: '1px solid var(--color-border, #eee)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: 12,
              }}>
                <div style={{ flex: 1 }}>{n.text || n.body || ''}</div>
                <div className="muted" style={{ fontSize: '0.82em', whiteSpace: 'nowrap' }}>
                  {fmtDate(n.date || n.createdAt)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
