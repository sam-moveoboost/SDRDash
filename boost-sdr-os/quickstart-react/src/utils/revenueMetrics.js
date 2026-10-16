// Revenue Intelligence calculations. Pure functions over parsed opportunities
// (see parseOpportunity in opportunityMetrics.js). Everything is in USD, using
// the blended valueUSD the rest of the app reports on.

const DAY = 86400000;
export const STALE_DAYS = 30;
export const MIN_CLOSED_FOR_COACHING = 8;
export const MIN_CLOSED_FOR_RATE = 10;
// Lost reasons that can realistically come back. Used for the "recoverable" estimate.
export const REENGAGE_REASONS = ['Timeline is to long', 'Budget', 'Ghosting'];
// Win probability assumed for open deals that have none recorded, so they are
// not silently counted as worth nothing in the at-risk figure.
export const ASSUMED_PROBABILITY = 25;
export const DEFAULT_RECOVERY_RATE = 0.1;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const STAGE_ORDER = [
  'New (Qualified)', 'Demo (Evaluation)', 'Proposal (Validation)', 'Negotiation & Legal',
  'Negotiation', 'Contract sent (Buying process)', 'In Progress', 'Ghosting', 'On hold',
];

export function fmtUSD(n) {
  if (n == null || Number.isNaN(n)) return '–';
  const abs = Math.abs(n);
  const trim = x => String(parseFloat(x.toFixed(1)));
  if (abs >= 1e6) return `$${trim(n / 1e6)}M`;
  if (abs >= 1e3) return `$${Math.round(n / 1e3)}k`;
  return `$${Math.round(n)}`;
}

export function fmtPct(n) {
  return n == null || Number.isNaN(n) ? '–' : `${Math.round(n)}%`;
}

const sum = (list, fn) => list.reduce((s, o) => s + (fn(o) || 0), 0);
const ago = (now, days) => new Date(now.getTime() - days * DAY);
const top = (list, n = 5) => [...list].sort((a, b) => b.valueUSD - a.valueUSD).slice(0, n);

function wonSince(opps, from) {
  return opps.filter(o => o.isWon && o.actualClose && o.actualClose >= from);
}
function lostSince(opps, from) {
  return opps.filter(o => o.isLost && o.actualClose && o.actualClose >= from);
}

function cycleDays(o) {
  if (!o.created || !o.actualClose) return null;
  const d = (o.actualClose - o.created) / DAY;
  return d >= 0 ? d : null;
}

function avg(list) {
  const v = list.filter(x => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

// ── Headline ─────────────────────────────────────────────────────────
export function headline(opps, now = new Date()) {
  const from12 = ago(now, 365);
  const from90 = ago(now, 90);
  const open = opps.filter(o => o.isOpen);
  const won12 = wonSince(opps, from12);
  const lost12 = lostSince(opps, from12);
  const won90 = wonSince(opps, from90);
  const closed12 = won12.length + lost12.length;
  return {
    openCount: open.length,
    openValue: sum(open, o => o.valueUSD),
    openArr: sum(open.filter(o => !o.isPS), o => o.valueUSD),
    openPS: sum(open.filter(o => o.isPS), o => o.valueUSD),
    weightedOpen: sum(open, o => o.weightedValueUSD),
    won12Value: sum(won12, o => o.valueUSD),
    won12Count: won12.length,
    won90Value: sum(won90, o => o.valueUSD),
    won90Count: won90.length,
    lost12Value: sum(lost12, o => o.valueUSD),
    lost12Count: lost12.length,
    winRate12: closed12 ? (won12.length / closed12) * 100 : null,
    avgCycleDays: avg(won12.map(cycleDays)),
    avgDealSize: won12.length ? sum(won12, o => o.valueUSD) / won12.length : null,
  };
}

// ── Where revenue comes from ─────────────────────────────────────────
export function wonBy(opps, keyFn, now = new Date()) {
  const map = new Map();
  for (const o of wonSince(opps, ago(now, 365))) {
    const k = keyFn(o) || 'Unspecified';
    const cur = map.get(k) || { label: k, value: 0, count: 0 };
    cur.value += o.valueUSD || 0;
    cur.count += 1;
    map.set(k, cur);
  }
  return [...map.values()].sort((a, b) => b.value - a.value);
}

export function monthlyWon(opps, now = new Date()) {
  const buckets = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: MONTHS[d.getMonth()], year: d.getFullYear(), value: 0, count: 0 });
  }
  const byKey = Object.fromEntries(buckets.map(b => [b.key, b]));
  for (const o of opps) {
    if (!o.isWon || !o.actualClose) continue;
    const b = byKey[`${o.actualClose.getFullYear()}-${o.actualClose.getMonth()}`];
    if (b) { b.value += o.valueUSD || 0; b.count += 1; }
  }
  return buckets;
}

// Win rate (by count) and won value per group, last 12 months. Groups with fewer
// than minClosed closed deals are folded out so tiny samples don't mislead.
export function winRateBy(opps, keyFn, now = new Date(), minClosed = MIN_CLOSED_FOR_RATE) {
  const from = ago(now, 365);
  const map = new Map();
  for (const o of [...wonSince(opps, from), ...lostSince(opps, from)]) {
    const k = keyFn(o) || 'Unspecified';
    const cur = map.get(k) || { label: k, won: 0, lost: 0, wonValue: 0, lostValue: 0 };
    if (o.isWon) { cur.won += 1; cur.wonValue += o.valueUSD || 0; }
    else { cur.lost += 1; cur.lostValue += o.valueUSD || 0; }
    map.set(k, cur);
  }
  return [...map.values()]
    .map(g => ({ ...g, closed: g.won + g.lost, rate: (g.won / (g.won + g.lost)) * 100 }))
    .filter(g => g.closed >= minClosed)
    .sort((a, b) => b.closed - a.closed);
}

export function concentration(opps, now = new Date(), n = 5) {
  const won = wonSince(opps, ago(now, 365)).sort((a, b) => b.valueUSD - a.valueUSD);
  const total = sum(won, o => o.valueUSD);
  const topDeals = won.slice(0, n);
  const topValue = sum(topDeals, o => o.valueUSD);
  return { total, topValue, share: total ? (topValue / total) * 100 : null, deals: topDeals };
}

// ── Pipeline shape ───────────────────────────────────────────────────
export function funnel(opps) {
  const map = new Map();
  for (const o of opps.filter(x => x.isOpen)) {
    const cur = map.get(o.stage) || { stage: o.stage, count: 0, value: 0, weighted: 0 };
    cur.count += 1;
    cur.value += o.valueUSD || 0;
    cur.weighted += o.weightedValueUSD || 0;
    map.set(o.stage, cur);
  }
  const rank = s => { const i = STAGE_ORDER.indexOf(s); return i === -1 ? 99 : i; };
  return [...map.values()].sort((a, b) => rank(a.stage) - rank(b.stage) || b.value - a.value);
}

export function lostByReason(opps, now = new Date()) {
  const map = new Map();
  for (const o of lostSince(opps, ago(now, 365))) {
    const k = o.reasonLost || 'No reason recorded';
    const cur = map.get(k) || { label: k, count: 0, value: 0 };
    cur.count += 1;
    cur.value += o.valueUSD || 0;
    map.set(k, cur);
  }
  return [...map.values()].sort((a, b) => b.value - a.value);
}

// ── Leakage ──────────────────────────────────────────────────────────
function expectedValue(o) {
  const p = o.winProbability > 0 ? o.winProbability : ASSUMED_PROBABILITY;
  return (o.valueUSD || 0) * (p / 100);
}

export function leakage(opps, now = new Date(), recoveryRate = DEFAULT_RECOVERY_RATE) {
  const open = opps.filter(o => o.isOpen);
  const staleCut = ago(now, STALE_DAYS);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const isStale = o => !!o.updatedAt && new Date(o.updatedAt) < staleCut;
  const isOverdue = o => !!o.expectedClose && o.expectedClose < today;
  const isParked = o => o.stage === 'Ghosting' || o.stage === 'On hold';

  const make = (key, label, why, list) => ({
    key, label, why,
    count: list.length,
    value: sum(list, o => o.valueUSD),
    expected: sum(list, expectedValue),
    sample: top(list),
  });

  const checks = [
    make('stale', `Untouched for ${STALE_DAYS}+ days`, 'Open deals with no activity on the record. The longer they sit, the less likely they close.', open.filter(isStale)),
    make('overdue', 'Past expected close date', 'Open deals whose expected close date has already passed.', open.filter(isOverdue)),
    make('parked', 'Parked (Ghosting or On hold)', 'Value sitting in stages that rarely convert without a deliberate re-engage.', open.filter(isParked)),
    make('noClose', 'No expected close date', 'Cannot be forecast or chased on time.', open.filter(o => !o.expectedClose)),
    make('noNext', 'No next step recorded', 'Nobody has committed to what happens next.', open.filter(o => !(o.nextStep || '').trim())),
    make('noProb', 'No win probability', 'Forecast under-counts these deals.', open.filter(o => !o.winProbability)),
    make('zeroPS', 'PS deals worth $0', 'Professional services deals with no value or FX rate set, so pipeline is understated.', open.filter(o => o.isPS && !o.valueUSD)),
  ];

  const atRiskList = open.filter(o => isStale(o) || isOverdue(o) || isParked(o));
  const atRisk = {
    count: atRiskList.length,
    value: sum(atRiskList, o => o.valueUSD),
    expected: sum(atRiskList, expectedValue),
    sample: top(atRiskList),
  };

  const lost12 = lostSince(opps, ago(now, 365));
  const reengage = lost12.filter(o => REENGAGE_REASONS.includes(o.reasonLost));
  const recoverable = {
    count: reengage.length,
    lostValue: sum(reengage, o => o.valueUSD),
    estimate: sum(reengage, o => o.valueUSD) * recoveryRate,
    sample: top(reengage),
    noReason: lost12.filter(o => !o.reasonLost).length,
  };

  return {
    checks,
    atRisk,
    recoverable,
    total: atRisk.expected + recoverable.estimate,
    recoveryRate,
  };
}

// ── Coaching ─────────────────────────────────────────────────────────
const COACH_TIPS = {
  rate: 'Review the last few lost deals together and tighten qualification before the demo stage.',
  cycle: 'Find where deals wait. Agree a dated next step at the end of every call.',
  stale: 'Run a 15 minute pipeline clean-up: re-engage or close out every deal untouched for 30 days.',
  missing: 'Fill the essentials today: value, hours and win probability.',
};

function namesOf(o, field) {
  return String(o[field] || '')
    .split(',')
    .map(s => s.trim())
    .filter(s => s && s !== 'Unassigned');
}

export function coaching(opps, field = 'sdr', now = new Date()) {
  const from = ago(now, 365);
  const staleCut = ago(now, STALE_DAYS);
  const people = new Map();
  const get = name => {
    if (!people.has(name)) people.set(name, { name, won: 0, lost: 0, wonValue: 0, cycles: [], open: 0, stale: 0, missing: 0, openExpected: 0 });
    return people.get(name);
  };

  for (const o of opps) {
    const names = namesOf(o, field);
    if (!names.length) continue;
    for (const n of names) {
      const p = get(n);
      if (o.isWon && o.actualClose && o.actualClose >= from) {
        p.won += 1; p.wonValue += o.valueUSD || 0; p.cycles.push(cycleDays(o));
      } else if (o.isLost && o.actualClose && o.actualClose >= from) {
        p.lost += 1;
      } else if (o.isOpen) {
        p.open += 1;
        p.openExpected += expectedValue(o);
        if (o.updatedAt && new Date(o.updatedAt) < staleCut) p.stale += 1;
        if (o.missingEssentials) p.missing += 1;
      }
    }
  }

  const rows = [...people.values()].map(p => ({
    ...p,
    closed: p.won + p.lost,
    rate: p.won + p.lost ? (p.won / (p.won + p.lost)) * 100 : null,
    cycle: avg(p.cycles),
  }));

  const eligible = rows.filter(r => r.closed >= MIN_CLOSED_FOR_COACHING);
  const teamClosed = eligible.reduce((s, r) => s + r.closed, 0);
  const team = {
    rate: teamClosed ? (eligible.reduce((s, r) => s + r.won, 0) / teamClosed) * 100 : null,
    cycle: avg(eligible.map(r => r.cycle)),
    people: eligible.length,
  };

  const out = rows.map(r => {
    const flags = [];
    if (r.closed >= MIN_CLOSED_FOR_COACHING && team.rate != null) {
      if (r.rate <= team.rate - 10) flags.push({ tone: 'warn', kind: 'rate', text: `Win rate ${fmtPct(r.rate)} vs team ${fmtPct(team.rate)}` });
      else if (r.rate >= team.rate + 10) flags.push({ tone: 'good', kind: 'rate', text: `Win rate ${fmtPct(r.rate)} vs team ${fmtPct(team.rate)}` });
      if (r.cycle != null && team.cycle != null && r.cycle >= team.cycle * 1.3) {
        flags.push({ tone: 'warn', kind: 'cycle', text: `${Math.round(r.cycle)} days to close vs team ${Math.round(team.cycle)}` });
      }
    }
    if (r.open >= 5 && r.stale / r.open >= 0.4) flags.push({ tone: 'warn', kind: 'stale', text: `${r.stale} of ${r.open} open deals untouched ${STALE_DAYS}+ days` });
    if (r.open >= 5 && r.missing / r.open >= 0.4) flags.push({ tone: 'warn', kind: 'missing', text: `Missing data on ${r.missing} of ${r.open} open deals` });
    const firstWarn = flags.find(f => f.tone === 'warn');
    return { ...r, flags, tip: firstWarn ? COACH_TIPS[firstWarn.kind] : null };
  });

  out.sort((a, b) => b.wonValue - a.wonValue);
  return { rows: out, team };
}
