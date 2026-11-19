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

function makeDeps({ persist = true, claudeFails = false, claudePingFails = false, hold = false } = {}) {
  let release = () => {};
  const holdGate = hold ? new Promise((r) => { release = r; }) : null;
  const calls = fixtures();
  const saved = new Map();
  const unreadable = new Set();
  const log = { analysed: [], marked: [], windows: [] };
  return {
    log,
    release: () => release(),
    unreadable,
    calls,
    deps: {
      mondayApi: {
        fetchCalls: async (since) => { log.windows.push(since); return calls; },
        fetchCall: async (id) => calls.find((c) => c.id === id) ?? null,
        ping: async () => {},
        fetchProspect: async () => ({ source: 'phone', industry: 'Real Estate', company: 'Acme Homes', title: 'Sales Director', seniority: 'director', employees: '24' }),
        fetchTranscripts: async (ids) => Object.fromEntries(ids.filter((id) => RAW[id]).map((id) => [id, RAW[id]])),
        markAnalysed: async (id) => { log.marked.push(id); calls.find((c) => c.id === id).coachingStatus = 'Analysed'; },
        setStatus: async (id, label) => { log.statuses = log.statuses || []; log.statuses.push([id, label]); calls.find((c) => c.id === id).coachingStatus = label; },
      },
      analysis: {
        ping: async () => { if (claudePingFails) throw new Error('Claude did not answer within 15 seconds'); },
        analyseCall: async ({ call, prospect }) => {
          if (claudeFails) throw new Error('Claude API HTTP 529');
          if (holdGate) await holdGate; // lets a test keep analyses running
          log.analysed.push(call.id);
          log.prospects = log.prospects || {};
          log.prospects[call.id] = prospect;
          return { callType: 'conversation', language: 'English', schema: 6, positioning: { recorded: true, lead: 'none', when: 'never' }, stats: { prospectWordsAfterOpening: 80, turnsAfterOpening: 10 }, opener: { recorded: true, style: 'other', quote: 'x' }, coachable: true, openerResult: 'stayed_engaged', nextStepSecured: true, meddpicc: {}, craft: {}, objections: [] };
        },
      },
      store: {
        getAnalysis: async (id) => saved.get(id) ?? null,
        getAnalysisChecked: async (id) => ({ analysis: saved.get(id) ?? null, unreadable: !saved.has(id) && unreadable.has(id) }),
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

test('everyone can see the team trends, but nothing that points at an individual', async () => {
  await withServer(async ({ call, json, calls, deps }) => {
    // Two SDRs' calls, both analysed, with objections that were handled well and poorly.
    for (const id of ['1', '2']) {
      calls.find((c) => c.id === id).coachingStatus = 'Analysed';
      await deps.store.saveAnalysis(id, {
        callType: 'conversation', language: 'English', schema: 6, positioning: { recorded: true, lead: 'none', when: 'never' }, stats: { prospectWordsAfterOpening: 80, turnsAfterOpening: 10 }, opener: { recorded: true, style: 'other', quote: 'x' }, coachable: true, openerResult: 'stayed_engaged', nextStepSecured: true, craft: {},
        prospect: { seniority: 'manager', role: 'Head of Sales', industry: 'software' },
        opener: { style: 'permission_based', quote: 'Got a minute?', quoteEn: 'Got a minute?' },
        objections: [{ category: 'no_time', stage: 'opener', quote: 'No time', quoteEn: 'No time', responseQuote: 'Ten minutes next week?', responseQuoteEn: 'Ten minutes next week?', handled: id === '1' ? 'well' : 'poorly', why: 'x' }],
      });
    }

    // An SDR gets the team's patterns, even when they ask for someone else, and not just their own calls.
    const sdr = await json(`/trends?userId=${EMAD}`, LUKE);
    assert.equal(sdr.analysedCount, 2);
    assert.equal(sdr.trends.analysedCalls, 2);
    assert.equal(sdr.trends.topObjections[0].count, 2);
    assert.ok(sdr.trends.bestHandling[0].examples[0].response); // what works is visible
    assert.equal(sdr.trends.sdrs, undefined); // no SDR-by-SDR comparison

    // Nothing in what an SDR receives names a person or points at a call.
    const text = JSON.stringify(sdr);
    for (const forbidden of ['Luke Birchley', 'Emad Mahamid', 'sdrName', 'sdrId', 'callId', '"111"', '"222"']) {
      assert.ok(!text.includes(forbidden), `an SDR was sent ${forbidden}`);
    }

    // Managers still get names, links to calls and the comparison, and can look at one SDR.
    const manager = await json('/trends', SAM);
    assert.equal(manager.trends.sdrs.length, 2);
    assert.ok(JSON.stringify(manager).includes('Luke Birchley'));
    assert.equal((await json(`/trends?userId=${LUKE}`, SAM)).trends.analysedCalls, 1);

    // Seeing trends does not open anyone's calls: transcripts and analyses stay private.
    assert.equal((await call('/calls/2/transcript', LUKE)).status, 404);
    const res = await json('/analyse', LUKE, { method: 'POST', body: JSON.stringify({ ids: ['2'] }) });
    assert.equal(res.results[0].error, 'not_found');
    const mine = await json('/calls', LUKE);
    assert.ok(mine.calls.every((c) => c.sdrId === LUKE));
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
    analysis: { schema: 6, stats: { prospectWordsAfterOpening: 3, turnsAfterOpening: 2 }, coachable: false, callType: 'early_hangup', nextStepSecured: false, craft: {}, prospect: { seniority: 'unknown' }, objections: [], openerResult: 'hung_up', opener: { style: 'direct_pitch', quote: 'We help teams with monday.com' }, ...a },
  });
  const earlyObj = (handled, responseQuote) => [{ category: 'not_interested', stage: 'opener', quote: 'Not interested thanks', responseQuote, handled, why: 'x' }];
  const t = buildTrends([
    mk('1', 'Luke', ['MeetingBooked'], { stats: { prospectWordsAfterOpening: 80, turnsAfterOpening: 10 }, opener: { recorded: true, style: 'other', quote: 'x' }, coachable: true, callType: 'conversation', openerResult: 'stayed_engaged', nextStepSecured: true, opener: { style: 'permission_based', quote: 'Got a minute?' }, objections: earlyObj('well', 'Fair enough, can I ask one quick question?') }),
    mk('2', 'Emad', [], { objections: earlyObj('poorly', null) }),
    mk('3', 'Sam F', [], { callType: 'voicemail', openerResult: 'unclear' }),
  ]);
  assert.equal(t.analysedCalls, 2); // the voicemail is left out
  assert.equal(t.hangups.count, 1);
  assert.equal(t.openers.find((o) => o.style === 'cold_permission_ask').stayedRate, 1);
  assert.equal(t.openers.find((o) => o.style === 'credentials_first').hungUpRate, 1);
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
    schema: 6, stats: { prospectWordsAfterOpening: 3, turnsAfterOpening: 2 }, coachable: false, callType: 'early_hangup', nextStepSecured: false, craft: {}, prospect: { seniority: 'unknown' }, openerResult: 'hung_up',
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
      const text = calls === 1 ? '{ "call_type": "conversation" "coachable": true' : JSON.stringify({ call_type: 'conversation', coachable: true, meddpicc: {}, craft: { opening: { score: 3 } }, objections: [], positioning: { lead: 'none', when: 'never' }, opener: { style: 'other' } });
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
    assert.equal(row.refresh, 'outdated');
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
    await deps.store.saveAnalysis('3', { callType: 'early_hangup', language: 'English', schema: 6, positioning: { recorded: true, lead: 'none', when: 'never' }, stats: { prospectWordsAfterOpening: 80, turnsAfterOpening: 10 }, opener: { recorded: true, style: 'other', quote: 'x' }, coachable: false });

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
      return toolReply({ call_type: 'conversation', coachable: true, meddpicc: {}, craft: { opening: { score: 3 } }, objections: [], positioning: { lead: 'none', when: 'never' }, opener: { style: 'other' } });
    };
    await analyseCall({ turns: quoteTurns, call: { durationMin: 1 } }, { fetchImpl });
    await ping({ fetchImpl });
    assert.deepEqual(seen.map((t) => t.type), ['auto', 'auto']);
  });
});

test('calls still waiting are always listed, even when many finished calls come after them', async () => {
  await withServer(async ({ json, calls, deps }) => {
    // 210 newer, finished calls for Luke: more than the list's cap, and all newer than the waiting ones.
    for (let i = 0; i < 210; i++) {
      const id = `done${i}`;
      calls.push(mkCall({ id, createdAt: '2026-11-10T10:00:00Z', startedAt: '2026-11-10 10:00', coachingStatus: 'Analysed', tags: ['Gatekeeper'] }));
      await deps.store.saveAnalysis(id, { callType: 'conversation', language: 'English', schema: 6, positioning: { recorded: true, lead: 'none', when: 'never' }, stats: { prospectWordsAfterOpening: 80, turnsAfterOpening: 10 }, opener: { recorded: true, style: 'other', quote: 'x' }, coachable: true, meddpicc: {}, craft: {}, objections: [] });
    }
    const list = await json('/calls', LUKE);
    const waitingRows = list.calls.filter((c) => c.status === 'waiting');
    assert.deepEqual(waitingRows.map((c) => c.id).sort(), ['1', '3']); // the two older waiting calls are not crowded out
    assert.equal(list.waitingCount, waitingRows.length); // the count and the list agree
    assert.equal(list.calls.filter((c) => c.status === 'analysed').length, 200); // finished calls are capped
  });
});

test('Claude is given room for a long analysis', async () => {
  const { analyseCall } = require('../src/lib/analysis');
  await withKey(async () => {
    let body;
    const fetchImpl = async (_u, init) => { body = JSON.parse(init.body); return toolReply({ call_type: 'conversation', coachable: true, meddpicc: {}, craft: {}, objections: [] }); };
    await analyseCall({ turns: quoteTurns, call: { durationMin: 1 } }, { fetchImpl });
    assert.ok(body.max_tokens >= 6000);
  });
});

// ---- review priority (1 to 10): how much there is to learn from a call ----
const { reviewPriority } = require('../src/lib/priority');
const craftOf = (score) => Object.fromEntries(['opening', 'discovery', 'objection_handling', 'next_step_ask', 'tone_and_control'].map((k) => [k, { score, note: '' }]));
const conv = (extra = {}) => ({ callType: 'conversation', coachable: true, stats: { chars: 1500 }, objections: [], craft: craftOf(4), tryNextTime: [], ...extra });

test('a long conversation with poor objection handling, weak craft and a missed moment is top priority', () => {
  const p = reviewPriority(conv({
    stats: { chars: 6000 }, objections: [{ handled: 'poorly' }, { handled: 'poorly' }],
    craft: { ...craftOf(4), discovery: { score: 1 }, next_step_ask: { score: 2 } }, missedMoment: { quote: 'x' }, tryNextTime: ['a', 'b', 'c'],
  }), { durationMin: 9 });
  assert.equal(p.score, 10);
  assert.equal(p.level, 'high');
  assert.ok(p.reasons.some((r) => /Long conversation/.test(r)));
  assert.ok(p.reasons.some((r) => /2 objections handled poorly/.test(r)));
  assert.ok(p.reasons.some((r) => /Weak: Discovery, Asking for the next step/.test(r)));
  assert.ok(p.reasons.includes('Lots of feedback'));
});

test('a good example is worth reviewing too: a well-handled objection scores high even when the call was good', () => {
  const justOne = reviewPriority(conv({ objections: [{ handled: 'well' }] }), { durationMin: 4, tags: [] });
  assert.ok(justOne.score >= 7, `score was ${justOne.score}`);
  assert.equal(justOne.level, 'high');
  assert.ok(justOne.reasons.includes('A well-handled objection'));

  const star = reviewPriority(conv({ objections: [{ handled: 'well' }], bestMoment: { quote: 'x' } }), { durationMin: 6, tags: ['MeetingBooked'] });
  assert.ok(star.score >= 9, `score was ${star.score}`);
  assert.ok(star.reasons.includes('A strong moment to share'));
  assert.ok(star.reasons.includes('Meeting booked'));
});

test('a poorly handled and a well-handled objection are equally worth a look', () => {
  const bad = reviewPriority(conv({ objections: [{ handled: 'poorly' }] }), { durationMin: 3 });
  const good = reviewPriority(conv({ objections: [{ handled: 'well' }] }), { durationMin: 3 });
  assert.equal(bad.score, good.score);
});

test('a conversation with no lessons recorded is low (and carries no "nothing stood out" tag), or medium if it was long', () => {
  const plain = reviewPriority(conv(), { durationMin: 2, tags: [] });
  assert.equal(plain.score, 3);
  assert.equal(plain.level, 'low');
  assert.equal(plain.reasons.includes('Nothing stood out'), false);
  const long = reviewPriority(conv({ stats: { chars: 5000 } }), { durationMin: 7, tags: [] });
  assert.equal(long.level, 'medium');
});

test('quick hang-ups and gatekeepers are low unless there is an example in them, and never above 6', () => {
  const plain = reviewPriority({ callType: 'early_hangup', coachable: false, objections: [], craft: {}, tryNextTime: [] }, { durationMin: 0 });
  assert.equal(plain.score, 1);
  assert.equal(plain.level, 'low');
  const bad = reviewPriority({ callType: 'early_hangup', coachable: false, objections: [{ handled: 'poorly' }], missedMoment: { quote: 'x' }, craft: {}, tryNextTime: [] }, { durationMin: 0 });
  assert.ok(bad.score > plain.score && bad.score <= 6, `score was ${bad.score}`);
  const kept = reviewPriority({ callType: 'early_hangup', coachable: false, objections: [{ handled: 'well' }], bestMoment: { quote: 'x' }, craft: {}, tryNextTime: [] }, { durationMin: 0, tags: ['MeetingBooked'] });
  assert.ok(kept.score <= 6);
  assert.equal(reviewPriority({ callType: 'gatekeeper', coachable: false, objections: [], craft: {} }, {}).level, 'low');
});

test('voicemail and phone menus are the lowest priority, and a missing analysis has none', () => {
  assert.equal(reviewPriority({ callType: 'voicemail', coachable: false }, {}).score, 1);
  assert.equal(reviewPriority({ callType: 'automated_menu', coachable: false }, {}).score, 1);
  assert.equal(reviewPriority(null, {}), null);
});

test('scores always stay between 1 and 10', () => {
  for (const poor of [0, 1, 5]) for (const well of [0, 2]) for (const weakScore of [1, 3, 5]) for (const minutes of [0, 4, 20]) {
    const objections = [...Array.from({ length: poor }, () => ({ handled: 'poorly' })), ...Array.from({ length: well }, () => ({ handled: 'well' }))];
    const p = reviewPriority(conv({ stats: { chars: minutes * 800 }, objections, craft: craftOf(weakScore), missedMoment: { quote: 'x' }, bestMoment: { quote: 'y' }, tryNextTime: ['a', 'b', 'c'] }), { durationMin: minutes, tags: ['MeetingBooked'] });
    assert.ok(Number.isInteger(p.score) && p.score >= 1 && p.score <= 10);
  }
});

test('finished calls come back with a priority, in the list the page shows', async () => {
  await withServer(async ({ json, calls, deps }) => {
    calls.find((c) => c.id === '3').coachingStatus = 'Analysed';
    await deps.store.saveAnalysis('3', { callType: 'early_hangup', language: 'English', schema: 6, positioning: { recorded: true, lead: 'none', when: 'never' }, stats: { prospectWordsAfterOpening: 80, turnsAfterOpening: 10 }, opener: { recorded: true, style: 'other', quote: 'x' }, coachable: false, objections: [], craft: {} });
    const row = (await json('/calls', LUKE)).calls.find((c) => c.id === '3');
    assert.equal(row.status, 'analysed');
    assert.equal(row.priority.level, 'low');
    assert.equal(row.priority.score, 1);
  });
});

test('the list says how many valid transcripts there are, analysed and waiting', async () => {
  await withServer(async ({ json }) => {
    const before = await json('/calls', LUKE);
    assert.deepEqual(before.transcriptTotals, { valid: 2, analysed: 0, waiting: 2 });
    await json('/analyse', LUKE, { method: 'POST', body: JSON.stringify({ ids: ['3'] }) });
    const after = await json('/calls', LUKE);
    assert.deepEqual(after.transcriptTotals, { valid: 2, analysed: 1, waiting: 1 });
    assert.deepEqual((await json('/calls', SAM)).transcriptTotals, { valid: 3, analysed: 1, waiting: 2 }); // plus Emad's call
  });
});

test('"no time" and "bad timing" count as one objection, and older names fold into the new groups', () => {
  const mk = (id, category) => ({
    call: { id, sdrName: 'Luke', tags: [] },
    analysis: { schema: 6, stats: { prospectWordsAfterOpening: 80, turnsAfterOpening: 10 }, opener: { recorded: true, style: 'other', quote: 'x' }, coachable: true, callType: 'conversation', openerResult: 'stayed_engaged', nextStepSecured: false, craft: {}, prospect: { seniority: 'unknown' },
      opener: { style: 'referral_or_context', quote: 'we spoke before' },
      objections: [{ category, stage: 'middle', quote: 'q', quoteEn: 'q', responseQuote: 'r', responseQuoteEn: 'r', handled: 'well', why: 'x' }] },
  });
  const t = buildTrends([mk('1', 'no_time'), mk('2', 'bad_timing'), mk('3', 'not_a_good_time'), mk('4', 'using_competitor'), mk('5', 'already_covered'), mk('6', 'too_small_or_no_need')]);
  const row = (c) => t.topObjections.find((o) => o.category === c);
  assert.equal(row('not_a_good_time').count, 3);
  assert.equal(row('not_a_good_time').label, 'Not a good time');
  assert.equal(row('already_covered').count, 2);
  assert.equal(row('too_small_or_no_need').count, 1);
  assert.equal(t.openers.find((o) => o.style === 'warm_followup').calls, 6); // older "referral" name
  assert.deepEqual(t.openerFit, { inType: 6, total: 6 });
});

test('who books lists booked calls only, and shows a gap when the industry was not recorded', () => {
  const mk = (id, tags, industry) => ({
    call: { id, sdrName: 'Luke', tags },
    analysis: { coachable: true, callType: 'conversation', openerResult: 'stayed_engaged', nextStepSecured: false, craft: {}, prospect: { seniority: 'manager', industry },
      opener: { style: 'warm_followup', quote: 'x' }, objections: [] },
  });
  const t = buildTrends([mk('1', ['MeetingBooked'], 'Software'), mk('2', ['MeetingBooked'], null), mk('3', [], 'Retail'), mk('4', [], 'Retail')]);
  assert.equal(t.profile.bookedCount, 2);
  assert.deepEqual(t.profile.byIndustry.map((r) => [r.label, r.count]), [['software', 1], ['Not recorded', 1]]);
  assert.equal(t.profile.industryMissing, 1);
});

test('call craft is averaged over every call with a person on the line, not only full conversations', () => {
  const short = { coachable: false, callType: 'early_hangup', meddpicc: {}, craft: { opening: { score: 2 } } };
  const full = { coachable: true, callType: 'conversation', meddpicc: { identify_pain: { score: 2 } }, craft: { opening: { score: 4 } } };
  const s = summarise([short, full]);
  assert.equal(s.totalAnalysed, 2);
  assert.equal(s.analysedCalls, 1);
  assert.equal(s.craft.opening.avg, 3);
  assert.equal(s.analysedCalls, 1); // one full conversation; the craft average above still counts both calls
});

// ---- a slow storage must never make finished calls look un-analysed ----
test('a saved analysis is found even when the write test fails, and in a store that is not the one used for saving', async () => {
  const old = fakeBackend('secure');
  const analysis = { callType: 'conversation', summary: 'saved earlier' };
  await old.set('coach_v1_9', analysis);
  // The write test fails here (nothing can be read back from the first store), so nothing is chosen.
  realStore._setBackends([fakeBackend('slow', { readBack: false }), old]);
  const got = await realStore.getAnalysisChecked('9');
  assert.deepEqual(got.analysis, analysis);
  assert.equal(got.unreadable, false);
});

test('a store that cannot be read is reported as unreadable, not as never analysed', async () => {
  const dead = { name: 'dead', set: async () => true, get: async () => { throw new Error('timed out'); } };
  realStore._setBackends([dead]);
  const got = await realStore.getAnalysisChecked('10');
  assert.equal(got.analysis, null);
  assert.equal(got.unreadable, true);
  const clean = fakeBackend('clean');
  realStore._setBackends([clean]);
  assert.deepEqual(await realStore.getAnalysisChecked('11'), { analysis: null, unreadable: false, errors: [] });
});

test('calls whose saved analysis could not be read are not offered for re-analysis', async () => {
  await withServer(async ({ json, calls, deps, unreadable }) => {
    calls.find((c) => c.id === '3').coachingStatus = 'Analysed';
    unreadable.add('3');
    const list = await json('/calls', LUKE);
    assert.equal(list.unreadableCount, 1);
    assert.equal(list.calls.some((c) => c.id === '3'), false); // neither waiting nor finished
    assert.equal(list.waitingCount, 1); // only call 1, never analysed
    const res = await json('/analyse', LUKE, { method: 'POST', body: JSON.stringify({ ids: ['3'] }) });
    assert.equal(res.results[0].error, 'storage_unreadable');
  });
});

// ---- industry from the CRM record ----
test('the CRM record of the person called is passed to the analysis', async () => {
  await withServer(async ({ json, log }) => {
    const res = await json('/analyse', LUKE, { method: 'POST', body: JSON.stringify({ ids: ['1'] }) });
    assert.equal(res.results[0].saved, true);
    assert.equal(log.prospects['1'].industry, 'Real Estate');
    assert.equal(log.prospects['1'].company, 'Acme Homes');
  });
});

test('a failed prospect lookup never stops a call being analysed', async () => {
  const { fetchProspect } = require('../src/lib/mondayApi');
  // No token is set, so the lookup fails inside; it must answer null, not throw.
  const saved = process.env.MONDAY_API_TOKEN;
  delete process.env.MONDAY_API_TOKEN;
  try {
    assert.equal(await fetchProspect({ prospectIds: ['1'], externalPhone: '447403259262' }), null);
  } finally {
    if (saved) process.env.MONDAY_API_TOKEN = saved;
  }
});

test('a call is linked to its prospect by the board link, and the called number is kept for matching', () => {
  const { parseCall, parseProspect } = require('../src/lib/mondayApi');
  const call = parseCall({ id: '1', created_at: '2026-11-02T14:57:03Z', column_values: [
    { id: 'board_relation_mm2cmzgw', text: 'Nahum', linked_item_ids: ['3362084344'] },
    { id: 'phone_mm19p9w6', text: '+972 58-595-2424' },
  ] });
  assert.deepEqual(call.prospectIds, ['3362084344']);
  assert.equal(call.externalPhone, '972585952424');
  const p = parseProspect({ column_values: [
    { id: 'dropdown_mkz4vqpg', text: 'Real Estate' }, { id: 'text_mkw7ezh6', text: 'Acme Homes' },
    { id: 'text_mm0wcwfm', text: '' }, { id: 'text_mm04hrym', text: 'director' },
  ] }, 'phone');
  assert.equal(p.industry, 'Real Estate');
  assert.equal(p.title, null);
  assert.equal(p.source, 'phone');
});

test('industry: the CRM wins, the model picks from the fixed list otherwise, and gaps stay visible', () => {
  const turns = [{ who: 'prospect', text: 'hello' }, { who: 'sdr', text: 'hi' }];
  const base = { call_type: 'conversation', coachable: true, opener_result: 'stayed_engaged', next_step_secured: false, meddpicc: {}, craft: {}, objections: [] };
  const crm = { industry: 'Real Estate', company: 'Acme Homes', title: 'Sales Director', seniority: 'director' };
  const a = validate({ ...base, prospect: { seniority: 'unknown', industry: 'Real estate and property', industry_source: 'crm' } }, turns, crm);
  assert.equal(a.prospect.industryGroup, 'Real estate and property');
  assert.equal(a.prospect.industrySource, 'crm');
  assert.equal(a.prospect.company, 'Acme Homes');
  assert.equal(a.prospect.role, 'Sales Director');
  assert.equal(a.prospect.seniority, 'vp_director'); // CRM "director" fills a seniority the call never stated
  // Without a CRM record the model cannot claim "crm"; a made-up label falls back to Other.
  const b = validate({ ...base, prospect: { industry: 'Underwater basket weaving', industry_source: 'crm' } }, turns);
  assert.equal(b.prospect.industryGroup, 'Other');
  assert.equal(b.prospect.industrySource, 'unknown');
  const c = validate({ ...base, prospect: { industry: 'Energy and utilities', industry_source: 'company_name' } }, turns);
  assert.equal(c.prospect.industrySource, 'company_name');
});

test('who books by industry uses the fixed-list pick and flags booked calls where nothing was known', () => {
  const mk = (id, group, source) => ({
    call: { id, sdrName: 'Luke', tags: ['MeetingBooked'] },
    analysis: { coachable: true, callType: 'conversation', openerResult: 'stayed_engaged', nextStepSecured: true, craft: {}, objections: [],
      prospect: { seniority: 'manager', industryGroup: group, industrySource: source }, opener: { style: 'warm_followup', quote: 'x' } },
  });
  const t = buildTrends([mk('1', 'Energy and utilities', 'crm'), mk('2', 'Energy and utilities', 'company_name'), mk('3', 'Other', 'unknown')]);
  assert.deepEqual(t.profile.byIndustry.map((r) => [r.label, r.count]), [['energy and utilities', 2], ['Not recorded', 1]]);
  assert.equal(t.profile.industryMissing, 1);
});

test('the CRM record reaches Claude as context in the request', async () => {
  const { analyseCall } = require('../src/lib/analysis');
  await withKey(async () => {
    let body;
    const fetchImpl = async (_u, init) => { body = JSON.parse(init.body); return toolReply({ call_type: 'conversation', coachable: true, opener_result: 'stayed_engaged', next_step_secured: false, meddpicc: {}, craft: {}, objections: [] }); };
    await analyseCall({ turns: quoteTurns, call: { durationMin: 1 }, prospect: { company: 'Acme Homes', industry: 'Real Estate', title: 'Sales Director' } }, { fetchImpl });
    assert.match(body.messages[0].content, /Company: Acme Homes/);
    assert.match(body.messages[0].content, /Industry \(CRM\): Real Estate/);
  });
});

// ---- caching: load once, serve at once, top up behind ----
async function withClock(fn) {
  const ctx = makeDeps();
  let clock = Date.parse('2026-11-04T12:00:00Z');
  const router = createRouter(ctx.deps, { now: () => clock });
  const app = express();
  app.use('/coaching', router);
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}/coaching`;
  const json = async (path, userId = LUKE) => (await fetch(base + path, { headers: { Authorization: `Bearer ${token(userId)}` } })).json();
  try {
    await fn({ json, advance: (ms) => { clock += ms; }, router, ...ctx });
  } finally {
    server.close();
  }
}

test('the three requests the page makes share one read of the board', async () => {
  await withClock(async ({ json, log }) => {
    await Promise.all([json('/overview'), json('/calls'), json('/trends')]);
    assert.equal(log.windows.length, 1);
  });
});

test('an old list is served at once and topped up behind, and Refresh waits for the new one', async () => {
  await withClock(async ({ json, advance, log, calls }) => {
    await json('/calls');
    assert.equal(log.windows.length, 1);
    await json('/calls'); // still fresh: no new read
    assert.equal(log.windows.length, 1);

    advance(10 * 60 * 1000); // older than the 2 minute limit
    const stale = await json('/calls'); // answered from what is held
    assert.ok(stale.calls.length > 0);
    await new Promise((r) => setTimeout(r, 30)); // the top-up runs behind it
    assert.equal(log.windows.length, 2);

    calls.push({ ...calls[0], id: '99', createdAt: '2026-11-04T11:00:00Z', startedAt: '2026-11-04 11:00' });
    await json('/calls?fresh=1');
    assert.equal(log.windows.length, 3); // Refresh reads again straight away
  });
});

test('warming up at start loads the list and the saved analyses without a request', async () => {
  await withClock(async ({ router, log }) => {
    await router.warm(30);
    assert.equal(log.windows.length, 1);
  });
});

test('three readers of the same saved analysis cause one read from storage', async () => {
  let reads = 0;
  const counting = { name: 'counting', set: async () => true, get: async () => { reads += 1; await new Promise((r) => setTimeout(r, 20)); return { callType: 'conversation' }; } };
  realStore._setBackends([counting]);
  const [a, b, c] = await Promise.all([realStore.getAnalysisChecked('77'), realStore.getAnalysisChecked('77'), realStore.getAnalysisChecked('77')]);
  assert.equal(reads, 1);
  assert.equal(a.analysis.callType, 'conversation');
  assert.equal(b.analysis.callType, 'conversation');
  assert.equal(c.analysis.callType, 'conversation');
});

// ---- what we say we are ----
const posTurns = [
  { who: 'sdr', text: 'Hi, it is Sam from boost, we are an AI business that builds agents for sales teams.' },
  { who: 'prospect', text: 'Oh interesting, tell me more about that.' },
];
const posBase = { call_type: 'conversation', coachable: true, opener_result: 'stayed_engaged', next_step_secured: false, meddpicc: {}, craft: {}, objections: [] };

test('what the SDR says boost is gets recorded with a checked quote and the prospect reaction', () => {
  const a = validate({ ...posBase, positioning: { lead: 'ai', mentions_monday: false, mentions_ai: true, when: 'opening', quote: 'we are an AI business that builds agents', quote_en: 'we are an AI business that builds agents', reaction: 'engaged' } }, posTurns);
  assert.equal(a.positioning.lead, 'ai');
  assert.equal(a.positioning.mentionsAi, true);
  assert.equal(a.positioning.mentionsMonday, false);
  assert.equal(a.positioning.reaction, 'engaged');
  assert.equal(a.positioning.quote, 'we are an AI business that builds agents');
  // A quote that is not in the transcript is dropped, not trusted.
  const b = validate({ ...posBase, positioning: { lead: 'monday', when: 'opening', quote: 'we are the best monday.com partner in Europe', reaction: 'neutral' } }, posTurns);
  assert.equal(b.positioning.quote, null);
  assert.equal(b.positioning.mentionsMonday, true); // the lead always counts as mentioned
  // Never said means nothing is mentioned, whatever else came back.
  const c = validate({ ...posBase, positioning: { lead: 'ai', mentions_ai: true, when: 'never' } }, posTurns);
  assert.equal(c.positioning.lead, 'none');
  assert.equal(c.positioning.mentionsAi, false);
});

test('trends compare saying monday.com, AI, both or something else, and leave out older analyses', () => {
  const mk = (id, pos, over = {}) => ({
    call: { id, sdrName: 'Luke', tags: over.booked ? ['MeetingBooked'] : [], durationMin: over.mins ?? 3 },
    analysis: { schema: 6, stats: over.stayed === false ? { prospectWordsAfterOpening: 3, turnsAfterOpening: 2 } : { prospectWordsAfterOpening: 80, turnsAfterOpening: 10 }, coachable: true, callType: 'conversation', openerResult: over.stayed === false ? 'hung_up' : 'stayed_engaged', nextStepSecured: false, craft: {}, objections: [],
      prospect: { seniority: 'manager' }, opener: { style: 'warm_followup', quote: 'x' },
      ...(pos ? { positioning: { lead: 'none', mentionsMonday: false, mentionsAi: false, when: 'opening', quote: 'we are x', quoteEn: 'we are x', reaction: 'engaged', ...pos } } : {}) },
  });
  const pairs = [
    ...[1, 2, 3, 4, 5].map((i) => mk(`a${i}`, { lead: 'ai', mentionsAi: true }, { booked: i < 3 })),
    ...[1, 2, 3, 4, 5].map((i) => mk(`m${i}`, { lead: 'monday', mentionsMonday: true }, { stayed: i < 3 })),
    mk('b1', { lead: 'monday', mentionsMonday: true, mentionsAi: true }),
    mk('b2', { lead: 'ai', mentionsMonday: true, mentionsAi: true }),
    mk('n1', { lead: 'none', when: 'never' }, { stayed: false }),
    mk('n2', { lead: 'ai', mentionsAi: true, when: 'later' }), // said only later: counts as not said
    mk('old', null), // made before this was recorded
  ];
  const t = buildTrends(pairs);
  const g = (k) => t.positioning.find((r) => r.key === k);
  assert.equal(t.positioningCalls, 14); // the old analysis is not counted
  assert.equal(g('ai').calls, 5);
  assert.equal(g('ai').stayedRate, 1);
  assert.equal(g('ai').booked, 2);
  assert.equal(g('monday').stayedRate, 0.4);
  assert.equal(g('both').calls, 2);
  assert.equal(g('none').calls, 2);
  assert.equal(g('both').smallSample, true);
  assert.equal(g('ai').smallSample, false);
  assert.equal(t.bestPositioning, 'ai'); // most people stay, with enough calls to say so
  assert.equal(g('ai').avgDurationMin, 3);
});

test('what we say we are is shown to everyone without a name or a link to a call', () => {
  const { forEveryone } = require('../src/lib/trends');
  const t = buildTrends([{
    call: { id: '1', sdrName: 'Luke', sdrId: '111', tags: [], durationMin: 2 },
    analysis: { schema: 6, stats: { prospectWordsAfterOpening: 80, turnsAfterOpening: 10 }, opener: { recorded: true, style: 'other', quote: 'x' }, coachable: true, callType: 'conversation', openerResult: 'stayed_engaged', nextStepSecured: false, craft: {}, objections: [], prospect: {}, opener: { style: 'other', quote: null },
      positioning: { lead: 'ai', mentionsAi: true, mentionsMonday: false, when: 'opening', quote: 'we do AI', quoteEn: 'we do AI', reaction: 'engaged' } },
  }]);
  const text = JSON.stringify(forEveryone(t));
  assert.equal(text.includes('Luke'), false);
  assert.equal(text.includes('we do AI'), true);
});

// ---- real coaching: key exchanges, and no write-off of a real conversation ----
const longTurns = [
  { who: 'sdr', text: 'Hi, it is Emad from boost, we help companies with monday.com and AI.' },
  { who: 'prospect', text: 'What exactly does boost offer? I am not sure I understand.' },
  { who: 'sdr', text: 'It is not a solution, well it is a solution, we use Claude and CRM and leads and automation for you.' },
  { who: 'prospect', text: 'Okay but what do you actually offer, in simple words please.' },
  { who: 'sdr', text: 'We connect your systems so that leads are followed up automatically without anyone chasing them.' },
  { who: 'prospect', text: 'That sounds more interesting, we do have a lot of leads sitting there untouched.' },
  { who: 'sdr', text: 'Great, could we book twenty minutes tomorrow morning to show you how it works?' },
  { who: 'prospect', text: 'Send me an email first and call me tomorrow at nine, that works for me.' },
];

test('key exchanges pair what the prospect asked with how the SDR answered, and are checked against the transcript', () => {
  const a = validate({ ...posBase, key_exchanges: [
    { kind: 'prospect_question', prospect_quote: 'What exactly does boost offer?', prospect_quote_en: 'What exactly does boost offer?', sdr_quote: 'It is not a solution, well it is a solution', sdr_quote_en: 'It is not a solution, well it is a solution', verdict: 'missed', what_happened: 'A shifting answer to a simple question.', better: 'We make sure no lead goes untouched.' },
    { kind: 'objection', prospect_quote: 'This quote was never said on the call', sdr_quote: 'Neither was this one', verdict: 'landed', what_happened: 'invented' },
  ] }, longTurns);
  assert.equal(a.keyExchanges.length, 1); // the invented one is dropped
  assert.equal(a.keyExchanges[0].verdict, 'missed');
  assert.equal(a.keyExchanges[0].better, 'We make sure no lead goes untouched.');
  assert.match(a.keyExchanges[0].sdrQuote, /not a solution/);
});

test('a call where the prospect really took part is always coachable, whatever the model said', () => {
  const a = validate({ ...posBase, call_type: 'conversation', coachable: false }, longTurns);
  assert.equal(a.coachable, true);
  const hangup = validate({ ...posBase, call_type: 'early_hangup', coachable: false }, [{ who: 'sdr', text: 'Hello' }, { who: 'prospect', text: 'No thanks bye' }]);
  assert.equal(hangup.coachable, false);
});

test('a real conversation that comes back with no coaching is sent back once for it', async () => {
  const { analyseCall } = require('../src/lib/analysis');
  await withKey(async () => {
    const bodies = [];
    const fetchImpl = async (_u, init) => {
      bodies.push(JSON.parse(init.body));
      // First answer: scored nothing and said nothing. Second: the real feedback.
      return bodies.length === 1
        ? toolReply({ ...posBase, coachable: false, summary: 'Nothing much.' })
        : toolReply({ ...posBase, craft: { discovery: { score: 2 } }, key_exchanges: [{ kind: 'prospect_question', prospect_quote: 'What exactly does boost offer?', sdr_quote: 'It is not a solution, well it is a solution', verdict: 'missed', what_happened: 'x', better: 'y' }] });
    };
    const out = await analyseCall({ turns: longTurns, call: { durationMin: 4 } }, { fetchImpl });
    assert.equal(bodies.length, 2);
    assert.match(bodies[1].messages[0].content, /left out: the call craft scores/);
    assert.equal(out.keyExchanges.length, 1);
    assert.equal(out.craft.discovery.score, 2);
  });
});

test('answers that did not land raise the review priority, and a landed one is an example to copy', () => {
  const base = conv({ stats: { chars: 5000 } });
  const withMisses = reviewPriority({ ...base, keyExchanges: [{ verdict: 'missed' }, { verdict: 'missed' }, { verdict: 'landed' }] }, { durationMin: 4, tags: [] });
  assert.ok(withMisses.score >= 7);
  assert.ok(withMisses.reasons.includes('2 answers that did not land'));
  assert.ok(withMisses.reasons.includes('An answer that landed well'));
  const quiet = reviewPriority(base, { durationMin: 4, tags: [] });
  assert.ok(withMisses.score > quiet.score);
});

test('a vague company description counts as consultancy; only results, or only clients or partners, count as something else', () => {
  const mk = (id, kind) => ({
    call: { id, sdrName: 'Emad', tags: [], durationMin: 2 },
    analysis: { schema: 6, stats: { prospectWordsAfterOpening: 80, turnsAfterOpening: 10 }, opener: { recorded: true, style: 'other', quote: 'x' }, coachable: true, callType: 'conversation', openerResult: 'stayed_engaged', nextStepSecured: false, craft: {}, objections: [], prospect: {}, opener: { style: 'other', quote: null },
      positioning: { lead: 'other', otherKind: kind, mentionsMonday: false, mentionsAi: false, when: 'opening', quote: 'x', quoteEn: 'x', reaction: 'neutral' } },
  });
  const t = buildTrends([mk('1', 'generic_company'), mk('2', 'generic_company'), mk('3', 'results_only'), mk('4', 'credentials_only')]);
  const g = (k) => t.positioning.find((r) => r.key === k)?.calls;
  assert.equal(g('consultancy'), 2);
  assert.equal(g('other'), 2);
  const a = validate({ call_type: 'conversation', coachable: true, opener_result: 'stayed_engaged', next_step_secured: false, meddpicc: {}, craft: {}, objections: [], positioning: { lead: 'other', other_kind: 'results_only', when: 'opening' } }, posTurns);
  assert.equal(a.positioning.otherKind, 'results_only');
});

test('a store that answers "key not found" by throwing means not analysed, not unreadable; a real failure is reported with its reason', async () => {
  const notFound = { name: 'strict', set: async () => true, get: async () => { throw new Error('Key not found'); } };
  realStore._setBackends([notFound]);
  assert.deepEqual(await realStore.getAnalysisChecked('50'), { analysis: null, unreadable: false, errors: [] });
  const broken = { name: 'broken', set: async () => true, get: async () => { throw new Error('socket hang up'); } };
  realStore._setBackends([broken]);
  const got = await realStore.getAnalysisChecked('51');
  assert.equal(got.unreadable, true);
  assert.match(got.errors[0], /broken: socket hang up/);
});

// ---- storage limits: paced reads that finish in the background ----
const DEFAULT_TUNING = { maxConcurrent: 3, acquireTimeoutMs: 8000, backoffStartMs: 2000, backoffMaxMs: 30000, maxBackgroundTries: 25 };

test('storage reads are limited to a few at a time', async () => {
  let live = 0;
  let peak = 0;
  const backend = { name: 'paced', set: async () => true, get: async () => { live += 1; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, 15)); live -= 1; return { callType: 'conversation' }; } };
  realStore._setBackends([backend]);
  realStore._setTuning({ acquireTimeoutMs: 5000 });
  try {
    const out = await Promise.all(Array.from({ length: 12 }, (_, i) => realStore.getAnalysisChecked(`c${i}`)));
    assert.ok(out.every((o) => o.analysis));
    assert.ok(peak <= 3, `at most 3 reads at once, saw ${peak}`);
  } finally {
    realStore._setTuning(DEFAULT_TUNING);
  }
});

test('when storage says request limit exceeded, the read finishes in the background and is then kept in memory', async () => {
  let reads = 0;
  const limited = { name: 'secure storage', set: async () => true, get: async () => { reads += 1; if (reads <= 3) throw new Error('request limit exceeded'); return { callType: 'conversation', summary: 'found later' }; } };
  realStore._setBackends([limited]);
  realStore._setTuning({ acquireTimeoutMs: 100, backoffStartMs: 10, backoffMaxMs: 40 });
  try {
    const first = await realStore.getAnalysisChecked('900');
    assert.equal(first.analysis, null);
    assert.equal(first.unreadable, true); // not "never analysed": the page waits and asks again
    assert.match(first.errors.join(' '), /request limit exceeded/);
    await realStore._idle(); // the paced background read finishes
    const later = await realStore.getAnalysisChecked('900');
    assert.equal(later.analysis.summary, 'found later');
    const readsAfter = reads;
    await realStore.getAnalysisChecked('900');
    assert.equal(reads, readsAfter); // kept in memory: no more storage requests
  } finally {
    realStore._setTuning(DEFAULT_TUNING);
  }
});

// ---- background analysis: the page starts the work and asks how it is going ----
const untilDone = async (json, ids, who) => {
  for (let i = 0; i < 200; i += 1) {
    const st = await json(`/analyse/status?ids=${ids.join(',')}`, who);
    if (ids.every((id) => ['done', 'failed'].includes(st.jobs[id]?.state))) return st;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('the background analysis never finished');
};

test('analysis can be started and followed with short requests, and the result is saved as before', async () => {
  await withServer(async ({ call, json, log }) => {
    const res = await call('/analyse/start', LUKE, { method: 'POST', body: JSON.stringify({ ids: ['1'] }) });
    assert.equal(res.status, 202); // answered at once, before any analysing is done
    const st = await untilDone(json, ['1'], LUKE);
    assert.equal(st.jobs['1'].state, 'done');
    assert.equal(st.jobs['1'].result.saved, true);
    assert.deepEqual(log.analysed, ['1']);
  });
});

test('only the person who started a background analysis, or a manager, can read its result', async () => {
  await withServer(async ({ call, json }) => {
    await call('/analyse/start', LUKE, { method: 'POST', body: JSON.stringify({ ids: ['1'] }) });
    await untilDone(json, ['1'], LUKE);
    const other = await json('/analyse/status?ids=1', EMAD);
    assert.equal(other.jobs['1'].state, 'unknown');
    const manager = await json('/analyse/status?ids=1', SAM);
    assert.equal(manager.jobs['1'].state, 'done');
  });
});

test('an SDR cannot start analysis of someone else\'s call', async () => {
  await withServer(async ({ call, json, log }) => {
    await call('/analyse/start', LUKE, { method: 'POST', body: JSON.stringify({ ids: ['2'] }) }); // call 2 is Emad's
    const st = await untilDone(json, ['2'], LUKE);
    assert.equal(st.jobs['2'].result.error, 'not_found');
    assert.equal(log.analysed.includes('2'), false);
  });
});

test('only two analyses run at once in the background, and one that has not started can be cancelled', async () => {
  await withServer({ hold: true }, async ({ call, json, release, log }) => {
    await call('/analyse/start', SAM, { method: 'POST', body: JSON.stringify({ ids: ['1', '2', '3'] }) });
    await new Promise((r) => setTimeout(r, 30));
    const st = await json('/analyse/status?ids=1,2,3', SAM);
    assert.equal(st.running, 2);
    assert.equal(st.queued, 1);
    const cancelled = await json('/analyse/cancel', SAM, { method: 'POST', body: JSON.stringify({ ids: ['1', '2', '3'] }) });
    assert.equal(cancelled.cancelled, 1); // only the one still waiting
    release();
    await untilDone(json, ['1', '2'], SAM);
    assert.deepEqual([...log.analysed].sort(), ['1', '2']);
  });
});

test('stayed on and hung up always add up to 100% of a group, measured from the transcript, with gatekeeper blocks counted separately', () => {
  const mk = (id, result, stats, callType = 'conversation') => ({
    call: { id, sdrName: 'Luke', tags: [], durationMin: 1 },
    analysis: { schema: 6, stats, coachable: true, callType, openerResult: result, nextStepSecured: false, craft: {}, objections: [], prospect: {}, opener: { style: 'cold_permission_ask', quote: 'x' },
      positioning: { recorded: true, lead: 'ai', mentionsAi: true, when: 'opening', quote: 'x', quoteEn: 'x', reaction: 'neutral' } },
  });
  const LONG = { prospectWordsAfterOpening: 80, turnsAfterOpening: 10 };
  const SHORT = { prospectWordsAfterOpening: 12, turnsAfterOpening: 3 };
  const t = buildTrends([
    mk('1', 'stayed_engaged', LONG),
    mk('2', 'hung_up', SHORT),
    mk('3', 'blocked_by_gatekeeper', LONG, 'gatekeeper'), // a long chat with a gatekeeper is not "stayed on"
    mk('4', 'unclear', { prospectWordsAfterOpening: 45, turnsAfterOpening: 4 }), // enough words, too few turns
  ]);
  const ai = t.positioning.find((r) => r.key === 'ai');
  assert.equal(ai.stayed, 1);
  assert.equal(ai.hungUp, 3);
  assert.equal(ai.stayedRate + ai.hungUpRate, 1);
  assert.equal(ai.blocked, 1);
  const opener = t.openers.find((o) => o.style === 'cold_permission_ask');
  assert.equal(opener.stayedRate + opener.hungUpRate, 1);
});

test('calls analysed before the latest rules, or without the stay-on numbers, are left out of the two comparison cards', () => {
  const base = { callType: 'conversation', coachable: true, openerResult: 'stayed_engaged', nextStepSecured: false, craft: {}, objections: [], prospect: {}, opener: { style: 'credentials_first', quote: 'x' },
    positioning: { recorded: true, lead: 'ai', mentionsAi: true, when: 'opening', quote: 'x', quoteEn: 'x', reaction: 'neutral' } };
  const pair = (id, extra) => ({ call: { id, sdrName: 'L', tags: [], durationMin: 1 }, analysis: { ...base, ...extra } });
  const t = buildTrends([
    pair('new', { schema: 6, stats: { prospectWordsAfterOpening: 80, turnsAfterOpening: 10 } }),
    pair('old', { schema: 3, stats: { prospectWordsAfterOpening: 80, turnsAfterOpening: 10 } }),
    pair('nonumbers', { schema: 6 }),
  ]);
  assert.deepEqual(t.latestRules, { used: 1, total: 3 });
  assert.equal(t.openers.reduce((n, o) => n + o.calls, 0), 1);
});

test('a missing positioning is not recorded, and is not counted as "did not say"', () => {
  const { positioningUnrecorded } = require('../src/lib/analysis');
  const turns = [{ who: 'sdr', text: 'Hello' }, { who: 'prospect', text: 'Hi' }];
  const base = { call_type: 'conversation', coachable: false, opener_result: 'unclear', next_step_secured: false, meddpicc: {}, craft: {}, objections: [] };
  const omitted = validate({ ...base }, turns);
  assert.equal(omitted.positioning, null);
  assert.equal(positioningUnrecorded(omitted), true);
  assert.equal(positioningUnrecorded({ ...omitted, askedTwice: true }), false); // asked twice and left out: not offered again
  const judged = validate({ ...base, positioning: { lead: 'none', when: 'never', reaction: 'ended', note: 'Hung up before the SDR said what we do.' } }, turns);
  assert.equal(judged.positioning.recorded, true);
  assert.equal(positioningUnrecorded(judged), false);
  // Older stored analyses carrying a blank default are treated as not recorded too.
  assert.equal(positioningUnrecorded({ callType: 'conversation', schema: 4, positioning: { lead: 'none', when: 'never', quote: null, reaction: 'unclear', note: '' } }), true);
  const t = buildTrends([{ call: { id: '1', sdrName: 'L', tags: [], durationMin: 1 }, analysis: { ...omitted, coachable: false, prospect: {}, opener: { style: 'other' } } }]);
  assert.equal(t.positioningCalls, 0);
});

test('"apology" is an opener type, and the old "checking who it is" type now counts as other', () => {
  const { SYSTEM, OPENER_LABELS } = require('../src/lib/analysis');
  const turns = [{ who: 'sdr', text: 'Sorry for calling you out of the blue.' }, { who: 'prospect', text: 'Who is this?' }];
  const base = { call_type: 'conversation', coachable: false, opener_result: 'stayed_engaged', next_step_secured: false, meddpicc: {}, craft: {}, objections: [] };
  assert.equal(validate({ ...base, opener: { style: 'apology', quote: 'Sorry for calling you out of the blue.' } }, turns).opener.style, 'apology');
  assert.equal(validate({ ...base, opener: { style: 'named_person_ask' } }, turns).opener.style, 'other');
  assert.equal(OPENER_LABELS.apology, 'Apology');
  assert.match(SYSTEM, /Ignore that step/); // checking who is on the line is ignored; what comes next decides
});

// ---- warm and cold, and the stay-on numbers ----
test('trends can be limited to warm or cold calls, and warm means an earlier contact', async () => {
  await withServer(async ({ json, calls, deps }) => {
    const save = (id, style) => deps.store.saveAnalysis(id, {
      callType: 'conversation', language: 'English', schema: 6, positioning: { recorded: true, lead: 'none', when: 'never' }, stats: { prospectWordsAfterOpening: 80, turnsAfterOpening: 10 }, opener: { recorded: true, style: 'other', quote: 'x' },
      coachable: true, openerResult: 'stayed_engaged', nextStepSecured: false, craft: {}, prospect: {}, objections: [], opener: { style, quote: 'x' },
    });
    for (const id of ['1', '2', '3']) calls.find((c) => c.id === id).coachingStatus = 'Analysed';
    await save('1', 'cold_permission_ask');
    await save('2', 'warm_followup'); // says it refers to an earlier contact
    await save('3', 'credentials_first');
    // Call 3 went to a number we had already spoken to (call 1, earlier, answered): warm without saying so.
    calls.find((c) => c.id === '1').externalPhone = '447700900111';
    calls.find((c) => c.id === '3').externalPhone = '447700900111';
    const all = await json('/trends', SAM);
    assert.deepEqual(all.temperature, { selected: 'all', all: 3, warm: 2, cold: 1 });
    const warm = await json('/trends?temp=warm', SAM);
    assert.equal(warm.trends.analysedCalls, 2);
    assert.equal(warm.temperature.selected, 'warm');
    const cold = await json('/trends?temp=cold', SAM);
    assert.equal(cold.trends.analysedCalls, 1);
    assert.equal(cold.trends.openers[0].style, 'cold_permission_ask');
  });
});

test('an analysis that only lacks the stay-on numbers is updated from the transcript without calling Claude', async () => {
  await withServer(async ({ json, calls, deps, log }) => {
    calls.find((c) => c.id === '1').coachingStatus = 'Analysed';
    await deps.store.saveAnalysis('1', {
      callType: 'conversation', language: 'English', schema: 6, positioning: { recorded: true, lead: 'none', when: 'never' },
      coachable: true, openerResult: 'stayed_engaged', nextStepSecured: false, craft: {}, prospect: {}, objections: [], opener: { recorded: true, style: 'other', quote: 'x' },
    });
    const list = await json('/calls', LUKE);
    assert.equal(list.calls.find((c) => c.id === '1').refresh, 'numbers');
    const res = await json('/analyse', LUKE, { method: 'POST', body: JSON.stringify({ ids: ['1'] }) });
    assert.equal(res.results[0].numbersOnly, true);
    assert.equal(res.results[0].saved, true);
    assert.ok(Number.isFinite(res.results[0].analysis.stats.prospectWordsAfterOpening));
    assert.deepEqual(log.analysed, []); // Claude was never asked
    const after = await json('/calls', LUKE);
    assert.equal(after.calls.find((c) => c.id === '1').refresh, null);
  });
});

test('the transcript gives the prospect words and turns after the opening', () => {
  const t = parseTranscript('Call Transcription:\nSam Fessey: Is that Alex?\n+447000000001 Aircall new contact: Yes speaking.\nSam Fessey: Hi it is Sam from boost.\n+447000000001 Aircall new contact: Hello how can I help you today then.\nSam Fessey: We help with monday.', 'Sam Fessey');
  assert.equal(t.stats.turnsAfterOpening, 3);
  assert.equal(t.stats.prospectWordsAfterOpening, 8);
});

test('a real conversation with key moments but no craft scores is still sent back for the scores', async () => {
  const { analyseCall } = require('../src/lib/analysis');
  await withKey(async () => {
    const bodies = [];
    const withExchange = { key_exchanges: [{ kind: 'prospect_question', prospect_quote: 'What exactly does boost offer?', verdict: 'missed', what_happened: 'x', better: 'y' }] };
    const fetchImpl = async (_u, init) => {
      bodies.push(JSON.parse(init.body));
      // The first answer treated the call as not coachable: moments recorded, craft left blank.
      return bodies.length === 1 ? toolReply({ ...posBase, coachable: false, ...withExchange }) : toolReply({ ...posBase, craft: { opening: { score: 3 }, discovery: { score: 1 } }, ...withExchange });
    };
    const out = await analyseCall({ turns: longTurns, call: { durationMin: 4 } }, { fetchImpl });
    assert.equal(bodies.length, 2);
    assert.equal(out.craft.discovery.score, 1);
  });
});

test('Role check is an opener type, and Problem or result hook stays', () => {
  const { OPENER_LABELS, SYSTEM } = require('../src/lib/analysis');
  const turns = [{ who: 'sdr', text: 'I saw you are head of operations at Gridserv, is that still right?' }, { who: 'prospect', text: 'Yes.' }];
  const base = { call_type: 'conversation', coachable: false, opener_result: 'stayed_engaged', next_step_secured: false, craft: {}, objections: [] };
  assert.equal(validate({ ...base, opener: { style: 'role_check' } }, turns).opener.style, 'role_check');
  assert.equal(validate({ ...base, opener: { style: 'pain_question_hook' } }, turns).opener.style, 'pain_question_hook');
  assert.equal(OPENER_LABELS.role_check, 'Role check');
  assert.equal(OPENER_LABELS.pain_question_hook, 'Problem or result hook');
  assert.equal(/MEDDPICC/.test(SYSTEM), false); // not part of the analysis any more
});

test('a short brushed-off call still gets its opening scored, and is sent back if it comes back with no craft at all', async () => {
  const { analyseCall, isThin } = require('../src/lib/analysis');
  const shortTurns = [{ who: 'sdr', text: 'Sorry, mate. I know it is a little out of the blue.' }, { who: 'prospect', text: 'Not really, no thanks.' }];
  assert.equal(isThin({ callType: 'early_hangup', craft: {} }), true);
  assert.equal(isThin({ callType: 'early_hangup', craft: { opening: { score: 2 } } }), false);
  assert.equal(isThin({ callType: 'voicemail', craft: {} }), false);
  await withKey(async () => {
    const bodies = [];
    const base = { call_type: 'early_hangup', coachable: false, opener_result: 'brushed_off', next_step_secured: false, objections: [], key_exchanges: [], positioning: { lead: 'none', when: 'never' } };
    const fetchImpl = async (_u, init) => {
      bodies.push(JSON.parse(init.body));
      return bodies.length === 1 ? toolReply({ ...base, craft: {} }) : toolReply({ ...base, craft: { opening: { score: 2, note: 'Apologised and was vague.' } } });
    };
    const out = await analyseCall({ turns: shortTurns, call: { durationMin: 1 } }, { fetchImpl });
    assert.equal(bodies.length, 2);
    assert.equal(out.craft.opening.score, 2);
  });
});

test('an analysis that came back with no opener is never counted as "Other", and is sent back for it', async () => {
  const { openerUnrecorded, missingParts, validate: v } = require('../src/lib/analysis');
  const turns = [{ who: 'sdr', text: 'Hello' }, { who: 'prospect', text: 'Hi' }];
  const base = { call_type: 'early_hangup', coachable: false, opener_result: 'brushed_off', next_step_secured: false, craft: { opening: { score: 2 } }, objections: [], positioning: { lead: 'none', when: 'never' } };
  const without = v({ ...base }, turns);
  assert.equal(without.opener, null);
  assert.equal(openerUnrecorded(without), true);
  assert.equal(openerUnrecorded({ ...without, askedTwice: true }), false); // asked twice and left out: not offered again
  assert.ok(missingParts(without).some((p) => /"opener"/.test(p)));
  const withOne = v({ ...base, opener: { style: 'apology', quote: 'Hello' } }, turns);
  assert.equal(withOne.opener.style, 'apology');
  assert.equal(openerUnrecorded(withOne), false);
  // An older stored analysis holding a default "other" with no words is also not an opener.
  assert.equal(openerUnrecorded({ callType: 'conversation', schema: 6, opener: { style: 'other', quote: null, note: '' } }), true);
  // The opener cards leave those out instead of showing them as Other.
  const t = buildTrends([{ call: { id: '1', sdrName: 'L', tags: [], durationMin: 1 }, analysis: { ...without, schema: 6, stats: { prospectWordsAfterOpening: 80, turnsAfterOpening: 10 }, positioning: { recorded: true, lead: 'ai', mentionsAi: true, when: 'opening', quote: 'x', quoteEn: 'x', reaction: 'neutral' }, prospect: {}, coachable: true, callType: 'conversation', objections: [] } }]);
  assert.equal(t.openers.length, 0);
  assert.equal(t.positioningCalls, 1);
});

// ---- the board's status column tells the truth ----
const settle = () => new Promise((r) => setTimeout(r, 40)); // the board is updated just behind the response

test('calls waiting for their first analysis are shown as "Waiting to be analysed" on the board', async () => {
  await withServer(async ({ json, log, calls }) => {
    await json('/calls', LUKE);
    await settle();
    assert.ok((log.statuses || []).some(([id, label]) => id === '1' && label === 'Waiting to be analysed'));
    assert.equal(calls.find((c) => c.id === '1').coachingStatus, 'Waiting to be analysed');
    // It is not asked again on the next look.
    const before = log.statuses.length;
    await json('/calls', LUKE);
    await settle();
    assert.equal(log.statuses.length, before);
  });
});

test('a call analysed under older rules goes to "Waiting to be re-analysed", is analysed again, and ends up "Analysed"', async () => {
  await withServer(async ({ json, log, calls, deps }) => {
    calls.find((c) => c.id === '1').coachingStatus = 'Analysed';
    await deps.store.saveAnalysis('1', { callType: 'conversation', language: 'English', schema: 2, coachable: true, openerResult: 'stayed_engaged', nextStepSecured: false, craft: {}, prospect: {}, objections: [] });

    const first = await json('/calls', LUKE); // the response already treats it as waiting
    assert.equal(first.calls.find((c) => c.id === '1').status, 'waiting');
    await settle();
    assert.equal(calls.find((c) => c.id === '1').coachingStatus, 'Waiting to be re-analysed'); // and the board says so

    // From now on it is waiting without needing its old analysis read again, and it counts as a redo.
    const second = await json('/calls', LUKE);
    const row = second.calls.find((c) => c.id === '1');
    assert.equal(row.status, 'waiting');
    assert.equal(row.refresh, 'outdated');
    assert.ok(second.refreshCount >= 1);

    // Analysing it saves the result, then the board says Analysed.
    const res = await json('/analyse', LUKE, { method: 'POST', body: JSON.stringify({ ids: ['1'] }) });
    assert.equal(res.results[0].saved, true);
    assert.equal(calls.find((c) => c.id === '1').coachingStatus, 'Analysed');
    assert.deepEqual(log.analysed, ['1']);
    const third = await json('/calls', LUKE);
    assert.equal(third.calls.find((c) => c.id === '1').status, 'analysed');
  });
});

const CURRENT_ANALYSIS = { callType: 'conversation', language: 'English', schema: 6, positioning: { recorded: true, lead: 'none', when: 'never' }, stats: { prospectWordsAfterOpening: 80, turnsAfterOpening: 10 }, opener: { recorded: true, style: 'other', quote: 'x' }, coachable: true };
test('a call the board shows as waiting to be re-analysed but with a current saved analysis is shown as analysed and set back to Analysed', async () => {
  await withServer(async ({ json, calls, deps }) => {
    calls.find((c) => c.id === '1').coachingStatus = 'Waiting to be re-analysed';
    await deps.store.saveAnalysis('1', { ...CURRENT_ANALYSIS });
    const res = await json('/calls', LUKE);
    await settle();
    assert.equal(res.calls.find((c) => c.id === '1').status, 'analysed');
    assert.equal(calls.find((c) => c.id === '1').coachingStatus, 'Analysed');
  });
});

test('a call whose saved analysis could not be read is not flipped to waiting', async () => {
  await withServer(async ({ json, log, calls, unreadable }) => {
    calls.find((c) => c.id === '1').coachingStatus = 'Analysed';
    unreadable.add('1');
    await json('/calls', LUKE);
    await settle();
    assert.equal((log.statuses || []).some(([id]) => id === '1'), false);
    assert.equal(calls.find((c) => c.id === '1').coachingStatus, 'Analysed');
  });
});

// ---- the board is set from what is saved as soon as the server starts ----
async function withBootServer(opts, fn) {
  if (typeof opts === 'function') { fn = opts; opts = {}; }
  const ctx = makeDeps(opts);
  const router = createRouter(ctx.deps, { now: () => Date.parse('2026-11-04T12:00:00Z') });
  await fn({ router, ...ctx });
}

test('on start the board is set from what is saved: current is Analysed, older rules and nothing saved are waiting to be re-analysed', async () => {
  await withBootServer(async ({ router, log, calls, deps }) => {
    for (const id of ['1', '2', '3']) calls.find((c) => c.id === id).coachingStatus = 'Analysed';
    await deps.store.saveAnalysis('1', { ...CURRENT_ANALYSIS });
    await deps.store.saveAnalysis('2', { ...CURRENT_ANALYSIS, schema: 4 });
    const result = await router.boot();
    assert.equal(result.failed, 0);
    assert.equal(calls.find((c) => c.id === '1').coachingStatus, 'Analysed');
    assert.equal(calls.find((c) => c.id === '2').coachingStatus, 'Waiting to be re-analysed');
    assert.equal(calls.find((c) => c.id === '3').coachingStatus, 'Waiting to be re-analysed'); // nothing saved
    assert.equal(log.analysed.length, 0); // nothing was sent to Claude
  });
});

test('a restart cannot undo finished work: calls set to waiting but with a current saved analysis go back to Analysed', async () => {
  await withBootServer(async ({ router, calls, deps }) => {
    calls.find((c) => c.id === '1').coachingStatus = 'Waiting to be re-analysed';
    await deps.store.saveAnalysis('1', { ...CURRENT_ANALYSIS });
    await router.boot();
    assert.equal(calls.find((c) => c.id === '1').coachingStatus, 'Analysed');
    await router.boot(); // starting again changes nothing further
    assert.equal(calls.find((c) => c.id === '1').coachingStatus, 'Analysed');
  });
});

test('a saved analysis that cannot be read on start is left alone', async () => {
  await withBootServer(async ({ router, calls, unreadable }) => {
    calls.find((c) => c.id === '1').coachingStatus = 'Analysed';
    unreadable.add('1');
    await router.boot();
    assert.equal(calls.find((c) => c.id === '1').coachingStatus, 'Analysed');
  });
});

test('new calls with a usable transcript are set to waiting to be analysed every few minutes, whether or not anyone opens the page', async () => {
  await withBootServer(async ({ router, calls }) => {
    const result = await router.tick();
    assert.ok(result.changed >= 1);
    assert.equal(calls.find((c) => c.id === '1').coachingStatus, 'Waiting to be analysed');
    assert.equal(calls.find((c) => c.id === '6').coachingStatus || null, null); // transcript too short: left blank
  });
});

// ---- the audit: what is saved, set against what the board says ----
test('the audit counts what is saved against the board and names the disagreements, and only managers can see it', async () => {
  await withServer(async ({ json, call, calls, deps }) => {
    const set = (id, label) => { calls.find((c) => c.id === id).coachingStatus = label; };
    set('1', 'Analysed'); set('2', 'Analysed'); set('3', 'Analysed'); set('6', 'Waiting to be re-analysed');
    await deps.store.saveAnalysis('1', { ...CURRENT_ANALYSIS });                       // fine
    await deps.store.saveAnalysis('2', { ...CURRENT_ANALYSIS, schema: 4 });             // older rules
    // call 3: Analysed on the board, nothing saved
    await deps.store.saveAnalysis('6', { ...CURRENT_ANALYSIS });                       // waiting, but complete
    const audit = await json('/audit', SAM);
    assert.equal(audit.rulesVersion, require('../src/lib/analysis').ANALYSIS_SCHEMA);
    assert.equal(audit.saved.record, 3);
    const count = (key) => audit.problems.find((p) => p.key === key).count;
    assert.equal(count('analysedButNothingSaved'), 1);
    assert.equal(count('analysedButOlderRules'), 1);
    assert.equal(count('waitingButCurrentAndComplete'), 1);
    assert.equal(count('analysedButIncomplete'), 0);
    assert.equal(audit.usedByOpeningCards, 2);
    const denied = await call('/audit', LUKE);
    assert.equal(denied.status, 403);
  });
});
