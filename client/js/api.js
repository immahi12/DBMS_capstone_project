/**
 * ReLoop Frontend API Client (Vanilla JS)
 * Uses relative /api/... endpoints so browser requests work identically locally and in proxied previews.
 */
window.ReLoopAPI = (function () {
  const TOKEN_KEY = 'reloop_jwt_token';
  const USER_KEY = 'reloop_current_user';

  function getToken() {
    return localStorage.getItem(TOKEN_KEY);
  }

  function getUser() {
    try {
      const raw = localStorage.getItem(USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function setSession(token, user) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }

  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  async function request(endpoint, options = {}) {
    const headers = Object.assign(
      { 'Content-Type': 'application/json' },
      options.headers || {}
    );
    const token = getToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const res = await fetch(endpoint, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    const payload = await res.json().catch(() => ({
      success: false,
      error: { message: `Unexpected HTTP ${res.status} response` },
    }));

    if (res.status === 401 && !endpoint.includes('/api/auth/login')) {
      clearSession();
      window.location.hash = '#/login';
    }

    if (!res.ok || !payload.success) {
      const msg =
        (payload.error && payload.error.message) ||
        `Request failed with status ${res.status}`;
      const err = new Error(msg);
      err.code = payload.error && payload.error.code;
      err.status = res.status;
      throw err;
    }

    return payload.data;
  }

  return {
    getToken,
    getUser,
    setSession,
    clearSession,
    get: (url) => request(url, { method: 'GET' }),
    post: (url, body) => request(url, { method: 'POST', body }),
    patch: (url, body) => request(url, { method: 'PATCH', body }),
  };
})();
