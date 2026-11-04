import {
  gql, BOARDS, fetchBoardColumns, paginateQuery, setRelation, uploadFileToColumn, idbGet, idbSet,
} from './monday';
import {
  BOOKING_BOARD_ID, BK, OPP, CONTRACT_COLS, GROUP_BY_ENTITY, buildBookingColumnValues,
  parseNum, AMOUNT_COL_BY_CURRENCY, classifyInvoice, groupInvoicesByProject,
} from '../utils/billing';

// ── Booking board label options ───────────────────────────────────
function labelsOf(column) {
  if (!column?.settings_str) return [];
  try {
    const s = JSON.parse(column.settings_str);
    const dead = new Set((s.deactivated_labels ?? []).map(String));
    const entries = Array.isArray(s.labels)
      ? s.labels.map(l => [String(l.id), l.label])
      : Object.entries(s.labels ?? {}).map(([id, l]) => [id, typeof l === 'string' ? l : l?.label ?? l?.name]);
    return entries.filter(([id, l]) => l && String(l).trim() && !dead.has(id)).map(([, l]) => l);
  } catch { return []; }
}

export async function fetchBookingMeta() {
  const cols = await fetchBoardColumns(BOOKING_BOARD_ID);
  const byId = Object.fromEntries(cols.map(c => [c.id, c]));
  return {
    operationOptions: labelsOf(byId[BK.OPERATION]),
    monthOptions:     labelsOf(byId[BK.MONTH]),
    yearOptions:      labelsOf(byId[BK.YEAR]),
    termsOptions:     labelsOf(byId[BK.TERMS]),
    currencyOptions:  labelsOf(byId[BK.CURRENCY]),
    entityOptions:    labelsOf(byId[BK.ENTITY]),
    clientOptions:    labelsOf(byId[BK.CLIENT]),
    statusOptions:    labelsOf(byId[BK.STATUS]),
  };
}

// ── Opportunity → billing source ─────────────────────────────────
const SOURCE_COLS = [
  OPP.STAGE, OPP.OWNER, OPP.COMPANY, OPP.ACCOUNT, OPP.EMAIL, OPP.REGION, OPP.TYPE_OF_DEAL,
  OPP.ARR_LENGTH, OPP.PRODUCTS, OPP.CURRENCY, OPP.PS_VALUE, OPP.ARR_VALUE, OPP.TERMS,
  OPP.EXPECTED, OPP.CLOSED, ...CONTRACT_COLS.map(c => c.id),
];

function personIds(value) {
  try { return (JSON.parse(value ?? '{}').personsAndTeams ?? []).map(p => String(p.id)); }
  catch { return []; }
}

function fileAssetIds(value) {
  try { return (JSON.parse(value ?? '{}').files ?? []).filter(f => f.assetId).map(f => String(f.assetId)); }
  catch { return []; }
}

// Everything the billing screen needs to know about one opportunity, read fresh from the board
// (the shared Pipeline cache deliberately leaves out the contract and product columns).
export async function fetchOpportunityBillingSource(oppId) {
  const data = await gql(`
    query {
      items(ids: [${oppId}]) {
        id name
        column_values(ids: ${JSON.stringify(SOURCE_COLS)}) {
          id text value
          ... on BoardRelationValue { linked_item_ids }
        }
      }
    }
  `);
  const item = data.items?.[0];
  if (!item) throw new Error('Opportunity not found');
  const col = id => item.column_values.find(c => c.id === id);
  const text = id => col(id)?.text ?? '';

  let contract = { label: '', assets: [] };
  for (const c of CONTRACT_COLS) {
    const ids = fileAssetIds(col(c.id)?.value);
    if (ids.length) {
      const a = await gql(`query { assets(ids: [${ids.join(',')}]) { id name url public_url } }`);
      contract = {
        label: c.label,
        assets: (a.assets ?? []).map(x => ({ id: x.id, name: x.name, url: x.url, publicUrl: x.public_url })),
      };
      break;
    }
  }

  return {
    id: String(item.id),
    name: item.name,
    stage: text(OPP.STAGE),
    ownerIds: personIds(col(OPP.OWNER)?.value),
    company: text(OPP.COMPANY),
    accountIds: (col(OPP.ACCOUNT)?.linked_item_ids ?? []).map(String),
    email: text(OPP.EMAIL),
    region: text(OPP.REGION),
    typeOfDeal: text(OPP.TYPE_OF_DEAL),
    arrLength: text(OPP.ARR_LENGTH),
    products: text(OPP.PRODUCTS).split(',').map(s => s.trim()).filter(Boolean),
    currency: text(OPP.CURRENCY),
    psValue: text(OPP.PS_VALUE),
    arrValue: text(OPP.ARR_VALUE),
    terms: text(OPP.TERMS),
    expectedDate: text(OPP.EXPECTED).slice(0, 10),
    closedDate: text(OPP.CLOSED).slice(0, 10),
    contract,
  };
}

// ── Booking board items ───────────────────────────────────────────
const BOOKING_FIELDS = `
  id name created_at
  group { id title }
  column_values(ids: ${JSON.stringify([
    BK.BD, BK.STATUS, BK.OPERATION, BK.MONTH, BK.YEAR, BK.PROJECT, BK.CURRENCY, BK.ENTITY, BK.DESCRIPTION,
    BK.EMAIL, BK.CLIENT, BK.DUE_DATE, BK.DEFAULT_DATE, BK.AMOUNT_ILS, BK.AMOUNT_USD, BK.AMOUNT_GBP, BK.AMOUNT_EUR, BK.AMOUNT_VAT,
    BK.ACCOUNT_REL,
  ])}) { id text value ... on BoardRelationValue { linked_item_ids } }
`;

function parseBookingItem(item) {
  const text = id => item.column_values.find(c => c.id === id)?.text ?? '';
  const bdValue = item.column_values.find(c => c.id === BK.BD)?.value;
  const currency = text(BK.CURRENCY);
  const own = AMOUNT_COL_BY_CURRENCY[currency];
  const amount = parseNum(own ? text(own) : null)
    ?? parseNum(text(BK.AMOUNT_USD)) ?? parseNum(text(BK.AMOUNT_GBP)) ?? parseNum(text(BK.AMOUNT_EUR));
  const row = {
    id: String(item.id),
    name: item.name,
    createdAt: item.created_at,
    entity: item.group?.title ?? text(BK.ENTITY),
    bd: text(BK.BD),
    bdIds: personIds(bdValue),
    accountIds: (item.column_values.find(c => c.id === BK.ACCOUNT_REL)?.linked_item_ids ?? []).map(String),
    status: text(BK.STATUS),
    operation: text(BK.OPERATION),
    month: text(BK.MONTH),
    year: text(BK.YEAR),
    project: text(BK.PROJECT),
    description: text(BK.DESCRIPTION),
    email: text(BK.EMAIL),
    client: text(BK.CLIENT),
    currency,
    amount,
    amountIls: parseNum(text(BK.AMOUNT_ILS)),
    amountWithVat: parseNum(text(BK.AMOUNT_VAT)),
    dueDate: (text(BK.DUE_DATE) || text(BK.DEFAULT_DATE)).slice(0, 10),
    url: `https://deployboostai.monday.com/boards/${BOOKING_BOARD_ID}/pulses/${item.id}`,
  };
  row.kind = classifyInvoice(row);
  return row;
}

// ── Find a project to add a later invoice to ─────────────────────
// Searches the Booking board itself (every rep), by the Project column and by item name, and
// groups the invoices it finds by project so outstanding ones are visible at a glance.
// Run as two queries because mixing rules with `or` on text columns is unreliable.
export async function searchBookingProjects(term) {
  const t = String(term ?? '').trim();
  if (t.length < 2) return [];
  const q = col => `{ rules: [{ column_id: "${col}", compare_value: [${JSON.stringify(t)}], operator: contains_text }] }`;
  const [byProject, byName] = await Promise.all([
    paginateQuery(BOOKING_BOARD_ID, BOOKING_FIELDS, q(BK.PROJECT), 3),
    paginateQuery(BOOKING_BOARD_ID, BOOKING_FIELDS, q('name'), 3),
  ]);
  const seen = new Map();
  for (const i of [...byProject, ...byName]) seen.set(String(i.id), i);
  const groups = groupInvoicesByProject([...seen.values()].map(parseBookingItem));
  // A hit on one invoice name can miss the project's other invoices, so pull the full set for each project found.
  return groups
    .sort((a, b) => (b.overdue - a.overdue) || (b.outstanding - a.outstanding) || a.name.localeCompare(b.name))
    .slice(0, 25);
}

// Every invoice on one project, so the numbering and outstanding counts are complete.
export async function fetchProjectInvoices(projectName) {
  const items = await paginateQuery(BOOKING_BOARD_ID, BOOKING_FIELDS,
    `{ rules: [{ column_id: "${BK.PROJECT}", compare_value: [${JSON.stringify(projectName)}], operator: contains_text }] }`, 3);
  return items.map(parseBookingItem).filter(i => i.project.trim().toLowerCase() === projectName.trim().toLowerCase());
}

// ── Invoice cache ─────────────────────────────────────────────────
// The Booking board is large and slow to read, so:
//   - memory: reused while younger than INVOICE_TTL_MS; concurrent callers share one request
//   - IndexedDB: the last snapshot survives a reload, so the screen paints it instantly
//     and refreshes in the background (stale-while-revalidate).
const INVOICE_TTL_MS = 2 * 60 * 1000;
const INVOICE_SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const memCache = new Map();   // key -> { items, fetchedAt, stale }
const inFlight = new Map();   // key -> Promise
const cacheKey = userId => `invoices:v2:${userId ?? 'all'}`;

// Whatever is on hand without touching the network (memory, then IndexedDB), or null.
export async function peekBookingInvoices({ userId } = {}) {
  const key = cacheKey(userId);
  if (memCache.has(key)) return memCache.get(key);
  const stored = await idbGet(key);
  if (!stored?.items || Date.now() - stored.fetchedAt > INVOICE_SNAPSHOT_MAX_AGE_MS) return null;
  if (!memCache.has(key)) memCache.set(key, { ...stored, stale: true });
  return memCache.get(key);
}

// Sets the Payment Status of one invoice on the Booking board and patches every cached copy,
// so the tracker updates at once and a reload does not bring the old value back.
export async function setInvoiceStatus(itemId, label) {
  const value = JSON.stringify(JSON.stringify({ label }));
  await gql(`mutation { change_column_value(board_id: ${BOOKING_BOARD_ID}, item_id: ${itemId}, column_id: "${BK.STATUS}", value: ${value}) { id } }`);
  const patch = i => (i.id === String(itemId) ? { ...i, status: label, kind: classifyInvoice({ status: label, dueDate: i.dueDate }) } : i);
  for (const [key, snap] of memCache) {
    const items = snap.items.map(patch);
    memCache.set(key, { ...snap, items });
    idbSet(key, { items, fetchedAt: snap.fetchedAt });
  }
}

export function invalidateBookingInvoices() {
  for (const [k, v] of memCache) memCache.set(k, { ...v, stale: true });
}

// userId null = every rep. The board is filtered server-side on the BD person column.
// maxAgeMs: 0 forces a network read.
export async function fetchBookingInvoices({ userId, maxAgeMs = INVOICE_TTL_MS } = {}) {
  const key = cacheKey(userId);
  const hit = memCache.get(key);
  if (hit && !hit.stale && Date.now() - hit.fetchedAt < maxAgeMs) return hit.items;
  if (inFlight.has(key)) return inFlight.get(key);
  const params = userId
    ? `{ rules: [{ column_id: "${BK.BD}", compare_value: ["person-${userId}"], operator: any_of }] }`
    : `{ rules: [] }`;
  const p = paginateQuery(BOOKING_BOARD_ID, BOOKING_FIELDS, params, 10)
    .then(items => {
      const parsed = items.map(parseBookingItem);
      const snap = { items: parsed, fetchedAt: Date.now(), stale: false };
      memCache.set(key, snap);
      idbSet(key, { items: parsed, fetchedAt: snap.fetchedAt });
      return parsed;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

// ── Create invoices (one deal, all rows in one go) ───────────────
async function attachContract(itemId, assets) {
  const notes = [];
  for (const a of assets) {
    try {
      let uploaded = false;
      try {
        const res = await fetch(a.publicUrl);
        if (res.ok) uploaded = await uploadFileToColumn(itemId, BK.CONTRACT, await res.blob(), a.name || 'contract');
      } catch { /* fall through to a link */ }
      if (!uploaded) {
        const value = JSON.stringify(JSON.stringify({ files: [{ url: a.url, name: a.name || 'Contract', fileType: 'LINK' }] }));
        await gql(`mutation { change_column_value(board_id: ${BOOKING_BOARD_ID}, item_id: ${itemId}, column_id: "${BK.CONTRACT}", value: ${value}) { id } }`);
        notes.push(`${a.name || 'Contract'} attached as a link`);
      }
    } catch (e) {
      notes.push(`Contract not attached (${String(e.message).slice(0, 80)})`);
    }
  }
  return notes;
}

// Creates one Booking item per row, in order. A row that already has `createdId`
// is skipped, so retrying after a partial failure never doubles anything up.
export async function createBookingInvoices({ rows, bdUserIds, project, email, client, accountIds = [], contractAssets = [], onRow }) {
  const results = [];
  for (const row of rows) {
    if (row.createdId) { results.push({ rowId: row.id, ok: true, itemId: row.createdId, skipped: true, notes: [] }); continue; }
    const columnValues = buildBookingColumnValues(row, { bdUserIds, project, email });
    const groupId = GROUP_BY_ENTITY[row.entity];
    let result;
    try {
      const data = await gql(`
        mutation {
          create_item(
            board_id: ${BOOKING_BOARD_ID},
            ${groupId ? `group_id: "${groupId}",` : ''}
            item_name: ${JSON.stringify(row.name.trim())},
            column_values: ${JSON.stringify(JSON.stringify(columnValues))}
          ) { id }
        }
      `);
      const itemId = data.create_item.id;
      const notes = [];
      if (client) {
        // Best effort, like the account link: a locked or restricted Client column must not lose the invoice.
        try {
          const value = JSON.stringify(JSON.stringify({ labels: [client] }));
          await gql(`mutation { change_column_value(board_id: ${BOOKING_BOARD_ID}, item_id: ${itemId}, column_id: "${BK.CLIENT}", value: ${value}, create_labels_if_missing: true) { id } }`);
        } catch (e) { notes.push(`Client not set (${String(e.message).slice(0, 60)})`); }
      }
      if (accountIds.length) {
        try { await setRelation(BOOKING_BOARD_ID, itemId, BK.ACCOUNT_REL, accountIds); }
        catch (e) { notes.push(`Account link failed (${String(e.message).slice(0, 60)})`); }
      }
      if (contractAssets.length) notes.push(...await attachContract(itemId, contractAssets));
      result = { rowId: row.id, ok: true, itemId, notes };
    } catch (e) {
      result = { rowId: row.id, ok: false, error: String(e.message).slice(0, 300), notes: [] };
    }
    results.push(result);
    onRow?.(result);
  }
  return results;
}

