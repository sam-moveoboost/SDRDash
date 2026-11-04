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

const mkCall = (o) => ({
  callId: null, sdrId: LUKE, sdrName: 'Luke Birchley', agentName: 'Luke Birchley', direction: 'outbound',
  outcome: 'Outbound answered', answered: true, tags: [], durationMin: 3, recordingUrl: null, coachingStatus: null, ...o,
});
const fixtures = () => [
  mkCall({ id: '1', createdAt: '2026-11-02T14:00:00Z', startedAt: '2026-11-02 14:00', tags: ['MeetingBooked'], durationMin: 5 }),
  mkCall({ id: '2', createdAt: '2026-11-02T15:00:00Z', startedAt: '2026-11-02 15:00', sdrId: EMAD, sdrName: 'Emad Mahamid', agentName: 'Emad Mahamid', durationMin: 4 }),
  mkCall({ id: '3', createdAt: '2026-11-02T16:00:00Z', startedAt: '2026-11-02 16:00', durationMin: 0 }), // short hang-up
  mkCall({ id: '4', createdAt: '2026-11-02T17:00:00Z', startedAt: '2026-11-02 17:00', outcome: 'Outbound unanswered', answered: false, durationMin: null }),
  mkCall({ id: '5', createdAt: '2026-10-30T10:00:00Z', startedAt: '2026-10-30 10:00' }), // before the 1 November line
  mkCall({ id: '6', createdAt: '2026-11-03T09:00:00Z', startedAt: '2026-11-03 09:00', durationMin: 0 }), // transcript too short
];
const RAW = { 1: convo('Luke Birchley'), 2: convo('Emad Mahamid'), 3: SHORT, 4: SHORT, 5: convo('Luke Birchley'), 6: TINY };

function makeDeps({ persist = true } = {}) {
  const calls = fixtures();
  const saved = new Map();
  const log = { analysed: [], marked: [] };
  return {
    log,
    calls,
    deps: {
      mondayApi: {
        fetchCalls: async () => calls,
        fetchTranscripts: async (ids) => Object.fromEntries(ids.filter((id) => RAW[id]).map((id) => [id, RAW[id]])),
        markAnalysed: async (id) => { log.marked.push(id); calls.find((c) => c.id === id).coachingStatus = 'Analysed'; },
      },
      analysis: {
        analyseCall: async ({ call }) => {
          log.analysed.push(call.id);
          return { callType: 'conversation', coachable: true, openerResult: 'stayed_engaged', nextStepSecured: true, meddpicc: {}, craft: {}, objections: [] };
        },
      },
      store: {
        getAnalysis: async (id) => saved.get(id) ?? null,
        saveAnalysis: async (id, a) => { if (persist) saved.set(id, a); return persist; },
        mapLimit: async (items, _l, fn) => Promise.all(items.map(fn)),
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
    assert.equal(mine.stats.calls, 5); // Luke's five calls, not Emad's
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
    assert.equal(all.stats.calls, 6);
    assert.equal(all.team.length, 2);
    assert.equal(all.sdrs.length, 2);
    assert.equal((await json(`/overview?userId=${EMAD}`, SAM)).stats.calls, 1);
  });
});

test('unanswered calls do not count as answered', async () => {
  await withServer(async ({ json }) => {
    const mine = await json('/overview', LUKE);
    assert.equal(mine.stats.outbound, 5);
    assert.equal(mine.stats.answered, 4); // the unanswered call is not counted
  });
});

test('the list is answered calls since 1 November with a transcript of 250+ characters, whatever their length', async () => {
  await withServer(async ({ json }) => {
    const list = await json('/calls', LUKE);
    const ids = list.calls.map((c) => c.id).sort();
    // 1 = conversation, 3 = short hang-up (0 minutes, still included).
    // 4 unanswered, 5 before 1 Nov and 6 under 250 characters are all left out.
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
    const res = await json('/analyse', LUKE, { method: 'POST', body: JSON.stringify({ ids: ['2', '4', '5', '6'] }) });
    const by = Object.fromEntries(res.results.map((r) => [r.id, r.error]));
    assert.equal(by['2'], 'not_found'); // Emad's call
    assert.equal(by['4'], 'not_found'); // unanswered
    assert.equal(by['5'], 'not_found'); // before 1 November
    assert.equal(by['6'], 'too_short'); // under 250 characters
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
  assert.equal(s.conversations, 3); // calls 1, 2 and 5 are over a minute
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
