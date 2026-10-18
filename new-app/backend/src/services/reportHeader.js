'use strict';

/**
 * Shared CSV report preamble — the PWA's `rptHead()`.
 *
 * PWA FACT (MEP_PROJECTS_PWA/index.html:3417):
 *   function rptHead(title){return [[title.toUpperCase()+" — "+co().name],
 *     ["Generated",today()+" by "+U.name+" ("+ROLES[U.role]+")"],
 *     (srchVal()?["Filter","search: "+srchVal()]:[""]),[]]}
 *
 * Every PWA report CSV starts with these four rows: an upper-cased title
 * carrying the company name, who generated it and when, the active search
 * filter (or one empty cell when no search is applied), then a blank row
 * before the column header. Reproduced here so the exported file names the
 * company and the person who ran it, exactly as the PWA's files did.
 */

// PWA FACT (index.html:1222): `var ROLES={...}` — the human-readable role
// labels the report header prints.
const ROLE_LABELS = Object.freeze({
  super: 'Super Admin',
  admin: 'Admin',
  sales: 'Sales',
  hvac_pm: 'HVAC Project Manager',
  solar_pm: 'Solar Project Manager',
  mep_pm: 'MEP Design Manager',
  engineer: 'Engineer',
  inventory: 'Inventory Manager',
  service_mgr: 'Service Manager',
  service_eng: 'Service Engineer',
  finance: 'Finance',
});

/** PWA FACT (`today()`, index.html:1195): a UTC YYYY-MM-DD day key. */
function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * The four preamble rows as arrays of cells, ready for the caller's own CSV
 * escaping. `company` is the company document (its `displayName` wins over
 * `name`, matching how the rest of the app titles documents); `search` is
 * the screen's active search text, if any.
 */
function reportHeaderRows(title, { company, actorAuth, search } = {}) {
  const companyName = (company && (company.displayName || company.name)) || '';
  const who = (actorAuth && actorAuth.name) || '';
  const roleLabel = (actorAuth && (ROLE_LABELS[actorAuth.role] || actorAuth.role)) || '';
  return [
    [`${String(title).toUpperCase()}${companyName ? ` — ${companyName}` : ''}`],
    ['Generated', `${todayKey()} by ${who}${roleLabel ? ` (${roleLabel})` : ''}`],
    search ? ['Filter', `search: ${search}`] : [''],
    [],
  ];
}

/** A date-stamped report filename, e.g. `payments-2026-10-13.csv`. */
function reportFilename(stem) {
  return `${stem}-${todayKey()}.csv`;
}

module.exports = { ROLE_LABELS, reportHeaderRows, reportFilename, todayKey };
