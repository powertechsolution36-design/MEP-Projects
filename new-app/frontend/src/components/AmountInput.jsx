/**
 * Money and GST inputs for the quotation screens.
 *
 * Owner request (14 Nov 2026): an amount box was a spinner that started at
 * 0, so typing 25000 meant first clearing the 0, and a stray scroll over the
 * box silently changed the price. Amounts are plain text boxes now — empty
 * when there is nothing in them, digits and one decimal point accepted, no
 * arrows to nudge. GST is picked from a list rather than typed.
 */
import { useState } from 'react';

/** The rates India actually charges, in the order they are met. */
export const GST_RATES = [0, 5, 12, 18, 28];

/**
 * value is a number (0 included) or '' / null for "nothing entered".
 * onChange is given a number, or '' when the box is cleared.
 */
export default function AmountInput({ value, onChange, placeholder = '', style, title, ariaLabel, allowDecimal = true }) {
  // What the person has typed, kept while it is mid-edit ("12." is not a
  // number yet but must not be snatched away from under the cursor).
  const [typing, setTyping] = useState(null);
  const shown = typing !== null
    ? typing
    : (value === '' || value === null || value === undefined || Number(value) === 0 ? '' : String(value));

  function handle(raw) {
    const cleaned = allowDecimal
      ? raw.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1')
      : raw.replace(/\D/g, '');
    setTyping(cleaned);
    onChange(cleaned === '' || cleaned === '.' ? '' : Number(cleaned));
  }

  return (
    <input
      type="text"
      inputMode={allowDecimal ? 'decimal' : 'numeric'}
      value={shown}
      onChange={(e) => handle(e.target.value)}
      onBlur={() => setTyping(null)}
      placeholder={placeholder}
      style={style}
      title={title}
      aria-label={ariaLabel}
    />
  );
}

/**
 * GST picker. `blankLabel` is what an empty choice means on this screen —
 * "no GST" on the quotation as a whole, "use the quotation's %" on a line.
 * `blankValue` is what that choice sends back (0 or null).
 */
export function GstSelect({ value, onChange, blankLabel = 'No GST', blankValue = 0, style, title, ariaLabel }) {
  const current = value === '' || value === null || value === undefined ? '' : String(Number(value));
  const rates = GST_RATES.filter((r) => !(blankValue === 0 && r === 0));
  return (
    <select
      value={current}
      onChange={(e) => onChange(e.target.value === '' ? blankValue : Number(e.target.value))}
      style={style}
      title={title}
      aria-label={ariaLabel}
    >
      <option value="">{blankLabel}</option>
      {rates.map((r) => <option key={r} value={r}>{r}%</option>)}
      {/* A rate saved earlier that is not one of the usual five stays shown. */}
      {current !== '' && !rates.map(String).includes(current) && <option value={current}>{current}%</option>}
    </select>
  );
}
