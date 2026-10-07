'use strict';

const { ServiceError } = require('../errors');

/**
 * Payment / Finance business/application layer.
 *
 * Source of truth: new-app/docs/PWA_COVERAGE_AUDIT_SALESORDER.md §8 (the
 * full finance trace), verified directly against MEP_PROJECTS_PWA/index.html
 * (`payRcvd`, `payBal`, `syncPayStatus`, `addPayment`, `mEditPayment`,
 * `delPayment`, `delPayRow`, `mPayEdit`/`savePayEdit`, `mRaise`/`doRaise`,
 * `mPayFollow`/`savePayFollow`, `mPayNew`/`savePayNew`, `dlReceipts`).
 *
 * LOCKED PRINCIPLE: every PWA-demonstrated functional behavior is
 * reproduced exactly, including quirks and asymmetries — see the module's
 * own comments below for each one, and PWA_COVERAGE_AUDIT_SALESORDER.md.
 */

// Locked decision "Role enforcement = A": finance/admin manage the ledger
// (PWA FACT: MENUS — only `finance`/`admin` have the "Payments" menu item).
const LEDGER_ROLES = Object.freeze(['finance', 'admin']);

// PWA FACT: `money(n){if(!n&&n!==0)return"";n=Number(n)||0;return "₹ "+n.toLocaleString("en-IN",{maximumFractionDigits:0})}` (same helper reproduced in serviceCallService.js).
function money(n) {
  if (!n && n !== 0) return '';
  const num = Number(n) || 0;
  return `₹ ${num.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function assertCompanyContext(actorAuth) {
  if (!actorAuth || !actorAuth.companyId) {
    throw new ServiceError('No company context for this account.', 'NO_COMPANY_CONTEXT', 403);
  }
}
function assertRole(actorAuth, allowedRoles, actionDescription) {
  if (!allowedRoles.includes(actorAuth.role)) {
    throw new ServiceError(`Role "${actorAuth.role}" is not permitted to ${actionDescription}.`, 'FORBIDDEN', 403);
  }
}
function todayDate() {
  return new Date();
}

// PWA FACT: `payRcvd(x) = sum(paid[].amt)`.
function computeReceived(payment) {
  return (payment.partPayments || []).reduce((a, p) => a + (Number(p.amount) || 0), 0);
}
// PWA FACT: `payBal(x) = max(0, amount - payRcvd(x))`.
function computeBalance(payment) {
  return Math.max(0, (payment.amount || 0) - computeReceived(payment));
}

/**
 * PWA FACT (`syncPayStatus`, verified literally): recomputes `status`/
 * `rcvDate` from the balance, and — ONLY if this Payment is SO-linked —
 * writes the `received` flag back onto the SO's own milestone. This is the
 * ONE place a Payment mutation is allowed to touch the SalesOrder (locked
 * decision "SO milestone amount synchronization = A" governs the OTHER
 * direction — see `editMilestone` below). `received` can flip back to
 * `false` here (PWA FACT: deleting/editing a part-payment down can move a
 * settled milestone back to Pending) — this is intentionally NOT "fixed."
 */
async function syncPayStatus(companyId, payment, deps, session) {
  const balance = computeBalance(payment);
  const patch = {};
  if (balance <= 0) {
    patch.status = 'Received';
    const parts = payment.partPayments || [];
    patch.receivedDate = parts.length ? parts[parts.length - 1].date : todayDate();
  } else {
    patch.status = 'Pending';
    patch.receivedDate = null;
  }
  const updated = await deps.paymentRepo.update(companyId, payment.id, patch, session);
  if (payment.salesOrderId) {
    await deps.salesOrderRepo.setMilestoneReceived(companyId, payment.salesOrderId, payment.milestoneIndex, balance <= 0, session);
  }
  return updated;
}

async function getPayment(id, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  assertRole(actorAuth, LEDGER_ROLES, 'view Payments');
  const payment = await deps.paymentRepo.findById(actorAuth.companyId, id);
  if (!payment) throw new ServiceError('Payment not found.', 'NOT_FOUND', 404);
  return payment;
}

async function listPayments(actorAuth, { status } = {}, deps) {
  assertCompanyContext(actorAuth);
  assertRole(actorAuth, LEDGER_ROLES, 'view Payments');
  return deps.paymentRepo.listByCompany(actorAuth.companyId, { status });
}

/**
 * PWA FACT (`mPayNew`/`savePayNew`): a manual pending entry with no SO
 * link at all (`soNo:""` in the PWA — modeled here as `salesOrderId: null`).
 * "SO-linked milestones are added automatically when Sales creates an SO.
 * Use this only for other receivables" (PWA's own on-screen copy).
 */
async function createManualPayment(input, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  assertRole(actorAuth, LEDGER_ROLES, 'add a manual pending payment');
  const { projectOrReference, amount, personName, phone, remark } = input || {};
  if (!projectOrReference || !Number(amount)) {
    throw new ServiceError('Project/reference and amount are required.', 'VALIDATION_ERROR', 400); // PWA FACT: `if(!gv("pp_pr")||!gv("pp_a"))`
  }
  return deps.paymentRepo.create({
    companyId: actorAuth.companyId,
    projectOrReference,
    personName: personName || '',
    phone: phone || '',
    amount: Number(amount),
    remark: remark || '',
    lastCallDate: null,
    discussionNotes: '',
    nextCallDate: null,
    status: 'Pending',
    salesOrderId: null,
    milestoneIndex: null,
    partPayments: [],
    raisedToFinance: null,
    receivedDate: null,
  });
}

/**
 * PWA FACT (`addPayment`): appends a part-payment; allows an amount greater
 * than the outstanding balance, but only after explicit confirmation
 * (`confirm(...)` in the PWA) — reproduced here as a required
 * `confirmOverpayment: true` flag rather than silently allowing it, since a
 * server API has no interactive confirm dialog of its own. Two different
 * notifications fire depending on whether the balance clears (exact literal
 * text), to `["admin","sales"]` — NOT to `finance`, matching the PWA exactly.
 */
async function addPartPayment(paymentId, input, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  assertRole(actorAuth, LEDGER_ROLES, 'record a payment');
  // Pre-check (fast-fail before opening a transaction) -- kept only as an
  // early user-facing rejection; NOT the authoritative guard (see F5 /
  // FIX-6-02 below, which is what actually protects against a concurrent
  // overpayment race).
  const precheckPayment = await deps.paymentRepo.findById(actorAuth.companyId, paymentId);
  if (!precheckPayment) throw new ServiceError('Payment not found.', 'NOT_FOUND', 404);

  const { amount, date, mode, reference, remark, invoiceIssued, confirmOverpayment } = input || {};
  const amt = Number(amount);
  if (!amt || amt <= 0) {
    throw new ServiceError('Enter amount received.', 'VALIDATION_ERROR', 400); // PWA FACT: `if(amt<=0){toast(...)}`
  }
  const precheckBalance = computeBalance(precheckPayment);
  if (amt > precheckBalance && !confirmOverpayment) {
    throw new ServiceError(
      `Amount is more than the balance of ${precheckBalance}. Resubmit with confirmOverpayment:true to proceed.`,
      'OVERPAYMENT_CONFIRMATION_REQUIRED',
      409
    );
  }

  return deps.withTransaction(deps, async (txnDeps) => {
    const { session } = txnDeps;
    // Stage 5 finding F5: re-fetch the Payment AND re-check the
    // overpayment-confirmation gate fresh, inside the transaction, on every
    // attempt (including retries after a write-conflict). The pre-check
    // above can be stale by the time this runs -- e.g. two concurrent part
    // payments against the same Payment must each see the OTHER's
    // already-committed amount before deciding whether THIS amount would
    // overpay the (now-smaller) remaining balance, or a client that never
    // saw the true remaining balance could push it well past zero without
    // ever having been shown (or having confirmed past) the real
    // overpayment prompt. This does not change any PWA-visible outcome for
    // a single, non-concurrent call (the same confirmOverpayment contract
    // applies) -- it only closes the race window, per the INFRASTRUCTURE-ONLY
    // DIFFERENCE convention already used for FIX-5-01.
    const payment = await txnDeps.paymentRepo.findById(actorAuth.companyId, paymentId);
    if (!payment) throw new ServiceError('Payment not found.', 'NOT_FOUND', 404);
    const balanceBefore = computeBalance(payment);
    if (amt > balanceBefore && !confirmOverpayment) {
      throw new ServiceError(
        `Amount is more than the balance of ${balanceBefore}. Resubmit with confirmOverpayment:true to proceed.`,
        'OVERPAYMENT_CONFIRMATION_REQUIRED',
        409
      );
    }
    const partPayment = {
      amount: amt,
      date: date || todayDate(),
      mode: mode || 'Bank Transfer/NEFT',
      reference: reference || '',
      remark: remark || '',
      invoiceIssued: !!invoiceIssued,
      recordedByUserId: actorAuth.userId,
    };
    const updated = await txnDeps.paymentRepo.pushPartPayment(actorAuth.companyId, paymentId, partPayment, session);
    const balanceAfter = computeBalance(updated);
    const final = await syncPayStatus(actorAuth.companyId, updated, txnDeps, session);

    let soPart = '';
    if (updated.salesOrderId) {
      const linkedSo = await txnDeps.salesOrderRepo.findById(actorAuth.companyId, updated.salesOrderId);
      if (linkedSo) soPart = ` (SO-${linkedSo.orderNumber})`;
    }
    if (balanceAfter <= 0) {
      await txnDeps.notificationRepo.create(
        {
          companyId: actorAuth.companyId,
          text: `Payment fully received: ${money(updated.amount)} — ${updated.projectOrReference}${soPart}`, // PWA FACT literal structure
          date: todayDate(),
          targetRoles: ['admin', 'sales'],
          readByUserIds: [],
        },
        session
      );
    } else {
      await txnDeps.notificationRepo.create(
        {
          companyId: actorAuth.companyId,
          text: `Part payment received: ${money(amt)} for ${updated.projectOrReference}. Balance ${money(balanceAfter)}.`, // PWA FACT literal structure
          date: todayDate(),
          targetRoles: ['admin', 'sales'],
          readByUserIds: [],
        },
        session
      );
    }
    return final;
  });
}

/**
 * PWA FACT (`mEditPayment`/`saveEditPayment`): any field of a part-payment
 * entry can be changed after the fact; stamps `editedBy`/`editedOn`; no cap
 * check against "other entries total" is actually enforced in the PWA
 * (the modal only shows a hint) — reproduced here with the same absence of
 * a hard cap, then re-syncs status.
 */
async function editPartPayment(paymentId, partPaymentId, input, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  assertRole(actorAuth, LEDGER_ROLES, 'edit a payment entry');
  const payment = await deps.paymentRepo.findById(actorAuth.companyId, paymentId);
  if (!payment) throw new ServiceError('Payment not found.', 'NOT_FOUND', 404);
  const entry = (payment.partPayments || []).find((p) => String(p.id) === String(partPaymentId));
  if (!entry) throw new ServiceError('Payment entry not found.', 'NOT_FOUND', 404);

  const { amount, date, mode, reference, remark, invoiceIssued } = input || {};
  const amt = amount !== undefined ? Number(amount) : entry.amount;
  if (!amt || amt <= 0) {
    throw new ServiceError('Enter a valid amount.', 'VALIDATION_ERROR', 400); // PWA FACT: `if(amt<=0){toast(...)}`
  }
  const patch = {
    amount: amt,
    date: date || entry.date,
    mode: mode || entry.mode,
    reference: reference !== undefined ? reference : entry.reference,
    remark: remark !== undefined ? remark : entry.remark,
    invoiceIssued: invoiceIssued !== undefined ? !!invoiceIssued : entry.invoiceIssued,
    editedByUserId: actorAuth.userId,
    editedOn: todayDate(),
  };

  return deps.withTransaction(deps, async (txnDeps) => {
    const { session } = txnDeps;
    const updated = await txnDeps.paymentRepo.updatePartPayment(actorAuth.companyId, paymentId, partPaymentId, patch, session);
    return syncPayStatus(actorAuth.companyId, updated, txnDeps, session);
  });
}

/**
 * PWA FACT (`delPayment`): removes ONE part-payment entry (not the whole
 * Payment record — see `deletePaymentRecord` for that), then re-syncs
 * status. This is what can move a Received milestone back to Pending.
 */
async function removePartPayment(paymentId, partPaymentId, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  assertRole(actorAuth, LEDGER_ROLES, 'remove a payment entry');
  const payment = await deps.paymentRepo.findById(actorAuth.companyId, paymentId);
  if (!payment) throw new ServiceError('Payment not found.', 'NOT_FOUND', 404);

  return deps.withTransaction(deps, async (txnDeps) => {
    const { session } = txnDeps;
    const updated = await txnDeps.paymentRepo.removePartPayment(actorAuth.companyId, paymentId, partPaymentId, session);
    return syncPayStatus(actorAuth.companyId, updated, txnDeps, session);
  });
}

/**
 * PWA FACT (`delPayRow`): whole-record delete, only ever offered when the
 * Payment is NOT SO-linked (`!x.soNo`) — an SO-linked Payment has no delete
 * path in the PWA at all. Enforced here as a hard rule, not just a UI hint.
 */
async function deletePaymentRecord(paymentId, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  assertRole(actorAuth, LEDGER_ROLES, 'delete a payment record');
  const payment = await deps.paymentRepo.findById(actorAuth.companyId, paymentId);
  if (!payment) throw new ServiceError('Payment not found.', 'NOT_FOUND', 404);
  if (payment.salesOrderId) {
    throw new ServiceError('An SO-linked payment cannot be deleted, only its individual entries.', 'FORBIDDEN', 403);
  }
  await deps.paymentRepo.remove(actorAuth.companyId, paymentId);
  return true;
}

/**
 * PWA FACT (`mPayEdit`/`savePayEdit`): edits the milestone/reference record
 * itself (not a part-payment entry) — project/amount/person/phone/remark.
 * Rejects reducing `amount` below what's already received (PWA FACT:
 * `if(amt<r){toast(...)}`). Locked decision "SO milestone amount
 * synchronization = A": if SO-linked, the new amount is written FORWARD
 * onto the SO's own `paymentMilestones[mi].amount` (PWA FACT:
 * `if(x.soNo){...so.pay[x.mi].a=amt}`) — but per that same locked decision,
 * this direction is NOT mirrored by an SO-side edit (see
 * salesOrderService.js's `editSalesOrder`), and — PWA FACT, verified
 * literally in `savePayEdit` — this function does NOT call
 * `syncPayStatus()` after changing the amount, so `status`/`rcv` are
 * intentionally NOT recomputed here even though the balance changed. This
 * is preserved exactly as a PWA quirk, not corrected.
 */
async function editMilestone(paymentId, input, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  assertRole(actorAuth, LEDGER_ROLES, 'edit a payment milestone');
  const payment = await deps.paymentRepo.findById(actorAuth.companyId, paymentId);
  if (!payment) throw new ServiceError('Payment not found.', 'NOT_FOUND', 404);

  const { projectOrReference, amount, personName, phone, remark, lastCallDate, nextCallDate, discussionNotes } = input || {};
  const received = computeReceived(payment);
  const patch = {};
  if (projectOrReference !== undefined) patch.projectOrReference = projectOrReference;
  if (personName !== undefined) patch.personName = personName;
  if (phone !== undefined) patch.phone = phone;
  if (remark !== undefined) patch.remark = remark;
  if (lastCallDate !== undefined) patch.lastCallDate = lastCallDate;
  if (nextCallDate !== undefined) patch.nextCallDate = nextCallDate;
  if (discussionNotes !== undefined) patch.discussionNotes = discussionNotes;

  if (amount !== undefined) {
    const amt = Number(amount);
    if (!amt || amt <= 0) {
      throw new ServiceError('Enter milestone amount.', 'VALIDATION_ERROR', 400);
    }
    if (amt < received) {
      throw new ServiceError(`Amount cannot be less than ${received} already received.`, 'VALIDATION_ERROR', 400);
    }
    patch.amount = amt;
  }

  return deps.withTransaction(deps, async (txnDeps) => {
    const { session } = txnDeps;
    const updated = await txnDeps.paymentRepo.update(actorAuth.companyId, paymentId, patch, session);
    if (amount !== undefined && payment.salesOrderId) {
      await txnDeps.salesOrderRepo.setMilestoneAmount(actorAuth.companyId, payment.salesOrderId, payment.milestoneIndex, Number(amount), session);
    }
    // Deliberately no syncPayStatus() call here — see doc comment above.
    return updated;
  });
}

/** PWA FACT (`mPayFollow`/`savePayFollow`): lastCall/nextCall/disc/remark only. */
async function addFollowUp(paymentId, input, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  assertRole(actorAuth, LEDGER_ROLES, 'follow up on a payment');
  const payment = await deps.paymentRepo.findById(actorAuth.companyId, paymentId);
  if (!payment) throw new ServiceError('Payment not found.', 'NOT_FOUND', 404);
  const { lastCallDate, nextCallDate, discussionNotes, remark } = input || {};
  return deps.paymentRepo.update(actorAuth.companyId, paymentId, {
    lastCallDate: lastCallDate !== undefined ? lastCallDate : payment.lastCallDate,
    nextCallDate: nextCallDate !== undefined ? nextCallDate : payment.nextCallDate,
    discussionNotes: discussionNotes !== undefined ? discussionNotes : payment.discussionNotes,
    remark: remark !== undefined ? remark : payment.remark,
  });
}

// PWA FACT (roleDivision.js ROLE_DIVISION_MAP, inverted from DIVISION_PM_ROLE).
const PM_DIVISION_FOR_ROLE = Object.freeze({ hvac_pm: 'HVAC', solar_pm: 'Solar', mep_pm: 'MEP' });
const RAISE_ROLES = Object.freeze(['hvac_pm', 'solar_pm', 'mep_pm', 'admin']);

/**
 * PWA FACT (`mRaise`/`doRaise`): locates the Payment for (SO, milestone
 * index); creates it on the fly with the same field shape as the original
 * creation cascade if it's somehow missing; stamps `raisedToFinance`;
 * appends a discussion note; notifies `["finance","admin"]` with an
 * "urgent" prefix when priority is Urgent. Locked decision "Role
 * enforcement = A": the PWA had NO role check at all in this function — the
 * appropriate division PM (or admin) is now enforced here server-side. A PM
 * may only raise a milestone for their OWN division's SalesOrder.
 */
async function raiseToFinance(salesOrderId, milestoneIndex, input, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  assertRole(actorAuth, RAISE_ROLES, 'raise a payment milestone to Finance');

  const so = await deps.salesOrderRepo.findById(actorAuth.companyId, salesOrderId);
  if (!so) throw new ServiceError('SalesOrder not found.', 'NOT_FOUND', 404);
  const requiredDivision = PM_DIVISION_FOR_ROLE[actorAuth.role];
  if (requiredDivision && so.division !== requiredDivision) {
    throw new ServiceError(`Role "${actorAuth.role}" may only raise milestones for ${requiredDivision} sales orders.`, 'FORBIDDEN', 403);
  }
  const milestone = (so.paymentMilestones || [])[milestoneIndex];
  if (!milestone) throw new ServiceError('Milestone not found.', 'NOT_FOUND', 404);

  const { note, dueByDate, priority } = input || {};

  return deps.withTransaction(deps, async (txnDeps) => {
    const { session } = txnDeps;
    let payment = await txnDeps.paymentRepo.findBySalesOrderAndMilestone(actorAuth.companyId, salesOrderId, milestoneIndex);
    if (!payment) {
      // PWA FACT: created on the fly with the same field shape as saveSO's own creation.
      const c0 = (so.contacts && so.contacts[0]) || {};
      payment = await txnDeps.paymentRepo.create(
        {
          companyId: actorAuth.companyId,
          projectOrReference: so.projectName,
          personName: c0.name || '',
          phone: c0.phone || '',
          amount: milestone.amount,
          remark: `SO ${so.orderNumber} milestone ${milestoneIndex + 1}: ${milestone.description}`,
          status: 'Pending',
          salesOrderId,
          milestoneIndex,
          partPayments: [],
          raisedToFinance: null,
          receivedDate: null,
        },
        session
      );
    }

    const raisedToFinance = {
      raisedByUserId: actorAuth.userId,
      raisedByRole: actorAuth.role,
      raisedDate: todayDate(),
      collectByDate: dueByDate || null,
      priority: priority === 'Urgent' ? 'Urgent' : 'Normal',
      note: note || '',
    };
    const existingDisc = payment.discussionNotes || '';
    const discussionNotes = `${existingDisc ? existingDisc + ' | ' : ''}[${todayDate().toISOString().slice(0, 10)}] Raised: ${note || ''}`;
    const updated = await txnDeps.paymentRepo.update(actorAuth.companyId, payment.id, { raisedToFinance, discussionNotes }, session);

    await txnDeps.notificationRepo.create(
      {
        companyId: actorAuth.companyId,
        text: `${raisedToFinance.priority === 'Urgent' ? '⚠ URGENT — ' : ''}Payment milestone raised by ${actorAuth.name || actorAuth.role} for "${so.projectName}" (SO-${so.orderNumber}): ${money(computeBalance(updated))} due — ${note || ''}. Collect by ${dueByDate || ''}.`,
        date: todayDate(),
        targetRoles: ['finance', 'admin'],
        readByUserIds: [],
      },
      session
    );
    return updated;
  });
}

function csvEscape(value) {
  const s = value === undefined || value === null ? '' : String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
function formatDateForCsv(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

/**
 * FIX-6-05 (re-derived literally from `dlPayments()`, index.html:3552):
 * `rows = mine(DB.payments).filter(hit(...))` — the FULL payments
 * collection, no `status==="Pending"` hard filter (that filter belonged to
 * a different, incorrect reconstruction and is removed here). Exact column
 * order: Project, SO No, Person, Phone, Milestone Amount, Received,
 * Balance, Status, Raised by PM, Raised On, Collect By, Last Call,
 * Discussion, Next Call, Remark, Part Payments (16 columns). `SO No` and
 * `Status` are read directly off the payment record (PWA `x.soNo`/
 * `x.status`, not derived) — resolved here via the durable
 * `salesOrderId` -> `SalesOrder.orderNumber` ref (the infra-only
 * substitution for the PWA's plain display-number field). `Part Payments`
 * = `(x.paid||[]).length` -> `(x.partPayments||[]).length`. The three
 * PWA `x.raised.{by,date,dueBy}` fields are three separate columns here
 * (`raisedToFinance.{raisedByUserId(name),raisedDate,collectByDate}`), not
 * collapsed into one string. TOTAL row matches PWA's `out.push([],
 * ["TOTAL","","","",t,r,b])` exactly: a blank line, then a short 7-field
 * row (PWA's own `dlCSV` never pads short rows).
 */
async function exportPendingPaymentsCsv(actorAuth, deps) {
  assertCompanyContext(actorAuth);
  assertRole(actorAuth, LEDGER_ROLES, 'export payment reports');
  const rows = await deps.paymentRepo.listByCompany(actorAuth.companyId);
  const salesOrders = deps.salesOrderRepo ? await deps.salesOrderRepo.listByCompany(actorAuth.companyId) : [];
  const soOrderNumberById = new Map(salesOrders.map((s) => [String(s.id), s.orderNumber]));
  let nameById = new Map();
  if (deps.userRepoForEnquiry && deps.userRepoForEnquiry.listByCompany) {
    const users = await deps.userRepoForEnquiry.listByCompany(actorAuth.companyId);
    nameById = new Map(users.map((u) => [String(u.id), u.name]));
  }

  const lines = [];
  lines.push(csvEscape('PAYMENTS REPORT'));
  lines.push('');
  lines.push(
    [
      'Project', 'SO No', 'Person', 'Phone', 'Milestone Amount', 'Received', 'Balance', 'Status',
      'Raised by PM', 'Raised On', 'Collect By', 'Last Call', 'Discussion', 'Next Call', 'Remark', 'Part Payments',
    ].map(csvEscape).join(',')
  );
  let totalAmount = 0;
  let totalReceived = 0;
  let totalBalance = 0;
  for (const x of rows) {
    const received = computeReceived(x);
    const balance = computeBalance(x);
    totalAmount += x.amount || 0;
    totalReceived += received;
    totalBalance += balance;
    const soNo = x.salesOrderId ? soOrderNumberById.get(String(x.salesOrderId)) || '' : '';
    const raised = x.raisedToFinance;
    const raisedBy = raised ? nameById.get(String(raised.raisedByUserId)) || raised.raisedByRole || '' : '';
    lines.push(
      [
        x.projectOrReference, soNo, x.personName, x.phone, x.amount, received, balance, x.status,
        raisedBy, raised ? formatDateForCsv(raised.raisedDate) : '', raised ? formatDateForCsv(raised.collectByDate) : '',
        formatDateForCsv(x.lastCallDate), x.discussionNotes, formatDateForCsv(x.nextCallDate), x.remark,
        (x.partPayments || []).length,
      ].map(csvEscape).join(',')
    );
  }
  lines.push('');
  lines.push(['TOTAL', '', '', '', totalAmount, totalReceived, totalBalance].map(csvEscape).join(','));
  return lines.join('\n');
}

/**
 * FIX-6-06 (re-derived literally from `dlReceipts()`, index.html:3958):
 * exact column order — Date, Project, SO No, Person, Phone, Amount
 * Received, Mode, Reference, Invoice Issued, Milestone Amount, Milestone
 * Balance, Status, Entered By, Remark — flattened one row per part-payment
 * entry across every Payment. PWA does `mine(DB.payments).forEach(x =>
 * (x.paid||[]).forEach(p => rows.push(...)))` with NO `.sort()`/`.reverse()`
 * anywhere in the function — raw insertion order (outer: Payment array
 * order, inner: that Payment's `paid[]` array order). The previous
 * "newest first" `.sort()` here was an invented behavior not demonstrated
 * by the PWA and is removed; `listByCompany`/`partPayments` are already in
 * natural (insertion) order, so no reordering step is needed at all, plus
 * a TOTAL row summing Amount Received.
 */
async function exportReceiptsCsv(actorAuth, deps) {
  assertCompanyContext(actorAuth);
  assertRole(actorAuth, LEDGER_ROLES, 'export payment reports');
  const all = await deps.paymentRepo.listByCompany(actorAuth.companyId);
  const receipts = [];
  for (const x of all) {
    for (const p of x.partPayments || []) receipts.push({ x, p });
  }

  const lines = [];
  lines.push(csvEscape('PAYMENT RECEIPTS LEDGER'));
  lines.push('');
  lines.push(
    ['Date', 'Project', 'SO No', 'Person', 'Phone', 'Amount Received', 'Mode', 'Reference', 'Invoice Issued', 'Milestone Amount', 'Milestone Balance', 'Status', 'Entered By', 'Remark']
      .map(csvEscape)
      .join(',')
  );
  let total = 0;
  for (const { x, p } of receipts) {
    total += Number(p.amount) || 0;
    lines.push(
      [
        formatDateForCsv(p.date), x.projectOrReference, x.salesOrderId || '', x.personName, x.phone, p.amount,
        p.mode || '', p.reference || '', p.invoiceIssued ? 'Yes' : 'No', x.amount, computeBalance(x), x.status,
        p.recordedByUserId || '', p.remark || '',
      ].map(csvEscape).join(',')
    );
  }
  lines.push(['', '', '', '', 'TOTAL', total].map(csvEscape).join(','));
  return lines.join('\n');
}

module.exports = {
  getPayment,
  listPayments,
  createManualPayment,
  addPartPayment,
  editPartPayment,
  removePartPayment,
  deletePaymentRecord,
  editMilestone,
  addFollowUp,
  raiseToFinance,
  exportPendingPaymentsCsv,
  exportReceiptsCsv,
  // exported for tests / reuse
  computeReceived,
  computeBalance,
  syncPayStatus,
  LEDGER_ROLES,
  RAISE_ROLES,
};
