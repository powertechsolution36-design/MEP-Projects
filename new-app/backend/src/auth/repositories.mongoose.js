'use strict';

const { User, AuthSession, Company } = require('../models');
const { wrapDuplicateKeyError } = require('../errors');

/**
 * Real, Mongoose-backed implementations of the repository interfaces that
 * src/auth/authService.js and src/services/companyService.js depend on.
 *
 * This module is the ONLY place authService's pure logic is wired to an
 * actual database — it is used by the Express routes (src/routes) at
 * runtime, but is NOT exercised by the test suite, which instead injects
 * in-memory fakes implementing the same interface (see tests/auth/fakes.js).
 * This keeps "no live database used" true for verification while still
 * giving the auth logic a real persistence path for actual deployment.
 */

const userRepo = {
  async findForLogin({ companyId, username }) {
    const query = companyId ? { companyId, username } : { role: 'super', username };
    const doc = await User.findOne(query).lean();
    return doc ? mapUser(doc) : null;
  },
  async findById(id) {
    const doc = await User.findById(id).lean();
    return doc ? mapUser(doc) : null;
  },
};

function mapUser(doc) {
  return {
    id: String(doc._id),
    name: doc.name,
    username: doc.username,
    role: doc.role,
    companyId: doc.companyId ? String(doc.companyId) : null,
    active: doc.active !== false,
    passwordHash: doc.passwordHash,
  };
}

const sessionRepo = {
  async createSession({ userId, companyId, role, issuedAt, expiresAt }) {
    const doc = await AuthSession.create({ userId, companyId, role, issuedAt, expiresAt });
    return { id: String(doc._id) };
  },
  async findActiveSession(sessionId) {
    if (!sessionId) return null;
    const doc = await AuthSession.findById(sessionId).lean();
    if (!doc) return null;
    if (doc.revokedAt) return null;
    if (doc.expiresAt.getTime() <= Date.now()) return null;
    return { id: String(doc._id) };
  },
  async revokeSession(sessionId) {
    if (!sessionId) return;
    await AuthSession.findByIdAndUpdate(sessionId, { revokedAt: new Date() });
  },
};

const companyRepo = {
  async findById(id) {
    const doc = await Company.findById(id).lean();
    return doc ? { ...doc, id: String(doc._id) } : null;
  },
  async create(companyData) {
    const doc = await Company.create(companyData);
    const obj = doc.toObject();
    return { ...obj, id: String(obj._id) };
  },
  // FIX-6-03 (B2 -- Company deletion/cascade).
  async delete(id, session) {
    await Company.findByIdAndDelete(id, { session });
  },
  async listAll() {
    const docs = await Company.find({}).lean();
    return docs.map((d) => ({ ...d, id: String(d._id) }));
  },
  async updateFields(id, fields) {
    const doc = await Company.findByIdAndUpdate(id, { $set: fields }, { new: true }).lean();
    return doc ? { ...doc, id: String(doc._id) } : null;
  },
};

const userWriteRepo = {
  async existsByCompanyAndUsername(companyId, username) {
    const existing = await User.findOne({ companyId, username }).lean();
    return Boolean(existing);
  },
  async create(userData) {
    // FIX-6-02: User has a unique (companyId, username) index. userService.js
    // already pre-checks existsByCompanyAndUsername, but that check-then-create
    // is not atomic — a concurrent duplicate create must still surface a
    // friendly application error, never a raw E11000/driver message.
    try {
      const doc = await User.create(userData);
      return mapUser(doc.toObject());
    } catch (err) {
      wrapDuplicateKeyError(err, 'That username is already taken in this company.', 'USERNAME_ALREADY_EXISTS');
    }
  },
  // FIX-6-03 (B2 -- Company deletion/cascade): part of the PWA's literal
  // 8-collection cascade list (delCompany, index.html:1811-1817).
  async deleteManyByCompany(companyId, session) {
    await User.deleteMany({ companyId }, { session });
  },
  // Added for FIX-3.8-01 (userService.js) — post-bootstrap User management
  // (list/get/edit/delete), company-scoped throughout.
  async listByCompany(companyId) {
    const docs = await User.find({ companyId }).lean();
    return docs.map(mapUser);
  },
  async findByIdAndCompany(companyId, id) {
    const doc = await User.findOne({ _id: id, companyId }).lean();
    return doc ? mapUser(doc) : null;
  },
  async updateByIdAndCompany(companyId, id, patch) {
    const doc = await User.findOneAndUpdate({ _id: id, companyId }, { $set: patch }, { new: true }).lean();
    return doc ? mapUser(doc) : null;
  },
  async deleteByIdAndCompany(companyId, id) {
    await User.deleteOne({ _id: id, companyId });
  },
};

module.exports = { userRepo, sessionRepo, companyRepo, userWriteRepo };
