'use strict';

/**
 * Shared enum constants used across multiple models.
 * Every value here is a PWA FACT (an observed, fixed set from the source
 * application) unless the accompanying comment says otherwise. No value is
 * invented beyond what DOMAIN_MODEL.md / DATABASE_SCHEMA.md document.
 */

// PWA FACT — DOMAIN_MODEL.md "Divisions": exactly HVAC, Solar, MEP.
const DIVISIONS = Object.freeze(['HVAC', 'Solar', 'MEP']);

// PWA FACT — DOMAIN_MODEL.md "Roles (fixed, observed set — 11 roles)".
const ROLES = Object.freeze([
  'super',
  'admin',
  'sales',
  'hvac_pm',
  'solar_pm',
  'mep_pm',
  'engineer',
  'inventory',
  'service_mgr',
  'service_eng',
  'finance',
]);

// PWA FACT — checklist point sign-responsibility (verified: SIGN_ROLES has a
// dead 5th key `PM`, never reachable from the checklist-point UI — DATABASE_SCHEMA.md §5).
const SIGN_RESPONSIBILITIES = Object.freeze(['ENGINEER', 'CLIENT', 'SALES', 'SERVICE']);

// PWA FACT (verified against `STAGES`) — the exact per-division project
// stage lists. Deliberately NOT flattened into one generic enum: a
// project's `stage` is only ever valid against its OWN division's list
// (see Project.js's division-aware validator and DATABASE_SCHEMA.md §5
// "Stage Enum (per division)"). MEP's list ends on `Delivered`, not
// `Completed` — this is load-bearing for the Completion gate rule.
const PROJECT_STAGES_BY_DIVISION = Object.freeze({
  HVAC: Object.freeze(['Planning', 'Piping', 'Installation', 'Testing', 'Finishing', 'Completed']),
  Solar: Object.freeze(['Planning', 'Fabrication', 'Installation', 'Wiring', 'Net Metering', 'Completed']),
  MEP: Object.freeze(['Concept', 'Design In Progress', 'Internal Review', 'Client Review', 'Delivered']),
});

module.exports = { DIVISIONS, ROLES, SIGN_RESPONSIBILITIES, PROJECT_STAGES_BY_DIVISION };
