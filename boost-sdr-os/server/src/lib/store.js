// Saves each call's analysis so it is only ever paid for once. Uses monday code
// storage when available and falls back to memory (lost on restart) otherwise.

const { Storage } = require('@mondaycom/apps-sdk');
const { getSecret } = require('./secrets');
const { RUBRIC_VERSION } = require('./config');

const memory = new Map();
let storage;

function getStorage() {
  if (storage !== undefined) return storage;
  const token = getSecret('MONDAY_API_TOKEN');
  try {
    storage = token ? new Storage(token) : null;
  } catch (_err) {
    storage = null;
  }
  return storage;
}

// Storage calls must never hang a request, so each one gets a short deadline.
const withTimeout = (promise, ms, what) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(`${what} timed out after ${ms / 1000}s`)), ms)),
]);
const STORAGE_TIMEOUT_MS = 10000;

const keyFor = (itemId) => `coach:v${RUBRIC_VERSION}:${itemId}`;

async function getAnalysis(itemId) {
  const key = keyFor(itemId);
  if (memory.has(key)) return memory.get(key);
  const s = getStorage();
  if (s) {
    try {
      const res = await withTimeout(s.get(key), STORAGE_TIMEOUT_MS, 'Storage read');
      if (res?.success && res.value) {
        memory.set(key, res.value);
        return res.value;
      }
    } catch (_err) {
      // fall through to "not analysed"
    }
  }
  return null;
}

// Returns true only if the analysis was saved permanently. The memory copy is not
// enough to mark a call as analysed, because a restart would lose it.
async function saveAnalysis(itemId, analysis) {
  const key = keyFor(itemId);
  memory.set(key, analysis);
  const s = getStorage();
  if (!s) return false;
  try {
    const res = await withTimeout(s.set(key, analysis), STORAGE_TIMEOUT_MS, 'Storage write');
    return res?.success === true;
  } catch (_err) {
    return false;
  }
}

// Writes and reads back a throwaway record, to prove storage works.
async function selfTest() {
  const s = getStorage();
  if (!s) throw new Error('No storage (the monday API token secret is missing)');
  const stamp = String(Date.now());
  const set = await withTimeout(s.set('selftest', { stamp }), STORAGE_TIMEOUT_MS, 'Storage write');
  if (set?.success !== true) throw new Error(`Storage write failed: ${set?.error || 'unknown error'}`);
  const got = await withTimeout(s.get('selftest'), STORAGE_TIMEOUT_MS, 'Storage read');
  if (got?.value?.stamp !== stamp) throw new Error('Storage read did not return what was written');
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

module.exports = { getAnalysis, saveAnalysis, mapLimit, selfTest };
