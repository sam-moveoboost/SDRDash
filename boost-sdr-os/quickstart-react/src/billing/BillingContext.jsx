import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { fetchOpportunities } from '../api/monday';
import { fetchBookingInvoices } from '../api/billing';
import { OPP } from '../utils/billing';

const DAY = 86400000;
const WON_WINDOW_DAYS = 120; // only recent wins are chased; older ones are history
const STORE_KEY = 'billing:handled-opps';

function readHandled() {
  try { return new Set(JSON.parse(localStorage.getItem(STORE_KEY) || '[]')); } catch { return new Set(); }
}
function writeHandled(set) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify([...set])); } catch { /* storage blocked: fine */ }
}

const text = (item, id) => item.column_values?.find(c => c.id === id)?.text ?? '';
function ownerIds(item) {
  try { return (JSON.parse(item.column_values?.find(c => c.id === OPP.OWNER)?.value ?? '{}').personsAndTeams ?? []).map(p => String(p.id)); }
  catch { return []; }
}

const noop = () => {};
const BillingContext = createContext({
  pending: [], pendingCount: 0, invoices: [], loading: false, error: null,
  target: null, wonPrompt: null, showWonPrompt: noop, dismissWonPrompt: noop, reload: noop, openBilling: noop, clearTarget: noop, markHandled: noop, billedCountFor: () => 0, oppIdByName: () => null,
});

export const useBilling = () => useContext(BillingContext);

// Owns the data the nav badge, the Won prompt and the Billing tab all share:
// my Won deals that still need invoices, and my invoices on the Booking board.
export function BillingProvider({ user, onNavigate, children }) {
  const [opps, setOpps] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [handled, setHandled] = useState(readHandled);
  const [target, setTarget] = useState(null); // { oppId, mode: 'new' | 'extra' }
  const [wonPrompt, setWonPrompt] = useState(null); // { id, name } just marked Won
  const inFlight = useRef(null);

  const reload = useCallback(({ force = false } = {}) => {
    if (!user?.id) return Promise.resolve();
    if (inFlight.current) return inFlight.current;
    setLoading(true);
    setError(null);
    inFlight.current = Promise.all([
      fetchOpportunities({ region: 'All', maxAgeMs: force ? 0 : undefined }),
      fetchBookingInvoices({ userId: user.id }),
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

  const oppIdByName = useCallback(name => {
    const k = String(name ?? '').trim().toLowerCase();
    return opps.find(o => o.name.trim().toLowerCase() === k)?.id ?? null;
  }, [opps]);

  const pending = useMemo(() => {
    if (!user?.id) return [];
    const cutoff = Date.now() - WON_WINDOW_DAYS * DAY;
    return opps
      .filter(o => text(o, OPP.STAGE) === 'Won')
      .filter(o => ownerIds(o).includes(String(user.id)))
      .filter(o => {
        const closed = text(o, OPP.CLOSED).slice(0, 10);
        const when = closed ? new Date(`${closed}T00:00:00`).getTime() : new Date(o.updated_at).getTime();
        return when >= cutoff;
      })
      .filter(o => !handled.has(String(o.id)) && billedCountFor(o.name) === 0)
      .map(o => ({
        id: String(o.id),
        name: o.name,
        company: text(o, OPP.COMPANY),
        closedDate: text(o, OPP.CLOSED).slice(0, 10),
        region: text(o, OPP.REGION),
      }))
      .sort((a, b) => (b.closedDate || '').localeCompare(a.closedDate || ''));
  }, [opps, user?.id, handled, billedCountFor]);

  const markHandled = useCallback(oppId => {
    setHandled(prev => { const n = new Set(prev); n.add(String(oppId)); writeHandled(n); return n; });
  }, []);

  const openBilling = useCallback((oppId, mode = 'new') => {
    setTarget({ oppId: String(oppId), mode });
    onNavigate?.('billing');
  }, [onNavigate]);

  const showWonPrompt = useCallback(opp => { setWonPrompt({ id: String(opp.id), name: opp.name }); reload(); }, [reload]);

  const value = useMemo(() => ({
    pending, pendingCount: pending.length, invoices, loading, error, target, wonPrompt,
    showWonPrompt, dismissWonPrompt: () => setWonPrompt(null),
    reload, openBilling, clearTarget: () => setTarget(null), markHandled, billedCountFor, oppIdByName,
  }), [pending, invoices, loading, error, target, wonPrompt, showWonPrompt, reload, openBilling, markHandled, billedCountFor, oppIdByName]);

  return <BillingContext.Provider value={value}>{children}</BillingContext.Provider>;
}
