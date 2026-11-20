// Billing endpoints. Attaches the won deal's signed agreement to the invoices the dashboard has just
// created on the Booking board. The server works out which file to copy itself; the browser only says
// which deal and which invoices.

const express = require('express');
const { requireViewer } = require('../lib/auth');
const defaults = { api: require('../lib/billingApi') };

const FRESH_MS = 60 * 60 * 1000; // only invoices created in the last hour can be attached to
const MAX_ITEMS = 12;
const ID = /^\d{1,20}$/;

function createBillingRouter(deps = {}, { auth = requireViewer, now = () => Date.now() } = {}) {
  const { api } = { ...defaults, ...deps };
  const router = express.Router();
  router.use(auth);

  router.post('/attach-contract', express.json(), async (req, res) => {
    const { oppId, itemIds } = req.body ?? {};
    if (!ID.test(String(oppId ?? '')) || !Array.isArray(itemIds) || !itemIds.length || itemIds.length > MAX_ITEMS
      || !itemIds.every((i) => ID.test(String(i)))) {
      return res.status(400).json({ error: 'bad_request', message: 'Send a deal id and up to 12 invoice ids.' });
    }
    try {
      const opp = await api.fetchOpportunity(String(oppId));
      if (!opp) return res.status(404).json({ error: 'not_found', message: 'That opportunity was not found.' });
      // Only the deal's own BD (or an admin) can have its contract copied out.
      if (!req.viewer.isAdmin && !opp.ownerIds.includes(req.viewer.userId)) {
        return res.status(403).json({ error: 'forbidden', message: 'Only the deal owner can attach its contract.' });
      }
      if (!opp.assets.length) return res.json({ ok: true, attached: 0, reason: 'no_contract', results: [] });

      const items = await api.fetchBookingItems(itemIds.map(String));
      const eligible = [];
      const results = [];
      for (const id of itemIds.map(String)) {
        const item = items.find((i) => i.id === id);
        if (!item || item.boardId !== api.BOOKING_BOARD) results.push({ itemId: id, ok: false, error: 'not a Booking board invoice' });
        else if (now() - Date.parse(item.createdAt) > FRESH_MS) results.push({ itemId: id, ok: false, error: 'invoice is not new' });
        else if (item.project.trim().toLowerCase() !== opp.name.trim().toLowerCase()) results.push({ itemId: id, ok: false, error: 'invoice is for a different project' });
        else eligible.push(item);
      }

      // Download each file once, then upload it to every invoice.
      for (const asset of opp.assets) {
        let buffer;
        try { buffer = await api.download(asset.publicUrl); }
        catch (e) { for (const item of eligible) results.push({ itemId: item.id, ok: false, file: asset.name, error: e.message }); continue; }
        for (const item of eligible) {
          try { await api.upload(item.id, buffer, asset.name || 'contract'); results.push({ itemId: item.id, ok: true, file: asset.name }); }
          catch (e) { results.push({ itemId: item.id, ok: false, file: asset.name, error: e.message }); }
        }
      }
      return res.json({ ok: true, attached: results.filter((r) => r.ok).length, from: opp.label, results });
    } catch (err) {
      console.error('[billing/attach-contract]', err?.message);
      return res.status(502).json({ error: 'failed', message: String(err?.message ?? 'Could not attach the contract.').slice(0, 200) });
    }
  });

  return router;
}

module.exports = { createBillingRouter };
