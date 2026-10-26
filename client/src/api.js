// One place that talks to the server. Pages call api.get('/providers') and never touch fetch directly.
// Vite reads VITE_API_URL at BUILD time, so changing it on Vercel needs a redeploy.
const BASE = `${(import.meta.env.VITE_API_URL || '').replace(/\/$/, '')}/api`;
const TOKEN_KEY = 'tlp_token';

// localStorage can throw (private windows, blocked storage), so every access is wrapped.
export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable: the user just has to sign in again next visit */
  }
}

let onUnauthorized = () => {};
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function request(method, path, body) {
  const token = getToken();
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Cannot reach the server. Check your connection and try again.', 0);
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty or non-JSON body */
  }

  if (!res.ok) {
    // A 401 while holding a token means the session expired. Sign the user out so the UI recovers.
    if (res.status === 401 && token) onUnauthorized();
    let message = data?.message || `Something went wrong (error ${res.status}).`;
    if (Array.isArray(data?.errors) && data.errors.length) {
      const detail = data.errors.map((e) => (typeof e === 'string' ? e : e.message)).join(' ');
      if (detail) message = detail;
    }
    throw new ApiError(message, res.status);
  }
  return data;
}

// Photos and videos go up as the raw file body (no JSON), with the real type and name in headers.
async function upload(path, file, caption = '') {
  const token = getToken();
  let res;
  try {
    res = await fetch(BASE + path, {
      method: 'POST',
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        'X-Filename': encodeURIComponent(file.name || 'file'),
        ...(caption ? { 'X-Caption': encodeURIComponent(caption) } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: file,
    });
  } catch {
    throw new ApiError('Cannot reach the server. Check your connection and try again.', 0);
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) {
    if (res.status === 401 && token) onUnauthorized();
    throw new ApiError(data?.message || `Upload failed (error ${res.status}).`, res.status);
  }
  return data;
}

/** The server hands out file addresses starting with /api/...; add the server's own address in production. */
export const mediaSrc = (url) => `${(import.meta.env.VITE_API_URL || '').replace(/\/$/, '')}${url}`;

export const TOKEN_STORAGE_KEY = TOKEN_KEY;

export const api = {
  upload,
  del: (path) => request('DELETE', path),
  get: (path) => request('GET', path),
  post: (path, body = {}) => request('POST', path, body),
  put: (path, body = {}) => request('PUT', path, body),
  patch: (path, body = {}) => request('PATCH', path, body),
};
