// Team-wide patterns for managers, built from saved analyses (no extra AI cost).
// Input is a list of { call, analysis }. analysis.stats holds the transcript talk stats.
//
// Short calls are included: openers and early hang-ups are exactly what managers
// want to see. Only voicemail and phone menus are left out.

const { OBJECTION_LABELS, OPENER_LABELS, OPENER_DESCRIPTIONS, SENIORITY_LABELS } = require('./analysis');

const NON_HUMAN = new Set(['voicemail', 'automated_menu']);

const avg = (xs) => {
  const v = xs.filter((x) => Number.isFinite(x));
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
};
const rate = (a, b) => (b > 0 ? a / b : null);
const isBooked = (call) => call.tags.includes('MeetingBooked');
const stayed = (a) => a.openerResult === 'stayed_engaged';
const hungUp = (a) => a.openerResult === 'hung_up' || a.openerResult === 'brushed_off';
const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

function groupRate(items, keyFn, labelFn = (k) => k, limit = 8) {
  const groups = new Map();
  for (const it of items) {
    const key = keyFn(it);
    if (!key) continue;
    const g = groups.get(key) || { key, calls: 0, booked: 0 };
    g.calls += 1;
    if (isBooked(it.call)) g.booked += 1;
    groups.set(key, g);
  }
  return [...groups.values()]
    .map((g) => ({ label: labelFn(g.key), calls: g.calls, booked: g.booked, bookedRate: rate(g.booked, g.calls) }))
    .sort((a, b) => b.booked - a.booked || b.calls - a.calls)
    .slice(0, limit);
}

// Best examples first: the call booked, then the prospect stayed, then a next step was secured.
const successScore = (p) => Number(isBooked(p.call)) * 4 + Number(stayed(p.analysis)) * 2 + Number(p.analysis.nextStepSecured);

function buildTrends(pairs) {
  const human = pairs.filter((p) => p.analysis && !NON_HUMAN.has(p.analysis.callType));
  const real = human.filter((p) => p.analysis.coachable);
  const booked = human.filter((p) => isBooked(p.call));

  // ---- objections ----
  const objections = human.flatMap((p) => (p.analysis.objections || []).map((o) => ({ ...o, pair: p })));
  const byCat = new Map();
  for (const o of objections) {
    const g = byCat.get(o.category) || { category: o.category, items: [] };
    g.items.push(o);
    byCat.set(o.category, g);
  }
  const catSummary = (category, items) => ({
    category,
    label: OBJECTION_LABELS[category] || category,
    count: items.length,
    handledWell: items.filter((o) => o.handled === 'well').length,
    handledPoorly: items.filter((o) => o.handled === 'poorly').length,
    bookedAfter: items.filter((o) => isBooked(o.pair.call)).length,
    stayedAfter: items.filter((o) => stayed(o.pair.analysis)).length,
    hungUpAfter: items.filter((o) => hungUp(o.pair.analysis)).length,
  });
  const bestExamples = (items, n = 2) => items
    .filter((o) => o.handled === 'well' && o.responseQuote)
    .sort((a, b) => successScore(b.pair) - successScore(a.pair))
    .slice(0, n)
    .map((o) => ({
      sdrName: o.pair.call.sdrName,
      stage: o.stage,
      quote: o.quoteEn || o.quote,
      response: o.responseQuoteEn || o.responseQuote,
      why: o.why,
      booked: isBooked(o.pair.call),
      stayed: stayed(o.pair.analysis),
      startedAt: o.pair.call.startedAt,
      callId: o.pair.call.id,
    }));

  const topObjections = [...byCat.values()]
    .map((g) => ({
      ...catSummary(g.category, g.items),
      share: rate(g.items.length, objections.length),
      examples: g.items.slice(0, 2).map((o) => ({ quote: o.quoteEn || o.quote, sdrName: o.pair.call.sdrName })),
    }))
    .sort((a, b) => b.count - a.count);

  const bestHandling = topObjections.slice(0, 5)
    .map((t) => ({ category: t.category, label: t.label, examples: bestExamples(byCat.get(t.category).items) }))
    .filter((b) => b.examples.length);

  // Objections that came up in the opening seconds: the ones that decide whether the call survives.
  const early = objections.filter((o) => o.stage === 'opener');
  const earlyByCat = new Map();
  for (const o of early) {
    const g = earlyByCat.get(o.category) || { category: o.category, items: [] };
    g.items.push(o);
    earlyByCat.set(o.category, g);
  }
  const earlyObjections = [...earlyByCat.values()]
    .map((g) => ({ ...catSummary(g.category, g.items), examples: bestExamples(g.items) }))
    .sort((a, b) => b.count - a.count);

  // ---- how calls open, and who stays ----
  const styles = [...new Set(human.map((p) => p.analysis.opener?.style).filter(Boolean))];
  const openers = styles.map((style) => {
    const group = human.filter((p) => p.analysis.opener?.style === style);
    const quoteOf = (p) => (p.analysis.opener?.quote ? { quote: p.analysis.opener.quoteEn || p.analysis.opener.quote, sdrName: p.call.sdrName } : null);
    return {
      style,
      label: OPENER_LABELS[style] || style,
      description: OPENER_DESCRIPTIONS[style] || null,
      calls: group.length,
      stayed: group.filter((p) => stayed(p.analysis)).length,
      stayedRate: rate(group.filter((p) => stayed(p.analysis)).length, group.length),
      hungUp: group.filter((p) => hungUp(p.analysis)).length,
      hungUpRate: rate(group.filter((p) => hungUp(p.analysis)).length, group.length),
      booked: group.filter((p) => isBooked(p.call)).length,
      bookedRate: rate(group.filter((p) => isBooked(p.call)).length, group.length),
      nextStepRate: rate(group.filter((p) => p.analysis.nextStepSecured).length, group.length),
      stayExamples: group.filter((p) => stayed(p.analysis)).sort((a, b) => successScore(b) - successScore(a)).map(quoteOf).filter(Boolean).slice(0, 2),
      hangUpExamples: group.filter((p) => hungUp(p.analysis)).map(quoteOf).filter(Boolean).slice(0, 2),
    };
  }).sort((a, b) => b.calls - a.calls);

  // ---- hang-ups ----
  const hangs = human.filter((p) => hungUp(p.analysis));
  const reasonMap = new Map();
  for (const p of hangs) {
    const first = (p.analysis.objections || [])[0];
    const key = first ? first.category : 'no_objection_given';
    const g = reasonMap.get(key) || { category: key, count: 0, examples: [] };
    g.count += 1;
    if (first && g.examples.length < 2) g.examples.push({ quote: first.quoteEn || first.quote, sdrName: p.call.sdrName, opener: p.analysis.opener?.quoteEn || p.analysis.opener?.quote || null });
    reasonMap.set(key, g);
  }
  const hangups = {
    count: hangs.length,
    share: rate(hangs.length, human.length),
    reasons: [...reasonMap.values()]
      .map((g) => ({ ...g, label: g.category === 'no_objection_given' ? 'Hung up without saying why' : OBJECTION_LABELS[g.category] || g.category }))
      .sort((a, b) => b.count - a.count),
  };

  // ---- who is being booked ----
  const profile = {
    bySeniority: groupRate(human, (p) => p.analysis.prospect?.seniority, (k) => SENIORITY_LABELS[k] || k),
    byIndustry: groupRate(human, (p) => norm(p.analysis.prospect?.industry)),
    bookedRoles: (() => {
      const m = new Map();
      for (const p of booked) {
        const r = norm(p.analysis.prospect?.role);
        if (r) m.set(r, (m.get(r) || 0) + 1);
      }
      return [...m.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count).slice(0, 8);
    })(),
  };

  const talk = (group) => ({
    calls: group.length,
    avgSdrShare: avg(group.map((p) => p.analysis.stats?.sdrShare)),
    avgQuestions: avg(group.map((p) => p.analysis.stats?.sdrQuestions)),
    avgLongestSdrTurnWords: avg(group.map((p) => p.analysis.stats?.longestSdrTurnWords)),
    avgDurationMin: avg(group.map((p) => p.call.durationMin)),
  });

  // ---- by SDR ----
  const sdrMap = new Map();
  for (const p of human) {
    const k = p.call.sdrId || `name:${p.call.sdrName}`;
    const g = sdrMap.get(k) || { id: p.call.sdrId, name: p.call.sdrName, items: [] };
    g.items.push(p);
    sdrMap.set(k, g);
  }
  const sdrs = [...sdrMap.values()].map((g) => {
    const objs = g.items.flatMap((p) => p.analysis.objections || []);
    return {
      id: g.id,
      name: g.name,
      analysedCalls: g.items.length,
      booked: g.items.filter((p) => isBooked(p.call)).length,
      stayedRate: rate(g.items.filter((p) => stayed(p.analysis)).length, g.items.length),
      nextStepRate: rate(g.items.filter((p) => p.analysis.nextStepSecured).length, g.items.length),
      objectionsHandledWellRate: rate(objs.filter((o) => o.handled === 'well').length, objs.length),
      avgCraft: avg(g.items.filter((p) => p.analysis.coachable).flatMap((p) => Object.values(p.analysis.craft || {}).map((c) => c.score))),
    };
  }).sort((a, b) => b.booked - a.booked || b.analysedCalls - a.analysedCalls);

  return {
    analysedCalls: human.length,
    coachableCalls: real.length,
    bookedCalls: booked.length,
    objectionCount: objections.length,
    topObjections,
    bestHandling,
    earlyObjections,
    openers,
    hangups,
    profile,
    talk: { booked: talk(booked), notBooked: talk(human.filter((p) => !isBooked(p.call))) },
    sdrs,
  };
}

// The team patterns, with nothing that points at an individual: no names, no IDs, no link back to
// a particular call, and no SDR-by-SDR comparison. Short example quotes stay, because seeing what
// works is the point, but they cannot be traced to a person or opened as a transcript.
const PEOPLE_KEYS = new Set(['sdrName', 'sdrId', 'callId', 'startedAt', 'sdrs']);

function forEveryone(value) {
  if (Array.isArray(value)) return value.map(forEveryone);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([k]) => !PEOPLE_KEYS.has(k)).map(([k, v]) => [k, forEveryone(v)]));
  }
  return value;
}

module.exports = { buildTrends, forEveryone };
