'use strict';

const { ServiceError } = require('../errors');

/**
 * Half-filled quotation and sales-order forms, saved to be finished later.
 *
 * Owner request (14 Nov 2026). The point of a draft is that nothing has
 * happened yet: no QTN number, no SO number, no project, no payment records
 * and no notifications. All of that is the submit's job, unchanged. A draft
 * abandoned for good therefore leaves nothing behind but itself.
 *
 * A draft is personal. Someone else's half-written quotation is not yours to
 * finish, so only its author sees it -- and the company's admin, who has to
 * be able to pick up the work of whoever is away.
 */

// Who may keep a draft of each kind: the roles allowed to submit that form.
const DRAFT_ROLES = Object.freeze({
  quotation: Object.freeze(['admin', 'sales', 'finance']),
  salesOrder: Object.freeze(['admin', 'sales', 'solar_pm']),
});
const KINDS = Object.freeze(Object.keys(DRAFT_ROLES));
const MAX_DRAFTS_PER_KIND = 25;
const MAX_LABEL = 120;

function assertCompanyContext(auth) {
  if (!auth || !auth.companyId) {
    throw new ServiceError('A company context is required.', 'FORBIDDEN', 403);
  }
}

function assertKind(kind) {
  if (!KINDS.includes(kind)) {
    throw new ServiceError(`Unknown draft kind "${kind}" (must be ${KINDS.join(' or ')}).`, 'VALIDATION_ERROR', 400);
  }
}

function assertMayDraft(auth, kind) {
  assertCompanyContext(auth);
  assertKind(kind);
  if (!DRAFT_ROLES[kind].includes(auth.role)) {
    throw new ServiceError(
      `Role "${auth.role}" is not permitted to keep ${kind} drafts (must be ${DRAFT_ROLES[kind].join(', ')}).`,
      'FORBIDDEN',
      403
    );
  }
}

/** An admin may open anyone's draft; everyone else only their own. */
function assertMayTouch(auth, draft) {
  if (auth.role === 'admin') return;
  if (String(draft.userId) !== String(auth.userId)) {
    // Not "forbidden" but "not found": whose drafts exist is not the
    // business of someone who may not read them.
    throw new ServiceError('Draft not found.', 'NOT_FOUND', 404);
  }
}

function cleanLabel(label) {
  return typeof label === 'string' ? label.trim().slice(0, MAX_LABEL) : '';
}

/**
 * Save a draft, or replace one already saved. The payload is kept as the
 * form sent it; this service never looks inside it.
 */
async function saveDraft(input, auth, deps) {
  const { id, kind, label, payload } = input || {};
  assertMayDraft(auth, kind);
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ServiceError('A draft needs a form to save.', 'VALIDATION_ERROR', 400);
  }

  if (id) {
    const existing = await deps.formDraftRepo.findById(auth.companyId, id);
    if (!existing) throw new ServiceError('Draft not found.', 'NOT_FOUND', 404);
    assertMayTouch(auth, existing);
    if (existing.kind !== kind) {
      throw new ServiceError('A draft cannot change what kind of form it is.', 'VALIDATION_ERROR', 400);
    }
    return deps.formDraftRepo.update(auth.companyId, id, { label: cleanLabel(label), payload });
  }

  // Keep the list usable: the oldest goes when someone hoards drafts.
  const mine = await deps.formDraftRepo.listByCompany(auth.companyId, { kind, userId: auth.userId });
  if (mine.length >= MAX_DRAFTS_PER_KIND) {
    const oldest = mine[mine.length - 1];
    if (oldest) await deps.formDraftRepo.deleteById(auth.companyId, oldest.id);
  }

  return deps.formDraftRepo.create({
    companyId: auth.companyId,
    userId: auth.userId,
    userName: auth.name || '',
    kind,
    label: cleanLabel(label),
    payload,
  });
}

/** The drafts of one kind this person may open, newest first. */
async function listDrafts(kind, auth, deps) {
  assertMayDraft(auth, kind);
  const filter = auth.role === 'admin' ? { kind } : { kind, userId: auth.userId };
  return deps.formDraftRepo.listByCompany(auth.companyId, filter);
}

async function getDraft(id, auth, deps) {
  assertCompanyContext(auth);
  const draft = await deps.formDraftRepo.findById(auth.companyId, id);
  if (!draft) throw new ServiceError('Draft not found.', 'NOT_FOUND', 404);
  assertMayDraft(auth, draft.kind);
  assertMayTouch(auth, draft);
  return draft;
}

/**
 * Throw a draft away. Called by hand from the list, and by the form itself
 * once the real record has been created from it.
 */
async function deleteDraft(id, auth, deps) {
  const draft = await getDraft(id, auth, deps);
  await deps.formDraftRepo.deleteById(auth.companyId, draft.id);
  return { deletedDraftId: String(draft.id) };
}

module.exports = {
  saveDraft,
  listDrafts,
  getDraft,
  deleteDraft,
  DRAFT_ROLES,
  KINDS,
  MAX_DRAFTS_PER_KIND,
};
