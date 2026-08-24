import { useStore } from '../store/useStore';
import { api } from '../api/client';

export default function Notifications() {
  const notifications = useStore(s => s.notifications);
  async function readAll() { await api.patch('/api/notifications/read-all'); }
  return (
    <div>
      <div className="main-header">
        <h2>Notifications</h2>
        <button className="btn sec" onClick={readAll}>Mark all read</button>
      </div>
      <div className="card">
        {notifications.length === 0 && <div className="text-center text-mut" style={{padding: 40}}>No notifications</div>}
        {notifications.map(n => (
          <div key={n._id} style={{padding: '12px 0', borderBottom: '1px solid var(--line)', opacity: n.isRead ? 0.6 : 1}}>
            <div style={{display: 'flex', justifyContent: 'space-between'}}>
              <strong>{n.title}</strong>
              <span className="text-mut text-sm">{new Date(n.createdAt).toLocaleString()}</span>
            </div>
            <div className="text-mut" style={{marginTop: 4}}>{n.body}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
