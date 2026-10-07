'use strict';

/**
 * Legacy, hardcoded checklist point lists — PWA FACT, verified against
 * MEP_PROJECTS_PWA/index.html's `HVAC_CHK`/`SOLAR_CHK`/`MEP_CHK` constants
 * (lines 180-221) and `DB.templates` (line 358), which seeds
 * `DB.templates[div]` from them via `mkchk(...)`.
 *
 * This is NOT a ChecklistTemplate document — the PWA's own `DB.templates`
 * is a single, hardcoded, non-per-company fallback object, distinct from
 * the company-scoped `chkLists()`/ChecklistTemplate collection. `saveSO`
 * falls back to it ONLY when a division has zero ChecklistTemplate rows at
 * all (`tpl = cl ? cl.items : (DB.templates[so.div]||[])`).
 *
 * Locked decision (SalesOrder audit, "Checklist fallback = A"): REPRODUCE
 * this legacy fallback exactly — default ChecklistTemplate -> first
 * ChecklistTemplate for the division -> this legacy list -> empty only
 * when none of the above exist. See
 * new-app/docs/PWA_COVERAGE_AUDIT_SALESORDER.md §10, §21 item 4.
 */

const HVAC_CHK = [
  ['Site takeover with all details and requirements from Sales Team', 'SALES'],
  ['Entire project schedule planned and approved from Sales Team', 'SALES'],
  ['M/c location, copper piping, drain route and hole marking done and approved from client', 'CLIENT'],
  ['Material requirement sheet for low side done, material reached on site, DC signed from client', 'CLIENT'],
  ['Copper piping done as per requirements and aesthetically perfect', 'CLIENT'],
  ['Nitrogen pressure held 650 PSI for 48 hrs, no leakage in copper piping', 'ENGINEER'],
  ['Drain piping done and water flowing by gravity', 'ENGINEER'],
  ['Copper pipe connection to M/c done, nitrogen pressure held 650 PSI for 48 hrs, no leakage', 'ENGINEER'],
  ['Copper pipe & drain pipe finishing aesthetically done', 'CLIENT'],
  ['Electrical and communication connections done properly', 'ENGINEER'],
  ['Machine commissioning done', 'ENGINEER'],
  ['Cooling testing for every machine is OK', 'SERVICE'],
  ['Site handover to Service Department', 'SERVICE'],
];

const SOLAR_CHK = [
  ['Got SO and details from sales team', 'SALES'],
  ['Entire project schedule planned and approved from sales team', 'SALES'],
  ['Application done for MSEB sanction', 'ENGINEER'],
  ['Fabrication design done as per panel qty', 'ENGINEER'],
  ['Cable routes, inverter placements and meter location finalized and approved from client', 'CLIENT'],
  ['Earthing locations approved from client', 'CLIENT'],
  ['Fabrication materials ordered', 'ENGINEER'],
  ['Cables, ACDB, DCDB ordered', 'ENGINEER'],
  ['Panels installed properly', 'ENGINEER'],
  ['Wiring and DB installation done', 'ENGINEER'],
  ['Inverter installation and island testing done', 'ENGINEER'],
  ['Net metering done', 'ENGINEER'],
  ['Testing and project handover completed', 'SERVICE'],
];

const MEP_CHK = [
  ['Mechanical: Load calculations verified (heating/cooling loads - climate, orientation, occupancy)', 'ENGINEER'],
  ['Mechanical: Equipment sizing (chillers, AHUs, FCUs, VRF, splits) accurate', 'ENGINEER'],
  ['Mechanical: Ductwork layout checked (pressure drops, aspect ratios, acoustic lining)', 'ENGINEER'],
  ['Mechanical: Diffuser & grille placement - proper air distribution and throw', 'ENGINEER'],
  ['Mechanical: Ventilation - fresh air intake & exhaust rates meet local code', 'ENGINEER'],
  ['Electrical: Connected load & demand calculated with diversity factors', 'ENGINEER'],
  ['Electrical: SLD verified (transformer, DG set, UPS, main switchgear sizing)', 'ENGINEER'],
  ['Electrical: Cable sizing & routing (voltage drop, trays, conduits)', 'ENGINEER'],
  ['Electrical: Lighting design (lux levels, emergency lighting, energy codes)', 'ENGINEER'],
  ['Electrical: Earthing & lightning protection (grounding pits, protection loop)', 'ENGINEER'],
  ["Plumbing/PHE: Water demand calculated (domestic + flushing)", 'ENGINEER'],
  ["Plumbing/PHE: Pipe sizing by fixture unit methods (Hunter's curve)", 'ENGINEER'],
  ['Plumbing/PHE: Drainage slope - invert levels for soil, waste, rainwater', 'ENGINEER'],
  ['Plumbing/PHE: Storage tanks sized (UG + OH, compartmentalization)', 'ENGINEER'],
  ['Plumbing/PHE: Pumping system - head & flow for hydro-pneumatic and transfer pumps', 'ENGINEER'],
  ['Fire: Sprinkler & hydrant layout - full coverage per hazard classification', 'ENGINEER'],
  ['Fire: Fire pump room - suction/delivery sizing, dedicated water storage', 'ENGINEER'],
  ['Fire: Detection & alarm - detectors and MCPs per code spacing', 'ENGINEER'],
];

function toItems(rows) {
  return rows.map(([text, sign]) => ({ text, signResponsibility: sign }));
}

// PWA FACT: DB.templates has no `name`/`isDefault` of its own — it is
// consulted directly by division, never surfaced as a named template in
// any UI. `checklistTemplateName` is left "" by `saveSO` in this fallback
// case (verified: `chkName:cl?cl.name:""`).
const LEGACY_CHECKLIST_FALLBACK = Object.freeze({
  HVAC: Object.freeze(toItems(HVAC_CHK)),
  Solar: Object.freeze(toItems(SOLAR_CHK)),
  MEP: Object.freeze(toItems(MEP_CHK)),
});

module.exports = { LEGACY_CHECKLIST_FALLBACK };
