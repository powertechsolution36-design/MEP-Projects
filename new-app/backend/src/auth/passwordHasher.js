'use strict';

const bcrypt = require('bcryptjs');

/**
 * Password hashing — NEW BACKEND SECURITY DESIGN.
 *
 * The PWA stores/displays plaintext passwords (`users.pw`). This must never
 * be carried forward: this module is the ONLY place a plaintext password is
 * ever handled, and it is never logged, stored, or returned.
 *
 * bcrypt (via bcryptjs, a pure-JS implementation with no native build step,
 * chosen for portability across the developer's environment) is a mature,
 * industry-standard password hashing mechanism for Node.js.
 */

const SALT_ROUNDS = 12;

/**
 * @param {string} plainPassword
 * @returns {Promise<string>} a bcrypt hash — safe to persist as User.passwordHash
 */
async function hashPassword(plainPassword) {
  if (typeof plainPassword !== 'string' || plainPassword.length === 0) {
    throw new Error('Password must be a non-empty string.');
  }
  return bcrypt.hash(plainPassword, SALT_ROUNDS);
}

/**
 * @param {string} plainPassword
 * @param {string} passwordHash
 * @returns {Promise<boolean>}
 */
async function verifyPassword(plainPassword, passwordHash) {
  if (!plainPassword || !passwordHash) return false;
  return bcrypt.compare(plainPassword, passwordHash);
}

module.exports = { hashPassword, verifyPassword };
