import mondaySdk from 'monday-sdk-js';

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

export function gql(query) {
  // Direct fetch (HTTP) → fire immediately, no queue needed.
  if (DIRECT_TOKEN) return mondayFetch(query);

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
};

// Fetch first page only — pagination added once basic queries confirmed working
async function paginateBoard(boardId, fields) {
  console.log(`[monday] querying board ${boardId}...`);
  const first = await gql(`
    query {
      boards(ids: ["${boardId}"]) {
        items_page(limit: 100) {
          items { ${fields} }
        }
      }
    }
  `);
  const items = first.boards[0]?.items_page?.items ?? [];
  console.log(`[monday] board ${boardId} returned ${items.length} items`);
  return items;
}

// Helper: get a column value's text by ID
function colText(item, id) {
  return item.column_values?.find(c => c.id === id)?.text ?? '';
}

// ── Current user ──────────────────────────────────────────────────
export async function fetchCurrentUser() {
  const data = await gql(`query { me { id name email photo_thumb account { slug } } }`);
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
// month: "YYYY-MM" — server-side filter on Qualified Date (date_mm4wkg8g)
// SDR attribution uses multiple_person_mm2bjm2z, NOT lead_owner (which is the BDM)
export async function fetchQualifiedMeetings({ region, month }) {
  const startDate = `${month}-01`;
  const [y, m] = month.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const endDate = `${month}-${String(lastDay).padStart(2, '0')}`;

  const rules = [
    `{ column_id: "date_mm4wkg8g", compare_value: ["${startDate}"], operator: greater_than_or_equals }`,
    `{ column_id: "date_mm4wkg8g", compare_value: ["${endDate}"],   operator: lower_than_or_equal }`,
  ];

  const LEAD_FIELDS = `
    id name updated_at
    column_values(ids: ["lead_status", "multiple_person_mm2bjm2z", "date_mm4wkg8g", "color_mkz4y1yv"]) {
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

  return allItems.filter(item => {
    const status = colText(item, 'lead_status');
    if (status !== 'Qualified/SQL' && status !== 'Qualified') return false;
    if (region && region !== 'All') {
      if (colText(item, 'color_mkz4y1yv') !== region) return false;
    }
    return true;
  });
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
export async function fetchOpportunities({ region }) {
  const items = await paginateBoard(BOARDS.OPPORTUNITIES, `
    id
    name
    created_at
    updated_at
    column_values {
      id
      text
      value
    }
  `);

  return items.filter(item => {
    if (!region || region === 'All') return true;
    return colText(item, 'color_mkxerb02') === region;
  });
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
export async function fetchWorkspaceUsers() {
  const data = await gql(`query { users(kind: non_guests) { id name email photo_thumb } }`);
  return data.users ?? [];
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

  const personRule = userId
    ? `rules: [{ column_id: "person", compare_value: ["${userId}"], operator: any_of }]`
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

// ── Board column schema ───────────────────────────────────────────
// settings_str included so status columns can render their label options as a dropdown
export async function fetchBoardColumns(boardId) {
  const data = await gql(`
    query {
      boards(ids: ["${boardId}"]) {
        columns { id title type settings_str }
      }
    }
  `);
  return data.boards[0]?.columns ?? [];
}

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
    // Numbers, text: plain string value
    innerJson = String(value);
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
  return data.change_column_value;
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
  const FIELDS = `
    id name updated_at
    column_values(ids: ["lead_status", "color_mkz4y1yv", "multiple_person_mm2bjm2z"]) { id text value }
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

// ── Generic column mutation (any board) ──────────────────────────
// Used by the My Work detail panel to save edits across all boards.
export async function updateItemColumnValue(boardId, itemId, columnId, value, columnType) {
  let innerJson;
  if (columnType === 'multiple-person' || columnType === 'person') {
    innerJson = JSON.stringify({ personsAndTeams: [{ id: parseInt(value, 10), kind: 'person' }] });
  } else if (columnType === 'color' || columnType === 'status') {
    innerJson = JSON.stringify({ label: String(value) });
  } else if (columnType === 'date') {
    innerJson = JSON.stringify({ date: String(value) });
  } else {
    innerJson = String(value);
  }

  const gqlVal = JSON.stringify(innerJson);

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
  return data.change_column_value;
}
