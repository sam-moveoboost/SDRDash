// Team-wide patterns for managers, built from saved analyses (no extra AI cost).
// Input is a list of { call, analysis, stats } where stats are the transcript talk stats.

const { OBJECTION_LABELS, OPENER_LABELS, SENIORITY_LABELS } = require('./analysis');

const avg = (xs) => {
  const v = xs.filter((x) => Number.isFinite(x));
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
};
const rate = (a, b) => (b > 0 ? a / b : null);
const isBooked = (call) => call.tags.includes('MeetingBooked');
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

function buildTrends(pairs) {
  const real = pairs.filter((p) => p.analysis && p.analysis.coachable && p.analysis.callType !== 'not_a_conversation');
  const booked = real.filter((p) => isBooked(p.call));

  // ---- objections ----
  const objections = real.flatMap((p) => (p.analysis.objections || []).map((o) => ({ ...o, call: p.call, analysis: p.analysis })));
  const byCat = new Map();
  for (const o of objections) {
    const g = byCat.get(o.category) || { category: o.category, items: [] };
    g.items.push(o);
    byCat.set(o.category, g);
  }
  const topObjections = [...byCat.values()]
    .map((g) => ({
      category: g.category,
      label: OBJECTION_LABELS[g.category] || g.category,
      count: g.items.length,
      share: rate(g.items.length, objections.length),
      handledWell: g.items.filter((o) => o.handled === 'well').length,
      handledPoorly: g.items.filter((o) => o.handled === 'poorly').length,
      bookedAfter: g.items.filter((o) => isBooked(o.call)).length,
      examples: g.items.slice(0, 2).map((o) => ({ quote: o.quote, sdrName: o.call.sdrName })),
    }))
    .sort((a, b) => b.count - a.count);

  // The best answers: handled well, with the SDR's own words, preferring calls that went on to book.
  const bestHandling = topObjections.slice(0, 5).map((t) => {
    const items = (byCat.get(t.category)?.items || [])
      .filter((o) => o.handled === 'well' && o.responseQuote)
      .sort((a, b) => Number(isBooked(b.call)) - Number(isBooked(a.call)) || Number(b.analysis.nextStepSecured) - Number(a.analysis.nextStepSecured));
    return {
      category: t.category,
      label: t.label,
      examples: items.slice(0, 2).map((o) => ({
        sdrName: o.call.sdrName,
        quote: o.quote,
        response: o.responseQuote,
        why: o.why,
        booked: isBooked(o.call),
        startedAt: o.call.startedAt,
        callId: o.call.id,
      })),
    };
  }).filter((b) => b.examples.length);

  // ---- who is being booked ----
  const profile = {
    bySeniority: groupRate(real, (p) => p.analysis.prospect?.seniority, (k) => SENIORITY_LABELS[k] || k),
    byIndustry: groupRate(real, (p) => norm(p.analysis.prospect?.industry)),
    bookedRoles: (() => {
      const m = new Map();
      for (const p of booked) {
        const r = norm(p.analysis.prospect?.role);
        if (r) m.set(r, (m.get(r) || 0) + 1);
      }
      return [...m.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count).slice(0, 8);
    })(),
  };

  // ---- how the outreach sounded ----
  const openers = [...new Set(real.map((p) => p.analysis.opener?.style).filter(Boolean))].map((style) => {
    const group = real.filter((p) => p.analysis.opener?.style === style);
    const gBooked = group.filter((p) => isBooked(p.call));
    return {
      style,
      label: OPENER_LABELS[style] || style,
      calls: group.length,
      booked: gBooked.length,
      bookedRate: rate(gBooked.length, group.length),
      nextStepRate: rate(group.filter((p) => p.analysis.nextStepSecured).length, group.length),
      examples: gBooked.filter((p) => p.analysis.opener?.quote).slice(0, 2).map((p) => ({ quote: p.analysis.opener.quote, sdrName: p.call.sdrName })),
    };
  }).sort((a, b) => b.calls - a.calls);

  const talk = (group) => ({
    calls: group.length,
    avgSdrShare: avg(group.map((p) => p.stats?.sdrShare)),
    avgQuestions: avg(group.map((p) => p.stats?.sdrQuestions)),
    avgLongestSdrTurnWords: avg(group.map((p) => p.stats?.longestSdrTurnWords)),
    avgDurationMin: avg(group.map((p) => p.call.durationMin)),
  });
  const notBooked = real.filter((p) => !isBooked(p.call));

  // ---- by SDR ----
  const sdrMap = new Map();
  for (const p of real) {
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
      nextStepRate: rate(g.items.filter((p) => p.analysis.nextStepSecured).length, g.items.length),
      objectionsHandledWellRate: rate(objs.filter((o) => o.handled === 'well').length, objs.length),
      avgCraft: avg(g.items.flatMap((p) => Object.values(p.analysis.craft || {}).map((c) => c.score))),
    };
  }).sort((a, b) => b.booked - a.booked || b.analysedCalls - a.analysedCalls);

  return {
    analysedCalls: real.length,
    bookedCalls: booked.length,
    objectionCount: objections.length,
    topObjections,
    bestHandling,
    profile,
    openers,
    talk: { booked: talk(booked), notBooked: talk(notBooked) },
    sdrs,
  };
}

module.exports = { buildTrends };
