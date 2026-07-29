// ── Opportunities board (5089407336) — verified against the LIVE board schema ──
// Re-checked directly via the monday.com API — do not assume field meaning from
// column *names* alone; several were renamed/repurposed after this was first built:
//   - numeric_mm4x1a5e is titled "Total Account ARR" (NOT a deal-level ARR field —
//     it's a manually-entered, account-wide context number, kept off pipeline totals)
//   - numeric_mkz3h4rp is titled "PS Value (Transaction Currency)" (was "Total Price
//     After Discounts")
//   - PS Value (USD) is now a live FORMULA column (formula_mm5qaewe), not a manual
//     field — it converts numeric_mkz3h4rp to USD via per-currency FX rate columns
export const OPP_COLS = {
  STAGE:            'color_mkz28c27',   // status: New (Qualified) … Won / Lost
  TYPE_OF_DEAL:      'color_mkz2atw5',   // status: New Business, Expansion, Renewal, PS…
  REGION:            'color_mkxerb02',   // status: UK / US / IL / Apps / Other (territory)
  TRANSACTION_CURRENCY: 'color_mm4xexb2', // status: GBP / USD / ILS / AED / EUR
  NET_ADDED_ARR:     'numeric_mm1j3hkq', // numbers — the ARR+CS deal value, always USD
  TOTAL_ACCOUNT_ARR: 'numeric_mm4x1a5e', // numbers — manual, account-wide context (not a deal value)
  PS_VALUE_TXN:      'numeric_mkz3h4rp', // numbers — PS value, in the deal's Transaction Currency
  PS_VALUE_USD:      'formula_mm5qaewe', // formula — PS Value (Transaction Currency) converted to USD
  SOURCE:            'color_mkzaet62',   // status
  REASON_LOST:       'color_mm0gr7a7',   // status
  INDUSTRY:          'dropdown_mkz4ve72',
  EXPECTED_CLOSE:    'deal_expected_close_date',
  ACTUAL_CLOSE:      'deal_close_date',
  CREATED:           'deal_creation_date',
  DEAL_OWNER:        'deal_owner',       // people
  WIN_PROBABILITY:   'numeric_mm5pgbax', // numbers — 0-100
  FORECAST_CATEGORY: 'color_mm5phjr9',   // status: Commit / Best Case / Pipeline
  // Titled "Hours acquired" — on a PS deal this is hours purchased; on an ARR
  // deal it's the included Customer Success hours that ship with the ARR.
  HOURS_ACQUIRED:    'numeric_mm4xe0qv',
};

const CURRENCY_ALIAS = { GPB: 'GBP', UAE: 'AED' };

// Formula columns never populate `text` — monday's API only computes their
// value into `display_value` — so fall back to that, else PS Value (USD) and
// similar formula fields always read as empty/zero regardless of the board.
function colText(item, id) {
  const cv = item.column_values?.find(c => c.id === id);
  return cv?.text || cv?.display_value || '';
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

function num(item, id) {
  return parseFloat(colText(item, id).replace(/,/g, '')) || 0;
}

export function parseOpportunity(item) {
  const stage = colText(item, OPP_COLS.STAGE);
  const rawCurrency = colText(item, OPP_COLS.TRANSACTION_CURRENCY).trim().toUpperCase();
  const currency = CURRENCY_ALIAS[rawCurrency] || rawCurrency || 'Other';
  const typeOfDeal = colText(item, OPP_COLS.TYPE_OF_DEAL) || 'Unspecified';
  const isPS = typeOfDeal === 'PS';

  const netAddedARR = num(item, OPP_COLS.NET_ADDED_ARR);         // ARR+CS deal value, USD
  const totalAccountARR = num(item, OPP_COLS.TOTAL_ACCOUNT_ARR); // manual, account-wide context only
  const psValueTxn = num(item, OPP_COLS.PS_VALUE_TXN);           // PS value, transaction currency
  const psValueUSD = num(item, OPP_COLS.PS_VALUE_USD);           // PS value, converted to USD (live formula)
  const winProbability = num(item, OPP_COLS.WIN_PROBABILITY);    // 0-100
  const hoursAcquired = num(item, OPP_COLS.HOURS_ACQUIRED);      // PS: hours purchased. ARR: included CS hours.
  const valueUSD = isPS ? psValueUSD : netAddedARR;

  // What reps still need to fill in — surfaced as a warning icon in the UI so
  // gaps (like the missing Net Added ARR values found in production) get fixed
  // at the source instead of being silently patched over here.
  const missingFields = [];
  if (isPS) {
    if (!psValueTxn) missingFields.push('PS Value');
  } else {
    if (!netAddedARR) missingFields.push('Net Added ARR');
  }
  if (!hoursAcquired) missingFields.push(isPS ? 'Hours Acquired' : 'CS Hours Included');
  if (!winProbability) missingFields.push('Win Probability');

  return {
    id: item.id,
    name: item.name,
    updatedAt: item.updated_at,
    stage: stage || 'Unspecified',
    isWon:  stage === 'Won',
    isLost: stage === 'Lost',
    isOpen: stage !== 'Won' && stage !== 'Lost',
    typeOfDeal,
    isPS,
    region:     colText(item, OPP_COLS.REGION) || 'Other',
    currency,
    netAddedARR,
    totalAccountARR,
    psValueTxn,
    psValueUSD,
    hoursAcquired,
    missingFields,
    missingEssentials: missingFields.length > 0,
    // Blended reporting value in USD (the functional currency): Net Added ARR for
    // ARR+CS deals, the FX-converted PS Value (USD) for PS deals. PS deals show 0
    // here until the deal's FX rate has been set and the FX Calculator has run.
    valueUSD,
    winProbability,
    forecastCategory: colText(item, OPP_COLS.FORECAST_CATEGORY) || 'Unspecified',
    // Probability-weighted value — only meaningful for open (not-yet-closed) deals.
    weightedValueUSD: valueUSD * (winProbability / 100),
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

// Raw deal amount in its own native currency — Net Added ARR (USD) for ARR+CS
// deals, PS Value in Transaction Currency for PS deals. Used for composition
// breakdowns where showing the real transaction currency matters more than
// a blended USD total (use o.valueUSD for that instead).
function rawAmount(o) {
  return o.isPS ? o.psValueTxn : o.netAddedARR;
}

export function sumByCurrency(opps) {
  const out = {};
  for (const o of opps) out[o.currency] = (out[o.currency] || 0) + rawAmount(o);
  return out;
}

export function groupBy(opps, keyFn) {
  const out = {};
  for (const o of opps) {
    const k = keyFn(o) || 'Unspecified';
    out[k] ??= { count: 0, value: 0, byCurrency: {} };
    const amt = rawAmount(o);
    out[k].count += 1;
    out[k].value += amt;
    out[k].byCurrency[o.currency] = (out[k].byCurrency[o.currency] || 0) + amt;
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
      won[m].byCurrency[o.currency] = (won[m].byCurrency[o.currency] || 0) + rawAmount(o);
    }
    if (inYear(o.created, year)) {
      created[o.created.getMonth()] += 1;
    }
  }

  return MONTH_LABELS.map((label, i) => ({ label, won: won[i], created: created[i] }));
}

function sumUSD(opps) {
  return opps.reduce((sum, o) => sum + (o.valueUSD || 0), 0);
}

function sumWeightedUSD(opps) {
  return opps.reduce((sum, o) => sum + (o.weightedValueUSD || 0), 0);
}

// Stats for one side (ARR or PS) of a period's open/won/lost sets.
function sideStats(openSet, wonSet, lostSet) {
  const closedTotal = wonSet.length + lostSet.length;
  const wonValueUSD = sumUSD(wonSet);
  return {
    openCount: openSet.length,
    openValueUSD: sumUSD(openSet),               // raw, unweighted total open value
    weightedOpenValueUSD: sumWeightedUSD(openSet), // probability-weighted "expected to close"
    wonCount: wonSet.length,
    wonValueUSD,
    lostCount: lostSet.length,
    lostValueUSD: sumUSD(lostSet),
    closedTotal,
    winRate: closedTotal > 0 ? (wonSet.length / closedTotal) * 100 : null,
    avgDealSizeUSD: wonSet.length > 0 ? wonValueUSD / wonSet.length : 0,
  };
}

// Open + won + lost stats for a period, given predicates for which date field to test.
// Returns separate ARR and PS figures — these use different source fields and different
// currencies pre-conversion, so they're kept apart rather than blended into one number.
// "Expected to close" (weightedOpenValueUSD) is the open value weighted by Win Probability %.
export function periodStats(opps, { openPredicate, closedPredicate }) {
  const openSet = opps.filter(o => o.isOpen && openPredicate(o));
  const wonSet  = opps.filter(o => o.isWon && closedPredicate(o));
  const lostSet = opps.filter(o => o.isLost && closedPredicate(o));

  return {
    arr: sideStats(openSet.filter(o => !o.isPS), wonSet.filter(o => !o.isPS), lostSet.filter(o => !o.isPS)),
    ps:  sideStats(openSet.filter(o => o.isPS),  wonSet.filter(o => o.isPS),  lostSet.filter(o => o.isPS)),
  };
}

// ── Pipeline planning buckets ────────────────────────────────────────

// Sort open opportunities into: closing this quarter, closing later this year,
// and unscheduled (no Expected Close Date set at all — a real gap in the data,
// worth surfacing rather than silently dropping).
export function planningBuckets(opps, year, quarter) {
  const open = opps.filter(o => o.isOpen);
  const thisQuarter = open.filter(o => inQuarter(o.expectedClose, year, quarter));
  const laterThisYear = open.filter(o => inYear(o.expectedClose, year) && !inQuarter(o.expectedClose, year, quarter));
  const unscheduled = open.filter(o => !o.expectedClose);
  const sortByValue = list => [...list].sort((a, b) => b.valueUSD - a.valueUSD);
  return {
    thisQuarter: sortByValue(thisQuarter),
    laterThisYear: sortByValue(laterThisYear),
    unscheduled: sortByValue(unscheduled),
  };
}

// Split a set of opportunities' blended USD value into ARR vs PS totals — the two use
// different source fields (Net Added ARR vs the FX-converted PS Value (USD)) and are
// kept as separate figures rather than combined into one blended number.
export function sumUSDBySide(opps) {
  return {
    arr: sumUSD(opps.filter(o => !o.isPS)),
    ps:  sumUSD(opps.filter(o => o.isPS)),
    arrCount: opps.filter(o => !o.isPS).length,
    psCount: opps.filter(o => o.isPS).length,
  };
}

// Historical: everything already closed (Won or Lost), most recently closed first.
export function historicalClosed(opps) {
  return opps
    .filter(o => (o.isWon || o.isLost) && o.actualClose)
    .sort((a, b) => b.actualClose - a.actualClose);
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
