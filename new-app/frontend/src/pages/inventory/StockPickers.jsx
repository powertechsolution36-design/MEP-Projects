/**
 * Shared pickers for Stock Transfer and Issue Material.
 *
 * Owner request (26 Nov 2026): "create another option where the stock is
 * going to be used -- then according to that I will see the location. If
 * I select project I will see all the projects, if I select service call
 * I will see all service calls. And also add division and the
 * distribution that we created, and according to that I will see the
 * item." The same two rows serve both screens, so they live here rather
 * than being written twice and drifting apart.
 */

export const ITEM_DIVISIONS = ['HVAC', 'Solar', 'MEP', 'Common'];
export const ITEM_GROUPS = ['Machines', 'Piping & Refnuts', 'PCB', 'Permanent Stock'];
export const MACHINE_SUBGROUPS = [
  'Indoor', 'Outdoor', 'Panels', 'Remote', 'Split Indoor', 'Split Outdoor',
];
export const SHELF_LABEL = {
  'Split Indoor': 'Split Indoor (IDU)',
  'Split Outdoor': 'Split Outdoor (ODU)',
};

export const EMPTY_FILTERS = { usedFor: '', division: '', group: '', subGroup: '' };

/** The kinds of place a site option can be, in the order they read best. */
export function usedForKinds(sites, includeStockPoint = true) {
  const order = ['Projects', 'Service Calls', 'Sales Orders', 'Won Enquiries', 'AMC / PM', 'Clients', 'Other'];
  const found = [...new Set((sites || []).map(s => s.group || 'Other'))];
  return [
    // Only a transfer can end at one of the company's own stock points;
    // issued material always goes to a person at a site.
    ...(includeStockPoint ? ['Stock point'] : []),
    ...order.filter(k => found.includes(k)),
    ...found.filter(k => !order.includes(k)),
  ];
}

/**
 * The item list narrowed by what was chosen. An item with no division --
 * or marked Common -- belongs to everybody, so it stays visible whichever
 * division is picked; the same reasoning as the Stock screen's buttons.
 */
export function filterItems(items, f) {
  return (items || []).filter(i => {
    if (f.division) {
      const d = i.division || '';
      if (d && d !== 'Common' && d !== f.division) return false;
    }
    if (f.group && (i.group || '') !== f.group) return false;
    if (f.subGroup && (i.subGroup || '') !== f.subGroup) return false;
    return true;
  });
}

/** Where the stock is going to be used. */
export function UsedForPicker({ sites, value, onChange, label = 'Used for', includeStockPoint = true }) {
  return (
    <div className="filter-field"><label>{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)}>
        <option value="">— Anywhere —</option>
        {usedForKinds(sites, includeStockPoint).map(k => <option key={k} value={k}>{k}</option>)}
      </select>
    </div>
  );
}

/** Division, drawer and shelf -- the three that narrow the item list. */
export function ItemFilters({ value, onChange }) {
  return (
    <>
      <div className="filter-field"><label>Division</label>
        <select value={value.division} onChange={e => onChange({ ...value, division: e.target.value })}>
          <option value="">— All —</option>
          {ITEM_DIVISIONS.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>
      <div className="filter-field"><label>Group</label>
        <select
          value={value.group}
          onChange={e => onChange({
            ...value,
            group: e.target.value,
            subGroup: e.target.value === 'Machines' ? value.subGroup : '',
          })}
        >
          <option value="">— All —</option>
          {ITEM_GROUPS.map(g => <option key={g} value={g}>{g}</option>)}
        </select>
      </div>
      {value.group === 'Machines' && (
        <div className="filter-field"><label>Shelf</label>
          <select value={value.subGroup} onChange={e => onChange({ ...value, subGroup: e.target.value })}>
            <option value="">— All —</option>
            {MACHINE_SUBGROUPS.map(t => (
              <option key={t} value={t}>{SHELF_LABEL[t] || t}</option>
            ))}
          </select>
        </div>
      )}
    </>
  );
}
