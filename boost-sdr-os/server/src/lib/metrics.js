// Numbers for every call (not just transcribed ones), so history before the
// transcript change still counts.

const { CONVERSATION_MINUTES } = require('./config');

const round = (n, dp = 1) => (Number.isFinite(n) ? Math.round(n * 10 ** dp) / 10 ** dp : null);
const pct = (a, b) => (b > 0 ? a / b : null);

function weekStart(iso) {
  const d = new Date(String(iso).replace(' ', 'T') + (String(iso).includes('T') ? '' : 'Z'));
  if (Number.isNaN(d.getTime())) return null;
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

function statsFor(calls) {
  const outbound = calls.filter((c) => c.direction === 'outbound');
  const answered = outbound.filter((c) => /\banswered\b/i.test(c.outcome));
  const conversations = outbound.filter((c) => (c.durationMin ?? 0) > CONVERSATION_MINUTES);
  const booked = calls.filter((c) => c.tags.includes('MeetingBooked'));
  const convMinutes = conversations.reduce((s, c) => s + c.durationMin, 0);

  const tagCounts = {};
  for (const c of calls) for (const t of c.tags) tagCounts[t] = (tagCounts[t] || 0) + 1;
  const outcomeCounts = {};
  for (const c of calls) {
    const o = c.outcome || 'Unknown';
    outcomeCounts[o] = (outcomeCounts[o] || 0) + 1;
  }

  const weeks = new Map();
  for (const c of calls) {
    const w = weekStart(c.startedAt);
    if (!w) continue;
    const row = weeks.get(w) || { week: w, calls: 0, conversations: 0, booked: 0 };
    row.calls += 1;
    if (c.direction === 'outbound' && (c.durationMin ?? 0) > CONVERSATION_MINUTES) row.conversations += 1;
    if (c.tags.includes('MeetingBooked')) row.booked += 1;
    weeks.set(w, row);
  }

  return {
    calls: calls.length,
    outbound: outbound.length,
    answered: answered.length,
    conversations: conversations.length,
    meetingsBooked: booked.length,
    connectRate: round(pct(answered.length, outbound.length), 3),
    conversationRate: round(pct(conversations.length, outbound.length), 3),
    bookingRate: round(pct(booked.length, conversations.length), 3),
    avgConversationMin: round(conversations.length ? convMinutes / conversations.length : null),
    talkMinutes: round(convMinutes, 0),
    tags: tagCounts,
    outcomes: outcomeCounts,
    weekly: [...weeks.values()].sort((a, b) => a.week.localeCompare(b.week)),
  };
}

function bySdr(calls) {
  const groups = new Map();
  for (const c of calls) {
    const key = c.sdrId || `name:${c.sdrName}`;
    const g = groups.get(key) || { id: c.sdrId, name: c.sdrName, calls: [] };
    g.calls.push(c);
    groups.set(key, g);
  }
  return [...groups.values()]
    .map((g) => ({ id: g.id, name: g.name, ...statsFor(g.calls) }))
    .sort((a, b) => b.calls - a.calls);
}

module.exports = { statsFor, bySdr, weekStart };
