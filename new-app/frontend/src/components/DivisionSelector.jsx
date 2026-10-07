import { useState, useEffect } from 'react';
import { api } from '../api/client';

/**
 * Reusable division selector — fetches the company's effective (purchased)
 * divisions from GET /api/subscriptions/my-divisions and renders a <select>.
 *
 * Props:
 *   value      — current selected division
 *   onChange   — (division) => void
 *   required   — HTML required attribute
 *   className  — optional extra CSS class
 *   allOption  — if true, includes an "All Divisions" option with value ''
 *   disabled   — HTML disabled attribute
 */
export default function DivisionSelector({ value, onChange, required, className, allOption, disabled }) {
  const [divisions, setDivisions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.get('/api/subscriptions/my-divisions')
      .then(data => {
        if (!cancelled) setDivisions(data.divisions || []);
      })
      .catch(() => {
        // Fallback: show all 3 divisions if endpoint unavailable
        if (!cancelled) setDivisions(['HVAC', 'Solar', 'MEP']);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return (
    <select
      value={value || ''}
      onChange={e => onChange(e.target.value)}
      required={required}
      className={className}
      disabled={disabled || loading}
    >
      {allOption
        ? <option value="">All Divisions</option>
        : <option value="">— Select Division —</option>
      }
      {divisions.map(d => <option key={d} value={d}>{d}</option>)}
    </select>
  );
}
