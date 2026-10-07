'use strict';

/**
 * Verbatim checklist-point content traced directly from
 * MEP_PROJECTS_PWA/index.html's `HVAC_CHK`/`SOLAR_CHK`/`MEP_CHK` constants
 * (lines ~180-221) and `seedChklists()` (line ~236). Each PWA `sign` tag
 * (SALES/CLIENT/ENGINEER/SERVICE) maps 1:1 to the NEW APP
 * `signResponsibility` field (models/shared/enums.js SIGN_RESPONSIBILITIES).
 *
 * `seedChklists()` creates exactly one "Standard {division} Checklist"
 * template per (company, division) pair, marked as the division default
 * (`def:true`) -- for the PWA's 3 demo companies x 3 divisions, that is the
 * "9 seeded templates" referenced by CHK-3.3-01. This module reproduces
 * that per-division item content (division-keyed, company-agnostic) so it
 * can be (a) used as test fixtures, and (b) invoked once per company at
 * provisioning time to create that company's 3 "Standard" default
 * templates -- there is no existing seed-script convention elsewhere in
 * this codebase (no scripts/ or seeds/ directory before this task), so
 * this module doubles as both: a data source imported by tests, and a
 * plain function a future provisioning/admin flow can call directly
 * (`seedStandardChecklistTemplates`) -- no standalone CLI script is added,
 * consistent with there being no CLI-seed convention anywhere else here.
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
  ['Plumbing/PHE: Water demand calculated (domestic + flushing)', 'ENGINEER'],
  ["Plumbing/PHE: Pipe sizing by fixture unit methods (Hunter's curve)", 'ENGINEER'],
  ['Plumbing/PHE: Drainage slope - invert levels for soil, waste, rainwater', 'ENGINEER'],
  ['Plumbing/PHE: Storage tanks sized (UG + OH, compartmentalization)', 'ENGINEER'],
  ['Plumbing/PHE: Pumping system - head & flow for hydro-pneumatic and transfer pumps', 'ENGINEER'],
  ['Fire: Sprinkler & hydrant layout - full coverage per hazard classification', 'ENGINEER'],
  ['Fire: Fire pump room - suction/delivery sizing, dedicated water storage', 'ENGINEER'],
  ['Fire: Detection & alarm - detectors and MCPs per code spacing', 'ENGINEER'],
];

const STANDARD_ITEMS_BY_DIVISION = Object.freeze({
  HVAC: HVAC_CHK.map(([text, sign]) => Object.freeze({ text, signResponsibility: sign })),
  Solar: SOLAR_CHK.map(([text, sign]) => Object.freeze({ text, signResponsibility: sign })),
  MEP: MEP_CHK.map(([text, sign]) => Object.freeze({ text, signResponsibility: sign })),
});

/**
 * Creates the 3 "Standard {division} Checklist" templates (marked default)
 * for one company, mirroring `seedChklists()`'s per-(company,division)
 * loop. Idempotent-by-convention only insofar as the caller is expected to
 * call this once per new company; it does not itself check for an existing
 * "Standard" template (the PWA's own seed function has no such guard
 * either -- it runs once at demo-data bootstrap).
 */
async function seedStandardChecklistTemplates(companyId, createdByUserId, deps) {
  const created = [];
  for (const division of ['HVAC', 'Solar', 'MEP']) {
    const doc = await deps.checklistTemplateRepo.create({
      companyId,
      division,
      name: `Standard ${division} Checklist`,
      items: STANDARD_ITEMS_BY_DIVISION[division].map((i) => ({ ...i })),
      isDefault: true,
      createdByUserId,
      createdDate: new Date(),
    });
    created.push(doc);
  }
  return created;
}

module.exports = { STANDARD_ITEMS_BY_DIVISION, seedStandardChecklistTemplates };
