import { API_BASE_URL } from '../config';

const TOKEN_STORAGE_KEY = 'mep_new_app_token';

export function getStoredToken() {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch (e) {
    return null;
  }
}

export function setStoredToken(token) {
  try {
    if (token) {
      localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch (e) {
    // localStorage unavailable (private browsing, etc.) — session simply
    // won't survive a reload; not fatal for this pass.
  }
}

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

/**
 * Thin fetch wrapper around the dev backend's real HTTP API.
 * Attaches the bearer token automatically when present, and throws a typed
 * ApiError (with the real HTTP status + parsed JSON body) on any non-2xx
 * response so callers can show real, specific error messages.
 */
export async function apiRequest(path, { method = 'GET', body, token } = {}) {
  const authToken = token !== undefined ? token : getStoredToken();
  const headers = { 'Content-Type': 'application/json' };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;

  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (networkErr) {
    throw new ApiError(
      `Could not reach the backend at ${API_BASE_URL}. Is the dev server running (npm run dev:server)?`,
      0,
      null
    );
  }

  let data = null;
  const text = await response.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (e) {
      data = { raw: text };
    }
  }

  if (!response.ok) {
    const message = (data && data.error) || `Request failed with status ${response.status}`;
    throw new ApiError(message, response.status, data);
  }

  return data;
}

export const api = {
  get: (path, opts) => apiRequest(path, { ...opts, method: 'GET' }),
  post: (path, body, opts) => apiRequest(path, { ...opts, method: 'POST', body }),
  patch: (path, body, opts) => apiRequest(path, { ...opts, method: 'PATCH', body }),
  delete: (path, opts) => apiRequest(path, { ...opts, method: 'DELETE' }),
};
