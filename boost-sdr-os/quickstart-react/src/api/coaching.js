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

async function request(path, { method = 'GET', body } = {}) {
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

const qs = (params) => {
  const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== ''));
  return s.toString() ? `?${s}` : '';
};

export const coachingApi = {
  overview: (userId, days) => request(`/overview${qs({ userId, days })}`),
  calls: (userId, days) => request(`/calls${qs({ userId, days })}`),
  trends: (userId, days) => request(`/trends${qs({ userId, days })}`),
  transcript: (id) => request(`/calls/${encodeURIComponent(id)}/transcript`),
  selftest: () => request('/selftest'),
  analyse: (ids) => request('/analyse', { method: 'POST', body: { ids } }),
};
