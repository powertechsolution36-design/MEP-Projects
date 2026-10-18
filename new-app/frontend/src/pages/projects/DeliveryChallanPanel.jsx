import { useState } from 'react';
import { api, getStoredToken } from '../../api/client';
import { API_BASE_URL } from '../../config';
import { fmtDate } from '../../utils/format';
import { todayKey } from '../../utils/platform';

/**
 * Delivery Challans — PWA `challanPanel()` / `mDC()` / `saveDC()` /
 * `mDCItem()` / `printDC()` / `mReturn()`
 * (MEP_PROJECTS_PWA/index.html:2331-2469).
 *
 * The PWA keeps challan lines in one flat array on the project, every line
 * carrying its own `no`/`date`/`by`/`remark`, and groups them for display by
 * challan number (index.html:2343-2346). This backend stores exactly the
 * same shape (Project.deliveryChallans[]), so the grouping is reproduced
 * here rather than invented server-side:
 *
 *   groups[String(d.no)] = { date, by, remark, items }   first row wins
 *   order sorted by numeric challan number, ascending
 *   items keep insertion order within their group
 *
 * Each group is one physical document: it gets a header row, an "add item to
 * this DC" action and its own printable challan (`printDC`). The tally row,
 * the returnable banners and the per-row balance all come from the PWA.
 */

// PWA FACT (dcItemRow, index.html:2374): the unit is a fixed list, not free text.
const UNITS = ['Nos', 'Mtr', 'Kg', 'Set', 'Box', 'Roll', 'Ltr'];
// PWA FACT (DCROWS, index.html:2372): the new-challan form opens with 3 blank rows.
const BLANK_ROWS = 3;

function blankItem() {
  return { materialName: '', quantity: '', unit: 'Nos', returnable: false };
}

/** PWA FACT (index.html:2360): a returnable line's balance still on site. */
function lineBalance(d) {
  return (Number(d.quantity) || 0) - (Number(d.returnedQuantity) || 0);
}

/** PWA FACT (nextDCNo, index.html:2332-2335): max numeric part + 1, per project. */
function nextChallanNumber(rows) {
  let max = 0;
  rows.forEach((d) => {
    const n = parseInt(String(d.challanNumber).replace(/\D/g, ''), 10);
    if (!Number.isNaN(n) && n > max) max = n;
  });
  return String(max + 1);
}

/**
 * PWA FACT (printDC, index.html:2430-2446): one printable document per
 * challan number — company header, the challan's meta grid, its item table
 * and two signature blocks. Opened in a new window and printed there, so
 * the on-screen app is never replaced by a print view.
 *
 * Styling note: the heading colour follows this app's own document styling
 * (the quotation and AMC documents use the same brand blue) instead of the
 * PWA's red, so every document the company sends looks like one family.
 * Content, columns and signature wording are unchanged.
 */
function buildChallanHtml({ challanNumber, group, project, company }) {
  const esc = (v) => String(v === undefined || v === null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const co = company || {};
  const rows = group.items.map((entry, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${esc(entry.d.materialName)}</td>
        <td>${esc(entry.d.quantity)}</td>
        <td>${esc(entry.d.unit || '')}</td>
        <td>${entry.d.returnable ? 'Returnable' : 'Consumable'}</td>
        <td>${esc(entry.d.remark || '')}</td>
      </tr>`).join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Delivery Challan ${esc(challanNumber)}</title>
<style>
  body { font-family: "Segoe UI", Arial, sans-serif; font-size: 12px; padding: 26px; color: #16202e; }
  h1 { color: #123f7a; font-size: 20px; margin: 0; }
  h2 { font-size: 15px; margin: 14px 0 8px; border-bottom: 2px solid #123f7a; padding-bottom: 3px; }
  .sub { color: #526372; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 6px; }
  th { background: #f4f6f8; text-align: left; padding: 6px; border: 1px solid #d4dbe3; }
  td { padding: 6px; border: 1px solid #e2e7ec; }
  .g { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 14px; margin-top: 8px; }
  .g span { color: #6c7c8c; }
  .sig { margin-top: 46px; display: grid; grid-template-columns: 1fr 1fr; gap: 40px; }
  .sig div { border-top: 1px solid #333; padding-top: 5px; }
  @media print { body { padding: 0; } }
</style></head><body>
<h1>${esc(co.displayName || co.name || '')}</h1>
<div class="sub">${[co.address, co.phone, co.email].filter(Boolean).map(esc).join(' · ')}</div>
<h2>DELIVERY CHALLAN — No. ${esc(challanNumber)}</h2>
<div class="g">
  <div><span>Project:</span> <b>${esc(project.name)}</b></div>
  <div><span>SO No:</span> <b>${esc(project.salesOrderNumber || '-')}</b></div>
  <div><span>Date:</span> <b>${esc(fmtDate(group.date))}</b></div>
  <div><span>Received By:</span> <b>${esc(group.receivedByName || '')}</b></div>
  <div><span>Customer:</span> ${esc(project.customer || '-')}</div>
  <div><span>Division:</span> ${esc(project.division)}</div>
</div>
<table>
  <thead><tr><th>#</th><th>Material Description</th><th>Qty</th><th>Unit</th><th>Type</th><th>Remark</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
<div class="sig">
  <div>Delivered By / ${esc(co.displayName || co.name || '')}</div>
  <div>Received By (Client / Site)</div>
</div>
</body></html>`;
}

export default function DeliveryChallanPanel({ project, projectId, canAct, notInService, onProjectUpdated }) {
  const rows = project.deliveryChallans || [];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [form, setForm] = useState(null); // { challanNumber, appending, date, receivedByName, remark, items }
  const [editIdx, setEditIdx] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [returnIdx, setReturnIdx] = useState(null);
  const [returnForm, setReturnForm] = useState({ quantity: '', remark: '' });

  // PWA FACT (index.html:2343-2346): group by challan number, first row of a
  // group carries its shared header values, groups sorted numerically.
  const groups = new Map();
  rows.forEach((d, i) => {
    const key = String(d.challanNumber || '-');
    if (!groups.has(key)) {
      groups.set(key, { date: d.date, receivedByName: d.receivedByName, remark: d.remark, items: [] });
    }
    groups.get(key).items.push({ d, i });
  });
  const order = [...groups.keys()].sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0));

  // PWA FACT (index.html:2339-2342): the panel's tallies.
  const deliveredQty = rows.reduce((a, d) => a + (Number(d.quantity) || 0), 0);
  const returnableQty = rows.filter((d) => d.returnable).reduce((a, d) => a + (Number(d.quantity) || 0), 0);
  const returnedQty = rows.reduce((a, d) => a + (Number(d.returnedQuantity) || 0), 0);
  const pendingReturn = rows.filter((d) => d.returnable).reduce((a, d) => a + lineBalance(d), 0);
  const columnCount = canAct && notInService ? 10 : 9;

  function openNew(challanNumber) {
    const appending = Boolean(challanNumber);
    const existing = appending ? rows.find((d) => String(d.challanNumber) === String(challanNumber)) : null;
    setError(null);
    setForm({
      challanNumber: challanNumber || nextChallanNumber(rows),
      appending,
      date: existing ? fmtDate(existing.date) : todayKey(),
      receivedByName: existing ? existing.receivedByName || '' : '',
      remark: existing ? existing.remark || '' : '',
      items: Array.from({ length: BLANK_ROWS }, blankItem),
    });
  }

  function setItem(i, patch) {
    setForm((f) => ({ ...f, items: f.items.map((row, j) => (j === i ? { ...row, ...patch } : row)) }));
  }

  async function save() {
    // PWA FACT (saveDC, index.html:2405-2409): rows without a material name
    // are skipped silently; at least one real item is required.
    const items = form.items.filter((r) => r.materialName.trim());
    if (!items.length) { setError('Enter at least one material item'); return; }
    setBusy(true);
    setError(null);
    try {
      const data = await api.post(`/api/projects/${projectId}/delivery-challans`, {
        challanNumber: form.challanNumber,
        date: form.date,
        receivedByName: form.receivedByName,
        remark: form.remark,
        items,
      });
      onProjectUpdated(data.project);
      setForm(null);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  function openEdit(i) {
    const d = rows[i];
    setEditIdx(i);
    setEditForm({
      date: fmtDate(d.date),
      receivedByName: d.receivedByName || '',
      materialName: d.materialName || '',
      quantity: d.quantity || '',
      unit: d.unit || 'Nos',
      returnable: Boolean(d.returnable),
      remark: d.remark || '',
    });
  }

  async function saveEdit() {
    if (!editForm.materialName.trim()) { setError('Enter material'); return; }
    setBusy(true);
    try {
      const data = await api.patch(`/api/projects/${projectId}/delivery-challans/${editIdx}`, editForm);
      onProjectUpdated(data.project);
      setEditIdx(null);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  async function remove(i) {
    // PWA FACT (rmDC, index.html:2447).
    if (!window.confirm('Remove this material entry?')) return;
    setBusy(true);
    try {
      const data = await api.delete(`/api/projects/${projectId}/delivery-challans/${i}`);
      onProjectUpdated(data.project);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  function openReturn(i) {
    // PWA FACT (mReturn, index.html:2452): the quantity defaults to the balance.
    setReturnIdx(i);
    setReturnForm({ quantity: String(lineBalance(rows[i])), remark: '' });
  }

  async function saveReturn() {
    setBusy(true);
    try {
      const data = await api.post(`/api/projects/${projectId}/delivery-challans/${returnIdx}/return`, {
        quantity: Number(returnForm.quantity) || 0,
        remark: returnForm.remark,
      });
      onProjectUpdated(data.project);
      setReturnIdx(null);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  async function printChallan(challanNumber) {
    try {
      // The printed challan carries the company's own letterhead, which
      // lives in the Company Profile (the authority for company details).
      const profile = await api.get('/api/companies/my-profile').catch(() => null);
      const html = buildChallanHtml({
        challanNumber,
        group: groups.get(challanNumber),
        project,
        company: profile ? profile.company : null,
      });
      const w = window.open('', '_blank');
      if (!w) { setError('Allow pop-ups to print the challan'); return; }
      w.document.write(html);
      w.document.close();
      setTimeout(() => w.print(), 400);
    } catch (err) { setError(err.message); }
  }

  async function exportCsv() {
    try {
      const resp = await fetch(`${API_BASE_URL}/api/projects/${projectId}/delivery-challans/export.csv`, {
        headers: { Authorization: `Bearer ${getStoredToken()}` },
      });
      if (!resp.ok) throw new Error('Export failed');
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `challan-${project.name || 'project'}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) { setError(`Export failed: ${err.message}`); }
  }

  return (
    <div className="panel flush">
      <div className="panel-head">
        <h3>📦 Delivery Challans — Material</h3>
        <div className="panel-head-meta">
          <span className="status-badge status-open">{order.length} DC · {rows.length} items</span>
          {returnableQty > 0 && (
            <span className={`status-badge ${pendingReturn > 0 ? 'status-lost' : 'status-received'}`}>
              Returnable pending: {pendingReturn}
            </span>
          )}
          {canAct && notInService && (
            <button className="btn pri sm" onClick={() => openNew(null)}>+ New Delivery Challan</button>
          )}
          <button className="btn sec sm" onClick={exportCsv}>📥 Export</button>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {rows.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📦</div>
          <div className="empty-state-title">No material recorded yet.</div>
          <p className="muted">
            Create a delivery challan for each material delivery — DC numbers run 1, 2, 3… for this project.
          </p>
        </div>
      ) : (
        <>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>DC No</th>
                  <th>#</th>
                  <th>Material</th>
                  <th>Qty</th>
                  <th>Unit</th>
                  <th>Type</th>
                  <th>Returned</th>
                  <th>Balance on Site</th>
                  <th>Remark</th>
                  {canAct && notInService && <th></th>}
                </tr>
              </thead>
              <tbody>
                {order.map((key) => {
                  const g = groups.get(key);
                  return [
                    <tr key={`g-${key}`} className="group-row">
                      <td colSpan={columnCount}>
                        <strong>DC No {key}</strong> · {fmtDate(g.date)} · Received by: {g.receivedByName || '-'}
                        {g.remark ? ` · ${g.remark}` : ''}
                        {canAct && notInService && (
                          <span className="btn-row" style={{ marginLeft: 8 }}>
                            <button className="btn ghost sm" onClick={() => openNew(key)}>+ add item to this DC</button>
                            <button className="btn sec sm" onClick={() => printChallan(key)}>🖨 Print DC</button>
                          </span>
                        )}
                        {!(canAct && notInService) && (
                          <button className="btn sec sm" style={{ marginLeft: 8 }} onClick={() => printChallan(key)}>🖨 Print DC</button>
                        )}
                      </td>
                    </tr>,
                    ...g.items.map((entry, n) => {
                      const d = entry.d;
                      const bal = lineBalance(d);
                      return (
                        <tr key={`i-${entry.i}`} className={d.returnable && bal > 0 ? 'row-bad' : undefined}>
                          <td></td>
                          <td>{n + 1}</td>
                          <td><strong>{d.materialName}</strong></td>
                          <td>{d.quantity}</td>
                          <td>{d.unit || '-'}</td>
                          <td>
                            <span className={`div-chip ${d.returnable ? 'b-prp' : 'b-gry'}`}>
                              {d.returnable ? 'Returnable' : 'Consumable'}
                            </span>
                          </td>
                          <td>{d.returnable ? (d.returnedQuantity || 0) : '-'}</td>
                          <td className={d.returnable && bal > 0 ? 'due' : undefined}>{d.returnable ? bal : '-'}</td>
                          <td>{d.remark || '-'}</td>
                          {canAct && notInService && (
                            <td className="nowrap">
                              <div className="btn-row">
                                {d.returnable && <button className="btn sec sm" onClick={() => openReturn(entry.i)}>Return</button>}
                                <button className="btn sec sm" onClick={() => openEdit(entry.i)}>Edit</button>
                                <button className="btn danger sm" onClick={() => remove(entry.i)}>✕</button>
                              </div>
                            </td>
                          )}
                        </tr>
                      );
                    }),
                  ];
                })}
                {/* PWA FACT (index.html:2365): the TALLY row. */}
                <tr className="strong">
                  <td colSpan={3}>TALLY</td>
                  <td>{deliveredQty}</td>
                  <td colSpan={2}>total delivered qty</td>
                  <td>{returnedQty}</td>
                  <td colSpan={canAct && notInService ? 3 : 2}>{pendingReturn} to return</td>
                </tr>
              </tbody>
            </table>
          </div>
          {/* PWA FACT (index.html:2367-2368). */}
          {pendingReturn > 0 ? (
            <div className="alert alert-warn">
              {pendingReturn} returnable qty still on site — must be returned to office before project closure.
            </div>
          ) : (
            returnableQty > 0 && <div className="alert alert-success">✔ All returnable material returned to office.</div>
          )}
        </>
      )}

      {/* New / append challan — PWA `mDC()` (index.html:2380-2399) */}
      {form && (
        <div className="modal-overlay" onClick={() => setForm(null)}>
          <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
            <h3>{form.appending ? `Add items to DC No ${form.challanNumber}` : 'New Delivery Challan'}</h3>
            <div className="form-grid">
              <div className="filter-field">
                <label>DC No (auto)</label>
                <input value={form.challanNumber} readOnly className="mono strong" />
              </div>
              <div className="filter-field">
                <label>Date</label>
                <input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
              </div>
              <div className="filter-field">
                <label>Received By (site)</label>
                <input value={form.receivedByName} onChange={(e) => setForm((f) => ({ ...f, receivedByName: e.target.value }))} />
              </div>
              <div className="filter-field full-width">
                <label>DC Remark</label>
                <input value={form.remark} onChange={(e) => setForm((f) => ({ ...f, remark: e.target.value }))} />
              </div>
            </div>
            <h4 className="section-title">Items</h4>
            {form.items.map((item, i) => (
              <div className="fu-row" key={i}>
                <input
                  placeholder="Material description"
                  value={item.materialName}
                  onChange={(e) => setItem(i, { materialName: e.target.value })}
                  className="grow"
                />
                <input
                  type="number"
                  placeholder="Qty"
                  value={item.quantity}
                  onChange={(e) => setItem(i, { quantity: e.target.value })}
                />
                <select value={item.unit} onChange={(e) => setItem(i, { unit: e.target.value })}>
                  {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
                <select
                  value={item.returnable ? '1' : '0'}
                  onChange={(e) => setItem(i, { returnable: e.target.value === '1' })}
                >
                  <option value="0">Consumable</option>
                  <option value="1">Returnable</option>
                </select>
                {form.items.length > 1 && (
                  <button type="button" className="btn danger sm" onClick={() => setForm((f) => ({ ...f, items: f.items.filter((_, j) => j !== i) }))}>✕</button>
                )}
              </div>
            ))}
            <button
              type="button"
              className="btn sec sm"
              onClick={() => setForm((f) => ({ ...f, items: [...f.items, blankItem()] }))}
            >
              + Add another item
            </button>
            {error && <div className="alert alert-error">{error}</div>}
            <div className="modal-actions">
              <button className="btn sec sm" onClick={() => setForm(null)}>Cancel</button>
              <button className="btn pri sm" onClick={save} disabled={busy}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit one item — PWA `mDCItem()` (index.html:2412-2421) */}
      {editIdx !== null && (
        <div className="modal-overlay" onClick={() => setEditIdx(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Edit Material Entry</h3>
            <div className="form-grid">
              <div className="filter-field">
                <label>Date</label>
                <input type="date" value={editForm.date} onChange={(e) => setEditForm((f) => ({ ...f, date: e.target.value }))} />
              </div>
              <div className="filter-field">
                <label>Received By (site)</label>
                <input value={editForm.receivedByName} onChange={(e) => setEditForm((f) => ({ ...f, receivedByName: e.target.value }))} />
              </div>
              <div className="filter-field">
                <label>Type</label>
                <select value={editForm.returnable ? '1' : '0'} onChange={(e) => setEditForm((f) => ({ ...f, returnable: e.target.value === '1' }))}>
                  <option value="0">Consumable</option>
                  <option value="1">Returnable</option>
                </select>
              </div>
              <div className="filter-field">
                <label>Material</label>
                <input value={editForm.materialName} onChange={(e) => setEditForm((f) => ({ ...f, materialName: e.target.value }))} />
              </div>
              <div className="filter-field">
                <label>Qty</label>
                <input type="number" value={editForm.quantity} onChange={(e) => setEditForm((f) => ({ ...f, quantity: e.target.value }))} />
              </div>
              <div className="filter-field">
                <label>Unit</label>
                <select value={editForm.unit} onChange={(e) => setEditForm((f) => ({ ...f, unit: e.target.value }))}>
                  {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div className="filter-field full-width">
                <label>Remark</label>
                <input value={editForm.remark} onChange={(e) => setEditForm((f) => ({ ...f, remark: e.target.value }))} />
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn sec sm" onClick={() => setEditIdx(null)}>Cancel</button>
              <button className="btn pri sm" onClick={saveEdit} disabled={busy}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Record a return — PWA `mReturn()` (index.html:2448-2456) */}
      {returnIdx !== null && (
        <div className="modal-overlay" onClick={() => setReturnIdx(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Record Material Return</h3>
            <p className="muted">
              DC No {rows[returnIdx].challanNumber} — {rows[returnIdx].materialName}
              <br />Delivered: {rows[returnIdx].quantity} · already returned: {rows[returnIdx].returnedQuantity || 0}
              {' '}· balance on site: {lineBalance(rows[returnIdx])}
            </p>
            <div className="filter-field">
              <label>Return Quantity</label>
              <input type="number" value={returnForm.quantity} onChange={(e) => setReturnForm((f) => ({ ...f, quantity: e.target.value }))} />
            </div>
            <div className="filter-field">
              <label>Returned By / Remark</label>
              <input value={returnForm.remark} onChange={(e) => setReturnForm((f) => ({ ...f, remark: e.target.value }))} />
            </div>
            <div className="modal-actions">
              <button className="btn sec sm" onClick={() => setReturnIdx(null)}>Cancel</button>
              <button className="btn pri sm" onClick={saveReturn} disabled={busy || !returnForm.quantity}>Return</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
