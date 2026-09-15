// Phase 5 — Project / ProjectPackage schema contracts (DATABASE_ARCHITECTURE.md "Project / Package
// model" + rev 4 sub-trades + "Indexes (target)"; ACCESS_MATRIX.md PART 7).
//
// These assert the schema-level guarantees that keep LIVE v2 data safe and keep MEP and HVAC apart,
// so a future refactor cannot quietly drop one.
const mongoose = require('mongoose');

// The models resolve through the lazy registry Proxy, which needs a live connection. The schemas
// themselves do not, so they are rebuilt here exactly as the model files declare them — the
// assertions below are about schema shape, not about Mongo.
jest.mock('../src/models/registry', () => ({
  defineModel: (_name, schema) => ({ schema }),
}));

const Project = require('../src/models/Project');
const ProjectPackage = require('../src/models/ProjectPackage');
const {
  DIVISION_VALUES, PROJECT_STATUSES, RECORD_STATES, SUB_TRADES, ALL_SUB_TRADES, LEGACY_DIV_MAP,
} = require('../src/config/constants');

const projectSchema = Project.schema;
const packageSchema = ProjectPackage.schema;

function indexKeys(schema) {
  return schema.indexes().map(([key, options]) => ({ key, options: options || {} }));
}
function hasIndex(schema, key) {
  return indexKeys(schema).some((i) => JSON.stringify(i.key) === JSON.stringify(key));
}
function indexOptions(schema, key) {
  return indexKeys(schema).find((i) => JSON.stringify(i.key) === JSON.stringify(key))?.options;
}

describe('Project — v2-safe additive model of the live `projects` collection', () => {
  test('targets the SAME physical collection v2 owns', () => {
    expect(projectSchema.options.collection).toBe('projects');
  });

  test('is non-strict so unknown v2 fields round-trip untouched', () => {
    expect(projectSchema.options.strict).toBe(false);
  });

  test('`status` keeps v2\'s OPERATIONAL enum — not the Phase 4 governance states', () => {
    expect(projectSchema.path('status').enumValues).toEqual(PROJECT_STATUSES);
    expect(projectSchema.path('status').enumValues).not.toContain(RECORD_STATES.DRAFT);
  });

  test('the Phase 4 governance lifecycle lives on its own additive `recordState` field', () => {
    const recordState = projectSchema.path('recordState');
    expect(recordState).toBeDefined();
    expect(recordState.defaultValue).toBe(RECORD_STATES.DRAFT);
    expect(recordState.enumValues).toEqual(expect.arrayContaining(Object.values(RECORD_STATES)));
  });

  test('legacy `div` is declared WITHOUT re-imposing an enum — v2 owns that field', () => {
    expect(projectSchema.path('div')).toBeDefined();
    expect(projectSchema.path('div').enumValues ?? []).toEqual([]);
  });

  test.each(['pm', 'engs', 'chk', 'updates', 'dc', 'notes', 'meta', 'value', 'client', 'site'])(
    'legacy field %s is preserved',
    (field) => { expect(projectSchema.path(field)).toBeDefined(); },
  );

  test('legacy pm/engs stay STRING-typed — they are names, never user ids', () => {
    expect(projectSchema.path('pm').instance).toBe('String');
    expect(projectSchema.path('engs').caster.instance).toBe('String');
  });

  test.each([
    ['divisions'], ['subTrades'], ['projectMgrId'], ['accessList'], ['budget'],
    ['salesOrderId'], ['soNo'], ['customerId'], ['enquiryId'],
  ])('v3-additive field %s exists', (field) => {
    expect(projectSchema.path(field)).toBeDefined();
  });

  test('every v3-additive field is optional, so v2 writes are never invalidated', () => {
    for (const field of ['divisions', 'subTrades', 'projectMgrId', 'budget', 'salesOrderId', 'soNo', 'customerId']) {
      expect(projectSchema.path(field).isRequired).toBeFalsy();
    }
  });

  test('divisions[] is constrained to the frozen three', () => {
    expect(projectSchema.path('divisions').caster.enumValues).toEqual(DIVISION_VALUES);
  });

  test('the ownership plugin supplied the Phase 4 metadata block and soft-delete triad', () => {
    for (const field of ['createdByUserId', 'createdByName', 'updatedByUserId', 'deleted', 'deletedAt', 'deletedByUserId', 'deletionReason']) {
      expect(projectSchema.path(field)).toBeDefined();
    }
    expect(projectSchema.get('timestamps')).toBe(true);
  });

  test('frozen index targets are declared: co+status, co+divisions, code', () => {
    expect(hasIndex(projectSchema, { co: 1, status: 1 })).toBe(true);
    expect(hasIndex(projectSchema, { co: 1, divisions: 1 })).toBe(true);
    expect(projectSchema.path('code').options.index).toBe(true);
  });

  test('packageArchitecture defaults to FALSE so every existing legacy row stays legacy', () => {
    expect(projectSchema.path('packageArchitecture').defaultValue).toBe(false);
  });
});

describe('ProjectPackage — first-class division unit', () => {
  test('is its own v3-owned collection, not embedded in Project', () => {
    expect(packageSchema.options.collection).toBe('v3_project_packages');
  });

  test('§12 — identifies parent project, division, identity, lifecycle, ownership and company', () => {
    expect(packageSchema.path('projectId').isRequired).toBe(true);   // parent Project
    expect(packageSchema.path('division').isRequired).toBe(true);    // division
    expect(packageSchema.path('code').isRequired).toBe(true);        // package identity/number
    expect(packageSchema.path('status')).toBeDefined();              // package-specific lifecycle
    expect(packageSchema.path('recordState')).toBeDefined();         // governance state
    expect(packageSchema.path('createdByUserId')).toBeDefined();     // ownership metadata
    expect(packageSchema.path('co').isRequired).toBe(true);          // company scope
  });

  test('division holds exactly ONE of the frozen three — never a combined value', () => {
    const division = packageSchema.path('division');
    expect(division.instance).toBe('String');          // single value, not an array
    expect(division.enumValues).toEqual(DIVISION_VALUES);
    expect(division.enumValues).not.toContain('MEP/HVAC');
    expect(division.enumValues).not.toContain('Other');
  });

  test('{projectId, division} is UNIQUE — one MEP package and one HVAC package, never a shared one', () => {
    expect(indexOptions(packageSchema, { projectId: 1, division: 1 })?.unique).toBe(true);
  });

  test('{projectId, code} is unique — package identity is stable within its project', () => {
    expect(indexOptions(packageSchema, { projectId: 1, code: 1 })?.unique).toBe(true);
  });

  test('frozen index targets are declared: co+projectId, co+division', () => {
    expect(hasIndex(packageSchema, { co: 1, projectId: 1 })).toBe(true);
    expect(hasIndex(packageSchema, { co: 1, division: 1 })).toBe(true);
  });

  test('package PM and engineers are real user ids, unlike the legacy Project name strings', () => {
    expect(packageSchema.path('projectMgr').instance).toBe('ObjectId');
    expect(packageSchema.path('engs').caster.instance).toBe('ObjectId');
  });

  test('accessList is present so the Phase 2 package-scope middleware works unchanged', () => {
    expect(packageSchema.path('accessList')).toBeDefined();
  });

  test('carries its own operational lifecycle plus handover and warranty', () => {
    expect(packageSchema.path('status').enumValues).toEqual(PROJECT_STATUSES);
    expect(packageSchema.path('startDate')).toBeDefined();
    expect(packageSchema.path('endDate')).toBeDefined();
    expect(packageSchema.path('handedOverAt')).toBeDefined();
    expect(packageSchema.path('warranty.start')).toBeDefined();
    expect(packageSchema.path('warranty.terms')).toBeDefined();
  });

  test('the ownership plugin supplied the Phase 4 block here too', () => {
    for (const field of ['createdByUserId', 'updatedByUserId', 'deleted', 'deletionReason']) {
      expect(packageSchema.path(field)).toBeDefined();
    }
  });
});

describe('sub-trades (DATABASE_ARCHITECTURE.md rev 4) — exact frozen lists per division', () => {
  test('MEP', () => {
    expect(SUB_TRADES.MEP).toEqual(['ELECTRICAL', 'PLUMBING', 'FIRE_FIGHTING', 'OTHER']);
  });
  test('HVAC', () => {
    expect(SUB_TRADES.HVAC).toEqual([
      'VRF', 'DUCTED_AC', 'SPLIT_AC', 'PIPING', 'PRESSURE_TESTING', 'VACUUM_TESTING',
      'LEAK_TESTING', 'COMMISSIONING',
    ]);
  });
  test('SOLAR', () => {
    expect(SUB_TRADES.SOLAR).toEqual(['ROOFTOP_ON_GRID', 'ROOFTOP_OFF_GRID', 'GROUND_MOUNT', 'HYBRID', 'OTHER']);
  });
  test('sub-trades are keyed BY DIVISION so MEP and HVAC lists never merge', () => {
    expect(Object.keys(SUB_TRADES).sort()).toEqual(['HVAC', 'MEP', 'SOLAR']);
    expect(SUB_TRADES.MEP).not.toContain('VRF');
    expect(SUB_TRADES.HVAC).not.toContain('ELECTRICAL');
  });
  test('both models validate against the flattened union', () => {
    expect(projectSchema.path('subTrades').caster.enumValues).toEqual(ALL_SUB_TRADES);
    expect(packageSchema.path('subTrades').caster.enumValues).toEqual(ALL_SUB_TRADES);
  });
});

describe('LEGACY_DIV_MAP — the only sanctioned legacy division translation', () => {
  test("maps v2's values, including mixed-case Solar", () => {
    expect(LEGACY_DIV_MAP).toMatchObject({ MEP: 'MEP', HVAC: 'HVAC', Solar: 'SOLAR' });
  });
  test("deliberately has NO entry for 'Other'", () => {
    expect(LEGACY_DIV_MAP.Other).toBeUndefined();
  });
  test('no legacy value maps to more than one division', () => {
    expect(Object.values(LEGACY_DIV_MAP).every((v) => DIVISION_VALUES.includes(v))).toBe(true);
  });
});

describe('mongoose is still the only schema layer in use', () => {
  test('both schemas are real mongoose schemas', () => {
    expect(projectSchema).toBeInstanceOf(mongoose.Schema);
    expect(packageSchema).toBeInstanceOf(mongoose.Schema);
  });
});
