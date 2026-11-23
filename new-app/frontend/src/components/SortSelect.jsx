/**
 * One sort control, the same on every register.
 *
 * Owner request (23 Nov 2026): "add Sort according to A-z or Z-A, new
 * latest or old — keep this on right side as a drop down."
 *
 * The four he asked for and no more. Sorting is done here, on the rows the
 * screen already has, so it costs no request and it never changes which
 * rows are shown — only their order. A list keeps its own natural order
 * until somebody chooses otherwise: several of these registers are
 * deliberately newest-first or due-first already, and quietly re-sorting
 * them on load would take that away.
 */
export const SORT_MODES = [
  ['', 'Default order'],
  ['az', 'Name A – Z'],
  ['za', 'Name Z – A'],
  ['new', 'Newest first'],
  ['old', 'Oldest first'],
];

export default function SortSelect({ value, onChange, label = 'Sort' }) {
  return (
    <label className="sort-select">
      <span className="sort-select-label">{label}</span>
      <select value={value || ''} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        {SORT_MODES.map(([mode, text]) => <option key={mode} value={mode}>{text}</option>)}
      </select>
    </label>
  );
}

/**
 * Put rows in the chosen order.
 *
 * `name` reads whatever the register calls a row — a client's firm, a
 * project's name, a lead's site — and `date` reads what "new" means for
 * it, falling back to when the record was created. A row missing either
 * sorts to the end rather than to the top, so a blank name never leads the
 * list. The array is copied, never sorted in place.
 */
export function sortRows(rows, mode, { name, date } = {}) {
  const list = Array.isArray(rows) ? [...rows] : [];
  if (!mode) return list;

  const nameOf = (r) => String((name ? name(r) : r && r.name) || '').trim().toLowerCase();
  const timeOf = (r) => {
    const raw = (date ? date(r) : null) || (r && (r.createdAt || r.updatedAt)) || null;
    const t = raw ? new Date(raw).getTime() : NaN;
    return Number.isNaN(t) ? null : t;
  };

  if (mode === 'az' || mode === 'za') {
    const dir = mode === 'az' ? 1 : -1;
    return list.sort((a, b) => {
      const x = nameOf(a);
      const y = nameOf(b);
      if (!x && !y) return 0;
      if (!x) return 1;   // nameless rows go last, whichever way round it is
      if (!y) return -1;
      return dir * x.localeCompare(y);
    });
  }

  const dir = mode === 'new' ? -1 : 1;
  return list.sort((a, b) => {
    const x = timeOf(a);
    const y = timeOf(b);
    if (x === null && y === null) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    return dir * (x - y);
  });
}
