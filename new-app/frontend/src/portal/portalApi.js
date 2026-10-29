/**
 * The client portal's own API client (owner decision, 27 Oct 2026).
 *
 * Deliberately separate from src/api/client.js, and storing its token under
 * its own key. A member of staff and a client can then be signed in on the
 * same browser without either ending the other's session — which matters,
 * because the person testing this is usually both.
 */

const PORTAL_TOKEN_KEY = 'mep_portal_token';

export function getPortalToken() {
  try {
    return localStorage.getItem(PORTAL_TOKEN_KEY);
  } catch {
    return null; // private browsing: the session simply does not persist
  }
}

export function setPortalToken(token) {
  try {
    if (token) localStorage.setItem(PORTAL_TOKEN_KEY, token);
    else localStorage.removeItem(PORTAL_TOKEN_KEY);
  } catch {
    /* nothing to do */
  }
}

export class PortalApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.name = 'PortalApiError';
    this.status = status;
    this.data = data;
  }
}

async function request(path, { method = 'GET', body } = {}) {
  const token = getPortalToken();
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new PortalApiError('Could not reach the server. Check your connection.', 0, null);
  }

  let data = null;
  const text = await res.text();
  if (text) { try { data = JSON.parse(text); } catch { data = { raw: text }; } }

  if (!res.ok) {
    if (res.status === 401 && !path.endsWith('/auth/login')) {
      setPortalToken(null);
      if (typeof window !== 'undefined') window.dispatchEvent(new Event('mep:portal-unauthorized'));
    }
    throw new PortalApiError((data && data.error) || `Request failed (${res.status})`, res.status, data);
  }
  return data;
}

export const portalApi = {
  get: (p) => request(p),
  post: (p, body) => request(p, { method: 'POST', body }),
};

/**
 * An attachment is behind the client's own session, so it cannot be used as
 * a plain <img src>. Fetched with the token and handed to the page as a
 * blob URL instead.
 */
export async function fetchAttachmentUrl(attachmentId) {
  const token = getPortalToken();
  const res = await fetch(`/api/portal/attachments/${attachmentId}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new PortalApiError('Could not load that photograph.', res.status, null);
  return URL.createObjectURL(await res.blob());
}
