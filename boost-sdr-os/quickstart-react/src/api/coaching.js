import mondaySdk from 'monday-sdk-js';

// The coaching data lives on our monday code server, not in the browser. Every call
// carries monday's signed session token, and the server decides what this person may
// see. Nothing here is a lock on its own.
//
// Each app version has its own server address. This one is v4. When v4 is promoted
// to live, set VITE_COACHING_SERVER_URL to the live address (or change it here).
const SERVER_URL = (import.meta.env.VITE_COACHING_SERVER_URL || 'https://fcbba-service-32182176-d6c59411.us.monday.app').replace(/\/$/, '');

const monday = mondaySdk();

async function sessionToken() {
  const res = await monday.get('sessionToken');
  if (!res?.data) throw Object.assign(new Error('Open this app from inside monday to sign in.'), { code: 'not_signed_in' });
  return res.data;
}

// A restart of the server shows up as a dropped connection or a gateway error for a few minutes.
// Reads try again a couple of times quickly; the page then keeps trying by itself (see Coaching.jsx).
const looksLikeRestart = (err) => err instanceof TypeError || ([502, 503, 504].includes(err?.status) && err?.code !== 'not_configured');
const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

async function requestOnce(path, { method = 'GET', body } = {}) {
  const token = await sessionToken();
  const res = await fetch(`${SERVER_URL}/coaching${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) {
    throw Object.assign(new Error(json?.message || `The server answered ${res.status}.`), { status: res.status, code: json?.error });
  }
  return json;
}

async function request(path, opts = {}) {
  const isRead = !opts.method || opts.method === 'GET';
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await requestOnce(path, opts);
    } catch (err) {
      // Only reads are repeated; an analysis is never sent twice behind the person's back.
      if (!isRead || attempt >= 2 || !looksLikeRestart(err)) throw err;
      await wait(1500 * (attempt + 1));
    }
  }
}

const qs = (params) => {
  const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== ''));
  return s.toString() ? `?${s}` : '';
};

export const coachingApi = {
  // `fresh` makes the server re-read the board now instead of using the list it already holds.
  overview: (userId, days, fresh) => request(`/overview${qs({ userId, days, fresh: fresh ? 1 : undefined })}`),
  calls: (userId, days, fresh) => request(`/calls${qs({ userId, days, fresh: fresh ? 1 : undefined })}`),
  trends: (userId, days, fresh) => request(`/trends${qs({ userId, days, fresh: fresh ? 1 : undefined })}`),
  transcript: (id) => request(`/calls/${encodeURIComponent(id)}/transcript`),
  selftest: () => request('/selftest'),
  analyse: (ids) => request('/analyse', { method: 'POST', body: { ids } }),
  // Background analysis: start it, then ask how it is going with short requests.
  analyseStart: (ids) => request('/analyse/start', { method: 'POST', body: { ids } }),
  analyseStatus: (ids) => request(`/analyse/status${qs({ ids: ids.join(',') })}`),
  analyseCancel: (ids) => request('/analyse/cancel', { method: 'POST', body: { ids } }),
};
