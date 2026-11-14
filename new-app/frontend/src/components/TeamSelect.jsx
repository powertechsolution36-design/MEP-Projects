/**
 * Sales Team / Project Team pickers for a Sales Order.
 *
 * Owner request (14 Nov 2026): these two were free-text boxes, so the same
 * person was spelled three ways. They are dropdowns now — Sales Team lists
 * the company's Admin and Sales users, Project Team its Admin and division
 * Managers, deactivated people included.
 *
 * A name already saved on an order is always offered, even if that user has
 * since been renamed or removed, so editing an old order never silently
 * clears the field.
 */
import { useEffect, useState } from 'react';
import { api } from '../api/client';

/**
 * `enabled` is false on a screen the viewer can only read — the endpoint is
 * open to the roles that fill the form (sales, admin, solar_pm), so a PM or
 * Finance looking at an order would otherwise collect a pointless 403.
 */
export function useTeamCandidates(enabled = true) {
  const [candidates, setCandidates] = useState({ sales: [], project: [] });
  const [error, setError] = useState('');

  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    api.get('/api/sales-orders/team-candidates')
      .then((d) => { if (alive && d) setCandidates({ sales: d.sales || [], project: d.project || [] }); })
      .catch((err) => { if (alive) setError(err.message); });
    return () => { alive = false; };
  }, [enabled]);

  return { candidates, error };
}

export default function TeamSelect({ label, value, options, onChange, disabled }) {
  const names = (options || []).map((o) => o.name);
  // The saved name first, when it is no longer among the users on file.
  const extra = value && !names.includes(value) ? [value] : [];

  return (
    <div className="filter-field">
      <label>{label}</label>
      <select value={value || ''} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
        <option value="">— none —</option>
        {extra.map((n) => <option key={n} value={n}>{n} (no longer listed)</option>)}
        {(options || []).map((o) => (
          <option key={`${o.name}|${o.role}`} value={o.name}>
            {o.active === false ? `${o.name} (inactive)` : o.name}
          </option>
        ))}
      </select>
    </div>
  );
}
