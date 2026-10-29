'use strict';
/**
 * Works out what the AMC tracker import would do, without touching anything.
 *
 * Kept separate from the script that talks to the database so the decisions —
 * which contract a source row matches, which historical completions are
 * missing, what must not be overwritten — can be tested directly.
 *
 * The workbook's service columns come in pairs: "1ST SERVICE" is the month the
 * visit was scheduled for (a month NAME, e.g. "December"), and "1ST Service
 * Completed Date" is the date it was actually done. Only the second is a fact
 * about history; the first is not a date at all. Slots 5 and 6 have a
 * completion column with no month column.
 *
 * A completion maps onto the contract's existing representation —
 * scheduledVisits[i].completedDate — by SLOT: the workbook's 1st service is
 * the contract's first scheduled visit. Nothing is compacted or shifted: if a
 * slot has no matching visit (a 6th completion against a 4-visit quarterly
 * schedule) that is reported for review, never squeezed into a free slot.
 */

const dayKey = (v) => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

const norm = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();

/** The key the importer already used for idempotency: company + site + start. */
function matchKey(site, start) {
  return `${norm(site)}|${dayKey(start) || ''}`;
}

/**
 * @param {Array} records   rows from amc-tracker-data.json
 * @param {Array} existing  contracts already in this company
 * @returns {{creates:Array, updates:Array, conflicts:Array, skipped:Array, totals:Object}}
 */
function planAmcImport(records, existing) {
  const byKey = new Map();
  for (const c of existing) {
    const k = matchKey(c.site, c.startDate);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(c);
  }

  const creates = [];
  const updates = [];
  const conflicts = [];
  const skipped = [];

  for (const r of records) {
    const where = { sheet: r.sheet, row: r.row, site: r.site, srNo: r.srNo };
    const completions = (r.services || []).filter((s) => s.completedDate);

    if (!r.importable) {
      skipped.push({ ...where, reason: `missing required: ${r.missingRequired.join(', ')}`,
        completionsInSource: completions.length });
      continue;
    }

    const found = byKey.get(matchKey(r.site, r.start)) || [];

    if (found.length > 1) {
      conflicts.push({ ...where, kind: 'AMBIGUOUS_MATCH',
        detail: `${found.length} contracts share this site and start date`,
        contractIds: found.map((c) => String(c.id)) });
      continue;
    }

    if (found.length === 0) {
      creates.push({ ...where, contract: {
        site: r.site, customer: r.customer, phone: r.phone, email: r.email,
        capacity: r.capacity, start: r.start, end: r.end,
        amcType: r.amcType, category: r.category, amount: r.amount,
      }, completions: completions.map((s) => ({ slot: s.slot, completedDate: s.completedDate })) });
      continue;
    }

    /* One match: reconcile its historical completions only. No other field is
       touched — the contract may have been edited since it was imported. */
    const c = found[0];
    const visits = c.scheduledVisits || [];
    const toSet = [];
    const alreadyPresent = [];
    for (const s of completions) {
      const i = s.slot - 1;
      if (i < 0 || i >= visits.length) {
        conflicts.push({ ...where, kind: 'NO_VISIT_FOR_SLOT', contractId: String(c.id),
          detail: `service ${s.slot} completed ${s.completedDate}, but the schedule has ${visits.length} visits`,
          completedDate: s.completedDate, slot: s.slot });
        continue;
      }
      const have = dayKey(visits[i].completedDate);
      if (!have) {
        toSet.push({ slot: s.slot, visitIndex: i, month: visits[i].month, completedDate: s.completedDate });
      } else if (have === s.completedDate) {
        alreadyPresent.push({ slot: s.slot, visitIndex: i, completedDate: have });
      } else {
        // Genuine service history already recorded. Never overwritten.
        conflicts.push({ ...where, kind: 'COMPLETION_DIFFERS', contractId: String(c.id),
          detail: `service ${s.slot}: stored ${have}, workbook ${s.completedDate} — left as stored`,
          slot: s.slot, stored: have, workbook: s.completedDate });
      }
    }
    if (toSet.length || alreadyPresent.length) {
      updates.push({ ...where, contractId: String(c.id), toSet, alreadyPresent });
    }
  }

  const totals = {
    sourceRows: records.length,
    completionsInSource: records.reduce((n, r) => n + (r.services || []).filter((s) => s.completedDate).length, 0),
    creates: creates.length,
    completionsOnCreate: creates.reduce((n, x) => n + x.completions.length, 0),
    contractsToUpdate: updates.filter((u) => u.toSet.length).length,
    completionsToAdd: updates.reduce((n, u) => n + u.toSet.length, 0),
    completionsAlreadyPresent: updates.reduce((n, u) => n + u.alreadyPresent.length, 0),
    conflicts: conflicts.length,
    skipped: skipped.length,
  };
  return { creates, updates, conflicts, skipped, totals };
}

module.exports = { planAmcImport, matchKey, dayKey };
