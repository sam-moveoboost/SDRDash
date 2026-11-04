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

// A real conversation, long enough to pass the "has conversation" check.
const sdrLine = 'Hi, it is Luke from boost, we help teams get more out of monday.com and I wanted to ask how you currently run your sales pipeline today and who looks after it';
const prospectLine = 'We use spreadsheets mostly, and honestly it is a mess, our boss wants it sorted but we are really busy right now with the quarter end';
const CONVO = `Call ID: CA1\n\nCall Transcription:\n${Array.from({ length: 5 }, () => `+447000000001 Aircall new contact: ${prospectLine}\nLuke Birchley: ${sdrLine}`).join('\n')}`;

const calls = [
  { id: '1', sdrId: LUKE, sdrName: 'Luke Birchley', agentName: 'Luke Birchley', startedAt: '2026-11-02 14:00', durationMin: 5, outcome: 'Outbound answered', direction: 'outbound', tags: ['MeetingBooked'], recordingUrl: null },
  { id: '2', sdrId: EMAD, sdrName: 'Emad Mahamid', agentName: 'Emad Mahamid', startedAt: '2026-11-02 15:00', durationMin: 4, outcome: 'Outbound answered', direction: 'outbound', tags: [], recordingUrl: null },
  { id: '3', sdrId: LUKE, sdrName: 'Luke Birchley', agentName: 'Luke Birchley', startedAt: '2026-11-02 16:00', durationMin: 1, outcome: 'Outbound answered', direction: 'outbound', tags: [], recordingUrl: null },
];

function makeDeps() {
  const saved = new Map();
  const analysed = [];
  return {
    analysed,
    deps: {
      mondayApi: {
        fetchCalls: async () => calls,
        fetchTranscripts: async (ids) => Object.fromEntries(ids.map((id) => [id, CONVO.replace('Luke Birchley', calls.find((c) => c.id === id)?.agentName || 'Luke Birchley')])),
      },
      analysis: {
        notAConversation: () => ({ callType: 'not_a_conversation', coachable: false, meddpicc: {}, craft: {}, objections: [] }),
        analyseCall: async ({ call }) => {
          analysed.push(call.id);
          return { callType: 'conversation', coachable: true, nextStepSecured: true, meddpicc: {}, craft: {}, objections: [] };
        },
      },
      store: {
        getAnalysis: async (id) => saved.get(id) ?? null,
        saveAnalysis: async (id, a) => saved.set(id, a),
        mapLimit: async (items, _l, fn) => Promise.all(items.map(fn)),
      },
    },
  };
}

async function withServer(fn) {
  const { deps, analysed } = makeDeps();
  const app = express();
  app.use('/coaching', createRouter(deps));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}/coaching`;
  const call = (path, userId, init = {}) =>
    fetch(base + path, { ...init, headers: { ...(userId ? { Authorization: `Bearer ${token(userId)}` } : {}), 'content-type': 'application/json' } });
  try {
    await fn({ call, analysed, base });
  } finally {
    server.close();
  }
}

test('no token, a bad token and a token signed with the wrong secret are all refused', async () => {
  await withServer(async ({ call, base }) => {
    assert.equal((await call('/overview')).status, 401);
    const bad = await fetch(`${base}/overview`, { headers: { Authorization: 'Bearer nonsense' } });
    assert.equal(bad.status, 401);
    const forged = await fetch(`${base}/overview`, { headers: { Authorization: `Bearer ${token(SAM, 'wrong-secret')}` } });
    assert.equal(forged.status, 401);
  });
});

test('an SDR only ever sees their own calls and cannot ask for anyone else', async () => {
  await withServer(async ({ call }) => {
    const mine = await (await call('/overview', LUKE)).json();
    assert.equal(mine.stats.calls, 2); // Luke's two calls, not Emad's
    assert.deepEqual(mine.team, []);
    assert.deepEqual(mine.sdrs, []);

    assert.equal((await call(`/overview?userId=${EMAD}`, LUKE)).status, 403);
    assert.equal((await call('/overview?userId=all', LUKE)).status, 403);
    assert.equal((await call(`/calls?userId=${EMAD}`, LUKE)).status, 403);

    const list = await (await call('/calls', LUKE)).json();
    assert.ok(list.calls.every((c) => c.sdrId === LUKE));
  });
});

test('admins see the whole team and can pick one SDR', async () => {
  await withServer(async ({ call }) => {
    const all = await (await call('/overview', SAM)).json();
    assert.equal(all.stats.calls, 3);
    assert.equal(all.team.length, 2);
    assert.equal(all.sdrs.length, 2);

    const emad = await (await call(`/overview?userId=${EMAD}`, SAM)).json();
    assert.equal(emad.stats.calls, 1);
  });
});

test('an SDR cannot read or analyse someone else\'s call', async () => {
  await withServer(async ({ call, analysed }) => {
    assert.equal((await call('/calls/2/transcript', LUKE)).status, 404);
    assert.equal((await call('/calls/1/transcript', LUKE)).status, 200);

    const res = await (await call('/analyse', LUKE, { method: 'POST', body: JSON.stringify({ ids: ['2', '1'] }) })).json();
    assert.equal(res.results.find((r) => r.id === '2').error, 'not_found');
    assert.ok(res.results.find((r) => r.id === '1').analysis);
    assert.deepEqual(analysed, ['1']); // nothing was spent on Emad's call
  });
});

test('transcripts never expose prospect phone numbers', async () => {
  await withServer(async ({ call }) => {
    const body = JSON.stringify(await (await call('/calls/1/transcript', LUKE)).json());
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

test('parses the real English gatekeeper call and does not treat it as a conversation', () => {
  const raw = `Call ID: CAaf4\n\nCall Transcription:\n+448006335050 Aircall new contact: Total sales. Alex speaking.\nSam Fessey: Hi there. Sorry. Is is Jake available today at all?\n+448006335050 Aircall new contact: Who's sorry?\nSam Fessey: Jake Tibble?\n+448006335050 Aircall new contact: I can try and see if he's available.\nSam Fessey: Yeah. It's Sam Fessi from Boost regardingmonday.com.\n+448006335050 Aircall new contact: No worries. One moment, please.\nSam Fessey: Thanks, mate. Thank you.\n+448006335050 Aircall new contact: Unfortunately, I can't get ahold of him.\nSam Fessey: Okay. No stress.\n+448006335050 Aircall new contact: Bye\nSam Fessey: Bye.`;
  const parsed = parseTranscript(raw, 'Sam Fessey');
  assert.equal(parsed.turns[0].who, 'prospect');
  assert.equal(parsed.turns[1].who, 'sdr');
  assert.equal(parsed.stats.hasConversation, false);
});

test('a line with a colon inside it stays part of the same turn', () => {
  const parsed = parseTranscript('Call Transcription:\nSam Fessey: Here is the thing: it works\n+441 Aircall new contact: ok', 'Sam Fessey');
  assert.equal(parsed.turns.length, 2);
  assert.match(parsed.turns[0].text, /the thing: it works/);
});

test('quotes the model made up are dropped, real ones kept', () => {
  const turns = [{ who: 'prospect', text: 'We are not looking at any new tools this year, sorry.' }, { who: 'sdr', text: 'Totally fair, can I ask what you use today?' }];
  const out = validate({
    call_type: 'conversation',
    coachable: true,
    meddpicc: { identify_pain: { score: 2, evidence: 'We are not looking at any new tools this year' }, champion: { score: 2, evidence: 'I will champion this internally for you' } },
    objections: [
      { category: 'not_interested', quote: 'We are not looking at any new tools this year, sorry.', response_quote: 'Totally fair, can I ask what you use today?', handled: 'well', why: 'Acknowledged then asked a question' },
      { category: 'no_budget', quote: 'We have absolutely no budget at all', response_quote: 'Understood', handled: 'poorly', why: 'made up' },
    ],
    best_moment: { quote: 'a sentence that was never said on the call', why: 'x' },
    missed_moment: null,
  }, turns);
  assert.equal(out.meddpicc.identify_pain.evidence, 'We are not looking at any new tools this year');
  assert.equal(out.meddpicc.champion.evidence, null);
  assert.equal(out.objections.length, 1);
  assert.equal(out.objections[0].category, 'not_interested');
  assert.equal(out.bestMoment, null);
});

test('metrics count conversations and meetings booked', () => {
  const s = statsFor(calls);
  assert.equal(s.calls, 3);
  assert.equal(s.conversations, 2); // 5 and 4 minutes; the 1 minute call is not > 1
  assert.equal(s.meetingsBooked, 1);
});

test('focus areas need enough analysed calls', () => {
  const a = { coachable: true, callType: 'conversation', nextStepSecured: false, meddpicc: { identify_pain: { score: 2 } }, craft: { opening: { score: 4 }, next_step_ask: { score: 1 } } };
  assert.equal(summarise([a, a]).focus.length, 0);
  const s = summarise([a, a, a]);
  assert.ok(s.focus.length > 0);
  assert.equal(s.focus[0].key, 'next_step_ask'); // the weakest area comes first
});

test('trends group objections and find the best handling', () => {
  const mk = (id, sdrName, booked, objections) => ({
    call: { id, sdrId: id, sdrName, tags: booked ? ['MeetingBooked'] : [], durationMin: 4, startedAt: '2026-11-02 10:00' },
    analysis: { coachable: true, callType: 'conversation', nextStepSecured: booked, craft: {}, opener: { style: 'permission_based', quote: 'Got a minute?' }, prospect: { seniority: 'manager', role: 'Head of Sales', industry: 'software' }, objections },
    stats: { sdrShare: 0.4, sdrQuestions: 6, longestSdrTurnWords: 30 },
  });
  const obj = (handled) => [{ category: 'send_email', quote: 'Just send me an email', responseQuote: 'Happy to, what would make it worth reading?', handled, why: 'asked a follow up' }];
  const t = buildTrends([mk('1', 'Luke', true, obj('well')), mk('2', 'Emad', false, obj('poorly')), mk('3', 'Sam F', false, [])]);
  assert.equal(t.topObjections[0].category, 'send_email');
  assert.equal(t.topObjections[0].count, 2);
  assert.equal(t.bestHandling[0].examples[0].sdrName, 'Luke');
  assert.equal(t.profile.bySeniority[0].booked, 1);
  assert.equal(t.openers[0].style, 'permission_based');
  assert.equal(t.talk.booked.calls, 1);
});

test('parses a call exactly as the monday API returns it', () => {
  const { parseCall } = require('../src/lib/mondayApi');
  // Taken from the live Aircall Calls board (the Duration formula text is empty in the API).
  const call = parseCall({
    id: '3325335355',
    created_at: '2026-11-02T14:57:03Z',
    column_values: [
      { id: 'text_mm19bbdq', text: 'CA8ef9' },
      { id: 'multiple_person_mm2cff2x', text: 'Luke Birchley', persons_and_teams: [{ id: '104304092', kind: 'person' }] },
      { id: 'text_mm19p3gx', text: 'Outbound answered' },
      { id: 'text_mm195peh', text: 'outbound' },
      { id: 'text_mm19wwhm', text: 'Luke Birchley' },
      { id: 'tag_mm193gqc', text: 'MeetingBooked, FollowUpCall' },
      { id: 'date_mm19a9qc', text: '2026-11-02 14:56' },
      { id: 'date_mm19artx', text: '2026-11-02 14:56' },
      { id: 'date_mm19jrq', text: '2026-11-02 15:07' },
      { id: 'link_mm19c866', text: 'Recording - https://assets.aircall.io/calls/4300550213/recording' },
      { id: 'formula_mm3jzhbk', text: '' },
    ],
  });
  assert.equal(call.sdrId, '104304092');
  assert.equal(call.durationMin, 11);
  assert.deepEqual(call.tags, ['MeetingBooked', 'FollowUpCall']);
  assert.equal(call.recordingUrl, 'https://assets.aircall.io/calls/4300550213/recording');
});

test('the Claude call sends the right request and copes with fenced JSON', async () => {
  const { analyseCall } = require('../src/lib/analysis');
  const turns = [{ who: 'prospect', text: 'Just send me an email please.' }, { who: 'sdr', text: 'Happy to, what would make it worth reading?' }];
  const reply = { call_type: 'conversation', coachable: true, next_step_secured: false, meddpicc: {}, craft: {}, objections: [{ category: 'send_email', quote: 'Just send me an email please.', response_quote: 'Happy to, what would make it worth reading?', handled: 'well', why: 'asked a follow up' }] };
  let seen;
  const fetchImpl = async (url, init) => {
    seen = { url, init, body: JSON.parse(init.body) };
    return { ok: true, json: async () => ({ content: [{ type: 'text', text: `\`\`\`json\n${JSON.stringify(reply)}\n\`\`\`` }] }) };
  };

  delete process.env.ANTHROPIC_API_KEY;
  await assert.rejects(() => analyseCall({ turns, call: { durationMin: 3 } }, { fetchImpl }), /ANTHROPIC_API_KEY/);

  process.env.ANTHROPIC_API_KEY = 'sk-test-key';
  const out = await analyseCall({ turns, call: { durationMin: 3 } }, { fetchImpl });
  assert.equal(seen.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(seen.init.headers['x-api-key'], 'sk-test-key');
  assert.match(seen.body.messages[0].content, /PROSPECT: Just send me an email/);
  assert.equal(out.objections[0].category, 'send_email');
  assert.ok(!JSON.stringify(out).includes('sk-test-key'));
  delete process.env.ANTHROPIC_API_KEY;
});
