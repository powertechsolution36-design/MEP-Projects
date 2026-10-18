import { money, fmtDate } from '../../utils/format';

/**
 * Shared enquiry filter bar and table — the PWA's `enqFilterBar()`
 * (MEP_PROJECTS_PWA/index.html:1851-1869) and `enqTable()`
 * (index.html:1870-1880).
 *
 * Both the Enquiry List and the Lost Enquiries screen render these in the
 * PWA, from one function each, so they live in one module here too: the two
 * screens can never drift apart, which is exactly what happened before.
 *
 * `showStatus` reproduces the PWA's own parameter — the Lost screen passes
 * false and the Status select is left out (index.html:1861, 1894), because
 * every row on that screen is already Lost.
 */

const RATINGS = ['1', '2', '3', '4', '5'];
// PWA FACT (index.html:1861): the Status filter offers exactly these three.
const STATUSES = ['Open', 'Won', 'Lost'];

export const FILTER_KEYS = [
  'q', 'segment', 'siteType', 'rating', 'status', 'referenceSource',
  'reviewFrom', 'reviewTo', 'nextActionFrom', 'nextActionTo', 'valueMin', 'valueMax',
];

/** The list and the CSV export send the same filters, so the file matches the screen. */
export function filterParams(filters) {
  const params = new URLSearchParams();
  FILTER_KEYS.forEach((k) => { if (filters[k]) params.set(k, filters[k]); });
  return params;
}

/** PWA FACT (`uniq`, index.html:1827): dropdown options come from the rows on screen. */
function uniq(rows, pick) {
  return [...new Set(rows.map(pick).filter(Boolean))].sort();
}

export function FilterSelect({ label, value, options, onChange }) {
  return (
    <div className="filter-field">
      <label>{label}</label>
      <select value={value || ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">All</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

export function EnquiryFilterPanel({ rows, filters, setFilter, clearFilters, showStatus = false }) {
  return (
    <div className="panel filter-panel">
      <div className="filter-head">
        <h3>🔎 Filters &amp; Search</h3>
        <button className="btn sec sm" onClick={clearFilters}>Clear all</button>
      </div>
      <div className="field">
        <label htmlFor="enq-q">Search (project, customer, reference, remark, action)</label>
        <input
          id="enq-q"
          value={filters.q || ''}
          placeholder="type and press Enter..."
          onKeyDown={(e) => e.key === 'Enter' && setFilter('q', e.target.value)}
          onChange={(e) => setFilter('q', e.target.value)}
        />
      </div>
      <div className="filter-grid">
        <FilterSelect label="Segment" value={filters.segment} options={uniq(rows, (x) => x.segment)} onChange={(v) => setFilter('segment', v)} />
        <FilterSelect label="Site Type" value={filters.siteType} options={uniq(rows, (x) => x.siteType)} onChange={(v) => setFilter('siteType', v)} />
        <FilterSelect label="Rating" value={filters.rating} options={RATINGS} onChange={(v) => setFilter('rating', v)} />
        <FilterSelect label="Reference" value={filters.referenceSource} options={uniq(rows, (x) => x.referenceSource)} onChange={(v) => setFilter('referenceSource', v)} />
        {showStatus && (
          <FilterSelect label="Status" value={filters.status} options={STATUSES} onChange={(v) => setFilter('status', v)} />
        )}
        <div className="filter-field">
          <label>Value between (₹)</label>
          <div className="filter-pair">
            <input type="number" placeholder="min" value={filters.valueMin || ''} onChange={(e) => setFilter('valueMin', e.target.value)} />
            <input type="number" placeholder="max" value={filters.valueMax || ''} onChange={(e) => setFilter('valueMax', e.target.value)} />
          </div>
        </div>
        <div className="filter-field">
          <label>Review date from</label>
          <input type="date" value={filters.reviewFrom || ''} onChange={(e) => setFilter('reviewFrom', e.target.value)} />
        </div>
        <div className="filter-field">
          <label>Review date to</label>
          <input type="date" value={filters.reviewTo || ''} onChange={(e) => setFilter('reviewTo', e.target.value)} />
        </div>
        <div className="filter-field">
          <label>Next action from</label>
          <input type="date" value={filters.nextActionFrom || ''} onChange={(e) => setFilter('nextActionFrom', e.target.value)} />
        </div>
        <div className="filter-field">
          <label>Next action to</label>
          <input type="date" value={filters.nextActionTo || ''} onChange={(e) => setFilter('nextActionTo', e.target.value)} />
        </div>
      </div>
    </div>
  );
}

/** PWA FACT (`stars`, index.html:1365): the rating renders as filled stars. */
function stars(n) {
  const count = Number(n) || 0;
  return '★'.repeat(count) || '-';
}

/**
 * PWA FACT (`enqTable`, index.html:1870-1880): thirteen columns in this
 * order, a purple segment chip, stars for the rating, the next-action date
 * flagged only while the enquiry is still Open, and a TOTAL row carrying
 * the row count and the summed value.
 *
 * `extraColumns` lets the Lost screen append its own Lost Reason / Lost On
 * columns (see LostEnquiries.jsx) without a second copy of the table.
 */
export function EnquiryTable({ rows, onOpen, todayKey, extraColumns = [] }) {
  const total = rows.reduce((a, b) => a + (b.estimatedValue || 0), 0);
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Project / Address</th>
            <th>Site Type</th>
            <th>Cap.</th>
            <th>Customer</th>
            <th>Reference</th>
            <th>Segment</th>
            <th>Rating</th>
            <th>Action Done</th>
            <th>Next Action</th>
            <th>Next Date</th>
            <th>Value</th>
            <th>Status</th>
            {extraColumns.map((c) => <th key={c.key}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((e, i) => {
            const nextDate = fmtDate(e.nextActionDate);
            const overdue = e.status === 'Open' && nextDate && nextDate <= todayKey;
            return (
              <tr key={e.id} className="clickable-row" onClick={() => onOpen(e)}>
                <td>{i + 1}</td>
                <td><strong>{e.name}</strong></td>
                <td>{e.siteType || '-'}</td>
                <td>{e.capacity || '-'}</td>
                <td>{e.phone || '-'}</td>
                <td>{e.referenceSource || '-'}</td>
                <td><span className="div-chip b-prp">{e.segment}</span></td>
                <td className="nowrap">{stars(e.rating)}</td>
                <td>{e.lastActionDone || '-'}</td>
                <td>{e.nextActionDescription || '-'}</td>
                <td className={overdue ? 'due' : undefined}>{nextDate || '-'}</td>
                <td>{money(e.estimatedValue) || '-'}</td>
                <td><span className={`status-badge status-${(e.status || '').toLowerCase()}`}>{e.status}</span></td>
                {extraColumns.map((c) => <td key={c.key}>{c.render(e)}</td>)}
              </tr>
            );
          })}
          <tr className="strong">
            <td colSpan={11}>TOTAL — {rows.length} enquir{rows.length === 1 ? 'y' : 'ies'}</td>
            <td>{money(total) || '-'}</td>
            <td colSpan={1 + extraColumns.length}></td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
