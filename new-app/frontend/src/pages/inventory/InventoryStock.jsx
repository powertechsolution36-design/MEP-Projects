import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, apiRequest, getStoredToken, assertDownloadOk } from '../../api/client';
import { API_BASE_URL } from '../../config';
import { useAuth } from '../../auth/AuthContext';
import { money } from '../../utils/format';
import SortSelect, { useSort, sortRows } from '../../components/SortSelect';
import PipeSizeTable, { sizeInInches } from './PipeSizeTable';

/**
 * Inventory Stock — PWA `vStock()` exact reproduction.
 *
 * Shows dashboard KPIs + item list with stock levels.
 * PWA MENUS: admin, inventory, service_mgr, hvac_pm, solar_pm have stock access.
 * PWA FACT: mep_pm does NOT have stock menu entry.
 * MANAGE_ROLES (inventory, admin) can create/edit/delete items, adjust stock.
 * STOCK_REPORT_ROLES can export CSV.
 */

const MANAGE_ROLES = ['inventory', 'admin'];
const STOCK_REPORT_ROLES = ['admin', 'inventory', 'hvac_pm', 'solar_pm', 'service_mgr'];
const UNITS = ['Nos', 'Mtr', 'Kg', 'Set', 'Box', 'Roll', 'Ltr'];
/* Owner request (24 Nov 2026): "add Division HVAC, Solar and MEP, or
   Common for all the divisions." Common says out loud that an item is
   everybody's — a drill, a ladder — rather than leaving it blank and
   having the storekeeper guess. Blank stays allowed: it is what every
   item on file before today has, and those are tagged by hand. */
const ITEM_DIVISIONS = ['HVAC', 'Solar', 'MEP', 'Common'];
const ADJUSTMENT_TYPES = ['Purchase In', 'Opening Stock', 'Damage / Write-off', 'Adjustment'];

/* Owner request (26 Nov 2026): the Stock screen is drawers, and you see
   one at a time -- "if I am on Machines I will only see machines". */
const ITEM_GROUPS = ['Machines', 'Piping & Refnuts', 'PCB', 'Permanent Stock'];
const UNSORTED = 'Not sorted yet';
/* The shelves inside Machines. A split is shelved in two halves because
   it is sold as a set -- see the Split tab below. */
const MACHINE_SUBGROUPS = ['Indoor', 'Outdoor', 'Panels', 'Remote', 'Split Indoor', 'Split Outdoor'];
/* Owner request (26 Nov 2026): shelves inside Piping & Refnuts too. */
const PIPING_SUBGROUPS = ['Copper Piping', 'Refnuts', 'Joints', 'Drain', 'Other'];
const SUBGROUPS_BY_GROUP = {
  Machines: MACHINE_SUBGROUPS,
  'Piping & Refnuts': PIPING_SUBGROUPS,
};
/* What the tabs read. Machines shows one Split tab for its two halves,
   because a split is counted in sets; every other shelf is its own tab. */
const SUB_TABS_BY_GROUP = {
  Machines: ['Indoor', 'Outdoor', 'Panels', 'Remote', 'Split'],
  'Piping & Refnuts': PIPING_SUBGROUPS,
};
const UNSHELVED = 'Not shelved yet';
/* A login tied to one division works in that division only -- the same
   table the client list and the AMC form use. */
const PM_DIVISION = { hvac_pm: 'HVAC', solar_pm: 'Solar', mep_pm: 'MEP' };

/* Remembered choices, so the screen opens where you left it (the owner
   asked for this on the AMC sort: "keep it till I change it"). */
function readStored(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v;
  } catch { return fallback; }
}
function writeStored(key, value) {
  try { localStorage.setItem(key, value); } catch { /* private window */ }
}

/* Blank division means nobody has said yet. Those items show under every
   division rather than vanishing -- 19 Nov taught us what a silent
   filter does to a list. "Common" is the deliberate version of the same. */
function inDivision(item, division) {
  const d = item.division || '';
  return !d || d === 'Common' || d === division;
}
function groupOf(item) {
  return ITEM_GROUPS.includes(item.group) ? item.group : UNSORTED;
}
function subTabOf(item, group) {
  const sg = item.subGroup || '';
  if (sg === 'Split Indoor' || sg === 'Split Outdoor') return 'Split';
  return (SUB_TABS_BY_GROUP[group] || []).includes(sg) ? sg : UNSHELVED;
}

function totQty(item) {
  if (!item?.stockByLocation) return 0;
  const entries = item.stockByLocation instanceof Map
    ? Array.from(item.stockByLocation.values())
    : Object.values(item.stockByLocation);
  return entries.reduce((s, v) => s + (Number(v) || 0), 0);
}

/* Owner request (26 Nov 2026): "show low stock when anything is below 5
   quantity." An item with no minimum of its own used to read In Stock
   down to the last piece; five is now the house floor. An item's own
   minimum still counts, and still wins when it is higher. */
const LOW_STOCK_FLOOR = 5;

function stockState(item) {
  const t = totQty(item);
  if (t <= 0) return { label: 'Out of Stock', cls: 'status-lost' };
  const min = Math.max(Number(item?.minimumStockLevel) || 0, LOW_STOCK_FLOOR - 1);
  if (t <= min) return { label: 'Low Stock', cls: 'status-pending' };
  return { label: 'In Stock', cls: 'status-open' };
}

export default function InventoryStock() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [locations, setLocations] = useState([]);
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');

  /* Which drawer is open, and in which division. Remembered. */
  const myDivision = PM_DIVISION[user?.role] || '';
  const [division, setDivision] = useState(() => myDivision || readStored('mep_stock_division', 'HVAC'));
  const [group, setGroup] = useState(() => readStored('mep_stock_group', 'Machines'));
  const [subTab, setSubTab] = useState(() => readStored('mep_stock_sub', 'Indoor'));
  /* Owner request (26 Nov 2026): Adjust / Edit / Delete gathered into one
     menu per row. Three buttons on every line pushed the code and name
     columns off the side of the screen. */
  const [menuFor, setMenuFor] = useState(null);
  // Owner request (26 Nov 2026): the same sort as the other registers.
  const [sort, setSort] = useSort('stock');
  /* Owner request (26 Nov 2026): three quick filters beside the search --
     in stock, low, out. Deliberately NOT remembered between visits: a
     sort that sticks is helpful, a filter that sticks has people asking
     where their items went. */
  const [stockFilter, setStockFilter] = useState('');
  /* Owner request (26 Nov 2026): inside Split, the two halves get their
     own sections under the names the trade uses -- IDU for the indoor
     unit, ODU for the outdoor one. */
  const [splitSide, setSplitSide] = useState(() => readStored('mep_stock_split_side', 'IDU'));
  function pickSplitSide(v) { setSplitSide(v); writeStored('mep_stock_split_side', v); }
  function pickDivision(d) { setDivision(d); writeStored('mep_stock_division', d); }
  function pickGroup(g) {
    setGroup(g);
    writeStored('mep_stock_group', g);
    // Land on a shelf this drawer has, or the first one, rather than on
    // a tab that belongs to the drawer you just left.
    const tabs = SUB_TABS_BY_GROUP[g];
    if (tabs && !tabs.includes(subTab) && subTab !== UNSHELVED) pickSubTab(tabs[0]);
  }
  function pickSubTab(t) { setSubTab(t); writeStored('mep_stock_sub', t); }

  /* Modals */
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(null);
  const [showAdjust, setShowAdjust] = useState(null);
  const [saving, setSaving] = useState(false);

  /* Create form */
  const [createForm, setCreateForm] = useState({
    code: '', name: '', categoryId: '', unit: 'Nos', returnable: false, division: '',
    group: '', subGroup: '', fitsItemIds: [],
    minimumStockLevel: '', ratePerUnit: '', openingStock: '', openingLocationId: '',
  });

  /* Edit form */
  const [editForm, setEditForm] = useState({
    code: '', name: '', categoryId: '', unit: 'Nos', returnable: false, division: '',
    group: '', subGroup: '', fitsItemIds: [],
    minimumStockLevel: '', ratePerUnit: '',
  });

  /* Adjust form */
  /* Owner request (26 Nov 2026): "some of the added stock is more, how
     to edit it". Correcting a count was possible before only by typing a
     negative quantity, which nothing on the screen said. The form now
     asks what you are doing and works the difference out itself. */
  const [adjustForm, setAdjustForm] = useState({
    mode: 'set', type: 'Adjustment', quantity: '', locationId: '', remark: '',
  });

  const canManage = MANAGE_ROLES.includes(user?.role);
  const canExport = STOCK_REPORT_ROLES.includes(user?.role);

  /*
   * Owner request (26 Nov 2026): "after every edit I save, I am going to
   * the top of the screen -- I don't want it."
   *
   * The cause: every save reloaded with the spinner up, which took the
   * table off the page for a moment. With nothing tall left to scroll,
   * the browser put him back at the top, and the row he had just edited
   * was gone from view. A reload after a save is now quiet: the rows
   * stay where they are and are replaced when the new ones arrive.
   */
  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const [itemsData, catData, locData, dashData] = await Promise.all([
        api.get('/api/inventory/items'),
        api.get('/api/inventory/categories'),
        api.get('/api/inventory/locations'),
        canManage ? api.get('/api/inventory/dashboard').catch(() => null) : Promise.resolve(null),
      ]);
      setItems(itemsData.items || []);
      setCategories(catData.categories || []);
      setLocations(locData.locations || []);
      setDashboard(dashData?.dashboard || null);
    } catch (err) {
      setError(err.message);
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [canManage]);

  useEffect(() => { load(); }, [load]);

  /* A click anywhere else, or Escape, closes the open row menu. */
  useEffect(() => {
    if (!menuFor) return undefined;
    function away(e) {
      if (!e.target.closest || !e.target.closest('.row-menu')) setMenuFor(null);
    }
    function esc(e) { if (e.key === 'Escape') setMenuFor(null); }
    document.addEventListener('click', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('click', away);
      document.removeEventListener('keydown', esc);
    };
  }, [menuFor]);

  /* Category/Location name resolution */
  function catName(id) {
    const c = categories.find(x => (x.id || x._id) === id);
    return c ? c.name : '—';
  }
  function locName(id) {
    const l = locations.find(x => (x.id || x._id) === id);
    return l ? l.name : String(id);
  }

  function itemById(id) {
    const key = String(id);
    return items.find(x => String(x.id || x._id) === key) || null;
  }

  /* Search filter (client-side) */
  const searched = search
    ? items.filter(i => {
        const blob = [i.code, i.name, catName(i.categoryId), i.unit].join(' ').toLowerCase();
        return blob.includes(search.toLowerCase());
      })
    : items;

  /* One division, then one drawer, then -- inside Machines -- one shelf.
     Counts are taken at each step from what the step above left, so the
     numbers on the tabs are the numbers you will actually see. */
  const divisionItems = searched.filter(i => inDivision(i, division));
  const groupCounts = {};
  for (const g of [...ITEM_GROUPS, UNSORTED]) groupCounts[g] = 0;
  for (const i of divisionItems) groupCounts[groupOf(i)] += 1;
  const groupItems = divisionItems.filter(i => groupOf(i) === group);
  /* The shelves of the drawer in front of you -- Machines and Piping &
     Refnuts have them, the other drawers do not. */
  const subTabs = SUB_TABS_BY_GROUP[group] || null;
  const subCounts = {};
  if (subTabs) {
    for (const t of [...subTabs, UNSHELVED]) subCounts[t] = 0;
    for (const i of groupItems) subCounts[subTabOf(i, group)] += 1;
  }
  const inMachines = group === 'Machines';
  const showingSplit = inMachines && subTab === 'Split';
  const shelfItems = subTabs ? groupItems.filter(i => subTabOf(i, group) === subTab) : groupItems;
  /* The three quick filters, counted on exactly the rows they would show. */
  const stateKey = i => {
    const l = stockState(i).label;
    return l === 'In Stock' ? 'in' : l === 'Low Stock' ? 'low' : 'out';
  };
  const stateCounts = { in: 0, low: 0, out: 0 };
  for (const i of shelfItems) stateCounts[stateKey(i)] += 1;
  /*
   * Owner request (26 Nov 2026): "sort the data in Piping & Refnuts
   * properly." A–Z is the wrong order for fittings -- it puts 1/8 after
   * 1/2 and 1-1/8 between them, because it is reading characters, not
   * sizes. Left to itself this drawer now runs by size, smallest first,
   * with each size's elbow and socket together, which is how the stock
   * is counted and how his own sheet lists it. Choosing a sort still
   * does exactly what it says.
   */
  function bySize(a, b) {
    const x = sizeInInches(a.name);
    const y = sizeInInches(b.name);
    if (x === null && y === null) return String(a.name).localeCompare(String(b.name));
    if (x === null) return 1;   // no size in the name: after the sized ones
    if (y === null) return -1;
    if (Math.abs(x - y) > 0.001) return x - y;
    return String(a.name).localeCompare(String(b.name));
  }
  const picked = stockFilter ? shelfItems.filter(i => stateKey(i) === stockFilter) : shelfItems;
  const filtered = sort
    ? sortRows(picked, sort)
    : (group === 'Piping & Refnuts' ? [...picked].sort(bySize) : picked);

  const divisionsOffered = myDivision ? [myDivision] : ['HVAC', 'Solar', 'MEP'];
  function divisionCount(d) { return searched.filter(i => inDivision(i, d)).length; }

  /* The Split tab counts sets, not pieces: one indoor needs one outdoor,
     so an indoor is paired with whichever outdoor it was linked to and
     the set count is the smaller of the two. An unpaired half is shown
     on its own, because that is the number that otherwise stays hidden
     until an engineer is on site holding half a machine. */
  const splitIndoors = sortRows(
    inMachines ? groupItems.filter(i => i.subGroup === 'Split Indoor') : [], sort,
  );
  const splitOutdoors = sortRows(
    inMachines ? groupItems.filter(i => i.subGroup === 'Split Outdoor') : [], sort,
  );
  const pairedOutdoorIds = new Set();
  const splitPairs = splitIndoors.map(indoor => {
    const partner = (indoor.fitsItemIds || [])
      .map(id => itemById(id))
      .find(x => x && x.subGroup === 'Split Outdoor') || null;
    if (partner) pairedOutdoorIds.add(String(partner.id || partner._id));
    const qi = totQty(indoor);
    const qo = partner ? totQty(partner) : 0;
    return { indoor, partner, qi, qo, sets: partner ? Math.min(qi, qo) : 0 };
  });
  const lonelyOutdoors = splitOutdoors.filter(o => !pairedOutdoorIds.has(String(o.id || o._id)));
  const totalSets = splitPairs.reduce((n, p) => n + p.sets, 0);


  /* The drawer, the shelf, and -- for a board or a split half -- the
     units it goes with. Shown the same way on Create and on Edit. */
  function groupFields(form, setForm) {
    const machines = items.filter(i => groupOf(i) === 'Machines');
    const wantsFits = form.group === 'PCB'
      || form.subGroup === 'Split Indoor' || form.subGroup === 'Split Outdoor';
    return (
      <>
        <div className="filter-field"><label>Group</label>
          <select
            value={form.group}
            onChange={e => setForm(p => ({
              ...p,
              group: e.target.value,
              subGroup: (SUBGROUPS_BY_GROUP[e.target.value] || []).includes(p.subGroup)
                ? p.subGroup : '',
              // Permanent Stock is the returnable drawer -- it goes to
              // site and comes back. The server decides the same way.
              returnable: e.target.value === 'Permanent Stock' ? true : p.returnable,
            }))}
          >
            <option value="">— not sorted yet —</option>
            {ITEM_GROUPS.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>
        {(SUBGROUPS_BY_GROUP[form.group] || []).length > 0 && (
          <div className="filter-field"><label>Shelf</label>
            <select value={form.subGroup} onChange={e => setForm(p => ({ ...p, subGroup: e.target.value }))}>
              <option value="">— not shelved yet —</option>
              {SUBGROUPS_BY_GROUP[form.group].map(t => (
                <option key={t} value={t}>
                  {t === 'Split Indoor' ? 'Split Indoor (IDU)'
                    : t === 'Split Outdoor' ? 'Split Outdoor (ODU)' : t}
                </option>
              ))}
            </select>
          </div>
        )}
        {wantsFits && (
          <div className="filter-field" style={{ gridColumn: '1 / -1' }}>
            <label>
              {form.group === 'PCB'
                ? 'Fits these units (hold Ctrl to pick more than one)'
                : 'Its other half (hold Ctrl to pick more than one)'}
            </label>
            <select
              multiple
              size={6}
              value={form.fitsItemIds}
              onChange={e => setForm(p => ({
                ...p,
                fitsItemIds: Array.from(e.target.selectedOptions, o => o.value),
              }))}
            >
              {machines.map(m => (
                <option key={m.id || m._id} value={String(m.id || m._id)}>
                  {m.name}{m.code ? ` — ${m.code}` : ''}{m.subGroup ? ` (${m.subGroup})` : ''}
                </option>
              ))}
            </select>
            {machines.length === 0 && (
              <span className="muted">No machines on file yet to point at.</span>
            )}
          </div>
        )}
      </>
    );
  }

  /* ---- Create Item ---- */
  async function handleCreate(e) {
    e.preventDefault();
    if (createForm.openingStock && Number(createForm.openingStock) !== 0 && !createForm.openingLocationId) {
      setError('Choose the location for the opening stock.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.post('/api/inventory/items', {
        code: createForm.code,
        name: createForm.name,
        categoryId: createForm.categoryId || undefined,
        unit: createForm.unit,
        returnable: createForm.returnable,
        // Which side of the business it belongs to (24 Nov 2026).
        division: createForm.division,
        // Which drawer and shelf it belongs in (26 Nov 2026).
        group: createForm.group,
        subGroup: (SUBGROUPS_BY_GROUP[createForm.group] || []).includes(createForm.subGroup)
          ? createForm.subGroup : '',
        fitsItemIds: createForm.fitsItemIds,
        minimumStockLevel: createForm.minimumStockLevel ? Number(createForm.minimumStockLevel) : undefined,
        ratePerUnit: createForm.ratePerUnit ? Number(createForm.ratePerUnit) : undefined,
        // Backend contract: { <locationId>: qty } (PWA per-location opening entry).
        openingStock: createForm.openingStock && createForm.openingLocationId
          ? { [createForm.openingLocationId]: Number(createForm.openingStock) }
          : undefined,
      });
      setShowCreate(false);
      setCreateForm({ code: '', name: '', categoryId: '', unit: 'Nos', returnable: false, division: '', group: '', subGroup: '', fitsItemIds: [], minimumStockLevel: '', ratePerUnit: '', openingStock: '', openingLocationId: '' });
      await load(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  /* ---- Edit Item ---- */
  function openEdit(item) {
    setEditForm({
      code: item.code || '',
      name: item.name || '',
      categoryId: item.categoryId || '',
      unit: item.unit || 'Nos',
      returnable: !!item.returnable,
      division: item.division || '',
      group: item.group || '',
      subGroup: item.subGroup || '',
      fitsItemIds: (item.fitsItemIds || []).map(String),
      minimumStockLevel: item.minimumStockLevel != null ? String(item.minimumStockLevel) : '',
      ratePerUnit: item.ratePerUnit != null ? String(item.ratePerUnit) : '',
    });
    setShowEdit(item);
  }

  async function handleEdit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const itemId = showEdit.id || showEdit._id;
      await apiPut(`/api/inventory/items/${itemId}`, {
        code: editForm.code,
        name: editForm.name,
        categoryId: editForm.categoryId || undefined,
        unit: editForm.unit,
        returnable: editForm.returnable,
        division: editForm.division,
        group: editForm.group,
        subGroup: (SUBGROUPS_BY_GROUP[editForm.group] || []).includes(editForm.subGroup)
          ? editForm.subGroup : '',
        fitsItemIds: editForm.fitsItemIds,
        minimumStockLevel: editForm.minimumStockLevel ? Number(editForm.minimumStockLevel) : undefined,
        ratePerUnit: editForm.ratePerUnit ? Number(editForm.ratePerUnit) : undefined,
      });
      setShowEdit(null);
      await load(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  /* ---- Delete Item ---- */
  async function handleDelete(item) {
    if (!window.confirm(`Delete item "${item.name}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/api/inventory/items/${item.id || item._id}`);
      await load(true);
    } catch (err) {
      setError(err.message);
    }
  }

  /* ---- Adjust Stock ---- */
  /* Default to the one location when there is only one, so the current
     count can be shown straight away. */
  function openAdjust(item) {
    const only = locations.length === 1 ? String(locations[0].id || locations[0]._id) : '';
    setAdjustForm({ mode: 'set', type: 'Adjustment', quantity: '', locationId: only, remark: '' });
    setShowAdjust(item);
  }

  /* What is in stock at the chosen location right now. */
  function adjustCurrent() {
    const map = showAdjust?.stockByLocation || {};
    return Number(map[adjustForm.locationId] || 0);
  }

  /* The signed change the API wants, worked out from what was typed. */
  function adjustDelta() {
    const q = Number(adjustForm.quantity);
    if (!adjustForm.quantity || Number.isNaN(q)) return null;
    if (adjustForm.mode === 'set') return q - adjustCurrent();
    if (adjustForm.mode === 'remove') return -Math.abs(q);
    return Math.abs(q);
  }

  async function handleAdjust(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const itemId = showAdjust.id || showAdjust._id;
      const delta = adjustDelta();
      if (!delta) {
        setError(adjustForm.mode === 'set'
          ? 'That is the count already — nothing to change.'
          : 'Enter a quantity.');
        setSaving(false);
        return;
      }
      await api.post(`/api/inventory/items/${itemId}/adjust`, {
        type: adjustForm.type,
        quantity: delta,
        locationId: adjustForm.locationId || undefined,
        remark: adjustForm.remark || undefined,
      });
      setShowAdjust(null);
      await load(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  /* ---- CSV Export ---- */
  async function handleExport() {
    try {
      const resp = await fetch(
        API_BASE_URL + '/api/inventory/reports/stock.csv',
        { headers: { Authorization: `Bearer ${getStoredToken()}` } }
      );
      await assertDownloadOk(resp); // a refused export must not be saved as a file
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'inventory-stock-report.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert('Export failed: ' + err.message);
    }
  }

  return (
    <div className="enq-page">
      <div className="enq-header">
        <h2>Stock</h2>
        <div className="enq-actions">
          {/* Owner request (26 Nov 2026): sort here too, on the right. */}
          <SortSelect value={sort} onChange={setSort} />
          {canManage && (
            <button className="btn pri" onClick={() => setShowCreate(true)}>+ New Item</button>
          )}
          {canExport && (
            <button className="btn sec" onClick={handleExport}>CSV Export</button>
          )}
        </div>
      </div>

      {/* Dashboard KPIs */}
      {dashboard && (
        <div className="kpi-bar">
          <div className="kpi-card"><div className="kpi-label">Total Items</div><div className="kpi-value">{dashboard.totalItems}</div></div>
          <div className="kpi-card"><div className="kpi-label">Categories</div><div className="kpi-value">{dashboard.categories}</div></div>
          <div className="kpi-card"><div className="kpi-label">Stock Value</div><div className="kpi-value">{money(dashboard.stockValue)}</div></div>
          <div className="kpi-card"><div className="kpi-label">Low Stock</div><div className="kpi-value" style={{ color: dashboard.lowStock > 0 ? '#e65100' : undefined }}>{dashboard.lowStock}</div></div>
          <div className="kpi-card"><div className="kpi-label">Out of Stock</div><div className="kpi-value" style={{ color: dashboard.outOfStock > 0 ? '#c62828' : undefined }}>{dashboard.outOfStock}</div></div>
          <div className="kpi-card"><div className="kpi-label">Material w/ Staff</div><div className="kpi-value">{dashboard.materialWithStaff}</div></div>
          <div className="kpi-card"><div className="kpi-label">Return Requests</div><div className="kpi-value" style={{ color: dashboard.returnRequests > 0 ? '#e65100' : undefined }}>{dashboard.returnRequests}</div></div>
        </div>
      )}

      {/* Owner request (26 Nov 2026): three buttons, then the drawers. A
          login tied to one division is only offered its own. */}
      <div className="stock-divisions">
        {divisionsOffered.map(d => (
          <button
            key={d}
            type="button"
            className={`stock-div-btn${division === d ? ' on' : ''}`}
            onClick={() => pickDivision(d)}
          >
            <b>{d}</b>
            <span>{divisionCount(d)} item{divisionCount(d) === 1 ? '' : 's'}</span>
          </button>
        ))}
      </div>

      <div className="stock-tabs">
        {[...ITEM_GROUPS, UNSORTED].map(g => (
          <button
            key={g}
            type="button"
            className={`stock-tab${group === g ? ' on' : ''}`}
            onClick={() => pickGroup(g)}
          >
            {g}<i>{groupCounts[g]}</i>
          </button>
        ))}
      </div>

      {subTabs && (
        <div className="stock-subtabs">
          {[...subTabs, UNSHELVED].map(t => (
            <button
              key={t}
              type="button"
              className={`stock-subtab${subTab === t ? ' on' : ''}`}
              onClick={() => pickSubTab(t)}
            >
              {t}<i>{subCounts[t]}</i>
            </button>
          ))}
        </div>
      )}

      <div className="search-bar">
        <input type="text" placeholder="Search items..." value={search} onChange={e => setSearch(e.target.value)} />
        {/* Owner request (26 Nov 2026). Clicking the one already chosen
            clears it, so there is always a way back to everything. */}
        <div className="stock-quick">
          {[['in', 'In stock'], ['low', 'Low stock'], ['out', 'Out of stock']].map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`stock-quick-btn ${key}${stockFilter === key ? ' on' : ''}`}
              aria-pressed={stockFilter === key}
              onClick={() => setStockFilter(stockFilter === key ? '' : key)}
            >
              {label}<i>{stateCounts[key]}</i>
            </button>
          ))}
        </div>
      </div>

      {error && <p style={{ color: 'red' }}>{error}</p>}
      {loading && <p className="muted">Loading...</p>}

      {/* One indoor needs one outdoor, so this tab is counted in sets.
          Inside it the two halves have their own sections, under the
          names the trade uses: IDU and ODU (owner, 26 Nov 2026). */}
      {!loading && !error && showingSplit && (
        <>
          <div className="stock-subtabs">
            <button
              type="button"
              className={`stock-subtab${splitSide === 'IDU' ? ' on' : ''}`}
              onClick={() => pickSplitSide('IDU')}
            >
              IDU — indoor<i>{splitIndoors.length}</i>
            </button>
            <button
              type="button"
              className={`stock-subtab${splitSide === 'ODU' ? ' on' : ''}`}
              onClick={() => pickSplitSide('ODU')}
            >
              ODU — outdoor<i>{splitOutdoors.length}</i>
            </button>
          </div>

          <div className="table-wrap">
            <p className="muted" style={{ margin: '0 0 8px' }}>
              <b>{totalSets}</b> complete set{totalSets === 1 ? '' : 's'} on hand.
              A set is one IDU and its ODU; link them on the IDU's Edit form.
            </p>

            {splitSide === 'IDU' && (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Name</th>
                    <th>Qty</th>
                    <th>Rate</th>
                    <th>Its ODU</th>
                    <th>ODU qty</th>
                    <th>Sets</th>
                    <th>Match</th>
                    {canManage && <th>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {splitPairs.length === 0 && (
                    <tr><td colSpan={canManage ? 9 : 8} className="muted">No indoor halves in this division yet.</td></tr>
                  )}
                  {splitPairs.map(p => (
                    <tr key={p.indoor.id || p.indoor._id}>
                      <td>{p.indoor.code || '—'}</td>
                      <td>{p.indoor.name}</td>
                      <td>{p.qi}</td>
                      <td>{money(p.indoor.ratePerUnit)}</td>
                      <td>
                        {p.partner
                          ? <>{p.partner.name}<div className="muted">{p.partner.code || '—'}</div></>
                          : <span className="muted">not linked yet</span>}
                      </td>
                      <td>{p.partner ? p.qo : '—'}</td>
                      <td><b>{p.sets}</b></td>
                      <td>
                        {!p.partner
                          ? <span className="status-badge status-pending">no ODU linked</span>
                          : p.qi === p.qo
                            ? <span className="status-badge status-open">balanced</span>
                            : <span className="status-badge status-pending">
                                {Math.abs(p.qi - p.qo)} spare {p.qi > p.qo ? 'IDU' : 'ODU'}
                              </span>}
                      </td>
                      {canManage && (
                        <td>
                          <button className="btn sec sm" onClick={() => openAdjust(p.indoor)} style={{ marginRight: 4 }}>Adjust</button>
                          <button className="btn sec sm" onClick={() => openEdit(p.indoor)}>Edit</button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {splitSide === 'ODU' && (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Name</th>
                    <th>Qty</th>
                    <th>Rate</th>
                    <th>Its IDU</th>
                    <th>Status</th>
                    {canManage && <th>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {splitOutdoors.length === 0 && (
                    <tr><td colSpan={canManage ? 7 : 6} className="muted">No outdoor halves in this division yet.</td></tr>
                  )}
                  {splitOutdoors.map(o => {
                    const mate = splitPairs.find(p => p.partner
                      && String(p.partner.id || p.partner._id) === String(o.id || o._id));
                    return (
                      <tr key={o.id || o._id}>
                        <td>{o.code || '—'}</td>
                        <td>{o.name}</td>
                        <td>{totQty(o)}</td>
                        <td>{money(o.ratePerUnit)}</td>
                        <td>
                          {mate
                            ? <>{mate.indoor.name}<div className="muted">{mate.indoor.code || '—'}</div></>
                            : <span className="muted">not linked yet</span>}
                        </td>
                        <td>
                          {!mate
                            ? <span className="status-badge status-pending">on its own</span>
                            : mate.qi === mate.qo
                              ? <span className="status-badge status-open">balanced</span>
                              : <span className="status-badge status-pending">
                                  {Math.abs(mate.qi - mate.qo)} spare {mate.qi > mate.qo ? 'IDU' : 'ODU'}
                                </span>}
                        </td>
                        {canManage && (
                          <td>
                            <button className="btn sec sm" onClick={() => openAdjust(o)} style={{ marginRight: 4 }}>Adjust</button>
                            <button className="btn sec sm" onClick={() => openEdit(o)}>Edit</button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {!loading && !error && !showingSplit && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Category</th>
                <th>Division</th>
                {group === 'PCB' && <th>Fits</th>}
                <th>Unit</th>
                <th>Qty</th>
                <th>Rate</th>
                <th>Value</th>
                <th>Status</th>
                {canManage && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={(canManage ? 10 : 9) + (group === 'PCB' ? 1 : 0)} className="muted">Nothing in this drawer yet.</td></tr>
              )}
              {filtered.map(item => {
                const qty = totQty(item);
                const state = stockState(item);
                const value = qty * (Number(item.ratePerUnit) || 0);
                return (
                  <tr key={item.id || item._id}>
                    <td>{item.code || '—'}</td>
                    <td>{item.name}</td>
                    <td>{catName(item.categoryId)}</td>
                    <td>{item.division || <span className="muted">—</span>}</td>
                    {group === 'PCB' && (
                      <td>
                        {(item.fitsItemIds || []).length === 0
                          ? <span className="muted">—</span>
                          : (item.fitsItemIds || [])
                              .map(id => itemById(id))
                              .filter(Boolean)
                              .map(x => x.name)
                              .join(', ')}
                      </td>
                    )}
                    <td>{item.unit}</td>
                    <td>{qty}</td>
                    <td>{money(item.ratePerUnit)}</td>
                    <td>{money(value)}</td>
                    <td><span className={`status-badge ${state.cls}`}>{state.label}</span></td>
                    {canManage && (
                      <td>
                        <div className="row-menu">
                          <button
                            type="button"
                            className="btn sec sm row-menu-button"
                            aria-haspopup="menu"
                            aria-expanded={menuFor?.id === (item.id || item._id)}
                            aria-label={`Actions for ${item.name}`}
                            onClick={e => {
                              const id = item.id || item._id;
                              if (menuFor?.id === id) { setMenuFor(null); return; }
                              /* The table scrolls sideways, so a menu drawn
                                 inside it would be clipped. Pin it to the
                                 viewport at the button instead. */
                              const r = e.currentTarget.getBoundingClientRect();
                              setMenuFor({ id, top: r.bottom + 4, left: r.right });
                            }}
                          >
                            &#8943;
                          </button>
                          {menuFor?.id === (item.id || item._id) && (
                            <div
                              className="row-menu-list"
                              role="menu"
                              style={{ top: menuFor.top, left: menuFor.left }}
                            >
                              <button type="button" role="menuitem" onClick={() => { setMenuFor(null); openAdjust(item); }}>Adjust</button>
                              <button type="button" role="menuitem" onClick={() => { setMenuFor(null); openEdit(item); }}>Edit</button>
                              <button type="button" role="menuitem" className="danger" onClick={() => { setMenuFor(null); handleDelete(item); }}>Delete</button>
                            </div>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Owner request (26 Nov 2026): his own size chart under Joints and
          Copper Piping, with the blank Elbow and Socket columns filled in
          from what is on the shelf. */}
      {!loading && !error && group === 'Piping & Refnuts'
        && (subTab === 'Joints' || subTab === 'Copper Piping') && (
        <PipeSizeTable items={shelfItems} shelf={subTab} />
      )}

      {/* Create Item Modal */}
      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal modal-wide" onClick={e => e.stopPropagation()}>
            <h3>New Item</h3>
            <form onSubmit={handleCreate}>
              <div className="form-grid">
                <div className="filter-field"><label>Code</label><input type="text" value={createForm.code} onChange={e => setCreateForm(p => ({ ...p, code: e.target.value }))} /></div>
                <div className="filter-field"><label>Name *</label><input type="text" value={createForm.name} onChange={e => setCreateForm(p => ({ ...p, name: e.target.value }))} required /></div>
                <div className="filter-field"><label>Category</label>
                  <select value={createForm.categoryId} onChange={e => setCreateForm(p => ({ ...p, categoryId: e.target.value }))}>
                    <option value="">— None —</option>
                    {categories.map(c => <option key={c.id || c._id} value={c.id || c._id}>{c.name}</option>)}
                  </select>
                </div>
                <div className="filter-field"><label>Unit</label>
                  <select value={createForm.unit} onChange={e => setCreateForm(p => ({ ...p, unit: e.target.value }))}>
                    {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <div className="filter-field"><label>Division</label>
                  <select value={createForm.division} onChange={e => setCreateForm(p => ({ ...p, division: e.target.value }))}>
                    <option value="">— not set —</option>
                    {ITEM_DIVISIONS.map(d => <option key={d} value={d}>{d === 'Common' ? 'Common (all divisions)' : d}</option>)}
                  </select>
                </div>
                {groupFields(createForm, setCreateForm)}
                <div className="filter-field"><label>Min Stock Level</label><input type="number" value={createForm.minimumStockLevel} onChange={e => setCreateForm(p => ({ ...p, minimumStockLevel: e.target.value }))} /></div>
                <div className="filter-field"><label>Rate/Unit</label><input type="number" value={createForm.ratePerUnit} onChange={e => setCreateForm(p => ({ ...p, ratePerUnit: e.target.value }))} /></div>
                <div className="filter-field"><label>Opening Stock</label><input type="number" value={createForm.openingStock} onChange={e => setCreateForm(p => ({ ...p, openingStock: e.target.value }))} /></div>
                <div className="filter-field"><label>Opening Location</label>
                  <select value={createForm.openingLocationId} onChange={e => setCreateForm(p => ({ ...p, openingLocationId: e.target.value }))}>
                    <option value="">— Select —</option>
                    {locations.map(l => <option key={l.id || l._id} value={l.id || l._id}>{l.name}</option>)}
                  </select>
                </div>
                <div className="filter-field" style={{ alignItems: 'center', flexDirection: 'row', gap: 8 }}>
                  <input type="checkbox" checked={createForm.returnable} onChange={e => setCreateForm(p => ({ ...p, returnable: e.target.checked }))} />
                  <label>Returnable</label>
                </div>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn sec" onClick={() => setShowCreate(false)}>Cancel</button>
                <button type="submit" className="btn pri" disabled={saving}>{saving ? 'Saving...' : 'Create'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Item Modal */}
      {showEdit && (
        <div className="modal-overlay" onClick={() => setShowEdit(null)}>
          <div className="modal modal-wide" onClick={e => e.stopPropagation()}>
            <h3>Edit Item</h3>
            <form onSubmit={handleEdit}>
              <div className="form-grid">
                <div className="filter-field"><label>Code</label><input type="text" value={editForm.code} onChange={e => setEditForm(p => ({ ...p, code: e.target.value }))} /></div>
                <div className="filter-field"><label>Name *</label><input type="text" value={editForm.name} onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))} required /></div>
                <div className="filter-field"><label>Category</label>
                  <select value={editForm.categoryId} onChange={e => setEditForm(p => ({ ...p, categoryId: e.target.value }))}>
                    <option value="">— None —</option>
                    {categories.map(c => <option key={c.id || c._id} value={c.id || c._id}>{c.name}</option>)}
                  </select>
                </div>
                <div className="filter-field"><label>Unit</label>
                  <select value={editForm.unit} onChange={e => setEditForm(p => ({ ...p, unit: e.target.value }))}>
                    {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <div className="filter-field"><label>Division</label>
                  <select value={editForm.division} onChange={e => setEditForm(p => ({ ...p, division: e.target.value }))}>
                    <option value="">— not set —</option>
                    {ITEM_DIVISIONS.map(d => <option key={d} value={d}>{d === 'Common' ? 'Common (all divisions)' : d}</option>)}
                  </select>
                </div>
                {groupFields(editForm, setEditForm)}
                <div className="filter-field"><label>Min Stock Level</label><input type="number" value={editForm.minimumStockLevel} onChange={e => setEditForm(p => ({ ...p, minimumStockLevel: e.target.value }))} /></div>
                <div className="filter-field"><label>Rate/Unit</label><input type="number" value={editForm.ratePerUnit} onChange={e => setEditForm(p => ({ ...p, ratePerUnit: e.target.value }))} /></div>
                <div className="filter-field" style={{ alignItems: 'center', flexDirection: 'row', gap: 8 }}>
                  <input type="checkbox" checked={editForm.returnable} onChange={e => setEditForm(p => ({ ...p, returnable: e.target.checked }))} />
                  <label>Returnable</label>
                </div>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn sec" onClick={() => setShowEdit(null)}>Cancel</button>
                <button type="submit" className="btn pri" disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Adjust Stock Modal */}
      {showAdjust && (
        <div className="modal-overlay" onClick={() => setShowAdjust(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Adjust Stock — {showAdjust.name}</h3>
            <form onSubmit={handleAdjust}>
              <div className="form-grid">
                <div className="filter-field"><label>Location *</label>
                  <select value={adjustForm.locationId} onChange={e => setAdjustForm(p => ({ ...p, locationId: e.target.value }))} required>
                    <option value="">— Select —</option>
                    {locations.map(l => <option key={l.id || l._id} value={l.id || l._id}>{l.name}</option>)}
                  </select>
                </div>
                <div className="filter-field"><label>What are you doing?</label>
                  <select
                    value={adjustForm.mode}
                    onChange={e => setAdjustForm(p => ({
                      ...p,
                      mode: e.target.value,
                      type: e.target.value === 'add' ? 'Purchase In'
                        : e.target.value === 'remove' ? 'Damage / Write-off'
                        : 'Adjustment',
                    }))}
                  >
                    <option value="set">Correcting the count</option>
                    <option value="add">Adding stock</option>
                    <option value="remove">Taking stock out</option>
                  </select>
                </div>
                <div className="filter-field">
                  <label>{adjustForm.mode === 'set' ? 'The correct quantity *' : 'How many *'}</label>
                  <input
                    type="number"
                    min="0"
                    value={adjustForm.quantity}
                    onChange={e => setAdjustForm(p => ({ ...p, quantity: e.target.value }))}
                    required
                  />
                </div>
                <div className="filter-field"><label>Recorded as</label>
                  <select value={adjustForm.type} onChange={e => setAdjustForm(p => ({ ...p, type: e.target.value }))}>
                    {ADJUSTMENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className="filter-field"><label>Remark</label><input type="text" value={adjustForm.remark} onChange={e => setAdjustForm(p => ({ ...p, remark: e.target.value }))} /></div>
              </div>
              {/* Say out loud what is about to happen, so nobody has to
                  work out the arithmetic in their head. */}
              {adjustForm.locationId && (
                <p className="muted" style={{ margin: '4px 0 0' }}>
                  {adjustCurrent()} in stock here now
                  {adjustDelta() !== null && adjustDelta() !== 0 && (
                    <> → <b>{adjustCurrent() + adjustDelta()}</b> after this
                      {' '}({adjustDelta() > 0 ? '+' : ''}{adjustDelta()})</>
                  )}
                  {adjustDelta() === 0 && <> — that is the count already.</>}
                </p>
              )}
              <div className="modal-actions">
                <button type="button" className="btn sec" onClick={() => setShowAdjust(null)}>Cancel</button>
                <button type="submit" className="btn pri" disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

/* PUT helper — api client only has get/post/patch/delete */
function apiPut(path, body) {
  return apiRequest(path, { method: 'PUT', body });
}
