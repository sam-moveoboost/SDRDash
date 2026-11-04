// Sample data so the Coaching tab can be viewed before the server is connected.
// Names and quotes are invented.

const weekly = [
  { week: '2026-10-05', calls: 142, conversations: 21, booked: 3 },
  { week: '2026-10-12', calls: 158, conversations: 26, booked: 4 },
  { week: '2026-10-19', calls: 131, conversations: 19, booked: 2 },
  { week: '2026-10-26', calls: 167, conversations: 30, booked: 6 },
];

const stats = {
  calls: 598, outbound: 590, answered: 118, conversations: 96, meetingsBooked: 15,
  connectRate: 0.2, conversationRate: 0.163, bookingRate: 0.156, avgConversationMin: 3.4, talkMinutes: 326,
  tags: { MeetingBooked: 15, '1.NoAnswer': 220, LeftVoicemail: 80 }, outcomes: {}, weekly,
};

const team = [
  { id: '1', name: 'Luke Birchley', calls: 210, conversations: 38, meetingsBooked: 7, conversationRate: 0.18, bookingRate: 0.18, connectRate: 0.22, avgConversationMin: 3.9 },
  { id: '2', name: 'Emad Mahamid', calls: 190, conversations: 31, meetingsBooked: 5, conversationRate: 0.16, bookingRate: 0.16, connectRate: 0.2, avgConversationMin: 3.1 },
  { id: '3', name: 'Sam Fessey', calls: 198, conversations: 27, meetingsBooked: 3, conversationRate: 0.14, bookingRate: 0.11, connectRate: 0.17, avgConversationMin: 3.2 },
];

const meddpicc = (vals) => Object.fromEntries(Object.entries(vals).map(([k, [label, avg, touchedShare]]) => [k, { label, avg, touchedShare }]));

export const demoOverview = {
  scope: { sdrId: null, isAdmin: true, days: 30 },
  stats,
  team,
  sdrs: team.map(({ id, name, calls }) => ({ id, name, calls })),
  transcribedCalls: 24,
  coaching: {
    analysedCalls: 12,
    enoughForFocus: true,
    minCallsForFocus: 3,
    nextStepRate: 0.42,
    focus: [
      { key: 'next_step_ask', label: 'Asking for the next step', kind: 'craft', value: 0.35 },
      { key: 'discovery', label: 'Discovery', kind: 'craft', value: 0.42 },
      { key: 'economic_buyer', label: 'Economic buyer', kind: 'meddpicc', value: 0.2 },
    ],
    strengths: [
      { key: 'opening', label: 'Opening', kind: 'craft', value: 0.78 },
      { key: 'tone_and_control', label: 'Tone and call control', kind: 'craft', value: 0.7 },
    ],
    meddpicc: meddpicc({
      metrics: ['Metrics', 0.2, 0.15], economic_buyer: ['Economic buyer', 0.4, 0.3], decision_criteria: ['Decision criteria', 0.1, 0.1],
      decision_process: ['Decision process', 0.3, 0.25], paper_process: ['Paper process', 0, 0], identify_pain: ['Identify pain', 1.3, 0.8],
      champion: ['Champion', 0.4, 0.3], competition: ['Competition', 0.5, 0.4],
    }),
    craft: {
      opening: { label: 'Opening', avg: 4.1 }, discovery: { label: 'Discovery', avg: 2.7 }, objection_handling: { label: 'Objection handling', avg: 3.2 },
      next_step_ask: { label: 'Asking for the next step', avg: 2.4 }, tone_and_control: { label: 'Tone and call control', avg: 3.8 },
    },
  },
};

const analysis = {
  callType: 'conversation', coachable: true, nextStepSecured: true,
  summary: 'The SDR reached a sales manager who admitted the pipeline lives in spreadsheets, then booked a short follow-up.',
  meddpicc: {
    metrics: { score: 0, evidence: null }, economic_buyer: { score: 1, evidence: 'my boss wants it sorted' }, decision_criteria: { score: 0, evidence: null },
    decision_process: { score: 0, evidence: null }, paper_process: { score: 0, evidence: null },
    identify_pain: { score: 2, evidence: 'we use spreadsheets mostly and it is a mess' }, champion: { score: 1, evidence: null }, competition: { score: 0, evidence: null },
  },
  craft: {
    opening: { score: 4, note: 'Clear who he was and why he was calling.' }, discovery: { score: 3, note: 'Good first question, but did not dig into the impact.' },
    objection_handling: { score: 4, note: 'Acknowledged the time pressure and offered a shorter slot.' },
    next_step_ask: { score: 4, note: 'Asked for a specific time.' }, tone_and_control: { score: 4, note: 'Relaxed and in control.' },
  },
  prospect: { role: 'Sales manager', seniority: 'manager', industry: 'software' },
  opener: { style: 'permission_based', quote: 'have you got a minute', note: 'Asked permission before pitching.' },
  objections: [{ category: 'no_time', quote: 'we are really busy right now', responseQuote: 'totally get it, would ten minutes next week be easier', handled: 'well', why: 'Acknowledged, then made the ask smaller.' }],
  bestMoment: { quote: 'totally get it, would ten minutes next week be easier', why: 'Turned a brush-off into a specific next step.' },
  missedMoment: { quote: 'it is a mess', better: 'Ask what the mess costs them each week before moving on.' },
  tryNextTime: ['When someone says it is a mess, ask: "what does that cost you in a typical week?"', 'Name the decision maker: "who else would need to see this?"'],
};

export const demoCalls = {
  calls: [
    { id: 'd1', sdrId: '1', sdrName: 'Luke Birchley', startedAt: '2026-11-02 14:56', durationMin: 11, outcome: 'Outbound answered', tags: ['MeetingBooked'], recordingUrl: null, transcript: { available: true, hasConversation: true, sdrShare: 0.41, sdrQuestions: 9 }, analysis },
    { id: 'd2', sdrId: '2', sdrName: 'Emad Mahamid', startedAt: '2026-11-02 14:44', durationMin: 4, outcome: 'Outbound answered', tags: [], recordingUrl: null, transcript: { available: true, hasConversation: true, sdrShare: 0.58, sdrQuestions: 4 }, analysis: null },
    { id: 'd3', sdrId: '3', sdrName: 'Sam Fessey', startedAt: '2026-10-28 14:03', durationMin: 2, outcome: 'Outbound answered', tags: ['1.NoAnswer'], recordingUrl: null, transcript: { available: true, hasConversation: false, sdrShare: 0.5, sdrQuestions: 1 }, analysis: { callType: 'not_a_conversation', coachable: false, summary: 'Too short or one-sided to coach (for example a gatekeeper, voicemail or phone menu).', meddpicc: {}, craft: {}, objections: [], tryNextTime: [] } },
    { id: 'd4', sdrId: '1', sdrName: 'Luke Birchley', startedAt: '2026-10-30 10:12', durationMin: 6, outcome: 'Outbound answered', tags: [], recordingUrl: null, transcript: { available: false }, analysis: null },
  ],
};

export const demoTrends = {
  scope: { sdrId: null, days: 30 },
  transcribedCalls: 24,
  trends: {
    analysedCalls: 12, bookedCalls: 4, objectionCount: 17,
    topObjections: [
      { category: 'send_email', label: 'Send me an email', count: 6, share: 0.35, handledWell: 2, handledPoorly: 3, bookedAfter: 1, examples: [{ quote: 'just send me something over', sdrName: 'Emad Mahamid' }] },
      { category: 'no_time', label: 'No time', count: 5, share: 0.29, handledWell: 4, handledPoorly: 0, bookedAfter: 3, examples: [{ quote: 'we are really busy right now', sdrName: 'Luke Birchley' }] },
      { category: 'already_have_solution', label: 'Already have a solution', count: 3, share: 0.18, handledWell: 1, handledPoorly: 1, bookedAfter: 0, examples: [{ quote: 'we already run everything in monday', sdrName: 'Sam Fessey' }] },
      { category: 'not_interested', label: 'Not interested', count: 3, share: 0.18, handledWell: 0, handledPoorly: 2, bookedAfter: 0, examples: [] },
    ],
    bestHandling: [
      { category: 'no_time', label: 'No time', examples: [{ sdrName: 'Luke Birchley', quote: 'we are really busy right now', response: 'totally get it, would ten minutes next week be easier', why: 'Acknowledged, then made the ask smaller.', booked: true, startedAt: '2026-11-02 14:56', callId: 'd1' }] },
      { category: 'send_email', label: 'Send me an email', examples: [{ sdrName: 'Luke Birchley', quote: 'just send me something over', response: 'happy to, what would make it worth your time reading it', why: 'Turned the brush-off into a question about their priorities.', booked: false, startedAt: '2026-10-29 11:20', callId: 'd5' }] },
    ],
    profile: {
      bySeniority: [
        { label: 'Manager', calls: 5, booked: 2, bookedRate: 0.4 }, { label: 'VP or director', calls: 4, booked: 2, bookedRate: 0.5 },
        { label: 'C-level', calls: 2, booked: 0, bookedRate: 0 }, { label: 'Not stated', calls: 1, booked: 0, bookedRate: 0 },
      ],
      byIndustry: [
        { label: 'software', calls: 4, booked: 2, bookedRate: 0.5 }, { label: 'professional services', calls: 3, booked: 1, bookedRate: 0.33 },
        { label: 'construction', calls: 2, booked: 0, bookedRate: 0 },
      ],
      bookedRoles: [{ label: 'head of sales', count: 2 }, { label: 'operations manager', count: 1 }, { label: 'ceo', count: 1 }],
    },
    openers: [
      { style: 'permission_based', label: 'Permission based', calls: 6, booked: 3, bookedRate: 0.5, nextStepRate: 0.67, examples: [{ quote: 'have you got a minute', sdrName: 'Luke Birchley' }] },
      { style: 'direct_pitch', label: 'Direct pitch', calls: 4, booked: 1, bookedRate: 0.25, nextStepRate: 0.25, examples: [] },
      { style: 'referral_or_context', label: 'Referral or context', calls: 2, booked: 0, bookedRate: 0, nextStepRate: 0.5, examples: [] },
    ],
    talk: {
      booked: { calls: 4, avgSdrShare: 0.41, avgQuestions: 8.5, avgLongestSdrTurnWords: 38, avgDurationMin: 7.2 },
      notBooked: { calls: 8, avgSdrShare: 0.58, avgQuestions: 4.1, avgLongestSdrTurnWords: 71, avgDurationMin: 3.6 },
    },
    sdrs: [
      { id: '1', name: 'Luke Birchley', analysedCalls: 5, booked: 3, nextStepRate: 0.6, objectionsHandledWellRate: 0.67, avgCraft: 3.8 },
      { id: '2', name: 'Emad Mahamid', analysedCalls: 4, booked: 1, nextStepRate: 0.25, objectionsHandledWellRate: 0.25, avgCraft: 3.1 },
      { id: '3', name: 'Sam Fessey', analysedCalls: 3, booked: 0, nextStepRate: 0.33, objectionsHandledWellRate: 0.2, avgCraft: 2.9 },
    ],
  },
};
