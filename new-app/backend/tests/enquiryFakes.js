'use strict';

/**
 * In-memory fake repositories implementing the exact same interfaces as
 * src/repositories/businessRepositories.mongoose.js — used ONLY by tests, so
 * the Enquiry/SalesOrder/Payment service logic (including the SalesOrder
 * conversion cascade, standalone SO creation, and the full Payment ledger)
 * can be exercised thoroughly WITHOUT opening any live database connection,
 * matching the pattern in tests/auth/fakes.js.
 */

let idCounter = 0;
function nextId(prefix) {
  idCounter += 1;
  return `${prefix}_${idCounter}`;
}

function cloneDeep(value) {
  return JSON.parse(JSON.stringify(value));
}

function matchesId(record, id) {
  return String(record.id) === String(id);
}

function createEnquiryFakeStore(seed = {}) {
  const state = {
    enquiries: (seed.enquiries || []).map((e) => ({ followUpLog: [], ...e })),
    salesOrders: seed.salesOrders || [],
    projects: seed.projects || [],
    payments: (seed.payments || []).map((p) => ({ partPayments: [], ...p })),
    contracts: seed.contracts || [],
    serviceCalls: seed.serviceCalls || [],
    notifications: seed.notifications || [],
    checklistTemplates: seed.checklistTemplates || [],
    users: seed.users || [],
    companies: seed.companies || [],
    counters: seed.counters || {},
    inventoryCategories: seed.inventoryCategories || [],
    inventoryLocations: seed.inventoryLocations || [],
    inventoryItems: (seed.inventoryItems || []).map((i) => ({ stockByLocation: {}, ...i })),
    inventoryIssues: seed.inventoryIssues || [],
    inventoryTransactions: seed.inventoryTransactions || [],
    plans: seed.plans || [],
    subscriptions: seed.subscriptions || [],
  };

  function snapshot() {
    return cloneDeep(state);
  }
  function restore(snap) {
    state.enquiries = snap.enquiries;
    state.salesOrders = snap.salesOrders;
    state.projects = snap.projects;
    state.payments = snap.payments;
    state.contracts = snap.contracts;
    state.serviceCalls = snap.serviceCalls;
    state.notifications = snap.notifications;
    state.checklistTemplates = snap.checklistTemplates;
    state.users = snap.users;
    state.companies = snap.companies;
    state.counters = snap.counters;
    state.inventoryCategories = snap.inventoryCategories;
    state.inventoryLocations = snap.inventoryLocations;
    state.inventoryItems = snap.inventoryItems;
    state.inventoryIssues = snap.inventoryIssues;
    state.inventoryTransactions = snap.inventoryTransactions;
    state.plans = snap.plans;
    state.subscriptions = snap.subscriptions;
  }

  const enquiryRepo = {
    async create(data) {
      const doc = { id: nextId('enq'), followUpLog: [], ...data };
      state.enquiries.push(doc);
      return { ...doc };
    },
    async findById(companyId, id) {
      const doc = state.enquiries.find((e) => matchesId(e, id) && String(e.companyId) === String(companyId));
      return doc ? { ...doc } : null;
    },
    async listByCompany(companyId) {
      return state.enquiries.filter((e) => String(e.companyId) === String(companyId)).map((e) => ({ ...e }));
    },
    async updateFields(companyId, id, patch) {
      const doc = state.enquiries.find((e) => matchesId(e, id) && String(e.companyId) === String(companyId));
      if (!doc) return null;
      Object.assign(doc, patch);
      return { ...doc };
    },
    async pushFollowUp(companyId, id, patch, logEntry) {
      const doc = state.enquiries.find((e) => matchesId(e, id) && String(e.companyId) === String(companyId));
      if (!doc) return null;
      Object.assign(doc, patch);
      doc.followUpLog = [...(doc.followUpLog || []), logEntry];
      return { ...doc };
    },
    async reopenIfLost(companyId, id, logEntry) {
      const doc = state.enquiries.find(
        (e) => matchesId(e, id) && String(e.companyId) === String(companyId) && e.status === 'Lost'
      );
      if (!doc) return null;
      doc.status = 'Open';
      doc.followUpLog = [...(doc.followUpLog || []), logEntry];
      return { ...doc };
    },
    async markWonIfOpen(companyId, id, { remark, logEntry }) {
      const doc = state.enquiries.find(
        (e) => matchesId(e, id) && String(e.companyId) === String(companyId) && e.status === 'Open'
      );
      if (!doc) return null;
      doc.status = 'Won';
      doc.remark = remark;
      doc.followUpLog = [...(doc.followUpLog || []), logEntry];
      return { ...doc };
    },
    // FIX-6-03 (B2 -- Company deletion/cascade).
    async deleteManyByCompany(companyId) {
      state.enquiries = state.enquiries.filter((e) => String(e.companyId) !== String(companyId));
    },
  };

  const salesOrderRepo = {
    async findByEnquiryId(companyId, enquiryId) {
      const doc = state.salesOrders.find(
        (s) => String(s.companyId) === String(companyId) && String(s.enquiryId) === String(enquiryId)
      );
      return doc ? { ...doc } : null;
    },
    async create(data) {
      const dupe =
        data.enquiryId &&
        state.salesOrders.find(
          (s) => String(s.companyId) === String(data.companyId) && String(s.enquiryId) === String(data.enquiryId)
        );
      if (dupe) {
        const err = new Error('This Enquiry has already been converted to a SalesOrder.');
        err.code = 'DUPLICATE_CONVERSION';
        throw err;
      }
      const doc = { id: nextId('so'), enquiryId: null, ...data };
      state.salesOrders.push(doc);
      return { ...doc };
    },
    async findById(companyId, id) {
      const doc = state.salesOrders.find((s) => matchesId(s, id) && String(s.companyId) === String(companyId));
      return doc ? cloneDeep(doc) : null;
    },
    async listByCompany(companyId) {
      return state.salesOrders.filter((s) => String(s.companyId) === String(companyId)).map((s) => cloneDeep(s));
    },
    async update(companyId, id, patch) {
      const doc = state.salesOrders.find((s) => matchesId(s, id) && String(s.companyId) === String(companyId));
      if (!doc) return null;
      Object.assign(doc, patch);
      return cloneDeep(doc);
    },
    async setMilestoneAmount(companyId, id, milestoneIndex, amount) {
      const doc = state.salesOrders.find((s) => matchesId(s, id) && String(s.companyId) === String(companyId));
      if (!doc) return null;
      doc.paymentMilestones = doc.paymentMilestones || [];
      if (doc.paymentMilestones[milestoneIndex]) doc.paymentMilestones[milestoneIndex].amount = amount;
      return cloneDeep(doc);
    },
    async setMilestoneReceived(companyId, id, milestoneIndex, received) {
      const doc = state.salesOrders.find((s) => matchesId(s, id) && String(s.companyId) === String(companyId));
      if (!doc) return null;
      doc.paymentMilestones = doc.paymentMilestones || [];
      if (doc.paymentMilestones[milestoneIndex]) doc.paymentMilestones[milestoneIndex].received = received;
      return cloneDeep(doc);
    },
    // FIX-6-03 (B2 -- Company deletion/cascade).
    async deleteManyByCompany(companyId) {
      state.salesOrders = state.salesOrders.filter((s) => String(s.companyId) !== String(companyId));
    },
  };

  const projectRepo = {
    async create(data) {
      const doc = { id: nextId('proj'), ...data };
      state.projects.push(doc);
      return cloneDeep(doc);
    },
    async findBySalesOrderId(companyId, salesOrderId) {
      const doc = state.projects.find(
        (p) => String(p.companyId) === String(companyId) && String(p.salesOrderId) === String(salesOrderId)
      );
      return doc ? cloneDeep(doc) : null;
    },
    async findById(companyId, id) {
      const doc = state.projects.find((p) => matchesId(p, id) && String(p.companyId) === String(companyId));
      return doc ? cloneDeep(doc) : null;
    },
    async listByCompany(companyId) {
      return state.projects.filter((p) => String(p.companyId) === String(companyId)).map((p) => cloneDeep(p));
    },
    async update(companyId, id, patch) {
      const doc = state.projects.find((p) => matchesId(p, id) && String(p.companyId) === String(companyId));
      if (!doc) return null;
      Object.assign(doc, patch);
      return cloneDeep(doc);
    },
    async listEligibleForDelayCheck() {
      return state.projects
        .filter((p) => p.status === 'Ongoing' && p.timelineSet === true)
        .map((p) => ({ id: String(p.id), companyId: String(p.companyId) }));
    },
    // FIX-6-03 (B2 -- Company deletion/cascade).
    async deleteManyByCompany(companyId) {
      state.projects = state.projects.filter((p) => String(p.companyId) !== String(companyId));
    },
  };

  const paymentRepo = {
    async create(data) {
      const doc = { id: nextId('pay'), partPayments: [], ...data };
      state.payments.push(doc);
      return cloneDeep(doc);
    },
    async findById(companyId, id) {
      const doc = state.payments.find((p) => matchesId(p, id) && String(p.companyId) === String(companyId));
      return doc ? cloneDeep(doc) : null;
    },
    async findBySalesOrderAndMilestone(companyId, salesOrderId, milestoneIndex) {
      const doc = state.payments.find(
        (p) =>
          String(p.companyId) === String(companyId) &&
          String(p.salesOrderId) === String(salesOrderId) &&
          p.milestoneIndex === milestoneIndex
      );
      return doc ? cloneDeep(doc) : null;
    },
    async listByCompany(companyId, { status } = {}) {
      return state.payments
        .filter((p) => String(p.companyId) === String(companyId) && (!status || p.status === status))
        .map((p) => cloneDeep(p));
    },
    async update(companyId, id, patch) {
      const doc = state.payments.find((p) => matchesId(p, id) && String(p.companyId) === String(companyId));
      if (!doc) return null;
      Object.assign(doc, patch);
      return cloneDeep(doc);
    },
    async pushPartPayment(companyId, id, partPayment) {
      const doc = state.payments.find((p) => matchesId(p, id) && String(p.companyId) === String(companyId));
      if (!doc) return null;
      const entry = { id: nextId('pp'), ...partPayment };
      doc.partPayments = [...(doc.partPayments || []), entry];
      return cloneDeep(doc);
    },
    async updatePartPayment(companyId, id, partPaymentId, patch) {
      const doc = state.payments.find((p) => matchesId(p, id) && String(p.companyId) === String(companyId));
      if (!doc) return null;
      const entry = (doc.partPayments || []).find((pp) => matchesId(pp, partPaymentId));
      if (!entry) return null;
      Object.assign(entry, patch);
      return cloneDeep(doc);
    },
    async removePartPayment(companyId, id, partPaymentId) {
      const doc = state.payments.find((p) => matchesId(p, id) && String(p.companyId) === String(companyId));
      if (!doc) return null;
      doc.partPayments = (doc.partPayments || []).filter((pp) => !matchesId(pp, partPaymentId));
      return cloneDeep(doc);
    },
    async remove(companyId, id) {
      state.payments = state.payments.filter((p) => !(matchesId(p, id) && String(p.companyId) === String(companyId)));
      return true;
    },
    // FIX-6-03 (B2 -- Company deletion/cascade).
    async deleteManyByCompany(companyId) {
      state.payments = state.payments.filter((p) => String(p.companyId) !== String(companyId));
    },
  };

  const contractRepo = {
    async create(data) {
      const doc = { id: nextId('contract'), ...data };
      state.contracts.push(doc);
      return cloneDeep(doc);
    },
    async findById(companyId, id) {
      const doc = state.contracts.find((c) => matchesId(c, id) && String(c.companyId) === String(companyId));
      return doc ? cloneDeep(doc) : null;
    },
    async listByCompany(companyId) {
      return state.contracts.filter((c) => String(c.companyId) === String(companyId)).map((c) => cloneDeep(c));
    },
    async setVisitCompleted(companyId, id, visitIndex, completedDate) {
      const doc = state.contracts.find((c) => matchesId(c, id) && String(c.companyId) === String(companyId));
      if (!doc) return null;
      doc.scheduledVisits = doc.scheduledVisits || [];
      if (doc.scheduledVisits[visitIndex]) doc.scheduledVisits[visitIndex].completedDate = completedDate;
      return cloneDeep(doc);
    },
    // FIX-6-03 (B2 -- Company deletion/cascade).
    async deleteManyByCompany(companyId) {
      state.contracts = state.contracts.filter((c) => String(c.companyId) !== String(companyId));
    },
  };

  const serviceCallRepo = {
    async create(data) {
      const doc = { id: nextId('svc'), ...data };
      state.serviceCalls.push(doc);
      return cloneDeep(doc);
    },
    async findById(companyId, id) {
      const doc = state.serviceCalls.find((s) => matchesId(s, id) && String(s.companyId) === String(companyId));
      return doc ? cloneDeep(doc) : null;
    },
    async listByCompany(companyId) {
      return state.serviceCalls.filter((s) => String(s.companyId) === String(companyId)).map((s) => cloneDeep(s));
    },
    async update(companyId, id, patch) {
      const doc = state.serviceCalls.find((s) => matchesId(s, id) && String(s.companyId) === String(companyId));
      if (!doc) return null;
      Object.assign(doc, patch);
      return cloneDeep(doc);
    },
    async completeIfNotCompleted(companyId, id, patch) {
      const doc = state.serviceCalls.find((s) => matchesId(s, id) && String(s.companyId) === String(companyId));
      if (!doc || doc.status === 'Completed') return null;
      Object.assign(doc, patch);
      return cloneDeep(doc);
    },
    // FIX-6-03 (B2 -- Company deletion/cascade).
    async deleteManyByCompany(companyId) {
      state.serviceCalls = state.serviceCalls.filter((s) => String(s.companyId) !== String(companyId));
    },
  };


  const inventoryCategoryRepo = {
    async create(data) {
      const doc = { id: nextId('invcat'), ...data };
      state.inventoryCategories.push(doc);
      return { ...doc };
    },
    async findById(companyId, id) {
      const doc = state.inventoryCategories.find((c) => matchesId(c, id) && String(c.companyId) === String(companyId));
      return doc ? { ...doc } : null;
    },
    async listByCompany(companyId) {
      return state.inventoryCategories.filter((c) => String(c.companyId) === String(companyId)).map((c) => ({ ...c }));
    },
    async rename(companyId, id, name) {
      const doc = state.inventoryCategories.find((c) => matchesId(c, id) && String(c.companyId) === String(companyId));
      if (!doc) return null;
      doc.name = name;
      return { ...doc };
    },
    async remove(companyId, id) {
      const before = state.inventoryCategories.length;
      state.inventoryCategories = state.inventoryCategories.filter(
        (c) => !(matchesId(c, id) && String(c.companyId) === String(companyId))
      );
      return state.inventoryCategories.length < before;
    },
  };

  const inventoryLocationRepo = {
    async create(data) {
      const doc = { id: nextId('invloc'), ...data };
      state.inventoryLocations.push(doc);
      return { ...doc };
    },
    async findById(companyId, id) {
      const doc = state.inventoryLocations.find((l) => matchesId(l, id) && String(l.companyId) === String(companyId));
      return doc ? { ...doc } : null;
    },
    async listByCompany(companyId) {
      return state.inventoryLocations.filter((l) => String(l.companyId) === String(companyId)).map((l) => ({ ...l }));
    },
    async rename(companyId, id, name) {
      const doc = state.inventoryLocations.find((l) => matchesId(l, id) && String(l.companyId) === String(companyId));
      if (!doc) return null;
      doc.name = name;
      return { ...doc };
    },
    async remove(companyId, id) {
      const before = state.inventoryLocations.length;
      state.inventoryLocations = state.inventoryLocations.filter(
        (l) => !(matchesId(l, id) && String(l.companyId) === String(companyId))
      );
      return state.inventoryLocations.length < before;
    },
  };

  const inventoryItemRepo = {
    async create(data) {
      const doc = { id: nextId('invitem'), stockByLocation: {}, ...data };
      state.inventoryItems.push(doc);
      return cloneDeep(doc);
    },
    async findById(companyId, id) {
      const doc = state.inventoryItems.find((i) => matchesId(i, id) && String(i.companyId) === String(companyId));
      return doc ? cloneDeep(doc) : null;
    },
    async listByCompany(companyId) {
      return state.inventoryItems.filter((i) => String(i.companyId) === String(companyId)).map((i) => cloneDeep(i));
    },
    async update(companyId, id, patch) {
      const doc = state.inventoryItems.find((i) => matchesId(i, id) && String(i.companyId) === String(companyId));
      if (!doc) return null;
      Object.assign(doc, patch);
      return cloneDeep(doc);
    },
    // Fake mirror of the real repo's atomic-increment-then-clamp-to-zero
    // primitive (INVENTORY_DECISION_LOCK.md Decision 10) -- functionally
    // equivalent for tests, not literally atomic (single-threaded fakes
    // need no locking).
    async incrementStockAtLocation(companyId, id, locationId, delta) {
      const doc = state.inventoryItems.find((i) => matchesId(i, id) && String(i.companyId) === String(companyId));
      if (!doc) return null;
      doc.stockByLocation = doc.stockByLocation || {};
      const key = String(locationId);
      const next = (Number(doc.stockByLocation[key]) || 0) + delta;
      doc.stockByLocation[key] = next < 0 ? 0 : next;
      return cloneDeep(doc);
    },
    async remove(companyId, id) {
      const before = state.inventoryItems.length;
      state.inventoryItems = state.inventoryItems.filter(
        (i) => !(matchesId(i, id) && String(i.companyId) === String(companyId))
      );
      return state.inventoryItems.length < before;
    },
  };

  const inventoryIssueRepo = {
    async create(data) {
      const doc = { id: nextId('invissue'), ...data };
      state.inventoryIssues.push(doc);
      return cloneDeep(doc);
    },
    async findById(companyId, id) {
      const doc = state.inventoryIssues.find((x) => matchesId(x, id) && String(x.companyId) === String(companyId));
      return doc ? cloneDeep(doc) : null;
    },
    async listByCompany(companyId) {
      return state.inventoryIssues.filter((x) => String(x.companyId) === String(companyId)).map((x) => cloneDeep(x));
    },
    async listByStaff(companyId, staffId) {
      return state.inventoryIssues
        .filter((x) => String(x.companyId) === String(companyId) && String(x.staffId) === String(staffId))
        .map((x) => cloneDeep(x));
    },
    async update(companyId, id, patch) {
      const doc = state.inventoryIssues.find((x) => matchesId(x, id) && String(x.companyId) === String(companyId));
      if (!doc) return null;
      Object.assign(doc, patch);
      return cloneDeep(doc);
    },
  };

  const inventoryTransactionRepo = {
    async create(data) {
      const doc = { id: nextId('invtxn'), ...data };
      state.inventoryTransactions.push(doc);
      return cloneDeep(doc);
    },
    async listByCompany(companyId) {
      return state.inventoryTransactions.filter((t) => String(t.companyId) === String(companyId)).map((t) => cloneDeep(t));
    },
    async listByItem(companyId, itemId) {
      return state.inventoryTransactions
        .filter((t) => String(t.companyId) === String(companyId) && String(t.itemId) === String(itemId))
        .map((t) => cloneDeep(t));
    },
  };

  const companyRepo = {
    async findById(id) {
      const doc = state.companies.find((c) => matchesId(c, id));
      return doc ? cloneDeep(doc) : null;
    },
    // FIX-6-03 (B2 -- Company deletion/cascade).
    async delete(id) {
      state.companies = state.companies.filter((c) => !matchesId(c, id));
    },
  };

  const notificationRepo = {
    async create(data) {
      const doc = { id: nextId('notif'), ...data };
      state.notifications.push(doc);
      return { ...doc };
    },
    async listForRole(companyId, role, options) {
      const limit = (options && options.limit) || 200;
      return state.notifications
        .filter(
          (n) =>
            String(n.companyId) === String(companyId) &&
            (n.targetRoles || []).some((r) => r === role || r === '*')
        )
        .slice()
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .slice(0, limit)
        .map((n) => ({ ...n }));
    },
    async markRead(companyId, id, userId) {
      const doc = state.notifications.find((n) => matchesId(n, id) && String(n.companyId) === String(companyId));
      if (!doc) return null;
      doc.readByUserIds = doc.readByUserIds || [];
      if (!doc.readByUserIds.some((u) => String(u) === String(userId))) doc.readByUserIds.push(userId);
      return { ...doc };
    },
    // FIX-6-03 (B2 -- Company deletion/cascade).
    async deleteManyByCompany(companyId) {
      state.notifications = state.notifications.filter((n) => String(n.companyId) !== String(companyId));
    },
  };

  const checklistTemplateRepo = {
    async findDefaultForDivision(companyId, division) {
      const templates = state.checklistTemplates.filter(
        (t) => String(t.companyId) === String(companyId) && t.division === division
      );
      const preferred = templates.find((t) => t.isDefault);
      return preferred ? { ...preferred } : templates[0] ? { ...templates[0] } : null;
    },
    async findById(companyId, id) {
      const doc = state.checklistTemplates.find((t) => matchesId(t, id) && String(t.companyId) === String(companyId));
      return doc ? cloneDeep(doc) : null;
    },
    async listByDivision(companyId, division) {
      return state.checklistTemplates
        .filter((t) => String(t.companyId) === String(companyId) && t.division === division)
        .map((t) => cloneDeep(t));
    },
    async listByCompany(companyId) {
      return state.checklistTemplates.filter((t) => String(t.companyId) === String(companyId)).map((t) => cloneDeep(t));
    },
    async create(data) {
      const doc = { id: nextId('chktpl'), ...data };
      state.checklistTemplates.push(doc);
      return cloneDeep(doc);
    },
    async updateFields(companyId, id, patch) {
      const doc = state.checklistTemplates.find((t) => matchesId(t, id) && String(t.companyId) === String(companyId));
      if (!doc) return null;
      Object.assign(doc, patch);
      return cloneDeep(doc);
    },
    async unsetDefaultsForDivision(companyId, division) {
      state.checklistTemplates
        .filter((t) => String(t.companyId) === String(companyId) && t.division === division && t.isDefault)
        .forEach((t) => {
          t.isDefault = false;
        });
    },
    async countByDivision(companyId, division) {
      return state.checklistTemplates.filter((t) => String(t.companyId) === String(companyId) && t.division === division).length;
    },
    async deleteById(companyId, id) {
      state.checklistTemplates = state.checklistTemplates.filter(
        (t) => !(matchesId(t, id) && String(t.companyId) === String(companyId))
      );
    },
  };

  const userRepoForEnquiry = {
    async findById(id) {
      const doc = state.users.find((u) => matchesId(u, id));
      return doc ? { ...doc } : null;
    },
    async listByCompany(companyId) {
      return state.users.filter((u) => String(u.companyId) === String(companyId)).map((u) => ({ ...u }));
    },
  };

  // Added for FIX-3.8-01 (userService.js) cross-module workflow tests —
  // reads/writes the SAME state.users array userRepoForEnquiry above reads,
  // so a user created via userService.createUser in a test is immediately
  // visible to serviceCallService/projectService/inventoryService's own
  // userRepoForEnquiry lookups within the same store, proving real
  // cross-module compatibility (not just constant-membership checks).
  const userWriteRepo = {
    async existsByCompanyAndUsername(companyId, username) {
      return state.users.some((u) => String(u.companyId) === String(companyId) && u.username === username);
    },
    async create(userData) {
      const doc = { id: nextId('user'), active: true, ...userData };
      state.users.push(doc);
      return { ...doc };
    },
    async listByCompany(companyId) {
      return state.users.filter((u) => String(u.companyId) === String(companyId)).map((u) => ({ ...u }));
    },
    async findByIdAndCompany(companyId, id) {
      const doc = state.users.find((u) => matchesId(u, id) && String(u.companyId) === String(companyId));
      return doc ? { ...doc } : null;
    },
    async updateByIdAndCompany(companyId, id, patch) {
      const doc = state.users.find((u) => matchesId(u, id) && String(u.companyId) === String(companyId));
      if (!doc) return null;
      Object.assign(doc, patch);
      return { ...doc };
    },
    async deleteByIdAndCompany(companyId, id) {
      state.users = state.users.filter((u) => !(matchesId(u, id) && String(u.companyId) === String(companyId)));
    },
    // FIX-6-03 (B2 -- Company deletion/cascade). PWA FACT (`delCompany`,
    // index.html:1811-1817): the cascade purges exactly these 8 collections
    // by company id -- users, enquiries, sos, projects, svcCalls, contracts,
    // payments, notifs. Inventory (*items/categories/locations/issues/
    // transactions) and checklist templates are demonstrably NOT touched by
    // the PWA's own cascade list and must stay untouched here too.
    async deleteManyByCompany(companyId) {
      state.users = state.users.filter((u) => String(u.companyId) !== String(companyId));
    },
  };

  const planRepo = {
    async listAll() {
      return state.plans.map((p) => ({ ...p }));
    },
    async findByCode(code) {
      const doc = state.plans.find((p) => p.code === code.toUpperCase());
      return doc ? { ...doc } : null;
    },
    async create(data) {
      const existing = state.plans.find((p) => p.code === (data.code || '').toUpperCase());
      if (existing) {
        const err = new Error('A plan with that code already exists.');
        err.code = 'PLAN_CODE_DUPLICATE';
        throw err;
      }
      const doc = { id: nextId('plan'), ...data };
      state.plans.push(doc);
      return { ...doc };
    },
    async updateByCode(code, patch) {
      const doc = state.plans.find((p) => p.code === code.toUpperCase());
      if (!doc) return null;
      Object.assign(doc, patch);
      return { ...doc };
    },
  };

  const subscriptionRepo = {
    async findByCompany(companyId) {
      const doc = state.subscriptions.find((s) => String(s.companyId) === String(companyId));
      return doc ? cloneDeep(doc) : null;
    },
    async create(data) {
      const doc = { id: nextId('sub'), ...data };
      state.subscriptions.push(doc);
      return cloneDeep(doc);
    },
    async update(id, data) {
      const doc = state.subscriptions.find((s) => matchesId(s, id));
      if (!doc) return null;
      // Handle $push operator the same way the Mongoose adapter does
      for (const [key, value] of Object.entries(data)) {
        if (key === '$push') {
          for (const [field, entry] of Object.entries(value)) {
            doc[field] = doc[field] || [];
            doc[field].push(entry);
          }
        } else {
          doc[key] = value;
        }
      }
      return cloneDeep(doc);
    },
  };

  const counterRepo = {
    async getNextSequence(companyId, name) {
      const key = `${companyId}:${name}`;
      state.counters[key] = (state.counters[key] || 0) + 1;
      return state.counters[key];
    },
  };

  /**
   * Fake transaction: snapshots the whole in-memory store before running
   * fn, and restores it verbatim if fn throws — the same all-or-nothing
   * guarantee session.withTransaction() gives against a real MongoDB, so
   * tests can assert "the cascade/mutation cannot partially succeed"
   * without a live database.
   */
  async function withTransaction(deps, fn) {
    const snap = snapshot();
    try {
      return await fn(deps);
    } catch (err) {
      restore(snap);
      throw err;
    }
  }

  return {
    state,
    enquiryRepo,
    salesOrderRepo,
    projectRepo,
    paymentRepo,
    contractRepo,
    serviceCallRepo,
    notificationRepo,
    checklistTemplateRepo,
    userRepoForEnquiry,
    userWriteRepo,
    companyRepo,
    counterRepo,
    withTransaction,
    planRepo,
    subscriptionRepo,
    inventoryCategoryRepo,
    inventoryLocationRepo,
    inventoryItemRepo,
    inventoryIssueRepo,
    inventoryTransactionRepo,
  };
}

module.exports = { createEnquiryFakeStore };
