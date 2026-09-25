import mondaySdk from 'monday-sdk-js';
import { MEETING_COLS, EXCLUDED_CHANNELS, isQualifyingMeeting } from '../utils/meetingAttribution';

const monday = mondaySdk();

// ── API token strategy ─────────────────────────────────────────────────────
// monday.api() inside the iframe uses the app's OAuth token, which only has
// the scopes declared in the app's Monday developer-console settings.
// If that app never had write scopes added, ALL mutations are rejected by the
// postMessage bridge before they reach our error handler.
//
// Workaround: set VITE_MONDAY_API_TOKEN in .env.local to a personal Monday
// API token (Profile → Developers → Personal API Tokens).  That token carries
// your full user permissions and is used via direct fetch, bypassing the bridge.
//
// Long-term fix: add boards:write / items:write scopes to the app in Monday's
// developer console and reinstall the app.
const DIRECT_TOKEN = import.meta.env.VITE_MONDAY_API_TOKEN;

async function mondayFetch(query) {
  const res = await fetch('https://api.monday.com/v2', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: DIRECT_TOKEN,
      'API-Version': '2024-01',
    },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors?.length) {
    const raw = JSON.stringify(json.errors);
    console.error('[mondayFetch] errors:', raw);
    throw new Error(raw.slice(0, 400));
  }
  return json.data;
}

// The Monday SDK postMessage bridge cannot handle concurrent API calls — it returns
// "Invalid content-type" when two calls race.  The serial queue below fixes that.
// BUT: when DIRECT_TOKEN is set we use plain HTTP (mondayFetch), which is a standard
// concurrent-safe REST endpoint.  Skip the queue entirely in that case — serialising
// HTTP fetches is the main reason the Scoreboard was slow (~30 s instead of ~8 s).
let _apiQueue = Promise.resolve();

export function gql(query, { forceBridge = false } = {}) {
  // Direct fetch (HTTP) → fire immediately, no queue needed.
  // forceBridge skips this even when DIRECT_TOKEN is set — required for anything
  // that must reflect the actual embedded viewer (e.g. "who am I"), since the
  // direct token always resolves to whichever person's personal token it is,
  // not whoever currently has the app open.
  if (DIRECT_TOKEN && !forceBridge) return mondayFetch(query);

  // SDK postMessage bridge → must serialise.
  const call = () => monday.api(query).then(res => {
    if (res.errors?.length) {
      const raw = JSON.stringify(res.errors);
      console.error('[gql] errors:', raw);
      throw new Error(raw.slice(0, 400));
    }
    if (!res.data) throw new Error('No data returned from Monday API');
    return res.data;
  });

  // Chain onto the queue. Use .then(call, call) so a prior failure doesn't stall the queue.
  const result = _apiQueue.then(call, call);
  _apiQueue = result.then(() => {}, () => {});
  return result;
}

export const BOARDS = {
  PROSPECTS:     '5089407333',
  LEADS:         '5089407338',
  OPPORTUNITIES: '5089407336',
  ACCOUNTS:      '5089407341',
  CONTACTS:      '5089407337',
  AIRCALL:       '5092898618',
  TEAM_REGISTER: '5098805673',
  ARCHIVE:       '5098805642',
  EVENTS:        '5100871165',
};

// Walks every page via cursor — a board this size (the Opportunities board alone
// has 1000+ items) blows past a single 100-item page, which silently dropped
// almost all historical Won/Lost deals from every downstream calculation
// (win rate, closed value, quarter/year cards) since they weren't in whatever
// arbitrary 100 items monday happened to return first.
async function paginateBoard(boardId, fields) {
  console.log(`[monday] querying board ${boardId}...`);
  const first = await gql(`
    query {
      boards(ids: ["${boardId}"]) {
        items_page(limit: 500) {
          cursor
          items { ${fields} }
        }
      }
    }
  `);
  let allItems = first.boards[0]?.items_page?.items ?? [];
  let cursor   = first.boards[0]?.items_page?.cursor ?? null;

  let pages = 0;
  while (cursor && pages < 10) {
    const next = await gql(`
      query {
        next_items_page(limit: 500, cursor: "${cursor}") {
          cursor
          items { ${fields} }
        }
      }
    `);
    allItems = [...allItems, ...(next.next_items_page?.items ?? [])];
    cursor   = next.next_items_page?.cursor ?? null;
    pages++;
  }
  if (cursor) console.warn(`[monday] board ${boardId} has more items beyond the ${pages}-page cap — results are incomplete`);

  console.log(`[monday] board ${boardId} returned ${allItems.length} items`);
  return allItems;
}

// Helper: get a column value's text by ID. Formula columns never populate
// `text` (monday's API only computes it into `display_value`), so fall back
// to that — otherwise every formula column silently reads as empty/zero.
function colText(item, id) {
  const cv = item.column_values?.find(c => c.id === id);
  return cv?.text || cv?.display_value || '';
}

// ── Current user ──────────────────────────────────────────────────
// Always goes through the SDK bridge (forceBridge) — this must reflect whoever
// currently has the app open, not the fixed identity behind DIRECT_TOKEN.
export async function fetchCurrentUser() {
  const data = await gql(`query { me { id name email photo_thumb account { slug } } }`, { forceBridge: true });
  return data.me;
}

// ── Team Register ─────────────────────────────────────────────────
export async function fetchTeamRegister() {
  const data = await gql(`
    query {
      boards(ids: ["${BOARDS.TEAM_REGISTER}"]) {
        items_page(limit: 20) {
          items {
            id
            name
            column_values {
              id
              text
              value
            }
          }
        }
      }
    }
  `);
  const members = (data.boards[0]?.items_page?.items ?? []).map(parseTeamMember);

  const userIds = members.map(m => m.mondayUserId).filter(Boolean);
  if (userIds.length === 0) return members;

  const photoData = await gql(`
    query {
      users(ids: [${userIds.join(', ')}]) {
        id
        photo_thumb
      }
    }
  `);
  const photoMap = {};
  (photoData.users ?? []).forEach(u => { photoMap[String(u.id)] = u.photo_thumb; });

  return members.map(m => ({
    ...m,
    photoThumb: m.mondayUserId ? (photoMap[m.mondayUserId] ?? null) : null,
  }));
}

function parseTeamMember(item) {
  let mondayUserId = null;
  try {
    const raw = item.column_values?.find(c => c.id === 'multiple_person_mm4xaq63')?.value;
    if (raw) {
      const parsed = JSON.parse(raw);
      const first = parsed.personsAndTeams?.[0];
      if (first) mondayUserId = String(first.id);
    }
  } catch {}

  return {
    id:                 item.id,
    name:               item.name,
    mondayUserId,
    role:               colText(item, 'color_mm4e2v55'),
    rampMonth:          colText(item, 'color_mm4ehd9w'),
    multiplier:         parseFloat(colText(item, 'numeric_mm4e7k4w') || '1'),
    monthlyTarget:      parseFloat(colText(item, 'numeric_mm4e6n5n') || '0'),
    fullQuota:          parseFloat(colText(item, 'numeric_mm4ezckh') || '0'),
    region:             colText(item, 'color_mm4f4gaj'),
    weeklyCallTarget:   parseFloat(colText(item, 'numeric_mm4xwgdb') || '0'),
    weeklyEmailTarget:  parseFloat(colText(item, 'numeric_mm4xt7bt') || '0'),
    weeklyLinkedIn:     parseFloat(colText(item, 'numeric_mm4xnzej') || '0'),
    weeklyProspects:    parseFloat(colText(item, 'numeric_mm4xce7f') || '0'),
    weeklyConvos:       parseFloat(colText(item, 'numeric_mm4xvdy5') || '0'),
  };
}

// ── Qualified Meetings ────────────────────────────────────────────
// month: "YYYY-MM" — server-side filter on Qualified Date (date_mm4wkg8g).
// Returns every region: the region filter is applied client-side after
// attribution (utils/meetingAttribution), because a lead with a blank Region
// column belongs to the region of the rep who booked it — filtering on the
// raw column here silently dropped those meetings from regional views.
export async function fetchQualifiedMeetings({ month }) {
  const startDate = `${month}-01`;
  const [y, m] = month.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const endDate = `${month}-${String(lastDay).padStart(2, '0')}`;

  const rules = [
    `{ column_id: "${MEETING_COLS.QUALIFIED}", compare_value: ["${startDate}"], operator: greater_than_or_equals }`,
    `{ column_id: "${MEETING_COLS.QUALIFIED}", compare_value: ["${endDate}"],   operator: lower_than_or_equal }`,
  ];

  const LEAD_FIELDS = `
    id name created_at updated_at
    column_values(ids: [${Object.values(MEETING_COLS).map(c => `"${c}"`).join(', ')}]) {
      id text value
    }
  `;

  const first = await gql(`
    query {
      boards(ids: ["${BOARDS.LEADS}"]) {
        items_page(limit: 500, query_params: { rules: [${rules.join(', ')}] }) {
          cursor
          items { ${LEAD_FIELDS} }
        }
      }
    }
  `);

  let allItems = first.boards[0]?.items_page?.items ?? [];
  let cursor   = first.boards[0]?.items_page?.cursor ?? null;

  let pages = 0;
  while (cursor && pages < 4) {
    const next = await gql(`
      query {
        next_items_page(limit: 500, cursor: "${cursor}") {
          cursor
          items { ${LEAD_FIELDS} }
        }
      }
    `);
    allItems = [...allItems, ...(next.next_items_page?.items ?? [])];
    cursor = next.next_items_page?.cursor ?? null;
    pages++;
  }

  return allItems.filter(isQualifyingMeeting);
}

// ── Leads with a meeting date ─────────────────────────────────────
// Every lead with MB Date set, for the "booked" (created in period + has a
// meeting date) and "sitting" (meeting date in period) metrics. One query
// covers both, for any week or month, and the set is small because a lead
// only lands here once someone fills in its meeting date.
export async function fetchLeadsWithMeetingDate() {
  const LEAD_FIELDS = `
    id name created_at updated_at
    column_values(ids: [${Object.values(MEETING_COLS).map(c => `"${c}"`).join(', ')}]) {
      id text value
    }
  `;
  const rule = `{ column_id: "${MEETING_COLS.MEETING_DATE}", compare_value: [], operator: is_not_empty }`;

  const first = await gql(`
    query {
      boards(ids: ["${BOARDS.LEADS}"]) {
        items_page(limit: 500, query_params: { rules: [${rule}] }) {
          cursor
          items { ${LEAD_FIELDS} }
        }
      }
    }
  `);

  let allItems = first.boards[0]?.items_page?.items ?? [];
  let cursor   = first.boards[0]?.items_page?.cursor ?? null;

  let pages = 0;
  while (cursor && pages < 4) {
    const next = await gql(`
      query {
        next_items_page(limit: 500, cursor: "${cursor}") {
          cursor
          items { ${LEAD_FIELDS} }
        }
      }
    `);
    allItems = [...allItems, ...(next.next_items_page?.items ?? [])];
    cursor = next.next_items_page?.cursor ?? null;
    pages++;
  }

  // Same channel rule as qualified meetings: monday.com-sourced leads aren't SDR-generated
  return allItems.filter(item => !EXCLUDED_CHANNELS.has(colText(item, MEETING_COLS.CHANNEL)));
}

// ── Aircall calls (outbound, date-range filtered) ─────────────────
// startDate / endDate: "YYYY-MM-DD" strings (Monday API date column format)
export async function fetchAircallCalls({ startDate, endDate }) {
  const rules = [];
  if (startDate) rules.push(`{ column_id: "date_mm19a9qc", compare_value: ["${startDate}"], operator: greater_than_or_equals }`);
  if (endDate)   rules.push(`{ column_id: "date_mm19a9qc", compare_value: ["${endDate}"],   operator: lower_than_or_equal }`);

  const qp = rules.length ? `query_params: { rules: [${rules.join(', ')}] }` : '';

  const CALL_FIELDS = `
    id name
    column_values(ids: [
      "date_mm19a9qc",
      "date_mm19jrq",
      "date_mm19artx",
      "text_mm195peh",
      "text_mm19p3gx",
      "multiple_person_mm2cff2x",
      "link_mm19c866",
      "tag_mm193gqc"
    ]) { id text value }
  `;

  // First page
  const first = await gql(`
    query {
      boards(ids: ["${BOARDS.AIRCALL}"]) {
        items_page(limit: 500, ${qp}) {
          cursor
          items { ${CALL_FIELDS} }
        }
      }
    }
  `);

  let allItems = first.boards[0]?.items_page?.items ?? [];
  let cursor   = first.boards[0]?.items_page?.cursor ?? null;

  // Paginate if needed (cap at 4 extra pages = 2500 total items)
  let pages = 0;
  while (cursor && pages < 4) {
    const next = await gql(`
      query {
        next_items_page(limit: 500, cursor: "${cursor}") {
          cursor
          items { ${CALL_FIELDS} }
        }
      }
    `);
    allItems = [...allItems, ...(next.next_items_page?.items ?? [])];
    cursor = next.next_items_page?.cursor ?? null;
    pages++;
  }

  return allItems.filter(item => {
    const direction = item.column_values?.find(c => c.id === 'text_mm195peh')?.text?.toLowerCase();
    return direction === 'outbound';
  });
}

// ── Opportunities ─────────────────────────────────────────────────
// Explicit ids — the Opportunities board carries many more formula/mirror
// columns than this. Querying `column_values` unfiltered forces monday to
// compute `display_value` for every one of them on every item across every
// paginated page, which blows past monday's per-minute rate limit for that
// field (FIELD_MINUTE_RATE_LIMIT_EXCEEDED). Only two columns here are
// formulas (PS_VALUE_USD, HOURLY_RATE) — keep this list to what the
// Pipeline list and OpportunityDetailPanel actually read. HOURLY_RATE is
// deliberately left out: only the detail panel shows it, and the panel
// already refetches it for the one item being opened, so computing it for
// every item on the board was pure overhead on the bulk load.
const OPPORTUNITY_FIELD_IDS = [
  'color_mkz28c27',   // STAGE
  'color_mkz2atw5',   // TYPE_OF_DEAL
  'color_mkz2wqw4',   // ARR_SOURCE_TYPE
  'color_mkxerb02',   // REGION
  'color_mm4xexb2',   // TRANSACTION_CURRENCY
  'numeric_mm1j3hkq', // NET_ADDED_ARR
  'numeric_mm4x1a5e', // TOTAL_ACCOUNT_ARR
  'numeric_mkz3h4rp', // PS_VALUE_TXN
  'formula_mm5qaewe', // PS_VALUE_USD (formula)
  'color_mkzaet62',   // SOURCE
  'color_mm0gr7a7',   // REASON_LOST
  'dropdown_mkz4ve72', // INDUSTRY
  'deal_expected_close_date',
  'deal_close_date',
  'deal_creation_date',
  'deal_owner',            // BIZDEV
  'multiple_person_mm4xadea', // SDR
  'numeric_mm5pgbax', // WIN_PROBABILITY
  'color_mm5phjr9',   // FORECAST_CATEGORY
  'numeric_mm4xe0qv', // HOURS_ACQUIRED
  'text_mkz2m8qz',    // NEXT_STEP
  'date_mkz2b26d',    // NEXT_STEP_DATE
  'color_mm3hgc8e',   // DISCOVERY_STATUS
  'color_mkza93q9',   // CONVERSION_ACTIVITY
  'multiple_person_mm1cxqfr', // IC_CSM
  'color_mkz4dtzp',   // ARR_LENGTH
  'color_mm59ttnd',   // CALCULATE_TRIGGER
  'connect_boards31', // ACCOUNT
  'text8',            // COMPANY
  'color_mm4x2xm1',   // PAYMENT_TERMS
];

// ── Opportunities board cache ─────────────────────────────────────
// The whole board is always fetched (region is filtered client-side), so
// Scoreboard, Pipeline and My Work all share one copy instead of each
// re-paginating 1000+ items on every mount, tab switch and region change.
//   - In memory: reused while younger than OPP_CACHE_TTL_MS; concurrent
//     callers share one in-flight request.
//   - In IndexedDB: the last snapshot survives a reload, so the Pipeline can
//     paint it immediately and revalidate in the background.
// Mutations below patch or invalidate it so edits don't disappear on the
// next tab switch.
const OPP_CACHE_TTL_MS = 2 * 60 * 1000;
const OPP_SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
// Keyed on the field list so a column change never paints a snapshot that's
// missing a field the UI now expects.
const OPP_SNAPSHOT_KEY = `opportunities:${OPPORTUNITY_FIELD_IDS.join(',')}`;

let _oppCache = null;    // { items, fetchedAt, stale }
let _oppInFlight = null; // Promise<{ items, fetchedAt }>

function filterByRegion(items, region) {
  if (!region || region === 'All') return items;
  return items.filter(item => colText(item, 'color_mkxerb02') === region);
}

function setOppCache(items, fetchedAt, stale = false) {
  _oppCache = { items, fetchedAt, stale };
  idbSet(OPP_SNAPSHOT_KEY, { items, fetchedAt });
}

function loadOpportunityBoard() {
  if (!_oppInFlight) {
    _oppInFlight = paginateBoard(BOARDS.OPPORTUNITIES, `
      id
      name
      created_at
      updated_at
      column_values(ids: ${JSON.stringify(OPPORTUNITY_FIELD_IDS)}) {
        id
        text
        value
        ... on FormulaValue { display_value }
      }
    `)
      .then(items => { setOppCache(items, Date.now()); return _oppCache; })
      .finally(() => { _oppInFlight = null; });
  }
  return _oppInFlight;
}

// maxAgeMs: 0 forces a network refetch (the Pipeline's Refresh button).
export async function fetchOpportunitySnapshot({ region, maxAgeMs = OPP_CACHE_TTL_MS } = {}) {
  const fresh = _oppCache && !_oppCache.stale && Date.now() - _oppCache.fetchedAt < maxAgeMs
    ? _oppCache
    : await loadOpportunityBoard();
  return { items: filterByRegion(fresh.items, region), fetchedAt: fresh.fetchedAt };
}

export async function fetchOpportunities({ region, maxAgeMs } = {}) {
  return (await fetchOpportunitySnapshot({ region, maxAgeMs })).items;
}

// Whatever is already on hand — memory first, then the persisted snapshot —
// without touching the network. Resolves null when there's nothing usable.
export async function peekCachedOpportunities({ region } = {}) {
  let snap = _oppCache;
  if (!snap) {
    const stored = await idbGet(OPP_SNAPSHOT_KEY);
    if (!stored?.items || Date.now() - stored.fetchedAt > OPP_SNAPSHOT_MAX_AGE_MS) return null;
    // A network load may have landed while IndexedDB was being read.
    if (!_oppCache) _oppCache = { ...stored, stale: true }; // usable, but always revalidated
    snap = _oppCache;
  }
  return { items: filterByRegion(snap.items, region), fetchedAt: snap.fetchedAt };
}

// Replace one item's column_values (and name) in the shared cache, e.g. after
// a save or a formula refetch in the detail panel.
export function patchCachedOpportunity(itemId, { column_values, name } = {}) {
  if (!_oppCache) return;
  const items = _oppCache.items.map(o => (o.id === itemId
    ? { ...o, ...(column_values ? { column_values } : {}), ...(name !== undefined ? { name } : {}) }
    : o));
  setOppCache(items, _oppCache.fetchedAt, _oppCache.stale);
}

// Mark the cache stale without dropping it — the next view still paints it
// instantly but refetches in the background.
function invalidateOpportunityCache() {
  if (_oppCache) _oppCache = { ..._oppCache, stale: true };
}

// ── Tiny IndexedDB key/value store ────────────────────────────────
// Best-effort only: storage can be unavailable (private mode, blocked
// third-party storage inside the monday iframe), in which case every call
// quietly resolves to nothing and the app just behaves as before.
let _idb = null;
function idbOpen() {
  if (!_idb) {
    _idb = new Promise((resolve, reject) => {
      const req = indexedDB.open('sdr-os-cache', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).catch(() => null);
  }
  return _idb;
}

async function idbGet(key) {
  try {
    const db = await idbOpen();
    if (!db) return null;
    return await new Promise(resolve => {
      const req = db.transaction('kv').objectStore('kv').get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    });
  } catch { return null; }
}

async function idbSet(key, value) {
  try {
    const db = await idbOpen();
    if (!db) return;
    const tx = db.transaction('kv', 'readwrite');
    const store = tx.objectStore('kv');
    // Drop snapshots written under an older field list.
    const keysReq = store.getAllKeys();
    keysReq.onsuccess = () => {
      keysReq.result
        .filter(k => typeof k === 'string' && k.startsWith('opportunities:') && k !== key)
        .forEach(k => store.delete(k));
    };
    store.put(value, key);
  } catch {}
}

// ── Short-lived memo for rarely-changing lookups ──────────────────
// Board schemas and the workspace user list are requested by nearly every
// page; share one in-flight request and reuse the result for a few minutes.
function memoizeAsync(fn, ttlMs) {
  const entries = new Map();
  return (...args) => {
    const key = JSON.stringify(args);
    const hit = entries.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.promise;
    const promise = fn(...args);
    entries.set(key, { promise, at: Date.now() });
    promise.catch(() => entries.delete(key));
    return promise;
  };
}

// columnValues must already be in Monday's per-column wire shape
// (e.g. { label: "X" } for status, { date: "YYYY-MM-DD" } for date,
// { personsAndTeams: [...] } for person, plain string for text/numeric).
export async function createOpportunity(name, columnValues) {
  const cvJson = JSON.stringify(JSON.stringify(columnValues ?? {}));
  const data = await gql(`
    mutation {
      create_item(
        board_id: ${BOARDS.OPPORTUNITIES},
        item_name: ${JSON.stringify(name)},
        column_values: ${cvJson}
      ) {
        id
        name
        created_at
        updated_at
        column_values {
          id
          text
          value
          ... on FormulaValue { display_value }
        }
      }
    }
  `);
  if (_oppCache) setOppCache([data.create_item, ..._oppCache.items], _oppCache.fetchedAt, _oppCache.stale);
  return data.create_item;
}

// ── New prospects added in a date range ──────────────────────────
// Returns lightweight items: created_at + person column only.
// Paginates up to 2,500 items (5 pages × 500). New items are typically
// near the top of the default board sort so this should capture them.
export async function fetchNewProspects({ startDate, endDate }) {
  const FIELDS = `
    id
    created_at
    column_values(ids: ["person"]) { id value }
  `;

  const first = await gql(`
    query {
      boards(ids: ["${BOARDS.PROSPECTS}"]) {
        items_page(limit: 500) {
          cursor
          items { ${FIELDS} }
        }
      }
    }
  `);

  let allItems = first.boards[0]?.items_page?.items ?? [];
  let cursor   = first.boards[0]?.items_page?.cursor ?? null;

  let pages = 0;
  while (cursor && pages < 4) {
    const next = await gql(`
      query {
        next_items_page(limit: 500, cursor: "${cursor}") {
          cursor
          items { ${FIELDS} }
        }
      }
    `);
    allItems = [...allItems, ...(next.next_items_page?.items ?? [])];
    cursor = next.next_items_page?.cursor ?? null;
    pages++;
  }

  // Filter client-side by created_at within the date range
  const start = new Date(startDate + 'T00:00:00Z');
  const end   = new Date(endDate   + 'T23:59:59Z');

  return allItems.filter(item => {
    if (!item.created_at) return false;
    const d = new Date(item.created_at);
    return d >= start && d <= end;
  });
}

// ── Workspace users (for owner filter dropdown) ───────────────────
export const fetchWorkspaceUsers = memoizeAsync(async () => {
  const data = await gql(`query { users(kind: non_guests) { id name email photo_thumb } }`);
  return data.users ?? [];
}, 10 * 60 * 1000);

// ── UK opportunity search (for event linking) ─────────────────────
// Uses column_id:"name" with contains_text — the correct Monday API approach.
// search_value is NOT a valid ItemsQuery field. UK filtered client-side
// because combining a status-column rule with contains_text via operator:and
// returns empty results in Monday's API.
export async function searchUKOpportunities(term) {
  if (!term || term.trim().length < 2) return [];
  const safe = term.replace(/["\n\r\\]/g, ' ').trim();
  const data = await gql(`
    query {
      boards(ids: ["${BOARDS.OPPORTUNITIES}"]) {
        items_page(limit: 50, query_params: {
          rules: [{ column_id: "name", compare_value: ["${safe}"], operator: contains_text }]
        }) {
          items {
            id name
            column_values(ids: ["color_mkxerb02"]) { id text }
          }
        }
      }
    }
  `);
  return (data.boards[0]?.items_page?.items ?? []).filter(item => {
    const region = item.column_values?.find(c => c.id === 'color_mkxerb02')?.text;
    return region === 'UK';
  });
}

// ── Event board column options ─────────────────────────────────────
// Works for both status columns (labels is a numeric-keyed object of strings)
// and dropdown columns (labels is an array of {id, name} objects).
export async function fetchEventColumnOptions(columnId) {
  const data = await gql(`
    query {
      boards(ids: ["${BOARDS.EVENTS}"]) {
        columns(ids: ["${columnId}"]) { settings_str }
      }
    }
  `);
  const settingsStr = data.boards[0]?.columns?.[0]?.settings_str;
  if (!settingsStr) return [];
  try {
    const s = JSON.parse(settingsStr);
    // Dropdown: labels is an array of {id, name}
    if (Array.isArray(s.labels)) {
      return s.labels.map(l => l.name).filter(Boolean);
    }
    // Status/color: labels is a numeric-keyed object of label strings
    if (s.labels && typeof s.labels === 'object') {
      return Object.values(s.labels).filter(l => l && typeof l === 'string' && l.trim());
    }
  } catch {}
  return [];
}

// ── Prospects (server-side filtered by person, then paginated) ────
// userId null = no person filter (all prospects — use with caution on 7k board)
const PROSPECT_FIELDS = `
  id name
  column_values(ids: [
    "status", "person", "text_mkw7ezh6", "color_mm4fna6",
    "date4", "date_mkwr8xcd", "numeric_mkwrtyh6", "numeric_mkwr3x6d",
    "text_mm4hbfhh", "text_mm441v8n", "email_mm14rb30", "text_mm09kzh1"
  ]) { id text value }
`;

export async function fetchProspects({ userId, cursor }) {
  if (cursor) {
    const data = await gql(`
      query {
        next_items_page(limit: 50, cursor: "${cursor}") {
          cursor
          items { ${PROSPECT_FIELDS} }
        }
      }
    `);
    return {
      items: data.next_items_page?.items ?? [],
      cursor: data.next_items_page?.cursor ?? null,
    };
  }

  // monday's items_page filter for a "people" column requires the compare_value
  // to be prefixed ("person-<id>"), not the bare numeric id — a bare id silently
  // matches nothing rather than erroring, which is why this can look like "no
  // prospects assigned to me" even when the board clearly shows an assignment.
  const personRule = userId
    ? `rules: [{ column_id: "person", compare_value: ["person-${userId}"], operator: any_of }]`
    : '';

  const data = await gql(`
    query {
      boards(ids: ["${BOARDS.PROSPECTS}"]) {
        items_page(limit: 50, query_params: { ${personRule} }) {
          cursor
          items { ${PROSPECT_FIELDS} }
        }
      }
    }
  `);
  return {
    items: data.boards[0]?.items_page?.items ?? [],
    cursor: data.boards[0]?.items_page?.cursor ?? null,
  };
}

// ── Item name lookup (used to resolve connected board column values) ─
// board_relation columns never populate `text` — only `value` with linkedPulseIds
export async function fetchItemNames(ids) {
  if (!ids || ids.length === 0) return [];
  const data = await gql(`
    query {
      items(ids: [${ids.map(String).join(', ')}]) {
        id
        name
      }
    }
  `);
  return data.items ?? [];
}

// Refetch a handful of columns for one item — used to poll for values that
// update asynchronously via monday automations/formulas (e.g. the FX
// Calculator recomputing Hourly Rate / PS Value (USD) after being triggered),
// since the app otherwise only has the board snapshot from initial load.
export async function fetchItemColumnValues(itemId, columnIds) {
  const idsStr = columnIds.map(id => `"${id}"`).join(', ');
  const data = await gql(`
    query {
      items(ids: [${itemId}]) {
        id
        column_values(ids: [${idsStr}]) {
          id
          text
          value
          ... on FormulaValue { display_value }
        }
      }
    }
  `);
  return data.items?.[0]?.column_values ?? [];
}

// ── Board column schema ───────────────────────────────────────────
// settings_str included so status columns can render their label options as a dropdown
export const fetchBoardColumns = memoizeAsync(async boardId => {
  const data = await gql(`
    query {
      boards(ids: ["${boardId}"]) {
        columns { id title type settings_str }
      }
    }
  `);
  return data.boards[0]?.columns ?? [];
}, 10 * 60 * 1000);

// change_simple_column_value was deprecated in newer Monday API versions.
// Use change_column_value for everything — the value format depends on column type.
const PEOPLE_COL_KEYS = new Set(['sdr', 'bizdev']);

export async function updateOpportunityColumn(itemId, columnId, value, fieldKey, columnType) {
  let innerJson;

  if (PEOPLE_COL_KEYS.has(fieldKey)) {
    // People: {"personsAndTeams":[{"id":123,"kind":"person"}]}
    innerJson = JSON.stringify({ personsAndTeams: [{ id: parseInt(value, 10), kind: 'person' }] });
  } else if (columnType === 'color' || columnType === 'status') {
    // Status: {"label":"On hold"}
    innerJson = JSON.stringify({ label: String(value) });
  } else if (columnType === 'date') {
    // Date: {"date":"2026-07-03"}
    innerJson = JSON.stringify({ date: String(value) });
  } else {
    // Numbers, text: the column's JSON value IS the plain string itself, so it
    // must still be JSON-encoded (quoted) — a bare unquoted string isn't valid JSON.
    innerJson = JSON.stringify(String(value));
  }

  // change_column_value value: JSON! expects a JSON-encoded string literal in the query
  const gqlVal = JSON.stringify(innerJson);

  const data = await gql(`
    mutation {
      change_column_value(
        board_id: ${BOARDS.OPPORTUNITIES},
        item_id: ${itemId},
        column_id: "${columnId}",
        value: ${gqlVal}
      ) { id }
    }
  `);
  invalidateOpportunityCache();
  return data.change_column_value;
}

// ── Events board ──────────────────────────────────────────────────
// Used by mutations — board_relation excluded because change_multiple_column_values
// returns it as null. Fetch queries use linked_items instead (see fetchEvents).
const EVENT_FIELDS = `
  id name
  column_values(ids: [
    "timerange_mm5hahhc",
    "multiple_person_mm5hnbf2",
    "color_mm5g1ye5",
    "color_mm5hm4ye",
    "color_mm5g6xz0",
    "color_mm5h7kxk",
    "text_mm5gwa0a",
    "dropdown_mm5g237s",
    "text_mm5gf376",
    "text_mm5gj1xb",
    "link_mm5gn10g"
  ]) { id text value }
`;

function parseEventItem(item) {
  const col  = id => item.column_values?.find(c => c.id === id);
  const text = id => col(id)?.text ?? '';
  const json = id => { try { return JSON.parse(col(id)?.value || 'null'); } catch { return null; } };
  const range  = json('timerange_mm5hahhc');
  const people = json('multiple_person_mm5hnbf2');
  const link   = json('link_mm5gn10g');
  return {
    id:                   item.id,
    name:                 item.name,
    startDate:            range?.from ?? null,
    endDate:              range?.to   ?? null,
    location:             text('text_mm5gwa0a'),
    attendOrHostText:     text('color_mm5g1ye5'),
    eventTypeText:        text('color_mm5hm4ye'),
    bookingStatusText:    text('color_mm5g6xz0'),
    scaleText:            text('color_mm5h7kxk'),
    sector:               text('dropdown_mm5g237s'),
    visitorCost:          text('text_mm5gf376'),
    standCost:            text('text_mm5gj1xb'),
    website:              link?.url ?? text('link_mm5gn10g'),
    attendeeIds:          (people?.personsAndTeams ?? []).map(p => String(p.id)),
    // linked_items is populated by fetchEvents; mutations use optimistic update
    linkedOpportunityIds: (item.linked_items ?? []).map(li => li.id),
  };
}

export async function fetchEvents() {
  const data = await gql(`
    query {
      boards(ids: ["${BOARDS.EVENTS}"]) {
        items_page(limit: 500) {
          items {
            ${EVENT_FIELDS}
            linked_items(
              link_to_item_column_id: "board_relation_mm5hvv3n",
              linked_board_id: ${BOARDS.OPPORTUNITIES}
            ) { id name }
          }
        }
      }
    }
  `);
  return (data.boards[0]?.items_page?.items ?? []).map(parseEventItem);
}

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function sortableMonthLabel(dateStr) {
  if (!dateStr) return null;
  const [y, m] = dateStr.split('-').map(Number);
  if (!y || !m) return null;
  return `${y} ${String(m).padStart(2, '0')} - ${MONTH_NAMES[m - 1]}`;
}

function buildEventColumnValues(form) {
  const cv = {};
  if (form.startDate && form.endDate) {
    cv['timerange_mm5hahhc'] = { from: form.startDate, to: form.endDate };
  } else if (form.startDate) {
    cv['timerange_mm5hahhc'] = { from: form.startDate, to: form.startDate };
  }
  const monthLabel = sortableMonthLabel(form.startDate);
  if (monthLabel) cv['dropdown_mm5h62kd'] = { labels: [monthLabel] };
  if (form.attendeeIds?.length) {
    cv['multiple_person_mm5hnbf2'] = {
      personsAndTeams: form.attendeeIds.map(id => ({ id: parseInt(id, 10), kind: 'person' })),
    };
  } else {
    cv['multiple_person_mm5hnbf2'] = { personsAndTeams: [] };
  }
  if (form.attendOrHost)  cv['color_mm5g1ye5']   = { label: form.attendOrHost };
  if (form.eventType)     cv['color_mm5hm4ye']   = { label: form.eventType };
  if (form.bookingStatus) cv['color_mm5g6xz0']   = { label: form.bookingStatus };
  if (form.scale)         cv['color_mm5h7kxk']   = { label: form.scale };
  cv['text_mm5gwa0a'] = form.location  ?? '';
  cv['text_mm5gf376'] = form.visitorCost ?? '';
  cv['text_mm5gj1xb'] = form.standCost   ?? '';
  if (form.sector)   cv['dropdown_mm5g237s'] = { labels: [form.sector] };
  if (form.website)  cv['link_mm5gn10g']    = { url: form.website, text: form.website };
  // board_relation is intentionally excluded — change_multiple_column_values silently
  // ignores it. Use linkEventOpportunities() separately after the main mutation.
  return cv;
}

// board_relation columns are silently ignored by change_multiple_column_values.
// This dedicated mutation uses change_column_value which does support them.
async function linkEventOpportunities(itemId, opportunityIds) {
  if (!opportunityIds?.length) return;
  const value = JSON.stringify(JSON.stringify({ item_ids: opportunityIds.map(Number) }));
  await gql(`
    mutation {
      change_column_value(
        board_id: ${BOARDS.EVENTS},
        item_id: ${itemId},
        column_id: "board_relation_mm5hvv3n",
        value: ${value}
      ) { id }
    }
  `);
}

export async function createEvent(form) {
  const cvJson = JSON.stringify(JSON.stringify(buildEventColumnValues(form)));
  const data = await gql(`
    mutation {
      create_item(
        board_id: ${BOARDS.EVENTS},
        group_id: "group_mm5ghera",
        item_name: ${JSON.stringify(form.name)},
        column_values: ${cvJson}
      ) { ${EVENT_FIELDS} }
    }
  `);
  const created = parseEventItem(data.create_item);
  if (form.linkedOpportunityIds?.length) {
    await linkEventOpportunities(created.id, form.linkedOpportunityIds);
  }
  return created;
}

export async function updateEvent(itemId, form) {
  // name is included in column_values for updates — Monday API supports "name" as a column key
  const cv = { name: form.name, ...buildEventColumnValues(form) };
  const cvJson = JSON.stringify(JSON.stringify(cv));
  const data = await gql(`
    mutation {
      change_multiple_column_values(
        board_id: ${BOARDS.EVENTS},
        item_id: ${itemId},
        column_values: ${cvJson}
      ) { ${EVENT_FIELDS} }
    }
  `);
  if (form.linkedOpportunityIds !== undefined) {
    await linkEventOpportunities(itemId, form.linkedOpportunityIds);
  }
  return { ...parseEventItem(data.change_multiple_column_values), name: form.name };
}

// ── Mutations ─────────────────────────────────────────────────────
export async function updateItemStatus(boardId, itemId, columnId, statusLabel) {
  const data = await gql(`
    mutation {
      change_simple_column_value(
        board_id: "${boardId}",
        item_id: "${itemId}",
        column_id: "${columnId}",
        value: "${statusLabel}"
      ) { id }
    }
  `);
  return data.change_simple_column_value;
}

// Keep old name for any existing callers
export const fetchProspectsByOwner = fetchProspects;

// ── All leads (for My Work — client-side user filter) ─────────────
// Fetches only the columns needed for display and person-matching so
// we don't pull every column's full JSON blob for 1,000+ lead items.
export async function fetchAllLeads() {
  // lead_owner (Bizdev) and multiple_person_mm2bjm2z (SDR) are the two people
  // columns on this board — both are fetched so "My Work" assignment matching
  // (isAssignedToUser) can check either, not just the SDR column.
  const FIELDS = `
    id name updated_at
    column_values(ids: ["lead_status", "color_mkz4y1yv", "multiple_person_mm2bjm2z", "lead_owner", "lead_company"]) { id text value }
  `;

  const first = await gql(`
    query {
      boards(ids: ["${BOARDS.LEADS}"]) {
        items_page(limit: 200) {
          cursor
          items { ${FIELDS} }
        }
      }
    }
  `);

  let allItems = first.boards[0]?.items_page?.items ?? [];
  let cursor   = first.boards[0]?.items_page?.cursor ?? null;

  let pages = 0;
  while (cursor && pages < 5) {
    const next = await gql(`
      query {
        next_items_page(limit: 200, cursor: "${cursor}") {
          cursor
          items { ${FIELDS} }
        }
      }
    `);
    allItems = [...allItems, ...(next.next_items_page?.items ?? [])];
    cursor   = next.next_items_page?.cursor ?? null;
    pages++;
  }

  return allItems;
}

// Builds the per-column value structure change_multiple_column_values (and, once
// JSON-encoded, change_column_value) expects for a given column type. Blank
// values are mapped to `null` rather than an empty string/object — monday's API
// silently coerces "" to 0 on numbers columns and rejects "" as an invalid date
// structure, so clearing a field has to go through `null` for those two types.
export function buildColumnValue(type, value) {
  const isEmpty = value === undefined || value === null || String(value).trim() === '';
  if (type === 'multiple-person' || type === 'person') {
    return isEmpty ? null : { personsAndTeams: [{ id: parseInt(value, 10), kind: 'person' }] };
  } else if (type === 'color' || type === 'status') {
    return isEmpty ? null : { label: String(value) };
  } else if (type === 'dropdown') {
    return isEmpty ? null : { labels: [String(value)] };
  } else if (type === 'date') {
    return isEmpty ? null : { date: String(value) };
  } else if (type === 'numbers') {
    return isEmpty ? null : String(value);
  }
  return String(value ?? '');
}

// ── Generic column mutation (any board) ──────────────────────────
// Used by the My Work detail panel to save edits across all boards.
export async function updateItemColumnValue(boardId, itemId, columnId, value, columnType) {
  const gqlVal = JSON.stringify(JSON.stringify(buildColumnValue(columnType, value)));

  const data = await gql(`
    mutation {
      change_column_value(
        board_id: ${boardId},
        item_id: ${itemId},
        column_id: "${columnId}",
        value: ${gqlVal}
      ) { id }
    }
  `);
  if (String(boardId) === BOARDS.OPPORTUNITIES) invalidateOpportunityCache();
  return data.change_column_value;
}

// ── Multi-column mutation (any board) ─────────────────────────────
// Saves several columns in one atomic call — if monday rejects any single
// value, NONE of them are applied, so the app's local state and the board
// never end up half-saved the way sequential change_column_value calls could
// leave them. Also returns the item's fresh column_values (with the
// FormulaValue fragment) so callers don't need a separate refetch to pick up
// recalculated formula columns (e.g. Hourly Rate / PS Value (USD)).
export async function updateItemColumns(boardId, itemId, columnValues) {
  const cvJson = JSON.stringify(JSON.stringify(columnValues));
  const data = await gql(`
    mutation {
      change_multiple_column_values(
        board_id: ${boardId},
        item_id: ${itemId},
        column_values: ${cvJson}
      ) {
        id
        name
        column_values {
          id
          text
          value
          ... on FormulaValue { display_value }
        }
      }
    }
  `);
  if (String(boardId) === BOARDS.OPPORTUNITIES) {
    const updated = data.change_multiple_column_values;
    patchCachedOpportunity(String(updated.id), { column_values: updated.column_values, name: updated.name });
  }
  return data.change_multiple_column_values;
}
