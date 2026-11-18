/**
 * The checklist points a sales order's payments can be taken at.
 *
 * Owner request (18 Nov 2026): "first milestone is same for every Sales
 * Order that is Advance Payment 100% the rest will be chosen from the 13
 * checklist and on which checklists the each remaining payment will be
 * taken it should be as a dropdown option in sales order."
 *
 * The advance is taken against the order itself, so it is never tied to a
 * point. Every milestone after it may name the point of work that earns it,
 * and when the order creates the project that choice becomes the project's
 * own link: tick and sign off that point, and the money goes to Finance by
 * itself.
 *
 * The list is fetched for the chosen DIVISION and is exactly what a project
 * of that division will be created with — the division's template if it has
 * one, the standard points otherwise. No project exists yet at this stage,
 * which is why the form asks the server rather than reading one.
 */
import { useEffect, useState } from 'react';
import { api } from '../api/client';

/** The points for a division, refetched whenever the division changes. */
export function useChecklistPoints(division) {
  const [points, setPoints] = useState([]);
  const [templateName, setTemplateName] = useState('');
  useEffect(() => {
    if (!division) { setPoints([]); setTemplateName(''); return undefined; }
    let alive = true;
    api.get(`/api/checklist-templates/standard?division=${encodeURIComponent(division)}`)
      .then((d) => {
        if (!alive) return;
        setPoints((d.points && d.points.items) || []);
        setTemplateName((d.points && d.points.templateName) || '');
      })
      .catch(() => { if (alive) { setPoints([]); setTemplateName(''); } });
    return () => { alive = false; };
  }, [division]);
  return { points, templateName };
}

/** The label a point reads as in the dropdown. */
export const pointLabel = (p) => `${p.index + 1}. ${p.text}`;

export default function MilestonePointSelect({ points, value, onChange, disabled = false }) {
  const chosen = value === null || value === undefined || value === '' ? '' : String(value);
  return (
    <select
      className="milestone-point"
      value={chosen}
      disabled={disabled || points.length === 0}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      aria-label="Checklist point this payment is taken at"
      title={points.length === 0 ? 'Choose a division first' : 'Which checklist point this payment is taken at'}
    >
      <option value="">— taken at (checklist point) —</option>
      {points.map((p) => (
        <option key={p.index} value={p.index}>{pointLabel(p)}</option>
      ))}
    </select>
  );
}
