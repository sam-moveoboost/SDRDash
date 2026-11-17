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
  new Promise((_, reject) => { setTimeout(() => reject(new Error(`${what} timed out after ${ms / 1000}s`)), ms).unref?.(); }),
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
  epoch += 1;
  backends = list;
  chosen = null;
  lastTried = 0;
  memory.clear();
  queue.clear();
  tries.clear();
  reading.clear();
  gate.active = 0;
  gate.cooldownUntil = 0;
  gate.backoff = tuning.backoffStartMs;
}
function _setTuning(t) { Object.assign(tuning, t); gate.backoff = tuning.backoffStartMs; }
const _idle = async () => { while (hydrating || queue.size) await sleep(10); };

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

// Reading saved analyses is rate limited by monday ("request limit exceeded"), so reads are paced:
// a few at a time, with a pause that grows each time storage pushes back. What cannot be read in
// time is finished in the background; everything read stays in memory, so each analysis is read
// from storage at most once per server start. "Not found" and "could not read just now" are
// different answers, so a busy minute never makes finished calls look as if they were never analysed.
const tuning = { maxConcurrent: 3, acquireTimeoutMs: 8000, backoffStartMs: 2000, backoffMaxMs: 30000, maxBackgroundTries: 25 };
const gate = { active: 0, cooldownUntil: 0, backoff: tuning.backoffStartMs };
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
// The background loop's pauses never keep the process alive by themselves.
const sleepQuiet = (ms) => new Promise((resolve) => { setTimeout(resolve, ms).unref?.(); });
let epoch = 0; // bumped when the stores are swapped (tests), so older background work stops
const BUSY_NOTE = 'storage is busy (request limit), loading in the background';

// Waits for a free slot and for any pause to end. False when that takes longer than allowed.
async function acquire(timeoutMs, myEpoch = epoch) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (myEpoch !== epoch) return false;
    const pause = Math.max(0, gate.cooldownUntil - Date.now());
    if (pause === 0 && gate.active < tuning.maxConcurrent) {
      gate.active += 1;
      return true;
    }
    if (Date.now() + Math.max(pause, 20) > deadline) return false;
    await sleep(Math.min(Math.max(pause, 20), 250)); // short naps, so a stopped store is noticed quickly
  }
}
const release = () => { gate.active = Math.max(0, gate.active - 1); };
const pushedBack = () => { gate.cooldownUntil = Date.now() + gate.backoff; gate.backoff = Math.min(gate.backoff * 2, tuning.backoffMaxMs); };
const allClear = () => { gate.backoff = tuning.backoffStartMs; };

const reading = new Map(); // key -> in-flight read, so the three page requests share each read
const queue = new Set(); // ids being loaded in the background
const tries = new Map();
let hydrating = false;

async function hydrate() {
  if (hydrating) return;
  hydrating = true;
  const myEpoch = epoch;
  try {
    while (queue.size && myEpoch === epoch) {
      const id = queue.values().next().value;
      queue.delete(id);
      if (memory.has(keyFor(id))) continue;
      const result = await readAnalysis(id, { patient: true });
      if (result.unreadable) {
        const n = (tries.get(id) || 0) + 1;
        tries.set(id, n);
        if (n < tuning.maxBackgroundTries) queue.add(id);
        await sleepQuiet(Math.max(500, gate.cooldownUntil - Date.now()));
      }
    }
  } finally {
    hydrating = false;
    if (queue.size && myEpoch !== epoch) hydrate(); // stores were swapped while this loop slept: carry on with the new ones
  }
}
function enqueue(itemId) {
  queue.add(String(itemId));
  hydrate();
}

function getAnalysisChecked(itemId) {
  const key = keyFor(itemId);
  if (memory.has(key)) return Promise.resolve({ analysis: memory.get(key), unreadable: false, errors: [] });
  // Already being loaded in the background: say so, rather than adding more reads.
  if (queue.has(String(itemId))) return Promise.resolve({ analysis: null, unreadable: true, errors: [BUSY_NOTE] });
  if (!reading.has(key)) reading.set(key, readAnalysis(itemId).finally(() => reading.delete(key)));
  return reading.get(key);
}

// Some stores answer "no such key" by throwing. That is an answer ("not there"), not a failure to read.
const NOT_FOUND = /not.?found|404|no such|does not exist|doesn.?t exist|no value/i;

async function readAnalysis(itemId, { patient = false } = {}) {
  const key = keyFor(itemId);
  const myEpoch = epoch;
  const order = chosen ? [chosen, ...backends.filter((b) => b !== chosen)] : backends;
  let failed = false;
  const errors = [];
  for (const backend of order) {
    if (!(await acquire(patient ? 120000 : tuning.acquireTimeoutMs, myEpoch))) {
      failed = true;
      if (!errors.includes(BUSY_NOTE)) errors.push(BUSY_NOTE);
      continue;
    }
    try {
      const value = await withTimeout(backend.get(key), TIMEOUT_MS, 'reading an analysis');
      allClear();
      if (value && typeof value === 'object' && value.callType) {
        if (myEpoch === epoch) memory.set(key, value);
        return { analysis: value, unreadable: false, errors: [] };
      }
    } catch (err) {
      if (NOT_FOUND.test(err.message)) {
        allClear(); // the store said it has nothing under that key
      } else {
        console.error(`[store] reading ${itemId} from ${backend.name} failed: ${err.message}`);
        pushedBack();
        failed = true;
        errors.push(`${backend.name}: ${err.message}`);
      }
    } finally {
      release();
    }
  }
  if (failed && !patient && myEpoch === epoch) enqueue(itemId); // finish it in the background, paced
  return { analysis: null, unreadable: failed, errors: failed ? errors : [] };
}

async function getAnalysis(itemId) {
  return (await getAnalysisChecked(itemId)).analysis;
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

module.exports = { getAnalysis, getAnalysisChecked, saveAnalysis, mapLimit, selfTest, _setBackends, _setTuning, _idle, _makeBackends: makeBackends };
