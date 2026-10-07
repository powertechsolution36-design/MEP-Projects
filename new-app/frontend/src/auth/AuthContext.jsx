import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, ApiError, getStoredToken, setStoredToken } from '../api/client';

const AuthContext = createContext(null);

/**
 * Owns the full session lifecycle against the real dev backend:
 *  - restores a session from localStorage on load (calls GET /api/auth/me
 *    to confirm the stored token is still valid, not just present)
 *  - login() -> POST /api/auth/login
 *  - logout() -> POST /api/auth/logout
 *
 * `status` is one of 'checking' | 'authenticated' | 'anonymous' so routing
 * can tell "we don't know yet" (initial load) apart from "definitely not
 * logged in" (show the login screen).
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState('checking');
  const [error, setError] = useState(null);

  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      setStatus('anonymous');
      return;
    }
    api
      .get('/api/auth/me', { token })
      .then((data) => {
        setUser(data.user);
        setStatus('authenticated');
      })
      .catch(() => {
        setStoredToken(null);
        setUser(null);
        setStatus('anonymous');
      });
  }, []);

  const login = useCallback(async ({ username, password, companyId }) => {
    setError(null);
    try {
      const data = await api.post('/api/auth/login', {
        username,
        password,
        companyId: companyId || null,
      });
      setStoredToken(data.token);
      setUser(data.user);
      setStatus('authenticated');
      return data.user;
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Login failed.';
      setError(message);
      throw err;
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/api/auth/logout', {});
    } catch (e) {
      // Even if the network call fails, drop the local session so the UI
      // is never stuck "authenticated" against a backend it can't reach.
    }
    setStoredToken(null);
    setUser(null);
    setStatus('anonymous');
  }, []);

  const value = { user, status, error, login, logout };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
