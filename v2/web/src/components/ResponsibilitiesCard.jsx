import { useStore } from '../store/useStore';
import { getRoleMeta } from '../utils/responsibilities';

export default function ResponsibilitiesCard({ collapsed = false }) {
  const user = useStore(s => s.user);
  if (!user) return null;
  const meta = getRoleMeta(user.role);

  return (
    <div className="card resp-card" style={{ borderTop: `4px solid ${meta.color}` }}>
      <div className="resp-header">
        <div className="resp-icon" style={{ background: `${meta.color}22`, color: meta.color }}>{meta.icon}</div>
        <div>
          <div className="resp-name">Hello, {user.name}</div>
          <div className="resp-role">{meta.label} <span className="text-mut">· {meta.subtitle}</span></div>
        </div>
      </div>
      <div className="resp-title text-mut">Your Responsibilities</div>
      <ul className="resp-list">
        {meta.responsibilities.map((r, i) => (
          <li key={i}><span className="resp-tick" style={{ color: meta.color }}>✓</span> {r}</li>
        ))}
      </ul>
    </div>
  );
}
