import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { fmtDate } from '../utils/format';

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const ROLE_NAME = { engineer: 'Engineer', service_eng: 'Service Engineer' };
const STATUS = {
  Assigned: ['Assigned', ''],
  AwaitingReview: ['Awaiting review', 'status-pending'],
  Approved: ['Approved', 'status-won'],
};

export default function DailyTasks() {
  const { user } = useAuth();
  const isAssigner = ['admin', 'service_mgr'].includes(user?.role);
  const isManager = user?.role === 'service_mgr';
  const [date, setDate] = useState(localDateKey());
  const [tasks, setTasks] = useState([]);
  const [assignees, setAssignees] = useState([]);
  const [form, setForm] = useState({ title: '', description: '', taskDate: localDateKey(), assigneeUserId: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const query = isAssigner ? '' : `?date=${encodeURIComponent(date)}`;
      const data = await api.get(`/api/daily-tasks${query}`);
      setTasks(data.tasks || []);
      if (isAssigner) {
        const options = await api.get('/api/daily-tasks/assignees');
        setAssignees(options.assignees || []);
      }
    } catch (err) {
      setError(err.message || 'Could not load daily tasks.');
    } finally {
      setLoading(false);
    }
  }, [date, isAssigner]);

  useEffect(() => { load(); }, [load]);

  async function createTask(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.post('/api/daily-tasks', form);
      setForm({ title: '', description: '', taskDate: form.taskDate, assigneeUserId: '' });
      await load();
    } catch (err) {
      setError(err.message || 'Could not assign task.');
    } finally {
      setSaving(false);
    }
  }

  async function submitTask(task) {
    try {
      await api.post(`/api/daily-tasks/${task.id}/submit`);
      await load();
    } catch (err) { setError(err.message); }
  }

  async function approveTask(task) {
    try {
      await api.post(`/api/daily-tasks/${task.id}/approve`);
      await load();
    } catch (err) { setError(err.message); }
  }

  const pending = tasks.filter((task) => task.status === 'AwaitingReview');
  const approved = tasks.filter((task) => task.status === 'Approved');
  const assigned = tasks.filter((task) => task.status === 'Assigned');
  const performance = Object.values(tasks.reduce((rows, task) => {
    const key = String(task.assigneeUserId);
    if (!rows[key]) rows[key] = { name: task.assigneeName, role: task.assigneeRole, assigned: 0, pending: 0, approved: 0 };
    rows[key][task.status === 'AwaitingReview' ? 'pending' : task.status === 'Approved' ? 'approved' : 'assigned'] += 1;
    return rows;
  }, {}));

  return (
    <div className="enq-page">
      <div className="enq-header">
        <h2>Daily Tasks</h2>
        {!isAssigner && (
          <label>Work date&nbsp;
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
        )}
      </div>

      {error && <div className="panel" role="alert" style={{ color: 'var(--color-danger, #b42318)' }}>{error}</div>}

      {isAssigner && (
        <section className="panel" aria-labelledby="assign-daily-task-heading">
          <div className="phead"><h3 id="assign-daily-task-heading">Assign a task</h3></div>
          <form onSubmit={createTask} style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            <label>Task title
              <input required maxLength={160} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </label>
            <label>Assign to
              <select required value={form.assigneeUserId} onChange={(e) => setForm({ ...form, assigneeUserId: e.target.value })}>
                <option value="">Select an engineer</option>
                {assignees.map((person) => <option key={person.id} value={person.id}>{person.name} · {ROLE_NAME[person.role]}</option>)}
              </select>
            </label>
            <label>Work date
              <input required type="date" value={form.taskDate} onChange={(e) => setForm({ ...form, taskDate: e.target.value })} />
            </label>
            <label style={{ gridColumn: '1 / -1' }}>Instructions
              <textarea rows={3} maxLength={4000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </label>
            <div><button className="btn btn-primary" disabled={saving || !assignees.length}>{saving ? 'Assigning…' : 'Assign task'}</button></div>
          </form>
          {!assignees.length && !loading && <p className="muted">Create an engineer or service engineer account before assigning a task.</p>}
        </section>
      )}

      {isManager && (
        <section className="panel">
          <div className="phead"><h3>Awaiting your review</h3><span className="status-badge status-pending">{pending.length}</span></div>
          {pending.length === 0 ? <p className="muted">No completion requests are waiting for review.</p> : pending.map((task) => (
            <TaskCard key={task.id} task={task} action={<button className="btn btn-primary" onClick={() => approveTask(task)}>Approve completion</button>} />
          ))}
        </section>
      )}

      {!isAssigner && (
        <section className="panel">
          <div className="phead"><h3>My tasks · {date}</h3></div>
          {loading ? <p className="muted">Loading tasks…</p> : tasks.length === 0 ? <p className="muted">No tasks assigned for this date.</p> : tasks.map((task) => (
            <TaskCard key={task.id} task={task} action={task.status === 'Assigned'
              ? <button className="btn btn-primary" onClick={() => submitTask(task)}>Done · send for review</button>
              : null} />
          ))}
        </section>
      )}

      {isAssigner && (
        <section className="panel">
          <div className="phead"><h3>Task performance record</h3><span className="muted">Approved tasks are recorded per engineer.</span></div>
          {loading ? <p className="muted">Loading tasks…</p> : tasks.length === 0 ? <p className="muted">No tasks assigned yet.</p> : (
            <>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
                <span className="status-badge">Assigned: {assigned.length}</span>
                <span className="status-badge status-pending">Awaiting review: {pending.length}</span>
                <span className="status-badge status-won">Approved: {approved.length}</span>
              </div>
              <div className="tw"><table>
                <thead><tr><th>Engineer</th><th>Role</th><th>Assigned</th><th>Awaiting review</th><th>Approved</th></tr></thead>
                <tbody>{performance.map((row) => <tr key={`${row.name}-${row.role}`}><td>{row.name}</td><td>{ROLE_NAME[row.role]}</td><td>{row.assigned}</td><td>{row.pending}</td><td>{row.approved}</td></tr>)}</tbody>
              </table></div>
              <div style={{ marginTop: 18 }}><h3>Task history</h3>
                {tasks.map((task) => <TaskCard key={task.id} task={task} action={isManager && task.status === 'AwaitingReview'
                  ? <button className="btn btn-primary" onClick={() => approveTask(task)}>Approve completion</button>
                  : null} />)}
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}

function TaskCard({ task, action }) {
  const [label, badgeClass] = STATUS[task.status] || [task.status, ''];
  return (
    <article style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, padding: '14px 0', borderBottom: '1px solid var(--color-border, #e5e7eb)' }}>
      <div>
        <strong>{task.title}</strong>
        <div className="muted" style={{ marginTop: 4 }}>{task.assigneeName} · {ROLE_NAME[task.assigneeRole] || task.assigneeRole} · {fmtDate(task.taskDate)}</div>
        {task.description && <p style={{ whiteSpace: 'pre-wrap', margin: '8px 0' }}>{task.description}</p>}
        <span className={`status-badge ${badgeClass}`}>{label}</span>
        {task.assignedByName && <span className="muted" style={{ marginLeft: 8 }}>Assigned by {task.assignedByName}</span>}
        {task.submittedAt && <span className="muted" style={{ marginLeft: 8 }}>Submitted {fmtDate(task.submittedAt)}</span>}
        {task.approvedAt && <span className="muted" style={{ marginLeft: 8 }}>Approved by {task.approvedByName} · {fmtDate(task.approvedAt)}</span>}
      </div>
      {action && <div style={{ flexShrink: 0 }}>{action}</div>}
    </article>
  );
}
