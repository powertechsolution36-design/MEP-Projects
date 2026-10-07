/**
 * Shared formatting utilities — PWA-exact behavior.
 *
 * money() reproduces the PWA's own `money(n)` helper (line 1258):
 *   function money(n){if(!n&&n!==0)return"";n=Number(n)||0;return "₹ "+n.toLocaleString("en-IN",{maximumFractionDigits:0})}
 */

export function money(n) {
  if (!n && n !== 0) return '';
  const num = Number(n) || 0;
  return '₹ ' + num.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

/**
 * Format a date value (string or Date) to YYYY-MM-DD for display.
 * PWA uses `today()` which returns YYYY-MM-DD strings.
 */
export function fmtDate(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return String(value);
  return d.toISOString().slice(0, 10);
}

/**
 * Return today's date as YYYY-MM-DD.
 */
export function today() {
  return new Date().toISOString().slice(0, 10);
}
