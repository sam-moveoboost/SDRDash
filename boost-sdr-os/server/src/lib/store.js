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

const keyFor = (itemId) => `coach:v${RUBRIC_VERSION}:${itemId}`;

async function getAnalysis(itemId) {
  const key = keyFor(itemId);
  if (memory.has(key)) return memory.get(key);
  const s = getStorage();
  if (s) {
    try {
      const res = await s.get(key);
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
    const res = await s.set(key, analysis);
    return res?.success === true;
  } catch (_err) {
    return false;
  }
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

module.exports = { getAnalysis, saveAnalysis, mapLimit };
