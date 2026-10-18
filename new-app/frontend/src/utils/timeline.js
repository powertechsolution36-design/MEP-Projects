/**
 * Project timeline helpers — pure date arithmetic, no React, no I/O.
 *
 * All dates here are "day keys": YYYY-MM-DD strings handled on a UTC basis,
 * the same basis the backend's projectService.daysBetween uses, so the two
 * sides can never disagree about which day a target date falls on.
 */

/** PWA FACT (addDays, MEP_PROJECTS_PWA/index.html:1680). */
export function addDaysKey(key, n) {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `a` to `b`; negative when b precedes a. */
export function daysBetweenKeys(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

export function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Spread `count` checklist points evenly between a start and an end date.
 *
 * PWA FACT (autoFillTimeline, index.html:2592-2602), reproduced exactly:
 *   span          = daysBetween(start, end)
 *   if span < 1   -> span = count        (one day per point)
 *   point i (0-based) = start + round(span * (i + 1) / count)
 *
 * So the last point lands on the end date and the first lands one interval
 * in — the project start itself is not a target date. Rounding can give two
 * early points the same date when the span is short; that is the PWA's own
 * behaviour and is left alone rather than silently "corrected".
 *
 * Returns [] for a project with no checklist points.
 */
export function spreadTimelineDates(startKey, endKey, count) {
  if (!count || count < 1) return [];
  const start = startKey || todayKey();
  const end = endKey || addDaysKey(start, 60);
  let span = daysBetweenKeys(start, end);
  if (span < 1) span = count;
  return Array.from({ length: count }, (_, i) => addDaysKey(start, Math.round((span * (i + 1)) / count)));
}
