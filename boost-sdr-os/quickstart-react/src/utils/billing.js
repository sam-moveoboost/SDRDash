// Pure billing logic: no network, no React. Kept separate so it can be tested in isolation.

// ── Booking board (finance) ──────────────────────────────────────
export const BOOKING_BOARD_ID = '5090394353';

export const BK = {
  BD:           'person',
  STATUS:       'color_mkpspzc8',
  OPERATION:    'color_mkpsbc4z',
  MONTH:        'color_mkpsd6j1',
  YEAR:         'color_mkpsfbsw',
  TERMS:        'color_mkpsvr37',
  CURRENCY:     'color_mkq339tm',
  ENTITY:       'color_mkxzwse1',
  PROJECT:      'text_mkps8996',
  EMAIL:        'text_mkpsh68t',
  DESCRIPTION:  'text_mm435pb0',
  CONTRACT:     'file_mkps4q4t',
  ACCOUNT_REL:  'board_relation_mm0nbb57',
  DUE_DATE:     'date_mkps6287',
  DEFAULT_DATE: 'date_mkpv52e2',
  INVOICE_DATE: 'date_mkps33zk',
  AMOUNT_ILS:   'numeric_mkpv5mjg',
  AMOUNT_USD:   'numeric_mkpvsvnf',
  AMOUNT_GBP:   'numeric_mkpvft8a',
  AMOUNT_EUR:   'numeric_mkpvb8vh',
  AMOUNT_VAT:   'numeric_mkzjsvb7',
};

// The amount is typed into the column for its own currency; the board converts to ILS itself.
export const AMOUNT_COL_BY_CURRENCY = {
  ILS: BK.AMOUNT_ILS,
  USD: BK.AMOUNT_USD,
  GBP: BK.AMOUNT_GBP,
  EUR: BK.AMOUNT_EUR,
};

// Booking groups are the entity.
export const GROUP_BY_ENTITY = {
  'Boost IL': 'group_mkq7m299',
  'Boost US': 'group_mkzy1xdq',
  'Boost UK': 'group_mkxz5mmm',
};

export const NEW_STATUS = 'New!';
export const MAX_PAYMENTS = 4;

// ── Opportunities board ids the billing screen reads ─────────────
export const OPP = {
  STAGE:        'color_mkz28c27',
  OWNER:        'deal_owner',
  COMPANY:      'text8',
  ACCOUNT:      'connect_boards31',
  EMAIL:        'email',
  REGION:       'color_mkxerb02',
  TYPE_OF_DEAL: 'color_mkz2atw5',
  ARR_LENGTH:   'color_mkz4dtzp',
  PRODUCTS:     'dropdown_mm4xjwjm',
  CURRENCY:     'color_mm4xexb2',
  PS_VALUE:     'numeric_mkz3h4rp',
  ARR_VALUE:    'numeric_mm1j3hkq', // "Client payment (ARR on SO)", always USD
  TERMS:        'color_mm4x2xm1',
  EXPECTED:     'deal_expected_close_date',
  CLOSED:       'deal_close_date',
};

// SOW / contract file columns, in the order we trust them.
export const CONTRACT_COLS = [
  { id: 'file_mkzc2b6g', label: 'SOW/Contract' },
  { id: 'file_mm6tn0n1', label: 'Contract Signed' },
  { id: 'file_mm08w93r', label: 'Signed contracts' },
  { id: 'file_mm6hgp57', label: 'Contract Draft' },
];

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// ── Small helpers ─────────────────────────────────────────────────
const norm = s => String(s ?? '').trim().toLowerCase();

export function parseNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function round2(n) { return Math.round(n * 100) / 100; }

export function formatAmount(n, currency) {
  if (n === null || n === undefined || n === '') return '–';
  const sym = { GBP: '£', USD: '$', EUR: '€', ILS: '₪' }[currency] ?? '';
  return `${sym}${Number(n).toLocaleString('en-GB', { maximumFractionDigits: 2 })}${sym ? '' : ` ${currency ?? ''}`}`;
}

export function todayISO(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

// Picks the canonical option for a value, ignoring case and spacing. Returns '' when there is no match.
export function matchOption(value, options) {
  const v = norm(value);
  if (!v) return '';
  return (options ?? []).find(o => norm(o) === v) ?? '';
}

// ── Derivations from the opportunity ─────────────────────────────
export function deriveEntity(region) {
  return { IL: 'Boost IL', US: 'Boost US', UK: 'Boost UK' }[String(region ?? '').trim()] ?? '';
}

// Operation labels on the Booking board: ARR IL, ARR UK, CSM IL/UK, IC IL/UK/US, PS CODE IL/UK, Apps, Agents (Apps).
// Only returns a value when the opportunity says so clearly; otherwise the rep chooses.
export function deriveOperation({ products = [], region, typeOfDeal }, operationOptions = []) {
  const reg = String(region ?? '').trim();
  const prods = products.map(norm);
  const pick = label => matchOption(label, operationOptions);
  if (prods.includes('arr il')) return pick('ARR IL');
  if (prods.includes('arr uk')) return pick('ARR UK');
  if (prods.some(p => p.startsWith('ps code')) && (reg === 'IL' || reg === 'UK')) return pick(`PS CODE ${reg}`);
  if (prods.some(p => p.startsWith('ps no code')) && ['IL', 'UK', 'US'].includes(reg)) return pick(`IC ${reg}`);
  if (reg === 'Apps') return pick('Apps');
  return '';
}

// "2 Year" -> 2
export function parseYears(arrLength) {
  const m = /(\d+)/.exec(String(arrLength ?? ''));
  return m ? parseInt(m[1], 10) : null;
}

// Month index (0-11) and year for the first invoice: the month the deal closed (or is expected to close).
export function firstBillingMonth(opp, now = new Date()) {
  const raw = opp.closedDate || opp.expectedDate || '';
  const d = /^\d{4}-\d{2}-\d{2}/.test(raw) ? new Date(`${raw.slice(0, 10)}T00:00:00`) : now;
  return { month: d.getMonth(), year: d.getFullYear() };
}

export function addMonths({ month, year }, n) {
  const total = year * 12 + month + n;
  return { month: ((total % 12) + 12) % 12, year: Math.floor(total / 12) };
}

// Evenly split 100 across n payments; the last one absorbs the rounding.
export function splitPercents(n) {
  const base = round2(100 / n);
  const arr = Array(n).fill(base);
  arr[n - 1] = round2(100 - base * (n - 1));
  return arr;
}

// Pulls the deal's value and currency: PS value in its own currency, else the ARR value in USD.
export function deriveValue(opp) {
  const ps = parseNum(opp.psValue);
  if (ps) return { value: ps, currency: opp.currency, basis: 'PS Value (Transaction Currency)' };
  const arr = parseNum(opp.arrValue);
  if (arr) return { value: arr, currency: 'USD', basis: 'Client payment (ARR on SO), USD' };
  return { value: null, currency: opp.currency, basis: '' };
}

// Default number of payments and the gap between them.
// ARR deals bill once a year across the ARR length; everything else defaults to one payment.
export function defaultPaymentPlan(opp) {
  const years = parseYears(opp.arrLength);
  const isArr = /arr/i.test(opp.typeOfDeal ?? '') || (opp.products ?? []).some(p => /^arr /i.test(p));
  if (isArr && years && years >= 2) return { count: Math.min(years, MAX_PAYMENTS), gapMonths: 12 };
  return { count: 1, gapMonths: 1 };
}

// Row `index` (0-based) of a plan. `startNumber` lets later top-up invoices continue the numbering.
export function paymentName(base, number, total, percent) {
  if (total <= 1) return base;
  return `${base} - Payment ${number}${percent ? ` - ${percent}%` : ''}`;
}

let _rowSeq = 0;
export function newRowId() { _rowSeq += 1; return `row-${_rowSeq}`; }

// Builds the editable draft for a deal. Everything here is a suggestion the rep can change.
export function buildDraft(opp, meta, { count, startNumber = 1, existingCount = 0, now = new Date() } = {}) {
  const plan = defaultPaymentPlan(opp);
  const n = Math.max(1, Math.min(MAX_PAYMENTS, count ?? plan.count));
  const gap = plan.gapMonths;
  const { value, currency } = deriveValue(opp);
  const percents = splitPercents(n);
  const start = firstBillingMonth(opp, now);
  const entity = matchOption(deriveEntity(opp.region), meta.entityOptions);
  const operation = deriveOperation(opp, meta.operationOptions);
  const cur = matchOption(currency, meta.currencyOptions) || '';
  const terms = matchOption(opp.terms, meta.termsOptions);
  const total = startNumber - 1 + n;
  const base = opp.name;

  let allocated = 0;
  return Array.from({ length: n }, (_, i) => {
    const pct = percents[i];
    let amount = '';
    if (value) {
      amount = i === n - 1 ? round2(value - allocated) : round2(value / n);
      allocated += amount;
    }
    const when = addMonths(start, i * gap);
    const number = startNumber + i;
    // When topping up an existing plan, the name carries the running number only.
    const name = existingCount > 0 || startNumber > 1
      ? `${base} - Payment ${number}`
      : paymentName(base, number, total, n > 1 ? pct : null);
    return {
      id: newRowId(),
      name,
      percent: n > 1 ? pct : 100,
      amount,
      currency: cur,
      operation,
      month: MONTHS[when.month],
      year: String(when.year),
      terms,
      entity,
      description: '',
    };
  });
}

// ── Validation ───────────────────────────────────────────────────
export function validateRow(row) {
  const errors = [];
  if (!String(row.name ?? '').trim()) errors.push('name');
  if (!String(row.description ?? '').trim()) errors.push('description');
  if (!row.operation) errors.push('operation');
  if (!row.month) errors.push('month');
  if (!row.year) errors.push('year');
  if (!row.currency) errors.push('currency');
  if (!row.entity) errors.push('entity');
  if (parseNum(row.amount) === null || parseNum(row.amount) <= 0) errors.push('amount');
  return errors;
}

export const FIELD_LABEL = {
  name: 'Name', description: 'Invoice description', operation: 'Operation', month: 'Month of work',
  year: 'Year', currency: 'Currency', entity: 'Entity', amount: 'Amount',
};

// ── Duplicate detection ──────────────────────────────────────────
// Rows that match on everything the finance team would see (the payment number
// in the name is ignored, because that is the only thing that differs on a copy-paste).
function rowSignature(row) {
  return [
    norm(row.operation), norm(row.month), norm(row.year), norm(row.currency), norm(row.entity),
    norm(row.terms), String(parseNum(row.amount) ?? ''), norm(row.description),
  ].join('|');
}

// Returns Map<rowId, 'draft'|'board'> for rows that look like another draft row or one already on the board.
// `existing` entries need { project, operation, month, year, amount, currency }.
export function findDuplicates(rows, existing = [], project = '') {
  const flags = new Map();
  const seen = new Map();
  for (const r of rows) {
    const sig = rowSignature(r);
    if (seen.has(sig)) {
      flags.set(r.id, 'draft');
      flags.set(seen.get(sig), 'draft');
    } else {
      seen.set(sig, r.id);
    }
  }
  for (const r of rows) {
    const clash = existing.some(e =>
      norm(e.project) === norm(project)
      && norm(e.operation) === norm(r.operation)
      && norm(e.month) === norm(r.month)
      && norm(e.year) === norm(r.year)
      && norm(e.currency) === norm(r.currency)
      && parseNum(e.amount) === parseNum(r.amount));
    if (clash && !flags.has(r.id)) flags.set(r.id, 'board');
  }
  return flags;
}

// ── Column values for create_item ────────────────────────────────
export function buildBookingColumnValues(row, { bdUserIds = [], project, email }) {
  const cv = {
    [BK.STATUS]: { label: NEW_STATUS },
    [BK.OPERATION]: { label: row.operation },
    [BK.MONTH]: { label: row.month },
    [BK.YEAR]: { label: String(row.year) },
    [BK.CURRENCY]: { label: row.currency },
    [BK.ENTITY]: { label: row.entity },
    [BK.DESCRIPTION]: String(row.description).trim(),
  };
  const amountCol = AMOUNT_COL_BY_CURRENCY[row.currency];
  if (amountCol) cv[amountCol] = String(parseNum(row.amount));
  if (row.terms) cv[BK.TERMS] = { label: row.terms };
  if (bdUserIds.length) cv[BK.BD] = { personsAndTeams: bdUserIds.map(id => ({ id: parseInt(id, 10), kind: 'person' })) };
  if (project) cv[BK.PROJECT] = project;
  if (email) cv[BK.EMAIL] = email;
  return cv;
}

// ── Invoice tracking ─────────────────────────────────────────────
// 'overdue' | 'outstanding' | 'paid' | 'cancelled' | 'other'
// A payment is only overdue once the invoice is out: either finance flagged it Late!,
// or it is Awaiting Payment and its due date has passed. New!/Issue invoice rows are still outstanding.
export function classifyInvoice({ status, dueDate }, today = todayISO()) {
  const s = norm(status);
  if (s === 'paid!' || s === 'paid') return 'paid';
  if (s === 'cancelled') return 'cancelled';
  if (s === 'late!' || s === 'late') return 'overdue';
  if (s === 'on hold') return 'other';
  if (s === 'awaiting payment' && dueDate && dueDate < today) return 'overdue';
  return 'outstanding';
}

export const INVOICE_ORDER = { overdue: 0, outstanding: 1, other: 2, paid: 3, cancelled: 4 };

// Months late as a short human label for the table.
export function daysOverdue(dueDate, today = todayISO()) {
  if (!dueDate || dueDate >= today) return 0;
  return Math.round((new Date(`${today}T00:00:00`) - new Date(`${dueDate}T00:00:00`)) / 86400000);
}
