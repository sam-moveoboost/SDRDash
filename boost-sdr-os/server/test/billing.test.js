const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const { createBillingRouter } = require('../src/routes/billing');

const BOOKING = '5090394353';
const fresh = new Date().toISOString();
const old = new Date(Date.now() - 3 * 3600000).toISOString();

function fakeApi(over = {}) {
  const uploads = [];
  const api = {
    BOOKING_BOARD: BOOKING,
    uploads,
    fetchOpportunity: async () => ({ name: 'Acme - PS', ownerIds: ['111'], label: 'Contract Signed', assets: [{ id: '1', name: 'signed.pdf', publicUrl: 'https://x/y' }] }),
    fetchBookingItems: async (ids) => ids.map((id) => ({ id, boardId: BOOKING, createdAt: fresh, project: 'Acme - PS' })),
    download: async () => Buffer.from('pdf'),
    upload: async (id, buf, name) => { uploads.push([id, name]); },
    ...over,
  };
  return api;
}

async function post(api, viewer, body) {
  const app = express();
  app.use('/billing', createBillingRouter({ api }, { auth: (req, _res, next) => { req.viewer = viewer; next(); } }));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/billing/attach-contract`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: res.status, json: await res.json() };
  } finally { server.close(); }
}

const OWNER = { userId: '111', isAdmin: false };

test('attaches the contract to every new invoice for the deal', async () => {
  const api = fakeApi();
  const { status, json } = await post(api, OWNER, { oppId: '9', itemIds: ['5', '6'] });
  assert.equal(status, 200);
  assert.equal(json.attached, 2);
  assert.deepEqual(api.uploads, [['5', 'signed.pdf'], ['6', 'signed.pdf']]);
});

test('refuses someone who is not the deal owner', async () => {
  const api = fakeApi();
  const { status } = await post(api, { userId: '222', isAdmin: false }, { oppId: '9', itemIds: ['5'] });
  assert.equal(status, 403);
  assert.equal(api.uploads.length, 0);
});

test('an admin may attach for any deal', async () => {
  const api = fakeApi();
  const { status } = await post(api, { userId: '222', isAdmin: true }, { oppId: '9', itemIds: ['5'] });
  assert.equal(status, 200);
  assert.equal(api.uploads.length, 1);
});

test('skips invoices that are old, on another board or another project', async () => {
  const api = fakeApi({
    fetchBookingItems: async () => [
      { id: '5', boardId: BOOKING, createdAt: old, project: 'Acme - PS' },
      { id: '6', boardId: '999', createdAt: fresh, project: 'Acme - PS' },
      { id: '7', boardId: BOOKING, createdAt: fresh, project: 'Other' },
      { id: '8', boardId: BOOKING, createdAt: fresh, project: 'acme - ps' },
    ],
  });
  const { json } = await post(api, OWNER, { oppId: '9', itemIds: ['5', '6', '7', '8'] });
  assert.equal(json.attached, 1);
  assert.deepEqual(api.uploads, [['8', 'signed.pdf']]);
  assert.equal(json.results.filter((r) => !r.ok).length, 3);
});

test('reports a deal with no contract and rejects bad input', async () => {
  const none = fakeApi({ fetchOpportunity: async () => ({ name: 'Acme - PS', ownerIds: ['111'], label: '', assets: [] }) });
  assert.equal((await post(none, OWNER, { oppId: '9', itemIds: ['5'] })).json.reason, 'no_contract');
  assert.equal((await post(fakeApi(), OWNER, { oppId: 'x', itemIds: ['5'] })).status, 400);
  assert.equal((await post(fakeApi(), OWNER, { oppId: '9', itemIds: [] })).status, 400);
});

test('a failed upload is reported per invoice, not thrown', async () => {
  const api = fakeApi({ upload: async (id) => { if (id === '6') throw new Error('upload failed: nope'); } });
  const { json } = await post(api, OWNER, { oppId: '9', itemIds: ['5', '6'] });
  assert.equal(json.attached, 1);
  assert.equal(json.results.find((r) => r.itemId === '6').ok, false);
});
