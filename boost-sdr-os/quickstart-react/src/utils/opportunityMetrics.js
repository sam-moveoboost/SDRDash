// ── Opportunities board (5089407336) — verified column IDs ─────────
// Pulled directly from the live board schema; several columns carry
// "OLD CRM" siblings that are intentionally ignored here.
export const OPP_COLS = {
  STAGE:          'color_mkz28c27',   // status: New (Qualified) … Won / Lost
  TYPE_OF_DEAL:   'color_mkz2atw5',   // status: New Business, Expansion, Renewal, PS…
  REGION:         'color_mkxerb02',   // status: UK / US / IL / Apps / Other (territory)
  CURRENCY:       'color_mm4xexb2',   // status: GPB(sic/GBP) / USD / ILS / UAE(AED)
  ARR:            'numeric_mm4x1a5e', // numbers — primary deal value
  SOURCE:         'color_mkzaet62',   // status
  REASON_LOST:    'color_mm0gr7a7',   // status
  INDUSTRY:       'dropdown_mkz4ve72',
  EXPECTED_CLOSE: 'deal_expected_close_date',
  ACTUAL_CLOSE:   'deal_close_date',
  CREATED:        'deal_creation_date',
  DEAL_OWNER:     'deal_owner',       // people
};

const CURRENCY_ALIAS = { GPB: 'GBP', UAE: 'AED' };

function colText(item, id) {
  return item.column_values?.find(c => c.id === id)?.text ?? '';
}

function colValue(item, id) {
  return item.column_values?.find(c => c.id === id)?.value ?? null;
}

function parseDate(text) {
  if (!text) return null;
  const d = new Date(text);
  return isNaN(d.getTime()) ? null : d;
}

function parsePeopleIds(item, id) {
  try {
    const raw = colValue(item, id);
    return (JSON.parse(raw ?? '{}').personsAndTeams ?? []).map(p => String(p.id));
  } catch { return []; }
}

export function parseOpportunity(item) {
  const stage = colText(item, OPP_COLS.STAGE);
  const rawCurrency = colText(item, OPP_COLS.CURRENCY).trim().toUpperCase();
  const currency = CURRENCY_ALIAS[rawCurrency] || rawCurrency || 'Other';
  const value = parseFloat(colText(item, OPP_COLS.ARR).replace(/,/g, '')) || 0;

  return {
    id: item.id,
    name: item.name,
    updatedAt: item.updated_at,
    stage: stage || 'Unspecified',
    isWon:  stage === 'Won',
    isLost: stage === 'Lost',
    isOpen: stage !== 'Won' && stage !== 'Lost',
    typeOfDeal: colText(item, OPP_COLS.TYPE_OF_DEAL) || 'Unspecified',
    region:     colText(item, OPP_COLS.REGION) || 'Other',
    currency,
    value,
    source:     colText(item, OPP_COLS.SOURCE) || 'Unspecified',
    reasonLost: colText(item, OPP_COLS.REASON_LOST),
    industry:   colText(item, OPP_COLS.INDUSTRY) || 'Unspecified',
    expectedClose: parseDate(colText(item, OPP_COLS.EXPECTED_CLOSE)),
    actualClose:   parseDate(colText(item, OPP_COLS.ACTUAL_CLOSE)),
    created:       parseDate(colText(item, OPP_COLS.CREATED)),
    ownerIds: parsePeopleIds(item, OPP_COLS.DEAL_OWNER),
  };
}

// ── Time helpers ─────────────────────────────────────────────────────

export function quarterOf(date) {
  return Math.floor(date.getMonth() / 3) + 1;
}

export function quarterLabel(year, quarter) {
  return `Q${quarter} ${year}`;
}

export function inQuarter(date, year, quarter) {
  return !!date && date.getFullYear() === year && quarterOf(date) === quarter;
}

export function inYear(date, year) {
  return !!date && date.getFullYear() === year;
}

// ── Aggregation helpers ──────────────────────────────────────────────

export function sumByCurrency(opps) {
  const out = {};
  for (const o of opps) out[o.currency] = (out[o.currency] || 0) + o.value;
  return out;
}

export function groupBy(opps, keyFn) {
  const out = {};
  for (const o of opps) {
    const k = keyFn(o) || 'Unspecified';
    out[k] ??= { count: 0, value: 0, byCurrency: {} };
    out[k].count += 1;
    out[k].value += o.value;
    out[k].byCurrency[o.currency] = (out[k].byCurrency[o.currency] || 0) + o.value;
  }
  return Object.entries(out)
    .map(([label, d]) => ({ label, ...d }))
    .sort((a, b) => b.count - a.count);
}

const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// Won value/count by month (actual close date) + pipeline created by month, for one calendar year.
export function monthlyTrend(opps, year) {
  const won = Array.from({ length: 12 }, () => ({ count: 0, byCurrency: {} }));
  const created = Array(12).fill(0);

  for (const o of opps) {
    if (o.isWon && inYear(o.actualClose, year)) {
      const m = o.actualClose.getMonth();
      won[m].count += 1;
      won[m].byCurrency[o.currency] = (won[m].byCurrency[o.currency] || 0) + o.value;
    }
    if (inYear(o.created, year)) {
      created[o.created.getMonth()] += 1;
    }
  }

  return MONTH_LABELS.map((label, i) => ({ label, won: won[i], created: created[i] }));
}

// Open + won + lost stats for a period, given predicates for which date field to test.
export function periodStats(opps, { openPredicate, closedPredicate }) {
  const openSet = opps.filter(o => o.isOpen && openPredicate(o));
  const wonSet  = opps.filter(o => o.isWon && closedPredicate(o));
  const lostSet = opps.filter(o => o.isLost && closedPredicate(o));
  const closedTotal = wonSet.length + lostSet.length;

  const wonSums = sumByCurrency(wonSet);
  const wonCounts = {};
  wonSet.forEach(o => { wonCounts[o.currency] = (wonCounts[o.currency] || 0) + 1; });
  const avgDealSizeByCurrency = {};
  Object.keys(wonSums).forEach(c => { avgDealSizeByCurrency[c] = wonSums[c] / wonCounts[c]; });

  return {
    openCount: openSet.length,
    openValueByCurrency: sumByCurrency(openSet),
    wonCount: wonSet.length,
    wonValueByCurrency: wonSums,
    lostCount: lostSet.length,
    lostValueByCurrency: sumByCurrency(lostSet),
    closedTotal,
    winRate: closedTotal > 0 ? (wonSet.length / closedTotal) * 100 : null,
    avgDealSizeByCurrency,
  };
}

export function formatMoney(amount, currency) {
  if (!amount) return null;
  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${Math.round(amount).toLocaleString()} ${currency}`;
  }
}

// Render a {currency: amount} map as a compact "£45,000 · $12,000" string.
export function formatByCurrency(byCurrency) {
  const entries = Object.entries(byCurrency).filter(([, v]) => v > 0);
  if (entries.length === 0) return '—';
  return entries
    .sort((a, b) => b[1] - a[1])
    .map(([currency, amount]) => formatMoney(amount, currency) ?? `${Math.round(amount)} ${currency}`)
    .join(' · ');
}
