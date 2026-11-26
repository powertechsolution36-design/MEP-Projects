/**
 * The pipe-size chart, with your own stock written into it.
 *
 * Owner request (26 Nov 2026): "under Joints and Copper Piping create
 * this type of table" -- the MM / fractional inch / decimal inch chart
 * from his own workbook, whose Elbow and Socket columns were left blank
 * on paper. Here they are filled in from the stock on the shelf, so the
 * chart answers "what do I actually have in 3/4?" rather than only "what
 * is 3/4 in mm?".
 *
 * The chart rows are his, copied from the workbook's "Inventory" sheet
 * exactly as written, 1mm to 34mm -- not recalculated, not extended. A
 * size held in stock that falls outside the chart is listed underneath
 * rather than silently dropped or quietly added to the chart.
 */

// [mm, approximate size in fractional inches, size in decimal inches]
// -- MACHINE_INVENTORY_CLEANED.xlsx, sheet "Inventory", rows 5-38.
const CHART = [
  [1, '1/32 inch', 0.039], [2, '1/16 inch', 0.078], [3, '3/32 inch', 0.118],
  [4, '1/8 inch', 0.157], [5, '3/16 inch', 0.196],
  [6, 'Slightly Less Than 1/4 inch', 0.236], [7, 'Slightly More Than 1/4 inch', 0.275],
  [8, '5/16 inch', 0.314],
  [9, 'Slightly Less Than 3/8 inch', 0.354], [10, 'Slightly More Than 3/8 inch', 0.393],
  [11, '7/16 inch', 0.433],
  [12, 'Slightly Less Than 1/2 inch', 0.472], [13, 'Slightly More Than 1/2 inch', 0.511],
  [14, '9/16 inch', 0.551],
  [15, 'Slightly Less Than 5/8 inch', 0.59], [16, '5/8 inch', 0.629],
  [17, 'Slightly Less Than 11/16 inch', 0.669],
  [18, 'Slightly Less Than 3/4 inch', 0.708], [19, 'Slightly More Than 3/4 inch', 0.748],
  [20, 'Slightly Less Than 13/16 inch', 0.787], [21, 'Slightly More Than 13/16 inch', 0.826],
  [22, 'Slightly Less Than 7/8 inch', 0.866], [23, 'Slightly More Than 7/8 inch', 0.905],
  [24, '15/16 inch', 0.944], [25, 'About 1 inch', 0.983],
  [26, 'About 1-1/32 inch', 1.025], [27, 'About 1-1/16 inch', 1.063],
  [28, 'About 1-1/8 inch', 1.1024], [29, 'About 1-5/32 inch', 1.141],
  [30, 'About 1-3/16 inch', 1.1811], [31, 'About 1-7/32 inch', 1.22],
  [32, 'Slightly More Than 1-1/4 inch', 1.26], [33, 'About 1-5/16 inch', 1.3],
  [34, 'About 1-11/32 inch', 1.339],
];

/**
 * The size an item name is talking about, in inches.
 *
 * Two spellings are in the data, both his:
 *   ELBOW 3"4"   -- numerator then denominator; a two-digit first number
 *                   is a whole inch and a numerator, so 13"8" is 1 3/8
 *   3/8 H copper pipe, 34.9 mm 13/8, 31.8 mm
 */
export function sizeInInches(name) {
  const text = String(name || '');

  // 3"4"  /  13"8"
  const quoted = text.match(/(\d{1,2})\s*"\s*(\d{1,2})\s*"/);
  if (quoted) {
    const first = quoted[1];
    const den = Number(quoted[2]);
    if (den > 0) {
      if (first.length === 2) return Number(first[0]) + Number(first[1]) / den;
      return Number(first) / den;
    }
  }

  // "34.9 mm 13/8" and "31.8 mm" -- the millimetre reading is the plainer
  // of the two, so it wins where both appear.
  const mm = text.match(/(\d{2}(?:\.\d+)?)\s*"?\s*mm/i);
  if (mm) return Number(mm[1]) / 25.4;

  // 1 3/8 copper pipe  /  3/8 H copper pipe
  const mixed = text.match(/(?:^|\s)(\d)\s+(\d{1,2})\s*\/\s*(\d{1,2})/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = text.match(/(?:^|\s)(\d{1,2})\s*\/\s*(\d{1,2})/);
  if (frac && Number(frac[2]) > 0) return Number(frac[1]) / Number(frac[2]);

  return null;
}

/**
 * How the size would be written on his chart: 1.125 -> "1-1/8", 0.75 ->
 * "3/4". Only the eighths the trade uses, which is all the stock holds.
 */
const EIGHTHS = [[0.125, '1/8'], [0.25, '1/4'], [0.375, '3/8'], [0.5, '1/2'],
  [0.625, '5/8'], [0.75, '3/4'], [0.875, '7/8']];
function asFractionText(inches) {
  const whole = Math.floor(inches + 1e-6);
  const rest = inches - whole;
  if (rest < 0.01) return whole ? String(whole) : null;
  const hit = EIGHTHS.find(([v]) => Math.abs(v - rest) < 0.01);
  if (!hit) return null;
  return whole ? `${whole}-${hit[1]}` : hit[1];
}

/**
 * The chart row a size belongs on.
 *
 * His chart names some sizes outright ("About 1-1/8 inch"), and where it
 * does, that row wins -- a row labelled 1-1/8 should hold the 1-1/8
 * fittings even when the decimal next door is a hair closer. Where it
 * names a size twice ("slightly less than 3/4", "slightly more than
 * 3/4"), and everywhere else, the nearest decimal decides.
 */
function chartRowFor(rows, inches) {
  const text = asFractionText(inches);
  let pool = rows;
  if (text) {
    // A plain "1/8" must not be read out of "1-1/8".
    const token = text.includes('-') ? text : `(?<![-\\d])${text}`;
    const re = new RegExp(`${token}(?![\\d/])`);
    const named = rows.filter((r) => re.test(r.fraction));
    if (named.length) pool = named;
  }
  let best = null;
  for (const r of pool) {
    const gap = Math.abs(r.decimal - inches);
    if (!best || gap < best.gap) best = { r, gap };
  }
  return best;
}

function kindOf(name) {
  const t = String(name || '').toUpperCase();
  if (t.includes('ELBOW')) return 'elbow';
  if (t.includes('SOCKET')) return 'socket';
  return 'other';
}

function qtyOf(item) {
  const map = item.stockByLocation || {};
  return Object.values(map).reduce((s, v) => s + (Number(v) || 0), 0);
}

/**
 * @param shelf 'Joints' -> Elbow and Socket columns; anything else -> one
 *              column of what is on that shelf at each size.
 */
export default function PipeSizeTable({ items, shelf }) {
  const joints = shelf === 'Joints';
  const rows = CHART.map(([mm, fraction, decimal]) => ({
    mm, fraction, decimal, elbow: 0, socket: 0, other: 0, matched: false,
  }));
  const offChart = [];

  for (const item of items || []) {
    const inches = sizeInInches(item.name);
    const qty = qtyOf(item);
    if (inches === null) {
      offChart.push({ name: item.name, qty, why: 'no size in the name' });
      continue;
    }
    const best = chartRowFor(rows, inches);
    // 1-3/8 is 34.9mm and his chart stops at 34mm ("about 1-11/32"), so
    // the window has to be wide enough to reach that last row -- and
    // narrow enough that 1-5/8, which has no row at all, still falls out.
    if (!best || best.gap > 0.05) {
      offChart.push({ name: item.name, qty, why: `${inches.toFixed(3)} inch is past the chart` });
      continue;
    }
    best.r.matched = true;
    best.r[kindOf(item.name)] += qty;
  }

  return (
    <div className="panel" style={{ marginTop: 14 }}>
      <h3 style={{ marginTop: 0, fontSize: 16 }}>
        Size chart — {joints ? 'elbows and sockets' : 'pipe'} you hold at each size
      </h3>
      <div className="table-wrap">
        <table className="data-table size-chart">
          <thead>
            <tr>
              <th>MM</th>
              <th>Approximate Size in Fractional Inches</th>
              <th>Size in Decimal Inches</th>
              {joints ? <><th>Elbow</th><th>Socket</th></> : <th>In stock</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.mm} className={r.matched ? '' : 'muted-row'}>
                <td><b>{r.mm}mm</b></td>
                <td>{r.fraction}</td>
                <td>{r.decimal}</td>
                {joints ? (
                  <>
                    <td>{r.elbow || <span className="muted">—</span>}</td>
                    <td>{r.socket || <span className="muted">—</span>}</td>
                  </>
                ) : (
                  <td>{(r.elbow + r.socket + r.other) || <span className="muted">—</span>}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {offChart.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <p className="muted" style={{ margin: '0 0 4px' }}>
            On this shelf but not on the chart, which ends at 34mm:
          </p>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {offChart.map((o, i) => (
              <li key={i}>{o.name} — {o.qty} <span className="muted">({o.why})</span></li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
