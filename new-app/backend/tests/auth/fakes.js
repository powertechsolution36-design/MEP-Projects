'use strict';

/**
 * In-memory fake repositories implementing the exact same interfaces as
 * src/auth/repositories.mongoose.js — used ONLY by tests, so the auth/company
 * service logic can be exercised thoroughly WITHOUT opening any live
 * database connection (per the task's verification requirement).
 */

let idCounter = 0;
function nextId(prefix) {
  idCounter += 1;
  return `${prefix}_${idCounter}`;
}

function createInMemoryStore(seedUsers = [], seedCompanies = []) {
  const users = seedUsers.map((u) => ({ active: true, ...u }));
  const companies = seedCompanies.map((c) => ({ ...c }));
  const sessions = new Map();

  const userRepo = {
    async findForLogin({ companyId, username }) {
      const match = companyId
        ? users.find((u) => u.companyId === companyId && u.username === username)
        : users.find((u) => u.role === 'super' && u.username === username);
      return match ? { ...match } : null;
    },
    async findById(id) {
      const match = users.find((u) => u.id === id);
      return match ? { ...match } : null;
    },
  };

  const userWriteRepo = {
    async existsByCompanyAndUsername(companyId, username) {
      return users.some((u) => u.companyId === companyId && u.username === username);
    },
    async create(userData) {
      const doc = { id: nextId('user'), active: true, ...userData };
      users.push(doc);
      return { ...doc };
    },
    // Added for FIX-3.8-01 (userService.js) tests.
    async listByCompany(companyId) {
      return users.filter((u) => u.companyId === companyId).map((u) => ({ ...u }));
    },
    async findByIdAndCompany(companyId, id) {
      const match = users.find((u) => u.id === id && u.companyId === companyId);
      return match ? { ...match } : null;
    },
    async updateByIdAndCompany(companyId, id, patch) {
      const match = users.find((u) => u.id === id && u.companyId === companyId);
      if (!match) return null;
      Object.assign(match, patch);
      return { ...match };
    },
    async deleteByIdAndCompany(companyId, id) {
      const idx = users.findIndex((u) => u.id === id && u.companyId === companyId);
      if (idx >= 0) users.splice(idx, 1);
    },
  };

  const companyRepo = {
    async findById(id) {
      const match = companies.find((c) => c.id === id);
      return match ? { ...match } : null;
    },
    async create(companyData) {
      const doc = { id: nextId('company'), ...companyData };
      companies.push(doc);
      return { ...doc };
    },
  };

  const sessionRepo = {
    async createSession({ userId, companyId, role, issuedAt, expiresAt }) {
      const id = nextId('session');
      sessions.set(id, { id, userId, companyId, role, issuedAt, expiresAt, revokedAt: null });
      return { id };
    },
    async findActiveSession(id) {
      const session = sessions.get(id);
      if (!session) return null;
      if (session.revokedAt) return null;
      if (session.expiresAt.getTime() <= Date.now()) return null;
      return { id: session.id };
    },
    async revokeSession(id) {
      const session = sessions.get(id);
      if (session) session.revokedAt = new Date();
    },
    // test helper, not part of the production interface
    _getRaw(id) {
      return sessions.get(id);
    },
  };

  return { users, companies, sessions, userRepo, userWriteRepo, companyRepo, sessionRepo };
}

module.exports = { createInMemoryStore };
