import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { fetchOpportunities, peekCachedOpportunities, relIds } from '../api/monday';
import { fetchBookingInvoices, peekBookingInvoices, invalidateBookingInvoices } from '../api/billing';
import { OPP, isPsJob, invoicesCoverOpp, parseNum, BILLING_START } from '../utils/billing';

const DAY = 86400000;
const WON_WINDOW_DAYS = 120; // only recent wins are chased; older ones are history
const STORE_KEY = 'billing:handled-opps';
const FLAG_KEY = 'billing:flagged-opps';

function readSet(key) {
  try { return new Set(JSON.parse(localStorage.getItem(key) || '[]')); } catch { return new Set(); }
}
function writeSet(key, set) {
  try { localStorage.setItem(key, JSON.stringify([...set])); } catch { /* storage blocked: fine */ }
}

const text = (item, id) => item.column_values?.find(c => c.id === id)?.text ?? '';
function ownerIds(item) {
  try { return (JSON.parse(item.column_values?.find(c => c.id === OPP.OWNER)?.value ?? '{}').personsAndTeams ?? []).map(p => String(p.id)); }
  catch { return []; }
}

const noop = () => {};
const BillingContext = createContext({
  pending: [], pendingCount: 0, invoices: [], loading: false, error: null,
  target: null, wonPrompt: null, showWonPrompt: noop, dismissWonPrompt: noop, reload: noop, openBilling: noop, openProject: noop, patchInvoice: noop, clearTarget: noop, markHandled: noop, billedCountFor: () => 0,
});

export const useBilling = () => useContext(BillingContext);

// Owns the data the nav badge, the Won prompt and the Billing tab all share:
// my Won deals that still need invoices, and my invoices on the Booking board.
export function BillingProvider({ user, onNavigate, children }) {
  const [opps, setOpps] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [handled, setHandled] = useState(() => readSet(STORE_KEY));
  const [flagged, setFlagged] = useState(() => readSet(FLAG_KEY)); // prompted at the moment of winning
  const [target, setTarget] = useState(null); // { oppId, mode: 'new' } or { project, mode: 'extra' }
  const [wonPrompt, setWonPrompt] = useState(null); // { id, name } just marked Won
  const inFlight = useRef(null);

  // Paint whatever is cached straight away, then refresh in the background.
  useEffect(() => {
    if (!user?.id) return;
    let live = true;
    Promise.all([peekCachedOpportunities({ region: 'All' }), peekBookingInvoices({ userId: user.id })])
      .then(([o, inv]) => { if (!live) return; if (o?.items) setOpps(o.items); if (inv?.items) setInvoices(inv.items); });
    return () => { live = false; };
  }, [user?.id]);

  const reload = useCallback(({ force = false } = {}) => {
    if (!user?.id) return Promise.resolve();
    if (force) invalidateBookingInvoices();
    if (inFlight.current && !force) return inFlight.current;
    setLoading(true);
    setError(null);
    inFlight.current = Promise.all([
      fetchOpportunities({ region: 'All', maxAgeMs: force ? 0 : undefined }),
      fetchBookingInvoices({ userId: user.id, maxAgeMs: force ? 0 : undefined }),
    ])
      .then(([o, inv]) => { setOpps(o); setInvoices(inv); })
      .catch(e => setError(e.message))
      .finally(() => { setLoading(false); inFlight.current = null; });
    return inFlight.current;
  }, [user?.id]);

  useEffect(() => { reload(); }, [reload]);

  const billedProjects = useMemo(() => {
    const m = new Map();
    for (const i of invoices) {
      const k = i.project.trim().toLowerCase();
      if (k) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [invoices]);

  const billedCountFor = useCallback(name => billedProjects.get(String(name ?? '').trim().toLowerCase()) ?? 0, [billedProjects]);

  const pending = useMemo(() => {
    if (!user?.id) return [];
    const cutoff = Date.now() - WON_WINDOW_DAYS * DAY;
    return opps
      .filter(o => text(o, OPP.STAGE) === 'Won')
      .filter(o => ownerIds(o).includes(String(user.id)))
      // Billing is only set up for PS jobs.
      .filter(o => isPsJob({ typeOfDeal: text(o, OPP.TYPE_OF_DEAL), arrSourceType: text(o, 'color_mkz2wqw4') }))
      .filter(o => {
        const closed = text(o, OPP.CLOSED).slice(0, 10);
        // Existing jobs count as already invoiced; only deals won from BILLING_START (or ones we prompted for) are chased.
        if (!flagged.has(String(o.id)) && !(closed && closed >= BILLING_START)) return false;
        const when = closed ? new Date(`${closed}T00:00:00`).getTime() : new Date(o.updated_at).getTime();
        return when >= cutoff || flagged.has(String(o.id));
      })
      .filter(o => !handled.has(String(o.id)))
      // Skip deals whose invoices are already on the board (same project, or amounts that add up to the deal value).
      .filter(o => !invoicesCoverOpp({
        name: o.name,
        accountIds: relIds(o, OPP.ACCOUNT),
        currency: text(o, OPP.CURRENCY),
        value: parseNum(text(o, 'numeric_mkz3h4rp')) ?? undefined,
      }, invoices))
      .map(o => ({
        id: String(o.id),
        name: o.name,
        company: text(o, OPP.COMPANY),
        closedDate: text(o, OPP.CLOSED).slice(0, 10),
        region: text(o, OPP.REGION),
      }))
      .sort((a, b) => (b.closedDate || '').localeCompare(a.closedDate || ''));
  }, [opps, user?.id, handled, flagged, invoices]);

  const markHandled = useCallback(oppId => {
    setHandled(prev => { const n = new Set(prev); n.add(String(oppId)); writeSet(STORE_KEY, n); return n; });
  }, []);

  const openBilling = useCallback((oppId, mode = 'new') => {
    setTarget({ oppId: String(oppId), mode });
    onNavigate?.('billing');
  }, [onNavigate]);

  const showWonPrompt = useCallback(opp => {
    setWonPrompt({ id: String(opp.id), name: opp.name });
    setFlagged(prev => { const n = new Set(prev); n.add(String(opp.id)); writeSet(FLAG_KEY, n); return n; });
    reload();
  }, [reload]);

  const openProject = useCallback(project => {
    setTarget({ project, mode: 'extra' });
    onNavigate?.('billing');
  }, [onNavigate]);

  const patchInvoice = useCallback((id, patch) => {
    setInvoices(prev => prev.map(i => (i.id === String(id) ? { ...i, ...patch } : i)));
  }, []);

  const value = useMemo(() => ({
    pending, pendingCount: pending.length, invoices, loading, error, target, wonPrompt,
    showWonPrompt, dismissWonPrompt: () => setWonPrompt(null),
    reload, openBilling, openProject, patchInvoice, clearTarget: () => setTarget(null), markHandled, billedCountFor,
  }), [pending, invoices, loading, error, target, wonPrompt, showWonPrompt, reload, openBilling, openProject, patchInvoice, markHandled, billedCountFor]);

  return <BillingContext.Provider value={value}>{children}</BillingContext.Provider>;
}
