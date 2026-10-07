'use strict';

const express = require('express');
const authService = require('../auth/authService');
const { createAuthMiddleware } = require('../middleware/authMiddleware');

/**
 * Foundation authentication API.
 *
 *   POST /api/auth/login
 *   POST /api/auth/logout
 *   GET  /api/auth/me
 *
 * Full per-endpoint documentation lives in new-app/docs/API_AUTH_FOUNDATION.md.
 */
function createAuthRouter(deps) {
  const router = express.Router();
  const authMiddleware = createAuthMiddleware(deps);

  router.post('/login', async (req, res) => {
    const { username, password, companyId } = req.body || {};
    try {
      const result = await authService.login({ username, password, companyId: companyId || null }, deps);
      return res.status(200).json({
        token: result.token,
        expiresAt: result.expiresAt,
        user: result.user, // safe profile only — never a password hash
      });
    } catch (err) {
      if (err instanceof authService.AuthError) {
        return res.status(401).json({ error: err.message });
      }
      return res.status(400).json({ error: 'Login failed.' });
    }
  });

  router.post('/logout', authMiddleware, async (req, res) => {
    await authService.logout(req.auth.sessionId, deps);
    return res.status(200).json({ ok: true });
  });

  router.get('/me', authMiddleware, async (req, res) => {
    const { userRepo } = deps;
    const user = await userRepo.findById(req.auth.userId);
    if (!user) {
      return res.status(401).json({ error: 'Invalid or expired session.' });
    }
    return res.status(200).json({ user: authService.toSafeUser(user) });
  });

  return router;
}

module.exports = { createAuthRouter };
