// Server-side monday calls for billing: reading a won deal's contract files and attaching a copy to the
// invoices created on the Booking board. Monday has no "copy file" call, so the file is downloaded here
// (a browser cannot, the file store does not allow it) and uploaded again to each invoice.

const { getSecret } = require('./secrets');

const API_VERSION = '2024-01';
const BOOKING_BOARD = '5090394353';
const BK = { PROJECT: 'text_mkps8996', CONTRACT: 'file_mkps4q4t' };

// The signed agreement first, then the SOW/contract, then a draft as a last resort.
const CONTRACT_COLS = [
  { id: 'file_mm6tn0n1', label: 'Contract Signed' },
  { id: 'file_mm08w93r', label: 'Signed contracts' },
  { id: 'file_mkzc2b6g', label: 'SOW/Contract' },
  { id: 'file_mm6hgp57', label: 'Contract Draft' },
];

function token() {
  const t = getSecret('MONDAY_API_TOKEN');
  if (!t) throw Object.assign(new Error('The server is missing MONDAY_API_TOKEN.'), { code: 'not_configured' });
  return t;
}

async function gql(query) {
  const res = await fetch('https://api.monday.com/v2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: token(), 'API-Version': API_VERSION },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`monday API HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors?.length) throw new Error(`monday API: ${JSON.stringify(json.errors).slice(0, 300)}`);
  return json.data;
}

const assetIds = (value) => {
  try { return (JSON.parse(value ?? '{}').files ?? []).filter((f) => f.assetId).map((f) => String(f.assetId)); }
  catch { return []; }
};

// { name, ownerIds, label, assets: [{ id, name, publicUrl }] } for the first contract column that has files.
async function fetchOpportunity(oppId) {
  const data = await gql(`query { items(ids: [${oppId}]) { id name board { id }
    column_values(ids: ${JSON.stringify(['deal_owner', ...CONTRACT_COLS.map((c) => c.id)])}) { id value } } }`);
  const item = data.items?.[0];
  if (!item) return null;
  const col = (id) => item.column_values.find((c) => c.id === id);
  let ownerIds = [];
  try { ownerIds = (JSON.parse(col('deal_owner')?.value ?? '{}').personsAndTeams ?? []).map((p) => String(p.id)); } catch { /* none */ }
  for (const c of CONTRACT_COLS) {
    const ids = assetIds(col(c.id)?.value);
    if (!ids.length) continue;
    const a = await gql(`query { assets(ids: [${ids.join(',')}]) { id name public_url } }`);
    return { name: item.name, ownerIds, label: c.label, assets: (a.assets ?? []).map((x) => ({ id: String(x.id), name: x.name, publicUrl: x.public_url })) };
  }
  return { name: item.name, ownerIds, label: '', assets: [] };
}

async function fetchBookingItems(ids) {
  const data = await gql(`query { items(ids: [${ids.join(',')}]) { id created_at board { id }
    column_values(ids: ["${BK.PROJECT}"]) { id text } } }`);
  return (data.items ?? []).map((i) => ({
    id: String(i.id),
    boardId: String(i.board?.id ?? ''),
    createdAt: i.created_at,
    project: i.column_values.find((c) => c.id === BK.PROJECT)?.text ?? '',
  }));
}

async function download(publicUrl) {
  const res = await fetch(publicUrl);
  if (!res.ok) throw new Error(`download failed (HTTP ${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

async function upload(itemId, buffer, filename) {
  const form = new FormData();
  form.append('query', `mutation ($file: File!) { add_file_to_column(item_id: ${itemId}, column_id: "${BK.CONTRACT}", file: $file) { id } }`);
  form.append('variables[file]', new Blob([buffer]), filename);
  const res = await fetch('https://api.monday.com/v2/file', {
    method: 'POST',
    headers: { Authorization: token(), 'API-Version': API_VERSION },
    body: form,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.errors?.length) throw new Error(`upload failed: ${JSON.stringify(json.errors ?? res.status).slice(0, 200)}`);
}

module.exports = { BOOKING_BOARD, fetchOpportunity, fetchBookingItems, download, upload };
