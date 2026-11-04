// Server-side reads from monday. Uses the MONDAY_API_TOKEN secret, so nothing here
// depends on (or exposes) a token in the browser.

const { getSecret } = require('./secrets');
const { CALLS_BOARD, COLS } = require('./config');

const API_VERSION = '2024-01';

async function gql(query, variables = {}) {
  const token = getSecret('MONDAY_API_TOKEN');
  if (!token) throw Object.assign(new Error('The server is missing MONDAY_API_TOKEN.'), { code: 'not_configured' });
  const res = await fetch('https://api.monday.com/v2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: token, 'API-Version': API_VERSION },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`monday API HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors?.length) throw new Error(`monday API: ${JSON.stringify(json.errors).slice(0, 300)}`);
  return json.data;
}

const COLUMN_IDS = Object.values(COLS);
const ITEM_FIELDS = `
  id created_at
  column_values(ids: [${COLUMN_IDS.map((c) => `"${c}"`).join(', ')}]) {
    id text
    ... on PeopleValue { persons_and_teams { id kind } }
  }
`;

function parseCall(item) {
  const col = (id) => item.column_values?.find((c) => c.id === id);
  const text = (id) => col(id)?.text ?? '';
  const person = col(COLS.bizdev)?.persons_and_teams?.find((p) => p.kind === 'person');

  // The board's Duration formula comes back empty through the API, so work it out
  // the same way the formula does: answered to ended (minute resolution).
  const a = Date.parse(`${text(COLS.answeredAt).replace(' ', 'T')}Z`);
  const e = Date.parse(`${text(COLS.endedAt).replace(' ', 'T')}Z`);
  let durationMin = Number.isFinite(a) && Number.isFinite(e) && e >= a ? (e - a) / 60000 : null;
  if (durationMin == null) {
    const f = parseFloat(text(COLS.duration));
    durationMin = Number.isFinite(f) ? f : null;
  }

  const recording = text(COLS.recording).match(/https?:\/\/\S+/)?.[0] ?? null;
  return {
    id: String(item.id),
    callId: text(COLS.callId) || null,
    createdAt: item.created_at,
    startedAt: text(COLS.startedAt) || item.created_at,
    sdrId: person ? String(person.id) : null,
    sdrName: text(COLS.bizdev) || text(COLS.agentName) || 'Unassigned',
    agentName: text(COLS.agentName) || text(COLS.bizdev) || '',
    outcome: text(COLS.outcome),
    direction: text(COLS.direction).toLowerCase(),
    tags: text(COLS.tags).split(',').map((t) => t.trim()).filter(Boolean),
    durationMin,
    recordingUrl: recording,
  };
}

// Newest first, stopping once a page is wholly older than `sinceMs`.
async function fetchCalls(sinceMs, { maxPages = 12 } = {}) {
  const calls = [];
  let cursor = null;
  for (let page = 0; page < maxPages; page++) {
    const data = cursor
      ? await gql(`query($c:String!){ next_items_page(limit: 500, cursor: $c) { cursor items { ${ITEM_FIELDS} } } }`, { c: cursor })
      : await gql(`query { boards(ids: ["${CALLS_BOARD}"]) { items_page(limit: 500, query_params: { order_by: [{ column_id: "__creation_log__", direction: desc }] }) { cursor items { ${ITEM_FIELDS} } } } }`);
    const pageData = cursor ? data.next_items_page : data.boards?.[0]?.items_page;
    const items = pageData?.items ?? [];
    for (const it of items) {
      if (Date.parse(it.created_at) >= sinceMs) calls.push(parseCall(it));
    }
    cursor = pageData?.cursor ?? null;
    const oldest = items.length ? Date.parse(items[items.length - 1].created_at) : 0;
    if (!cursor || oldest < sinceMs) break;
  }
  return calls;
}

// Returns { [itemId]: rawTranscriptText } for items that have a transcript update.
async function fetchTranscripts(itemIds) {
  const out = {};
  for (let i = 0; i < itemIds.length; i += 25) {
    const batch = itemIds.slice(i, i + 25);
    const data = await gql(
      `query($ids:[ID!]){ items(ids: $ids) { id updates(limit: 10) { text_body } } }`,
      { ids: batch },
    );
    for (const it of data.items ?? []) {
      const upd = (it.updates ?? []).find((u) => /Call Transcription:/i.test(u.text_body || ''));
      if (upd) out[String(it.id)] = upd.text_body;
    }
  }
  return out;
}

module.exports = { fetchCalls, fetchTranscripts, parseCall };
