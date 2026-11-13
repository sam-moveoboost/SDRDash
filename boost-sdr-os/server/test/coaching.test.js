const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.MONDAY_CLIENT_SECRET = 'test-client-secret';

const { createRouter } = require('../src/routes/coaching');
const { parseTranscript } = require('../src/lib/transcript');
const { validate } = require('../src/lib/analysis');
const { statsFor } = require('../src/lib/metrics');
const { buildTrends } = require('../src/lib/trends');
const { summarise } = require('../src/lib/focus');

const SAM = '97429928'; // admin
const LUKE = '111'; // SDR
const EMAD = '222'; // SDR

const token = (userId, secret = 'test-client-secret') => jwt.sign({ dat: { user_id: userId } }, secret, { expiresIn: '5m' });

// A real conversation.
const sdrLine = 'Hi, it is Luke from boost, we help teams get more out of monday.com and I wanted to ask how you currently run your sales pipeline today and who looks after it';
const prospectLine = 'We use spreadsheets mostly, and honestly it is a mess, our boss wants it sorted but we are really busy right now with the quarter end';
const convo = (agent) => `Call ID: CA1\n\nCall Transcription:\n${Array.from({ length: 5 }, () => `+447000000001 Aircall new contact: ${prospectLine}\n${agent}: ${sdrLine}`).join('\n')}`;

// A short hang-up: well under a minute, but over 250 characters.
const SHORT = 'Call ID: CA2\n\nCall Transcription:\nLuke Birchley: Hi, is that Jo? It is Luke calling from boost, we help companies get more out of monday.com and I was hoping to grab a quick minute of your time.\n+447000000002 Aircall new contact: We do not take sales calls, please take us off your list.\nLuke Birchley: Of course, sorry to bother you, have a good day.\n+447000000002 Aircall new contact: Bye.';
const TINY = 'Call ID: CA3\n\nCall Transcription:\nLuke Birchley: Hello?\n+447000000003 Aircall new contact: Hi.';

const NOT_CONNECTED = ['1.NoAnswer', '3.Busy', 'LeftVoicemail', 'BadData'];
const mkCall = (o) => {
  const c = {
    callId: null, sdrId: LUKE, sdrName: 'Luke Birchley', agentName: 'Luke Birchley', direction: 'outbound',
    outcome: 'Outbound answered', answered: true, tags: [], durationMin: 3, recordingUrl: null, coachingStatus: null, ...o,
  };
  // The same rules the real parser applies.
  c.noConnectionTag = c.tags.some((t) => NOT_CONNECTED.includes(t));
  c.connected = c.answered && c.tags.length > 0 && !c.noConnectionTag;
  return c;
};
const fixtures = () => [
  mkCall({ id: '1', createdAt: '2026-11-02T14:00:00Z', startedAt: '2026-11-02 14:00', tags: ['MeetingBooked'], durationMin: 5 }),
  mkCall({ id: '2', createdAt: '2026-11-02T15:00:00Z', startedAt: '2026-11-02 15:00', sdrId: EMAD, sdrName: 'Emad Mahamid', agentName: 'Emad Mahamid', durationMin: 4 }),
  mkCall({ id: '3', createdAt: '2026-11-02T16:00:00Z', startedAt: '2026-11-02 16:00', durationMin: 0 }), // short hang-up
  mkCall({ id: '4', createdAt: '2026-11-02T17:00:00Z', startedAt: '2026-11-02 17:00', outcome: 'Outbound unanswered', answered: false, durationMin: null }),
  mkCall({ id: '5', createdAt: '2026-10-30T10:00:00Z', startedAt: '2026-10-30 10:00' }), // before the 1 November line
  mkCall({ id: '6', createdAt: '2026-11-03T09:00:00Z', startedAt: '2026-11-03 09:00', durationMin: 0 }), // transcript too short
  mkCall({ id: '7', createdAt: '2026-11-03T10:00:00Z', startedAt: '2026-11-03 10:00', tags: ['1.NoAnswer'], durationMin: 0 }), // answered per Aircall, but a voicemail
];
const RAW = { 7: SHORT, 1: convo('Luke Birchley'), 2: convo('Emad Mahamid'), 3: SHORT, 4: SHORT, 5: convo('Luke Birchley'), 6: TINY };

function makeDeps({ persist = true, claudeFails = false, claudePingFails = false } = {}) {
  const calls = fixtures();
  const saved = new Map();
  const log = { analysed: [], marked: [], windows: [] };
  return {
    log,
    calls,
    deps: {
      mondayApi: {
        fetchCalls: async (since) => { log.windows.push(since); return calls; },
        fetchCall: async (id) => calls.find((c) => c.id === id) ?? null,
        ping: async () => {},
        fetchTranscripts: async (ids) => Object.fromEntries(ids.filter((id) => RAW[id]).map((id) => [id, RAW[id]])),
        markAnalysed: async (id) => { log.marked.push(id); calls.find((c) => c.id === id).coachingStatus = 'Analysed'; },
      },
      analysis: {
        ping: async () => { if (claudePingFails) throw new Error('Claude did not answer within 15 seconds'); },
        analyseCall: async ({ call }) => {
          if (claudeFails) throw new Error('Claude API HTTP 529');
          log.analysed.push(call.id);
          return { callType: 'conversation', language: 'English', coachable: true, openerResult: 'stayed_engaged', nextStepSecured: true, meddpicc: {}, craft: {}, objections: [] };
        },
      },
      store: {
        getAnalysis: async (id) => saved.get(id) ?? null,
        saveAnalysis: async (id, a) => { if (persist) saved.set(id, a); return persist; },
        mapLimit: async (items, _l, fn) => Promise.all(items.map(fn)),
        selfTest: async () => [{ name: 'Saving analyses: fake', ok: persist, ms: 1, ...(persist ? {} : { error: 'the read gave back nothing' }) }],
      },
    },
  };
}

async function withServer(opts, fn) {
  if (typeof opts === 'function') { fn = opts; opts = {}; }
  const ctx = makeDeps(opts);
  const app = express();
  app.use('/coaching', createRouter(ctx.deps, { now: () => Date.parse('2026-11-04T12:00:00Z') }));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}/coaching`;
  const call = (path, userId, init = {}) =>
    fetch(base + path, { ...init, headers: { ...(userId ? { Authorization: `Bearer ${token(userId)}` } : {}), 'content-type': 'application/json' } });
  const json = async (path, userId, init) => (await call(path, userId, init)).json();
  try {
    await fn({ call, json, base, ...ctx });
  } finally {
    server.close();
  }
}

test('no token, a bad token and a token signed with the wrong secret are all refused', async () => {
  await withServer(async ({ call, base }) => {
    assert.equal((await call('/overview')).status, 401);
    assert.equal((await fetch(`${base}/overview`, { headers: { Authorization: 'Bearer nonsense' } })).status, 401);
    assert.equal((await fetch(`${base}/overview`, { headers: { Authorization: `Bearer ${token(SAM, 'wrong-secret')}` } })).status, 401);
  });
});

test('an SDR only ever sees their own calls and cannot ask for anyone else', async () => {
  await withServer(async ({ call, json }) => {
    const mine = await json('/overview', LUKE);
    assert.equal(mine.stats.calls, 6); // Luke's six calls, not Emad's
    assert.deepEqual(mine.team, []);
    assert.deepEqual(mine.sdrs, []);

    assert.equal((await call(`/overview?userId=${EMAD}`, LUKE)).status, 403);
    assert.equal((await call('/overview?userId=all', LUKE)).status, 403);
    assert.equal((await call(`/calls?userId=${EMAD}`, LUKE)).status, 403);

    const list = await json('/calls', LUKE);
    assert.ok(list.calls.every((c) => c.sdrId === LUKE));
    assert.deepEqual(list.coverage, []); // coverage is for managers
  });
});

test('admins see the whole team and can pick one SDR', async () => {
  await withServer(async ({ json }) => {
    const all = await json('/overview', SAM);
    assert.equal(all.stats.calls, 7);
    assert.equal(all.team.length, 2);
    assert.equal(all.sdrs.length, 2);
    assert.equal((await json(`/overview?userId=${EMAD}`, SAM)).stats.calls, 1);
  });
});

test('unanswered calls do not count as answered', async () => {
  await withServer(async ({ json }) => {
    const mine = await json('/overview', LUKE);
    assert.equal(mine.stats.outbound, 6);
    assert.equal(mine.stats.answered, 5); // the unanswered call is not counted
  });
});

test('a voicemail pick-up is answered per Aircall but is not a real connection', async () => {
  await withServer(async ({ json }) => {
    const { stats } = await json('/overview', LUKE);
    assert.equal(stats.answered, 5);
    // Only call 1 is tagged as a real outcome. Call 7 is tagged 1.NoAnswer, and calls 3, 5 and 6 are untagged.
    assert.equal(stats.connected, 1);
    assert.equal(stats.untaggedAnswered, 3);
    assert.ok(stats.connectRate < stats.answeredRate);
  });
});

test('the list is answered calls since 1 November with a transcript of 250+ characters, whatever their length', async () => {
  await withServer(async ({ json }) => {
    const list = await json('/calls', LUKE);
    const ids = list.calls.map((c) => c.id).sort();
    // 1 = conversation, 3 = short hang-up (0 minutes, still included).
    // 4 unanswered, 5 before 1 Nov, 6 under 250 characters and 7 tagged 1.NoAnswer are all left out.
    assert.deepEqual(ids, ['1', '3']);
    assert.equal(list.waitingCount, 2);
    assert.equal(list.rules.minChars, 250);
  });
});

test('managers see which SDRs have transcripts', async () => {
  await withServer(async ({ json }) => {
    const { coverage } = await json('/calls', SAM);
    const luke = coverage.find((c) => c.sdrId === LUKE);
    const emad = coverage.find((c) => c.sdrId === EMAD);
    assert.deepEqual([luke.answered, luke.withTranscript], [3, 2]); // calls 1, 3, 6 are candidates; 1 and 3 have usable transcripts
    assert.deepEqual([emad.answered, emad.withTranscript], [1, 1]);
  });
});

test('analysing saves the result, marks the call, and it is not picked up again', async () => {
  await withServer(async ({ json, log }) => {
    const post = (ids, who = LUKE) => json('/analyse', who, { method: 'POST', body: JSON.stringify({ ids }) });

    const first = await post(['3']); // the short hang-up
    assert.equal(first.results[0].saved, true);
    assert.equal(first.results[0].marked, true);
    assert.deepEqual(log.analysed, ['3']);
    assert.deepEqual(log.marked, ['3']);

    const list = await json('/calls', LUKE);
    assert.equal(list.calls.find((c) => c.id === '3').status, 'analysed');
    assert.equal(list.waitingCount, 1); // only call 1 is left

    await post(['3']); // asking again must not spend anything
    assert.deepEqual(log.analysed, ['3']);
  });
});

test('a call is not marked as analysed if its analysis could not be saved permanently', async () => {
  await withServer({ persist: false }, async ({ json, log }) => {
    const res = await json('/analyse', LUKE, { method: 'POST', body: JSON.stringify({ ids: ['1'] }) });
    assert.equal(res.results[0].saved, false);
    assert.equal(res.results[0].marked, false);
    assert.deepEqual(log.marked, []);
  });
});

test('only eligible calls can be analysed, and never someone else\'s', async () => {
  await withServer(async ({ json, log }) => {
    const res = await json('/analyse', LUKE, { method: 'POST', body: JSON.stringify({ ids: ['2', '4', '5', '6', '7'] }) });
    const by = Object.fromEntries(res.results.map((r) => [r.id, r.error]));
    assert.equal(by['2'], 'not_found'); // Emad's call
    assert.equal(by['4'], 'not_found'); // unanswered
    assert.equal(by['5'], 'not_found'); // before 1 November
    assert.equal(by['6'], 'too_short'); // under 250 characters
    assert.equal(by['7'], 'not_found'); // tagged 1.NoAnswer, so a voicemail
    assert.deepEqual(log.analysed, []); // nothing was spent
  });
});

test('transcripts never expose prospect phone numbers and other SDRs cannot read them', async () => {
  await withServer(async ({ call, json }) => {
    assert.equal((await call('/calls/2/transcript', LUKE)).status, 404);
    const body = JSON.stringify(await json('/calls/1/transcript', LUKE));
    assert.ok(!body.includes('+447000000001'));
  });
});

test('trends are for managers only', async () => {
  await withServer(async ({ call }) => {
    assert.equal((await call('/trends', LUKE)).status, 403);
    assert.equal((await call(`/trends?userId=${LUKE}`, LUKE)).status, 403);
    assert.equal((await call('/trends', SAM)).status, 200);
  });
});

test('parses the real English gatekeeper call', () => {
  const raw = `Call ID: CAaf4\n\nCall Transcription:\n+448006335050 Aircall new contact: Total sales. Alex speaking.\nSam Fessey: Hi there. Sorry. Is is Jake available today at all?\n+448006335050 Aircall new contact: Who's sorry?\nSam Fessey: Jake Tibble?\n+448006335050 Aircall new contact: I can try and see if he's available.\nSam Fessey: Yeah. It's Sam Fessi from Boost regardingmonday.com.\n+448006335050 Aircall new contact: No worries. One moment, please.\nSam Fessey: Thanks, mate. Thank you.\n+448006335050 Aircall new contact: Unfortunately, I can't get ahold of him.\nSam Fessey: Okay. No stress.\n+448006335050 Aircall new contact: Bye\nSam Fessey: Bye.`;
  const parsed = parseTranscript(raw, 'Sam Fessey');
  assert.equal(parsed.turns[0].who, 'prospect');
  assert.equal(parsed.turns[1].who, 'sdr');
  assert.equal(parsed.stats.hasConversation, false);
  assert.ok(parsed.stats.chars >= 250); // long enough to be analysed (the model will call it a gatekeeper)
});

test('a line with a colon inside it stays part of the same turn', () => {
  const parsed = parseTranscript('Call Transcription:\nSam Fessey: Here is the thing: it works\n+441 Aircall new contact: ok', 'Sam Fessey');
  assert.equal(parsed.turns.length, 2);
  assert.match(parsed.turns[0].text, /the thing: it works/);
});

test('quotes the model made up are dropped, real ones kept, and short-call fields are read', () => {
  const turns = [{ who: 'sdr', text: 'Hi is that Jo, I was hoping for a quick minute of your time.' }, { who: 'prospect', text: 'We do not take sales calls, please take us off your list.' }];
  const out = validate({
    call_type: 'early_hangup',
    coachable: false,
    opener_result: 'hung_up',
    ended_by: 'prospect',
    meddpicc: { identify_pain: { score: 2, evidence: 'We do not take sales calls' }, champion: { score: 2, evidence: 'I will champion this internally for you' } },
    opener: { style: 'permission_based', quote: 'I was hoping for a quick minute of your time', note: 'x' },
    objections: [
      { category: 'not_interested', stage: 'opener', quote: 'We do not take sales calls, please take us off your list.', response_quote: '', handled: 'poorly', why: 'no reply' },
      { category: 'no_budget', stage: 'middle', quote: 'We have absolutely no budget at all', response_quote: 'Understood', handled: 'poorly', why: 'made up' },
    ],
    best_moment: { quote: 'a sentence that was never said on the call', why: 'x' },
  }, turns);
  assert.equal(out.callType, 'early_hangup');
  assert.equal(out.coachable, false);
  assert.equal(out.openerResult, 'hung_up');
  assert.equal(out.opener.quote, 'I was hoping for a quick minute of your time');
  assert.equal(out.meddpicc.champion.evidence, null);
  assert.equal(out.objections.length, 1);
  assert.equal(out.objections[0].stage, 'opener');
  assert.equal(out.bestMoment, null);
});

test('metrics count conversations and meetings booked', () => {
  const s = statsFor(fixtures());
  assert.equal(s.meetingsBooked, 1);
  assert.equal(s.conversations, 1); // only call 1 is both connected (tagged) and over a minute
});

test('focus areas need enough coachable calls, and short calls do not count against anyone', () => {
  const a = { coachable: true, callType: 'conversation', nextStepSecured: false, meddpicc: { identify_pain: { score: 2 } }, craft: { opening: { score: 4 }, next_step_ask: { score: 1 } } };
  const hangup = { coachable: false, callType: 'early_hangup', meddpicc: {}, craft: {} };
  assert.equal(summarise([a, a, hangup, hangup]).focus.length, 0);
  const s = summarise([a, a, a, hangup]);
  assert.equal(s.analysedCalls, 3);
  assert.equal(s.focus[0].key, 'next_step_ask');
});

test('trends cover hang-ups, openers and early objections, and leave out voicemail', () => {
  const mk = (id, sdrName, tags, a) => ({
    call: { id, sdrId: id, sdrName, tags, durationMin: 1, startedAt: '2026-11-02 10:00' },
    analysis: { coachable: false, callType: 'early_hangup', nextStepSecured: false, craft: {}, prospect: { seniority: 'unknown' }, objections: [], openerResult: 'hung_up', opener: { style: 'direct_pitch', quote: 'We help teams with monday.com' }, ...a },
  });
  const earlyObj = (handled, responseQuote) => [{ category: 'not_interested', stage: 'opener', quote: 'Not interested thanks', responseQuote, handled, why: 'x' }];
  const t = buildTrends([
    mk('1', 'Luke', ['MeetingBooked'], { coachable: true, callType: 'conversation', openerResult: 'stayed_engaged', nextStepSecured: true, opener: { style: 'permission_based', quote: 'Got a minute?' }, objections: earlyObj('well', 'Fair enough, can I ask one quick question?') }),
    mk('2', 'Emad', [], { objections: earlyObj('poorly', null) }),
    mk('3', 'Sam F', [], { callType: 'voicemail', openerResult: 'unclear' }),
  ]);
  assert.equal(t.analysedCalls, 2); // the voicemail is left out
  assert.equal(t.hangups.count, 1);
  assert.equal(t.openers.find((o) => o.style === 'permission_based').stayedRate, 1);
  assert.equal(t.openers.find((o) => o.style === 'direct_pitch').hungUpRate, 1);
  assert.equal(t.earlyObjections[0].count, 2);
  assert.equal(t.earlyObjections[0].examples[0].sdrName, 'Luke'); // the one that worked
  assert.equal(t.bestHandling[0].examples[0].stayed, true);
});

test('parses a call exactly as the monday API returns it, including the new status column', () => {
  const { parseCall } = require('../src/lib/mondayApi');
  const call = parseCall({
    id: '3325335355',
    created_at: '2026-11-02T14:57:03Z',
    column_values: [
      { id: 'multiple_person_mm2cff2x', text: 'Luke Birchley', persons_and_teams: [{ id: '104304092', kind: 'person' }] },
      { id: 'text_mm19p3gx', text: 'Outbound answered' },
      { id: 'text_mm195peh', text: 'outbound' },
      { id: 'text_mm19wwhm', text: 'Luke Birchley' },
      { id: 'tag_mm193gqc', text: 'MeetingBooked, FollowUpCall' },
      { id: 'date_mm19a9qc', text: '2026-11-02 14:56' },
      { id: 'date_mm19artx', text: '2026-11-02 14:56' },
      { id: 'date_mm19jrq', text: '2026-11-02 15:07' },
      { id: 'link_mm19c866', text: 'Recording - https://assets.aircall.io/calls/4300550213/recording' },
      { id: 'color_mm8sjkwt', text: 'Analysed' },
    ],
  });
  assert.equal(call.sdrId, '104304092');
  assert.equal(call.durationMin, 11);
  assert.equal(call.answered, true);
  assert.equal(call.coachingStatus, 'Analysed');
  assert.deepEqual(call.tags, ['MeetingBooked', 'FollowUpCall']);

  const missed = parseCall({ id: '1', created_at: '2026-11-02T14:57:03Z', column_values: [{ id: 'text_mm19p3gx', text: 'Outbound unanswered' }] });
  assert.equal(missed.answered, false);
  assert.equal(call.connected, true); // answered and tagged with a real outcome

  const row = (tags, outcome = 'Outbound answered') => parseCall({ id: '9', created_at: '2026-11-02T14:57:03Z', column_values: [{ id: 'text_mm19p3gx', text: outcome }, { id: 'tag_mm193gqc', text: tags }] });
  assert.equal(row('1.NoAnswer').connected, false); // a voicemail Aircall calls answered
  assert.equal(row('1.NoAnswer').noConnectionTag, true);
  assert.equal(row('LeftVoicemail').connected, false);
  assert.equal(row('Gatekeeper').connected, true); // a human picked up
  assert.equal(row('').connected, false); // answered but not tagged yet
  assert.equal(row('').noConnectionTag, false);
  assert.equal(missed.coachingStatus, null);
});

test('the Claude call sends the right request and copes with fenced JSON', async () => {
  const { analyseCall } = require('../src/lib/analysis');
  const turns = [{ who: 'prospect', text: 'Just send me an email please.' }, { who: 'sdr', text: 'Happy to, what would make it worth reading?' }];
  const reply = { call_type: 'conversation', coachable: true, opener_result: 'stayed_engaged', next_step_secured: false, meddpicc: {}, craft: {}, objections: [{ category: 'send_email', stage: 'middle', quote: 'Just send me an email please.', response_quote: 'Happy to, what would make it worth reading?', handled: 'well', why: 'asked a follow up' }] };
  let seen;
  const fetchImpl = async (url, init) => {
    seen = { url, init, body: JSON.parse(init.body) };
    return { ok: true, json: async () => ({ content: [{ type: 'text', text: `\`\`\`json\n${JSON.stringify(reply)}\n\`\`\`` }] }) };
  };

  delete process.env.ANTHROPIC_API_KEY;
  await assert.rejects(() => analyseCall({ turns, call: { durationMin: 3 } }, { fetchImpl }), /ANTHROPIC_API_KEY/);

  process.env.ANTHROPIC_API_KEY = 'sk-test-key';
  const out = await analyseCall({ turns, call: { durationMin: 0 } }, { fetchImpl });
  assert.equal(seen.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(seen.init.headers['x-api-key'], 'sk-test-key');
  assert.match(seen.body.messages[0].content, /PROSPECT: Just send me an email/);
  assert.equal(out.objections[0].category, 'send_email');
  assert.ok(!JSON.stringify(out).includes('sk-test-key'));
  delete process.env.ANTHROPIC_API_KEY;
});

test('analysing one call looks up just that call and does not load weeks of the board', async () => {
  await withServer(async ({ json, log }) => {
    const res = await json('/analyse', LUKE, { method: 'POST', body: JSON.stringify({ ids: ['3'] }) });
    assert.equal(res.results[0].saved, true);
    assert.deepEqual(log.windows, []); // fetchCalls (the big load) was never used
  });
});

test('a failure names the step it happened at, returns normally, and marks nothing', async () => {
  await withServer({ claudeFails: true }, async ({ call, log }) => {
    const res = await call('/analyse', LUKE, { method: 'POST', body: JSON.stringify({ ids: ['3'] }) });
    assert.equal(res.status, 200); // a readable answer, not a dropped connection
    const out = (await res.json()).results[0];
    assert.equal(out.error, 'failed');
    assert.equal(out.step, 'analyse with Claude');
    assert.match(out.message, /Claude API HTTP 529/);
    assert.deepEqual(log.marked, []);
  });
});

test('the connection check is for managers and reports each part', async () => {
  await withServer(async ({ call, json }) => {
    assert.equal((await call('/selftest', LUKE)).status, 403);
    const ok = await json('/selftest', SAM);
    assert.equal(ok.ok, true);
    assert.equal(ok.checks.length, 3); // Claude, one store (fake), monday
  });
  await withServer({ claudePingFails: true, persist: false }, async ({ json }) => {
    const bad = await json('/selftest', SAM);
    assert.equal(bad.ok, false);
    const byName = Object.fromEntries(bad.checks.map((c) => [c.name.split(' ')[0], c]));
    assert.equal(byName.Claude.ok, false);
    assert.match(byName.Claude.error, /15 seconds/);
    assert.equal(byName.Saving.ok, false);
    assert.equal(byName.monday.ok, true);
  });
});

// ---- the real store module, with fake backends ----
const realStore = require('../src/lib/store');
const fakeBackend = (name, { readBack = true, asText = false, setOk = true } = {}) => {
  const data = new Map();
  return {
    name,
    set: async (k, v) => { if (!setOk) return false; data.set(k, asText ? JSON.stringify(v) : v); return true; },
    get: async (k) => (readBack ? (data.has(k) ? (asText ? JSON.parse(data.get(k)) : data.get(k)) : null) : null),
  };
};

test('the store skips a backend that writes but cannot read back, and uses the next one', async () => {
  realStore._setBackends([fakeBackend('broken', { readBack: false }), fakeBackend('good')]);
  const analysis = { callType: 'conversation', summary: 'x' };
  assert.equal(await realStore.saveAnalysis('1', analysis), true);
  assert.deepEqual(await realStore.getAnalysis('1'), analysis);
});

test('the store says not saved, and so nothing gets marked, when no backend works', async () => {
  realStore._setBackends([fakeBackend('broken', { readBack: false }), fakeBackend('refuses', { setOk: false })]);
  assert.equal(await realStore.saveAnalysis('2', { callType: 'conversation' }), false);
  assert.equal(await realStore.getAnalysis('2'), null);
});

test('values a store hands back as text are turned back into objects', async () => {
  realStore._setBackends([fakeBackend('texty', { asText: true })]);
  const analysis = { callType: 'early_hangup', openerResult: 'hung_up' };
  assert.equal(await realStore.saveAnalysis('3', analysis), true);
  assert.deepEqual(await realStore.getAnalysis('3'), analysis);
});

test('the connection check reports each store separately, with the reason it failed', async () => {
  realStore._setBackends([fakeBackend('broken', { readBack: false }), fakeBackend('good')]);
  const results = await realStore.selfTest();
  assert.equal(results.length, 2);
  assert.equal(results[0].ok, false);
  assert.match(results[0].error, /gave back nothing/);
  assert.equal(results[1].ok, true);
});

test('Claude\'s own explanation of a refusal is shown, not just the status', async () => {
  const { ping } = require('../src/lib/analysis');
  process.env.ANTHROPIC_API_KEY = 'sk-test-key';
  const fetchImpl = async () => ({ ok: false, status: 400, text: async () => JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' } }) });
  await assert.rejects(() => ping({ fetchImpl }), /HTTP 400: Your credit balance is too low/);
  delete process.env.ANTHROPIC_API_KEY;
});

test('app storage keeps objects intact even though the service turns them into text', async () => {
  // Mimics the fault seen live: the service saved the words "[object Object]" (15 characters).
  class CoercingStorage {
    constructor() { this.data = new Map(); }
    async set(key, value) { this.data.set(key, String(value)); return { success: true, version: '1' }; }
    async get(key) { return { success: true, value: this.data.get(key) }; }
  }
  const [, app] = realStore._makeBackends({ Storage: CoercingStorage, SecureStorage: class {}, getSecret: () => 'token' });
  realStore._setBackends([app]);
  const analysis = { callType: 'conversation', summary: 'x' };
  assert.equal(await realStore.saveAnalysis('4', analysis), true);
  assert.deepEqual(await realStore.getAnalysis('4'), analysis);
  const results = await realStore.selfTest();
  assert.equal(results[0].ok, true); // the connection check no longer shows this store as broken
});

// ---- English output for calls in other languages ----
const hebrewTurns = [
  { who: 'sdr', text: 'שלום, מדבר דני מבוסט, יש לך רגע?' },
  { who: 'prospect', text: 'אין לי זמן עכשיו, תתקשר בהזדמנות אחרת.' },
  { who: 'sdr', text: 'מבין לגמרי, אפשר עשר דקות בשבוע הבא?' },
];

test('findings are kept in English and quotes are checked in the original language', () => {
  const { validate, SYSTEM } = require('../src/lib/analysis');
  const out = validate({
    call_type: 'conversation', language: 'Hebrew', coachable: true, opener_result: 'stayed_engaged',
    opener: { style: 'permission_based', quote: 'יש לך רגע', quote_en: 'do you have a moment', note: 'Asked permission first.' },
    objections: [
      { category: 'no_time', stage: 'opener', quote: 'אין לי זמן עכשיו', quote_en: 'I do not have time right now', response_quote: 'אפשר עשר דקות בשבוע הבא', response_quote_en: 'could we do ten minutes next week', handled: 'well', why: 'Acknowledged, then made the ask smaller.' },
      { category: 'no_budget', stage: 'middle', quote: 'אין לנו תקציב בכלל', quote_en: 'we have no budget at all', handled: 'poorly', why: 'invented' },
    ],
    best_moment: { quote: 'מבין לגמרי', quote_en: 'I completely understand', why: 'Showed empathy.' },
    meddpicc: { identify_pain: { score: 1, evidence: 'אין לי זמן עכשיו', evidence_en: 'I do not have time right now' } },
  }, hebrewTurns);

  assert.equal(out.language, 'Hebrew');
  assert.equal(out.opener.quote, 'יש לך רגע'); // the original, which was checked against the transcript
  assert.equal(out.opener.quoteEn, 'do you have a moment');
  assert.equal(out.objections.length, 1); // the made-up Hebrew quote was dropped
  assert.equal(out.objections[0].quoteEn, 'I do not have time right now');
  assert.equal(out.objections[0].responseQuoteEn, 'could we do ten minutes next week');
  assert.equal(out.bestMoment.quoteEn, 'I completely understand');
  assert.equal(out.meddpicc.identify_pain.evidenceEn, 'I do not have time right now');
  assert.match(SYSTEM, /Write every finding in English/);
});

test('an English call needs no translation and a missing translation falls back to the original', () => {
  const { validate } = require('../src/lib/analysis');
  const turns = [{ who: 'prospect', text: 'We are not looking at any new tools this year, sorry.' }];
  const out = validate({ call_type: 'conversation', objections: [{ category: 'not_interested', stage: 'middle', quote: 'We are not looking at any new tools this year', handled: 'ok', why: 'x' }] }, turns);
  assert.equal(out.language, 'English');
  assert.equal(out.objections[0].quoteEn, 'We are not looking at any new tools this year');
});

test('manager trends show the English wording of quotes', () => {
  const mk = (id, analysis) => ({ call: { id, sdrId: id, sdrName: `SDR ${id}`, tags: [], durationMin: 1, startedAt: '2026-11-02 10:00' }, analysis });
  const t = buildTrends([mk('1', {
    coachable: false, callType: 'early_hangup', nextStepSecured: false, craft: {}, prospect: { seniority: 'unknown' }, openerResult: 'hung_up',
    opener: { style: 'direct_pitch', quote: 'שלום מבוסט', quoteEn: 'Hello from boost' },
    objections: [{ category: 'no_time', stage: 'opener', quote: 'אין לי זמן', quoteEn: 'I have no time', responseQuote: 'עשר דקות', responseQuoteEn: 'ten minutes', handled: 'well', why: 'x' }],
  })]);
  assert.equal(t.topObjections[0].examples[0].quote, 'I have no time');
  assert.equal(t.earlyObjections[0].examples[0].quote, 'I have no time');
  assert.equal(t.earlyObjections[0].examples[0].response, 'ten minutes');
  assert.equal(t.openers[0].hangUpExamples[0].quote, 'Hello from boost');
  assert.equal(t.hangups.reasons[0].examples[0].quote, 'I have no time');
});

// ---- reliable structured output from Claude ----
const withKey = async (fn) => {
  process.env.ANTHROPIC_API_KEY = 'sk-test-key';
  try { await fn(); } finally { delete process.env.ANTHROPIC_API_KEY; }
};
const quoteTurns = [
  { who: 'prospect', text: 'He said "not now" and then "call back in March", honestly.' },
  { who: 'sdr', text: 'No problem at all, I will call back in March.' },
];
const toolReply = (input) => ({ ok: true, json: async () => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'record_call_analysis', input }] }) });

test('Claude is made to answer through a tool, so quotes containing speech marks cannot break it', async () => {
  const { analyseCall } = require('../src/lib/analysis');
  await withKey(async () => {
    let body;
    const fetchImpl = async (_url, init) => {
      body = JSON.parse(init.body);
      // A quote with speech marks in it: as free text this is exactly what produced "Expected ',' or '}'".
      return toolReply({ call_type: 'conversation', coachable: true, opener_result: 'brushed_off', next_step_secured: true, meddpicc: {}, craft: {}, objections: [{ category: 'bad_timing', stage: 'middle', quote: 'He said "not now" and then "call back in March"', handled: 'well', why: 'x' }] });
    };
    const out = await analyseCall({ turns: quoteTurns, call: { durationMin: 1 } }, { fetchImpl });
    // This model refuses a forced tool choice ("tool" or "any"), so the tool is offered and asked for.
    assert.equal(body.tool_choice.type, 'auto');
    assert.equal(body.tools[0].name, 'record_call_analysis');
    assert.match(body.messages[0].content, /calling the record_call_analysis tool/);
    assert.equal(out.objections.length, 1);
    assert.match(out.objections[0].quote, /"not now"/);
  });
});

test('an unreadable plain-text reply is retried once, and a good second answer is used', async () => {
  const { analyseCall } = require('../src/lib/analysis');
  await withKey(async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      const text = calls === 1 ? '{ "call_type": "conversation" "coachable": true' : JSON.stringify({ call_type: 'conversation', coachable: true, meddpicc: {}, craft: {}, objections: [] });
      return { ok: true, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text }] }) };
    };
    const out = await analyseCall({ turns: quoteTurns, call: { durationMin: 1 } }, { fetchImpl });
    assert.equal(calls, 2);
    assert.equal(out.callType, 'conversation');
  });
});

test('an answer that stays unreadable fails clearly after two tries', async () => {
  const { analyseCall } = require('../src/lib/analysis');
  await withKey(async () => {
    let calls = 0;
    const fetchImpl = async () => { calls += 1; return { ok: true, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'not json at all' }] }) }; };
    await assert.rejects(() => analyseCall({ turns: quoteTurns, call: { durationMin: 1 } }, { fetchImpl }), /did not return JSON/);
    assert.equal(calls, 2);
  });
});

test('a reply cut off for length is reported plainly and not retried', async () => {
  const { analyseCall } = require('../src/lib/analysis');
  await withKey(async () => {
    let calls = 0;
    const fetchImpl = async () => { calls += 1; return { ok: true, json: async () => ({ stop_reason: 'max_tokens', content: [] }) }; };
    await assert.rejects(() => analyseCall({ turns: quoteTurns, call: { durationMin: 1 } }, { fetchImpl }), /ran out of room/);
    assert.equal(calls, 1);
  });
});

test('the connection check also proves Anthropic accepts the analysis format', async () => {
  const { ping } = require('../src/lib/analysis');
  await withKey(async () => {
    let body;
    await ping({ fetchImpl: async (_u, init) => { body = JSON.parse(init.body); return { ok: true, json: async () => ({}) }; } });
    assert.equal(body.tools[0].name, 'record_call_analysis');
    assert.equal(body.tool_choice.type, 'auto'); // never forced: this model refuses that
    assert.ok(body.max_tokens <= 32);
  });
  await withKey(async () => {
    const reject = async () => ({ ok: false, status: 400, text: async () => JSON.stringify({ error: { message: 'tools.0.input_schema: invalid' } }) });
    await assert.rejects(() => ping({ fetchImpl: reject }), /HTTP 400: tools\.0\.input_schema/);
  });
});

// ---- older analyses get redone in English ----
test('an analysis saved before the English change is offered for redoing, and replaced', async () => {
  await withServer(async ({ json, log, calls, deps }) => {
    // Call 3 was analysed earlier: marked on the board, but saved without a language (the old format).
    calls.find((c) => c.id === '3').coachingStatus = 'Analysed';
    await deps.store.saveAnalysis('3', { callType: 'early_hangup', coachable: false, objections: [{ quote: 'אין לי זמן' }] });

    const list = await json('/calls', LUKE);
    const row = list.calls.find((c) => c.id === '3');
    assert.equal(row.status, 'waiting');
    assert.equal(row.refresh, 'english');
    assert.equal(list.refreshCount, 1);
    assert.equal(list.waitingCount, 2); // call 1 (never analysed) plus call 3 (to redo)

    const res = await json('/analyse', LUKE, { method: 'POST', body: JSON.stringify({ ids: ['3'] }) });
    assert.equal(res.results[0].saved, true);
    assert.deepEqual(log.analysed, ['3']); // it really was analysed again, not served from the old record
  });
});

test('a current analysis (with a language) is left alone and never redone', async () => {
  await withServer(async ({ json, log, calls, deps }) => {
    calls.find((c) => c.id === '3').coachingStatus = 'Analysed';
    await deps.store.saveAnalysis('3', { callType: 'early_hangup', language: 'English', coachable: false });

    const list = await json('/calls', LUKE);
    assert.equal(list.calls.find((c) => c.id === '3').status, 'analysed');
    assert.equal(list.refreshCount, 0);

    await json('/analyse', LUKE, { method: 'POST', body: JSON.stringify({ ids: ['3'] }) });
    assert.deepEqual(log.analysed, []); // nothing spent
  });
});

test('a call marked analysed whose saved analysis has gone missing is offered again too', async () => {
  await withServer(async ({ json, calls }) => {
    calls.find((c) => c.id === '3').coachingStatus = 'Analysed'; // marked, but nothing saved
    const list = await json('/calls', LUKE);
    const row = list.calls.find((c) => c.id === '3');
    assert.equal(row.status, 'waiting');
    assert.equal(row.refresh, 'missing');
  });
});

test('Anthropic never receives a forced tool choice, which this model rejects', async () => {
  const { analyseCall, ping } = require('../src/lib/analysis');
  await withKey(async () => {
    const seen = [];
    const fetchImpl = async (_u, init) => {
      const b = JSON.parse(init.body);
      seen.push(b.tool_choice);
      // Mimic the real refusal for any forced choice.
      if (b.tool_choice && b.tool_choice.type !== 'auto') {
        return { ok: false, status: 400, text: async () => JSON.stringify({ error: { message: 'tool_choice: type "tool" and "any" are not supported for this model.' } }) };
      }
      return toolReply({ call_type: 'conversation', coachable: true, meddpicc: {}, craft: {}, objections: [] });
    };
    await analyseCall({ turns: quoteTurns, call: { durationMin: 1 } }, { fetchImpl });
    await ping({ fetchImpl });
    assert.deepEqual(seen.map((t) => t.type), ['auto', 'auto']);
  });
});
