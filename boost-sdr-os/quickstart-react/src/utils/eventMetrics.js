import { REL, LEAD_COLS, relIds } from '../api/monday';
import { parseOpportunity } from './opportunityMetrics';

// ── Event attribution rules ───────────────────────────────────────
// Lead → event: the lead's own event link (one event per lead), plus the
//   event's Leads column as a fallback (the pair is two-way, so these agree).
// Opportunity → event, either:
//   - direct: the opp's own event link or the event's Opportunities column, or
//   - via lead: the opp is linked to a lead that is linked to the event.
//   Direct wins when both apply, so each opp is labelled once per event.
// Totals are always de-duplicated by id, so an opp reachable from two events
// counts once in the headline numbers.

// Spelled "Qualifed" on the board itself.
export const QUALIFIED_LEAD_STATUSES = new Set(['Qualified Opportunity', 'Qualifed Lead No Opp', 'Qualified']);

// Source / Conversion Activity pre-fill, keyed by how the lead was met.
export const EVENT_SOURCE = 'Events/Conferences';
export const HOW_MET_OPTIONS = [
  { value: 'Boost Booth',    label: 'At our stand' },
  { value: 'F2F Event',      label: 'At the event' },
  { value: 'Event Outreach', label: 'Post-event outreach' },
];
const IN_PERSON = new Set(['Boost Booth', 'F2F Event']);

// "Hosting" means we had a stand at someone else's event.
export function isStandEvent(event) {
  return (event?.attendOrHostText ?? '').includes('Host');
}

export function defaultHowMet(event) {
  return isStandEvent(event) ? 'Boost Booth' : 'F2F Event';
}

// An event counts as having happened if it's marked Attended, or we decided to
// go and its last day is in the past (Booking Status often isn't updated).
export function eventHappened(event, today = new Date().toISOString().slice(0, 10)) {
  if (event.bookingStatusText === 'Attended') return true;
  if (event.bookingStatusText === 'Skipping' || event.attendOrHostText === 'Not Going') return false;
  const last = event.endDate || event.startDate;
  return Boolean(event.attendOrHostText?.startsWith('Decided') && last && last < today);
}

function colText(item, id) {
  const cv = item.column_values?.find(c => c.id === id);
  return cv?.text || cv?.display_value || '';
}

export function parseEventLead(item) {
  const status = colText(item, LEAD_COLS.STATUS);
  return {
    id:          item.id,
    name:        item.name,
    createdAt:   item.created_at,
    company:     colText(item, LEAD_COLS.COMPANY),
    status,
    isQualified: QUALIFIED_LEAD_STATUSES.has(status),
    source:      colText(item, LEAD_COLS.SOURCE),
    conversion:  colText(item, LEAD_COLS.CONVERSION),
    region:      colText(item, LEAD_COLS.REGION),
    sdr:         colText(item, LEAD_COLS.SDR),
    eventIds:    relIds(item, REL.LEAD_EVENT),
    oppIds:      relIds(item, REL.LEAD_OPPS),
  };
}

function parseEventOpp(item) {
  const o = parseOpportunity(item);
  return {
    ...o,
    createdAt: item.created_at,
    // ARR and PS are reported separately, both in USD, straight from their own
    // columns — Type of Deal is often blank on new deals, which would otherwise
    // hide PS value behind the isPS switch in parseOpportunity.
    arrUSD:    o.netAddedARR,
    psUSD:     o.psValueUSD,
    fxHelper:  parseFloat(colText(item, 'numeric_mm5qaeda')) || 0,
    eventIds:  relIds(item, REL.OPP_EVENT),
    leadIds:   relIds(item, REL.OPP_LEADS),
  };
}

// GBP → USD from the Opportunities board's own FX Helper on GBP deals, so £
// spend and USD pipeline are compared at the same rate the board uses.
const FALLBACK_GBP_USD = 1.34;
function gbpToUsd(opps) {
  const rates = opps
    .filter(o => o.currency === 'GBP' && o.fxHelper > 1)
    .map(o => o.fxHelper)
    .sort((a, b) => a - b);
  if (!rates.length) return { rate: FALLBACK_GBP_USD, estimated: true };
  return { rate: rates[Math.floor(rates.length / 2)], estimated: false };
}

export function parseSpend(text) {
  const n = parseFloat(String(text ?? '').replace(/[£,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function emptyTotals() {
  return {
    leads: 0, qualified: 0, inPerson: 0, outreach: 0,
    opps: 0, openOpps: 0, wonOpps: 0, lostOpps: 0,
    wonARR: 0, wonPS: 0, openARR: 0, openPS: 0,
  };
}

function addOpp(t, o) {
  t.opps++;
  if (o.isWon)       { t.wonOpps++; t.wonARR += o.arrUSD; t.wonPS += o.psUSD; }
  else if (o.isLost) { t.lostOpps++; }
  else               { t.openOpps++; t.openARR += o.arrUSD; t.openPS += o.psUSD; }
}

function addLead(t, l) {
  t.leads++;
  if (l.isQualified) t.qualified++;
  if (IN_PERSON.has(l.conversion)) t.inPerson++;
  else if (l.conversion === 'Event Outreach') t.outreach++;
}

export function wonValue(t)  { return t.wonARR + t.wonPS; }
export function openValue(t) { return t.openARR + t.openPS; }

// Builds everything the Events page renders from fetchEventReport()'s output.
export function buildEventReport(raw, year) {
  const leads = raw.leads.map(parseEventLead);
  const opps  = raw.opportunities.map(parseEventOpp);
  const leadById = new Map(leads.map(l => [l.id, l]));
  const oppById  = new Map(opps.map(o => [o.id, o]));
  const fx = gbpToUsd(opps);

  const rows = raw.events.map(event => {
    // Leads
    const leadIds = new Set(event.linkedLeadIds);
    leads.forEach(l => { if (l.eventIds.includes(event.id)) leadIds.add(l.id); });
    const eventLeads = [...leadIds].map(id => leadById.get(id)).filter(Boolean);

    // Opportunities: direct first, then via lead
    const attributed = new Map();
    const direct = new Set(event.linkedOpportunityIds);
    opps.forEach(o => { if (o.eventIds.includes(event.id)) direct.add(o.id); });
    direct.forEach(id => {
      const o = oppById.get(id);
      if (o) attributed.set(id, { opp: o, via: 'direct', lead: null });
    });
    eventLeads.forEach(l => l.oppIds.forEach(id => {
      const o = oppById.get(id);
      if (o && !attributed.has(id)) attributed.set(id, { opp: o, via: 'lead', lead: l });
    }));
    const eventOpps = [...attributed.values()];

    const totals = emptyTotals();
    eventLeads.forEach(l => addLead(totals, l));
    eventOpps.forEach(({ opp }) => addOpp(totals, opp));

    const spend = parseSpend(event.actualSpend);
    const spendUSD = spend !== null ? spend * fx.rate : null;
    return {
      event,
      happened: eventHappened(event),
      isStand: isStandEvent(event),
      leads: eventLeads,
      opps: eventOpps,
      totals,
      spend,
      costPerLead: spend && totals.leads ? spend / totals.leads : null,
      costPerOpp:  spend && totals.opps  ? spend / totals.opps  : null,
      // Won value (USD) per $1 spent — null until spend is entered
      roi: spendUSD ? wonValue(totals) / spendUSD : null,
    };
  });

  const yearRows = rows.filter(r => r.event.startDate?.startsWith(String(year)));

  // Headline totals, de-duplicated across events
  const totals = emptyTotals();
  const seenLeads = new Set();
  const seenOpps  = new Set();
  let spend = 0;
  let spendEvents = 0;
  yearRows.forEach(r => {
    r.leads.forEach(l => { if (!seenLeads.has(l.id)) { seenLeads.add(l.id); addLead(totals, l); } });
    r.opps.forEach(({ opp }) => { if (!seenOpps.has(opp.id)) { seenOpps.add(opp.id); addOpp(totals, opp); } });
    if (r.spend !== null) { spend += r.spend; spendEvents++; }
  });
  const happenedCount = yearRows.filter(r => r.happened).length;

  // Breakdowns — each group keeps every metric so the UI can toggle between them
  const group = keyFn => {
    const out = {};
    yearRows.filter(r => r.happened || r.totals.leads || r.totals.opps).forEach(r => {
      const key = keyFn(r);
      if (!key) return;
      out[key] ??= { events: 0, ...emptyTotals() };
      const g = out[key];
      g.events++;
      Object.keys(r.totals).forEach(k => { g[k] += r.totals[k]; });
    });
    return Object.entries(out);
  };

  // Attendee credit: everyone at an event shares that event's results
  const byPerson = {};
  yearRows.forEach(r => r.event.attendeeIds.forEach(id => {
    byPerson[id] ??= { events: 0, ...emptyTotals() };
    const p = byPerson[id];
    p.events++;
    Object.keys(r.totals).forEach(k => { p[k] += r.totals[k]; });
  }));

  // Opportunities that reach an event only through their lead — the Sync
  // action writes the direct link so monday's own views agree with the report.
  const toSync = [];
  rows.forEach(r => r.opps.forEach(({ opp, via, lead }) => {
    if (via === 'lead') toSync.push({ oppId: opp.id, oppName: opp.name, eventId: r.event.id, eventName: r.event.name, leadName: lead.name });
  }));

  // Opps already credited through their lead aren't "unlinked" — they're in toSync
  const attributedOppIds = new Set(rows.flatMap(r => r.opps.map(({ opp }) => opp.id)));
  const inYear = d => d?.startsWith(String(year));
  const dataQuality = {
    happenedNoLeads: yearRows.filter(r => r.happened && r.totals.leads === 0),
    missingSpend:    yearRows.filter(r => r.happened && r.spend === null),
    unlinkedLeads:   raw.unlinkedLeads.map(parseEventLead).filter(l => l.region === 'UK' && inYear(l.createdAt)),
    unlinkedOpps:    raw.unlinkedOpps.map(parseEventOpp)
      .filter(o => o.region === 'UK' && inYear(o.createdAt) && !attributedOppIds.has(o.id)),
    toSync,
  };

  return {
    rows,
    yearRows,
    totals,
    spend,
    spendEvents,
    happenedCount,
    fx,
    byType:   group(r => r.event.eventTypeText),
    byScale:  group(r => r.event.scaleText),
    byFormat: group(r => (r.isStand ? 'Stand' : 'Attended')),
    bySector: group(r => r.event.sector),
    byPerson: Object.entries(byPerson),
    dataQuality,
  };
}
