// Central API client with automatic auth token + error handling
function getApiBase() {
  const h = window.location.hostname;
  if (h === 'localhost' || h === '127.0.0.1') return '';  // uses Vite proxy
  if (h === 'mep-projects.spereon.codes') return 'https://api.mep-projects.spereon.codes';
  return `${window.location.protocol}//api.${h}`;
}

export const API_BASE = getApiBase();
const TOKEN_KEY = 'mep_token';

export function getToken() { return localStorage.getItem(TOKEN_KEY); }
export function setToken(t) { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); }

class ApiError extends Error {
  constructor(msg, status, data) { super(msg); this.status = status; this.data = data; }
}

async function request(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  const t = getToken();
  if (t) headers.Authorization = `Bearer ${t}`;
  const opts = { method, headers };
  if (body !== undefined) opts.body = JSON.stringify(body);
  let res;
  try { res = await fetch(API_BASE + path, opts); }
  catch (e) { throw new ApiError('Network error', 0); }
  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await res.json().catch(() => ({})) : await res.text();
  if (!res.ok) {
    if (res.status === 401) { setToken(null); window.dispatchEvent(new Event('mep:logout')); }
    throw new ApiError(data?.error || `HTTP ${res.status}`, res.status, data);
  }
  return data;
}

export const api = {
  get: (p) => request('GET', p),
  post: (p, b) => request('POST', p, b),
  put: (p, b) => request('PUT', p, b),
  patch: (p, b) => request('PATCH', p, b),
  del: (p) => request('DELETE', p),
};

export { ApiError };
