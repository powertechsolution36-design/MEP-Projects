import { useState } from 'react';
import { money } from '../../utils/format';

/**
 * The Equipment / Accessories line-item editor, shared by the create and the
 * edit screens so the two cannot drift apart.
 *
 * A line is one of four kinds (owner request, 22 Oct 2026 — the Ducted and
 * VRF offers in C:\Quotation need all of them; a Split offer uses only the
 * first):
 *
 *   item     a priced line, numbered 1, 2, 3 … within its section
 *   sub      a priced line with no number, sitting under a heading
 *            ("24 G", "22 G", "Canvas Connection" under Ducting & Accessories)
 *   heading  a bold sub-heading (OUTDOOR UNITS, INDOOR UNITS …)
 *   spec     a specification paragraph that carries no price
 *
 * The numbers shown here are what the server will store: it numbers the
 * 'item' rows and leaves the rest blank.
 */

export const EMPTY_LINE = {
  rowType: 'item', description: '', unit: 'Nos', qty: 1, supplyRate: 0, installationRate: 0, gstPercent: null,
};

const ROW_LABEL = { heading: 'Heading', spec: 'Specification', sub: 'Sub-row' };

/** Item description input with autocomplete from the item-name library. */
function ItemAutocomplete({ value, onChange, onAutocomplete }) {
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  async function handleInput(val) {
    onChange(val);
    if (val.length >= 2 && onAutocomplete) {
      try {
        const data = await onAutocomplete(val);
        setSuggestions(data || []);
        setShowSuggestions(true);
      } catch { setSuggestions([]); }
    } else {
      setSuggestions([]);
      setShowSuggestions(false);
    }
  }

  return (
    <div style={{ position: 'relative' }}>
      <input
        value={value || ''}
        onChange={e => handleInput(e.target.value)}
        onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
        onFocus={() => { if (suggestions.length) setShowSuggestions(true); }}
        placeholder="Item description"
        style={{ width: '100%' }}
      />
      {showSuggestions && suggestions.length > 0 && (
        <ul style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10,
          background: '#fff', border: '1px solid #ccc', borderRadius: 4,
          listStyle: 'none', margin: 0, padding: 0, maxHeight: 150, overflowY: 'auto',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        }}>
          {suggestions.map((s, i) => (
            <li key={i}
              onMouseDown={() => { onChange(s.name); setShowSuggestions(false); setSuggestions([]); }}
              style={{ padding: '6px 10px', cursor: 'pointer', borderBottom: '1px solid #eee' }}
            >
              {s.name} {s.unit ? <span style={{ color: '#888', fontSize: 12 }}>({s.unit})</span> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function LineItemsEditor({ items, setItems, label, onAutocomplete, isSolar }) {
  function setItemField(idx, key, value) {
    setItems(prev => { const c = [...prev]; c[idx] = { ...c[idx], [key]: value }; return c; });
  }
  function addRow(rowType) {
    setItems(prev => [...prev, {
      ...EMPTY_LINE,
      rowType,
      qty: rowType === 'heading' || rowType === 'spec' ? 0 : 1,
      gstPercent: isSolar && (rowType === 'item' || rowType === 'sub') ? 18 : null,
    }]);
  }
  function removeRow(idx) {
    setItems(prev => prev.filter((_, i) => i !== idx));
  }
  function move(idx, by) {
    setItems(prev => {
      const to = idx + by;
      if (to < 0 || to >= prev.length) return prev;
      const c = [...prev];
      [c[idx], c[to]] = [c[to], c[idx]];
      return c;
    });
  }

  // Columns: # | Description | Unit | Qty | Supply | Install | GST % | Basic (| with GST) | buttons
  // GST % is shown for every division (owner request, 22 Oct 2026): on the
  // high side it may be set per item; left blank, the quotation's own GST %
  // applies.
  const colCount = isSolar ? 9 : 9;
  let number = 0;

  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
        <h3 style={{ margin: 0 }}>{label} Items</h3>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button type="button" className="btn sec sm" onClick={() => addRow('item')}>+ Add Row</button>
          <button type="button" className="btn sec sm" onClick={() => addRow('sub')} title="A priced line with no number, under a heading">+ Sub-row</button>
          <button type="button" className="btn sec sm" onClick={() => addRow('heading')} title="A bold sub-heading, e.g. OUTDOOR UNITS">+ Heading</button>
          <button type="button" className="btn sec sm" onClick={() => addRow('spec')} title="A specification paragraph with no price">+ Specification</button>
        </div>
      </div>
      <div style={{ overflowX: 'auto', marginTop: 8 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: 40 }}>#</th>
              <th style={{ minWidth: 180 }}>Description</th>
              <th style={{ width: 70 }}>Unit</th>
              <th style={{ width: 70 }}>Qty</th>
              <th style={{ width: 100 }}>Supply Rate</th>
              {!isSolar && <th style={{ width: 100 }}>Install Rate</th>}
              <th style={{ width: 80 }}>GST %</th>
              <th style={{ width: 100, textAlign: 'right' }}>Basic Amt</th>
              {isSolar && <th style={{ width: 100, textAlign: 'right' }}>Amt with GST</th>}
              <th style={{ width: 70 }}></th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr><td colSpan={colCount} style={{ textAlign: 'center', color: '#888' }}>No items. Click + Add Row.</td></tr>
            ) : items.map((item, idx) => {
              const rowType = item.rowType || 'item';
              const isText = rowType === 'heading' || rowType === 'spec';
              if (rowType === 'item') number += 1;
              const supplyAmt = (item.qty || 0) * (item.supplyRate || 0);
              const installAmt = (item.qty || 0) * (item.installationRate || 0);
              const basicAmt = isSolar ? supplyAmt : supplyAmt + installAmt;
              const gstPct = item.gstPercent != null ? item.gstPercent : 18;
              const amtWithGst = Math.round(basicAmt * (1 + gstPct / 100));
              const buttons = (
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button type="button" className="btn sec sm" onClick={() => move(idx, -1)} title="Move up">↑</button>{' '}
                  <button type="button" className="btn sec sm" onClick={() => move(idx, 1)} title="Move down">↓</button>{' '}
                  <button type="button" className="btn danger sm" onClick={() => removeRow(idx)} title="Remove">&times;</button>
                </td>
              );

              if (isText) {
                return (
                  <tr key={idx} style={rowType === 'heading' ? { background: '#f4f6fa' } : undefined}>
                    <td style={{ color: '#888', fontSize: 11 }}>{ROW_LABEL[rowType]}</td>
                    <td colSpan={colCount - 2}>
                      {rowType === 'heading' ? (
                        <input
                          value={item.description || ''}
                          onChange={e => setItemField(idx, 'description', e.target.value)}
                          placeholder="e.g. OUTDOOR UNITS"
                          style={{ width: '100%', fontWeight: 700 }}
                        />
                      ) : (
                        <textarea
                          rows={3}
                          value={item.description || ''}
                          onChange={e => setItemField(idx, 'description', e.target.value)}
                          placeholder="Specification text — printed across the table with no price"
                          style={{ width: '100%' }}
                        />
                      )}
                    </td>
                    {buttons}
                  </tr>
                );
              }

              return (
                <tr key={idx}>
                  <td>{rowType === 'item' ? number : <span style={{ color: '#888', fontSize: 11 }}>{ROW_LABEL.sub}</span>}</td>
                  <td>
                    <ItemAutocomplete
                      value={item.description}
                      onChange={val => setItemField(idx, 'description', val)}
                      onAutocomplete={onAutocomplete}
                    />
                  </td>
                  <td><input value={item.unit || ''} onChange={e => setItemField(idx, 'unit', e.target.value)} style={{ width: 60 }} /></td>
                  <td><input type="number" min={0} value={item.qty ?? 0} onChange={e => setItemField(idx, 'qty', Number(e.target.value))} style={{ width: 60 }} /></td>
                  <td><input type="number" min={0} value={item.supplyRate ?? 0} onChange={e => setItemField(idx, 'supplyRate', Number(e.target.value))} style={{ width: 90 }} /></td>
                  {!isSolar && <td><input type="number" min={0} value={item.installationRate ?? 0} onChange={e => setItemField(idx, 'installationRate', Number(e.target.value))} style={{ width: 90 }} /></td>}
                  <td>
                    <input
                      type="number" min={0}
                      value={item.gstPercent != null ? item.gstPercent : ''}
                      onChange={e => setItemField(idx, 'gstPercent', e.target.value === '' ? null : Number(e.target.value))}
                      style={{ width: 70 }}
                      placeholder={isSolar ? '18' : '—'}
                      title={isSolar ? 'GST % for this item' : "GST % for this item — leave blank to use the quotation's GST %"}
                    />
                  </td>
                  <td style={{ textAlign: 'right' }}>{money(basicAmt)}</td>
                  {isSolar && <td style={{ textAlign: 'right' }}>{money(amtWithGst)}</td>}
                  {buttons}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
