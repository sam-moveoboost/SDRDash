// ── Missing-data rules ────────────────────────────────────────────
// The single definition of "what must be filled in", used by the My Missing
// Data tab. The Friday reminder prompt mirrors these rules, so change both
// together. Scope is UK only.
//
// Prospects: UK prospects someone is working (Status not "New Prospect" or
//   "Not Relevant" — untouched imports would drown everything else).
//   Owner = SDR.
// Leads: UK leads that are still being worked, plus qualified leads created in
//   the last 90 days (their Company / Source feed Scoreboard credit).
//   Owner = SDR, or the Bizdev when no SDR is set.
// Opportunities: every open UK deal (Stage not Won/Lost). Owner = Bizdev.
// Deliberately not checked (agreed as nice-to-have or automated): Industry,
// Job Title, Unqualified reason, Qualified Date, Reason for lost, Actual Close
// Date, SDR on leads or opportunities.

import { LEAD_COLS } from '../api/monday';

export const MISSING_BOARDS = { PROSPECT: 'prospect', LEAD: 'lead', OPP: 'opportunity' };

const PROSPECT_UNWORKED_STATUSES = new Set(['New Prospect', 'Not Relevant', '']);

const LEAD_CLOSED_STATUSES = new Set(['Duplicate', 'Lead Unqualified', 'Not Interested']);
const LEAD_QUALIFIED_STATUSES = new Set(['Qualified Opportunity', 'Qualifed Lead No Opp', 'Qualified']);
const QUALIFIED_LOOKBACK_DAYS = 90;

// Field editors: type drives both the input and how the value is saved.
const F = {
  // Prospects
  prospectCompany: { id: 'text_mkw7ezh6',     label: 'Company',             type: 'text' },
  prospectEmail:   { id: 'email_mm14rb30',    label: 'Email (or a phone number)', type: 'email' },
  // Leads
  leadCompany:    { id: LEAD_COLS.COMPANY,    label: 'Company Name',        type: 'text' },
  leadEmail:      { id: LEAD_COLS.EMAIL,      label: 'Business Email',      type: 'email' },
  leadSource:     { id: LEAD_COLS.SOURCE,     label: 'Source',              type: 'status' },
  leadConversion: { id: LEAD_COLS.CONVERSION, label: 'Conversion Activity', type: 'status' },
  leadMbDate:     { id: 'date_mm45gm2e',      label: 'MB Date',             type: 'date' },
  // Opportunities
  closeDate:   { id: 'deal_expected_close_date', label: 'Expected Close Date', type: 'date' },
  forecast:    { id: 'color_mm5phjr9',  label: 'Forecast Category', type: 'status' },
  winProb:     { id: 'numeric_mm5pgbax', label: 'Win Probability %', type: 'numbers', hint: '0–100' },
  dealType:    { id: 'color_mkz2atw5',  label: 'Type of Deal',      type: 'status' },
  arrValue:    { id: 'numeric_mm1j3hkq', label: 'Net Added ARR (USD)', type: 'numbers' },
  psValue:     { id: 'numeric_mkz3h4rp', label: 'PS Value (deal currency)', type: 'numbers' },
  currency:    { id: 'color_mm4xexb2',  label: 'Transaction Currency', type: 'status' },
  nextStep:    { id: 'text_mkz2m8qz',   label: 'Next Step',         type: 'text' },
  nextStepDate:{ id: 'date_mkz2b26d',   label: 'Next Step Date',    type: 'date' },
  contact:     { id: 'email',           label: "Main contact's email", type: 'email' },
  oppSource:   { id: 'color_mkzaet62',  label: 'Source',            type: 'status' },
  oppConversion:{ id: 'color_mkza93q9', label: 'Conversion Activity', type: 'status' },
};

function cv(item, id) {
  return item.column_values?.find(c => c.id === id);
}
function text(item, id) {
  const c = cv(item, id);
  return (c?.text || c?.display_value || '').trim();
}
function hasPeople(item, id) {
  try { return (JSON.parse(cv(item, id)?.value ?? '{}').personsAndTeams ?? []).length > 0; }
  catch { return false; }
}
export function peopleIds(item, id) {
  try { return (JSON.parse(cv(item, id)?.value ?? '{}').personsAndTeams ?? []).map(p => String(p.id)); }
  catch { return []; }
}
function filled(item, field) {
  if (field.type === 'multiple-person') return hasPeople(item, field.id);
  return text(item, field.id) !== '';
}

// ── Opportunities ─────────────────────────────────────────────────
function oppMissing(item) {
  const missing = [];
  const need = f => { if (!filled(item, f)) missing.push(f); };
  need(F.closeDate);
  need(F.forecast);
  need(F.winProb);
  need(F.dealType);
  // Value depends on the deal type: PS deals carry PS Value in their own
  // currency (so currency is needed to convert it); everything else is ARR.
  const type = text(item, F.dealType.id);
  if (type === 'PS') { need(F.psValue); need(F.currency); }
  else if (type) need(F.arrValue);
  need(F.nextStep);
  need(F.nextStepDate);
  // A linked Contact item also counts as having a main contact
  const linkedContact = (cv(item, 'deal_contact')?.linked_item_ids ?? []).length > 0;
  if (!linkedContact) need(F.contact);
  need(F.oppSource);
  need(F.oppConversion);
  return missing;
}

// ── Prospects ─────────────────────────────────────────────────────
function prospectInScope(item) {
  return !PROSPECT_UNWORKED_STATUSES.has(text(item, 'status'));
}

function prospectMissing(item) {
  const missing = [];
  if (!filled(item, F.prospectCompany)) missing.push(F.prospectCompany);
  // Any one way to reach them: email, the Phones column or Mobile Phone
  const reachable = ['email_mm14rb30', 'phone_mm1t253', 'text_mm4hkx37'].some(id => text(item, id) !== '');
  if (!reachable) missing.push(F.prospectEmail);
  return missing;
}

// ── Leads ─────────────────────────────────────────────────────────
function leadInScope(item, now) {
  const status = text(item, LEAD_COLS.STATUS);
  if (LEAD_CLOSED_STATUSES.has(status)) return false;
  if (LEAD_QUALIFIED_STATUSES.has(status)) {
    const created = Date.parse(item.created_at ?? '');
    return Number.isFinite(created) && now - created <= QUALIFIED_LOOKBACK_DAYS * 86400000;
  }
  return true;
}

function leadMissing(item) {
  const missing = [];
  const need = f => { if (!filled(item, f)) missing.push(f); };
  need(F.leadCompany);
  need(F.leadEmail);
  need(F.leadSource);
  need(F.leadConversion);
  if (text(item, LEAD_COLS.STATUS) === 'Meeting Booked') need(F.leadMbDate);
  return missing;
}

// ── Public API ────────────────────────────────────────────────────
export function missingFields(item, board) {
  if (board === MISSING_BOARDS.PROSPECT) return prospectMissing(item);
  return board === MISSING_BOARDS.OPP ? oppMissing(item) : leadMissing(item);
}

export function ownerIds(item, board) {
  if (board === MISSING_BOARDS.PROSPECT) return peopleIds(item, 'person');
  if (board === MISSING_BOARDS.OPP) return peopleIds(item, 'deal_owner');
  const sdr = peopleIds(item, LEAD_COLS.SDR);
  return sdr.length ? sdr : peopleIds(item, LEAD_COLS.BIZDEV);
}

// Returns [{ item, board, missing, owners }] for every record with a gap.
export function buildMissingList({ prospects = [], leads, opportunities }, now = Date.now()) {
  const out = [];
  prospects.filter(prospectInScope).forEach(item => {
    const missing = prospectMissing(item);
    if (missing.length) out.push({ item, board: MISSING_BOARDS.PROSPECT, missing, owners: ownerIds(item, MISSING_BOARDS.PROSPECT) });
  });
  opportunities.forEach(item => {
    const missing = oppMissing(item);
    if (missing.length) out.push({ item, board: MISSING_BOARDS.OPP, missing, owners: ownerIds(item, MISSING_BOARDS.OPP) });
  });
  leads.filter(item => leadInScope(item, now)).forEach(item => {
    const missing = leadMissing(item);
    if (missing.length) out.push({ item, board: MISSING_BOARDS.LEAD, missing, owners: ownerIds(item, MISSING_BOARDS.LEAD) });
  });
  return out;
}

// Status options with their indexes, deactivated labels removed. Saving by
// index avoids ambiguity where a board has two labels with the same name
// (Transaction Currency has an active and a deactivated "USD").
export function statusOptions(column) {
  if (!column?.settings_str) return [];
  try {
    const s = JSON.parse(column.settings_str);
    const off = new Set((s.deactivated_labels ?? []).map(String));
    const seen = new Set();
    return Object.entries(s.labels ?? {})
      .filter(([idx, l]) => !off.has(idx) && l && l.trim())
      .filter(([, l]) => !seen.has(l) && seen.add(l))
      .map(([idx, l]) => ({ index: Number(idx), label: l }));
  } catch { return []; }
}

// Keeps connect-board values (the Contact link) after a save — mutation
// responses carry no linked_item_ids.
export function mergeSavedColumns(prev, saved) {
  const rel = (prev ?? []).filter(c => c.linked_item_ids);
  const relIds = new Set(rel.map(c => c.id));
  return [...(saved ?? []).filter(c => !relIds.has(c.id)), ...rel];
}

