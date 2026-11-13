// Saves each call's analysis so it is only ever paid for once.
//
// Two monday code stores are available and they cannot be tested outside monday, so the
// app tests them itself: it picks the first one that can write a record and read the same
// record back. A save only counts once it has been read back, because a call is marked
// "Analysed" on the board on the strength of it.

const { Storage, SecureStorage } = require('@mondaycom/apps-sdk');
const { getSecret } = require('./secrets');
const { RUBRIC_VERSION } = require('./config');

const TIMEOUT_MS = 12000;
const RETRY_AFTER_MS = 60000;

const withTimeout = (promise, ms, what) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(`${what} timed out after ${ms / 1000}s`)), ms)),
]);

// Some stores hand JSON back as text.
const parse = (v) => {
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch (_err) { return v; }
};

const describe = (v) => {
  if (v == null) return 'nothing';
  if (typeof v === 'string') return `text (${v.length} characters)`;
  if (typeof v === 'object') return `an object with ${Object.keys(v).length} fields`;
  return typeof v;
};

// Keys use underscores only, which are safe in a URL path.
const keyFor = (itemId) => `coach_v${RUBRIC_VERSION}_${itemId}`;

// The monday SDK is passed in so tests can stand in for it.
function makeBackends({ Storage: AppStorage = Storage, SecureStorage: SecureStore = SecureStorage, getSecret: secret = getSecret } = {}) {
  let secure;
  let app;
  return [
    {
      name: 'secure storage',
      async set(key, value) {
        secure = secure || new SecureStore();
        return (await secure.set(key, value)) === true;
      },
      async get(key) {
        secure = secure || new SecureStore();
        return parse(await secure.get(key));
      },
    },
    {
      name: 'app storage',
      async set(key, value) {
        const token = secret('MONDAY_API_TOKEN');
        if (!token) throw new Error('the monday API token secret is missing');
        app = app || new AppStorage(token);
        // This store keeps text, so objects must be turned into JSON first (otherwise they
        // are saved as the words "[object Object]").
        const res = await app.set(key, JSON.stringify(value));
        if (res?.success !== true) throw new Error(`write refused: ${res?.error || 'unknown error'}`);
        return true;
      },
      async get(key) {
        const token = secret('MONDAY_API_TOKEN');
        if (!token) throw new Error('the monday API token secret is missing');
        app = app || new AppStorage(token);
        const res = await app.get(key);
        return parse(res?.value);
      },
    },
  ];
}

let backends = makeBackends();
let chosen = null;
let lastTried = 0;
const memory = new Map();

// For tests: swap in fake stores and forget any earlier choice.
function _setBackends(list) {
  backends = list;
  chosen = null;
  lastTried = 0;
  memory.clear();
}

// Writes a record about the size of a real analysis and reads it back.
async function roundTrip(backend) {
  const stamp = String(Date.now());
  const key = `selftest_${backend.name.replace(/\W+/g, '_')}`;
  const sent = { stamp, pad: 'x'.repeat(4000) };
  if (!(await withTimeout(backend.set(key, sent), TIMEOUT_MS, 'the write'))) throw new Error('the write was not accepted');
  const got = await withTimeout(backend.get(key), TIMEOUT_MS, 'the read');
  if (got?.stamp !== stamp) throw new Error(`the read gave back ${describe(got)} instead of what was written`);
}

async function verifiedBackend() {
  if (chosen) return chosen;
  if (lastTried && Date.now() - lastTried < RETRY_AFTER_MS) return null;
  lastTried = Date.now();
  for (const backend of backends) {
    try {
      await roundTrip(backend);
      chosen = backend;
      console.log(`[store] using ${backend.name}`);
      return backend;
    } catch (err) {
      console.error(`[store] ${backend.name} is not usable: ${err.message}`);
    }
  }
  return null;
}

async function getAnalysis(itemId) {
  const key = keyFor(itemId);
  if (memory.has(key)) return memory.get(key);
  const backend = await verifiedBackend();
  if (!backend) return null;
  try {
    const value = await withTimeout(backend.get(key), TIMEOUT_MS, 'reading an analysis');
    if (value && typeof value === 'object' && value.callType) {
      memory.set(key, value);
      return value;
    }
  } catch (_err) {
    // treated as not analysed
  }
  return null;
}

// True only if the analysis was written and read back from a store that works.
async function saveAnalysis(itemId, analysis) {
  const key = keyFor(itemId);
  const backend = await verifiedBackend();
  if (!backend) return false;
  try {
    if (!(await withTimeout(backend.set(key, analysis), TIMEOUT_MS, 'saving the analysis'))) return false;
    const back = await withTimeout(backend.get(key), TIMEOUT_MS, 'checking the saved analysis');
    if (back?.callType !== analysis.callType) return false;
    memory.set(key, analysis);
    return true;
  } catch (err) {
    console.error(`[store] saving ${itemId} failed: ${err.message}`);
    return false;
  }
}

// One result per store, for the manager connection check.
async function selfTest() {
  const results = [];
  for (const backend of backends) {
    const t0 = Date.now();
    try {
      await roundTrip(backend);
      if (!chosen) chosen = backend;
      results.push({ name: `Saving analyses: ${backend.name}`, ok: true, ms: Date.now() - t0 });
    } catch (err) {
      results.push({ name: `Saving analyses: ${backend.name}`, ok: false, ms: Date.now() - t0, error: err.message });
    }
  }
  return results;
}

// Runs fn over items with a small concurrency limit.
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i], i);
      }
    }),
  );
  return results;
}

module.exports = { getAnalysis, saveAnalysis, mapLimit, selfTest, _setBackends, _makeBackends: makeBackends };
