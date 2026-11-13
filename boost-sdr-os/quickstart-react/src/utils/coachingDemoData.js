// Sample data so the Coaching tab can be viewed before the server is connected.
// Names and quotes are invented.

const weekly = [
  { week: '2026-10-05', calls: 142, conversations: 21, booked: 3 },
  { week: '2026-10-12', calls: 158, conversations: 26, booked: 4 },
  { week: '2026-10-19', calls: 131, conversations: 19, booked: 2 },
  { week: '2026-10-26', calls: 167, conversations: 30, booked: 6 },
];

const stats = {
  calls: 598, outbound: 590, answered: 295, connected: 118, untaggedAnswered: 6, conversations: 96, meetingsBooked: 15,
  answeredRate: 0.5, connectRate: 0.2, conversationRate: 0.163, bookingRate: 0.156, avgConversationMin: 3.4, talkMinutes: 326,
  tags: { MeetingBooked: 15, '1.NoAnswer': 220, LeftVoicemail: 80 }, outcomes: {}, weekly,
};

const team = [
  { id: '1', name: 'Luke Birchley', calls: 210, connected: 44, connectRate: 0.21, conversations: 38, meetingsBooked: 7, conversationRate: 0.18, bookingRate: 0.18, connectRate: 0.22, avgConversationMin: 3.9 },
  { id: '2', name: 'Emad Mahamid', calls: 190, connected: 39, connectRate: 0.2, conversations: 31, meetingsBooked: 5, conversationRate: 0.16, bookingRate: 0.16, connectRate: 0.2, avgConversationMin: 3.1 },
  { id: '3', name: 'Sam Fessey', calls: 198, connected: 35, connectRate: 0.18, conversations: 27, meetingsBooked: 3, conversationRate: 0.14, bookingRate: 0.11, connectRate: 0.17, avgConversationMin: 3.2 },
];

const meddpicc = (vals) => Object.fromEntries(Object.entries(vals).map(([k, [label, avg, touchedShare]]) => [k, { label, avg, touchedShare }]));

export const demoOverview = {
  scope: { sdrId: null, isAdmin: true, days: 30 },
  stats,
  team,
  sdrs: team.map(({ id, name, calls }) => ({ id, name, calls })),
  analysedCount: 12,
  coachingFrom: '2026-11-01',
  connectionCheck: { analysed: 12, taggedConnectedButVoicemail: 1, untaggedButVoicemail: 2 },
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
  callType: 'conversation', coachable: true, nextStepSecured: true, openerResult: 'stayed_engaged', endedBy: 'sdr',
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
  objections: [{ category: 'no_time', stage: 'middle', quote: 'we are really busy right now', responseQuote: 'totally get it, would ten minutes next week be easier', handled: 'well', why: 'Acknowledged, then made the ask smaller.' }],
  bestMoment: { quote: 'totally get it, would ten minutes next week be easier', why: 'Turned a brush-off into a specific next step.' },
  missedMoment: { quote: 'it is a mess', better: 'Ask what the mess costs them each week before moving on.' },
  tryNextTime: ['When someone says it is a mess, ask: "what does that cost you in a typical week?"', 'Name the decision maker: "who else would need to see this?"'],
};

const hangup = {
  callType: 'early_hangup', coachable: false, nextStepSecured: false, openerResult: 'hung_up', endedBy: 'prospect',
  summary: 'The prospect said they do not take sales calls and hung up after the second sentence.',
  meddpicc: {}, craft: {}, prospect: { role: null, seniority: 'unknown', industry: null },
  opener: { style: 'direct_pitch', quote: 'we help companies get more out of monday.com', note: 'Went straight into the pitch before asking for a moment.' },
  objections: [{ category: 'not_interested', stage: 'opener', quote: 'we do not take sales calls', responseQuote: null, handled: 'poorly', why: 'No reply before the line went dead.' }],
  bestMoment: null, missedMoment: { quote: 'we do not take sales calls', better: 'Acknowledge it and ask one specific question about their pipeline before they go.' },
  tryNextTime: ['Open with who you are and ask for ten seconds before the pitch.'],
};

const hebrewCall = {
  callType: 'conversation', language: 'Hebrew', coachable: true, nextStepSecured: true, openerResult: 'stayed_engaged', endedBy: 'sdr',
  summary: 'The prospect said they were busy, the SDR acknowledged it and asked for a shorter slot next week, and they agreed to ten minutes.',
  meddpicc: { identify_pain: { score: 1, evidence: 'אין לי זמן עכשיו', evidenceEn: 'I do not have time right now' } },
  craft: { opening: { score: 4, note: 'Asked permission before pitching.' }, discovery: { score: null, note: '' }, objection_handling: { score: 4, note: 'Acknowledged the objection, then made the ask smaller.' }, next_step_ask: { score: 4, note: 'Asked for a specific time.' }, tone_and_control: { score: 4, note: 'Calm and respectful.' } },
  prospect: { role: null, seniority: 'unknown', industry: null },
  opener: { style: 'permission_based', quote: 'יש לך רגע', quoteEn: 'do you have a moment', note: 'Asked permission first.' },
  objections: [{ category: 'no_time', stage: 'opener', quote: 'אין לי זמן עכשיו', quoteEn: 'I do not have time right now', responseQuote: 'אפשר עשר דקות בשבוע הבא', responseQuoteEn: 'could we do ten minutes next week', handled: 'well', why: 'Acknowledged, then made the ask smaller.' }],
  bestMoment: { quote: 'מבין לגמרי', quoteEn: 'I completely understand', why: 'Showed empathy before making the ask.' },
  missedMoment: null,
  tryNextTime: ['Ask one question about how they run their pipeline today before booking the follow-up.'],
};

export const demoCalls = {
  waitingCount: 2,
  rules: { from: '2026-11-01', minChars: 250 },
  coverage: [
    { sdrId: '3', sdrName: 'Tayla Jones', answered: 41, withTranscript: 38 },
    { sdrId: '2', sdrName: 'Emad Mahamid', answered: 29, withTranscript: 11 },
    { sdrId: '1', sdrName: 'Luke Birchley', answered: 33, withTranscript: 0 },
  ],
  calls: [
    { id: 'd1', sdrId: '1', sdrName: 'Luke Birchley', startedAt: '2026-11-02 14:56', createdAt: '2026-11-02T14:57:00Z', durationMin: 11, outcome: 'Outbound answered', tags: ['MeetingBooked'], recordingUrl: null, status: 'analysed', transcript: { available: true }, analysis },
    { id: 'd2', sdrId: '2', sdrName: 'Emad Mahamid', startedAt: '2026-11-02 14:44', createdAt: '2026-11-02T14:44:00Z', durationMin: 4, outcome: 'Outbound answered', tags: [], recordingUrl: null, status: 'waiting', transcript: { available: true, chars: 1800 }, analysis: null },
    { id: 'd3', sdrId: '3', sdrName: 'Tayla Jones', startedAt: '2026-11-04 10:14', createdAt: '2026-11-04T10:14:00Z', durationMin: 0, outcome: 'Outbound answered', tags: [], recordingUrl: null, status: 'analysed', transcript: { available: true }, analysis: hangup },
    { id: 'd5', sdrId: '2', sdrName: 'Emad Mahamid', startedAt: '2026-11-03 11:05', createdAt: '2026-11-03T11:05:00Z', durationMin: 3, outcome: 'Outbound answered', tags: [], recordingUrl: null, status: 'analysed', transcript: { available: true }, analysis: hebrewCall },
    { id: 'd4', sdrId: '3', sdrName: 'Tayla Jones', startedAt: '2026-11-04 10:22', createdAt: '2026-11-04T10:22:00Z', durationMin: 1, outcome: 'Outbound answered', tags: [], recordingUrl: null, status: 'waiting', transcript: { available: true, chars: 640 }, analysis: null },
  ],
};

export const demoTrends = {
  scope: { sdrId: null, days: 30 },
  analysedCount: 12,
  trends: {
    analysedCalls: 12, coachableCalls: 7, bookedCalls: 4, objectionCount: 17,
    topObjections: [
      { category: 'send_email', label: 'Send me an email', count: 6, share: 0.35, handledWell: 2, handledPoorly: 3, bookedAfter: 1, examples: [{ quote: 'just send me something over', sdrName: 'Emad Mahamid' }] },
      { category: 'no_time', label: 'No time', count: 5, share: 0.29, handledWell: 4, handledPoorly: 0, bookedAfter: 3, examples: [{ quote: 'we are really busy right now', sdrName: 'Tayla Jones' }] },
      { category: 'not_interested', label: 'Not interested', count: 4, share: 0.24, handledWell: 1, handledPoorly: 3, bookedAfter: 0, examples: [] },
      { category: 'already_have_solution', label: 'Already have a solution', count: 2, share: 0.12, handledWell: 1, handledPoorly: 1, bookedAfter: 0, examples: [{ quote: 'we already run everything in monday', sdrName: 'Tayla Jones' }] },
    ],
    bestHandling: [
      { category: 'no_time', label: 'No time', examples: [{ sdrName: 'Tayla Jones', quote: 'we are really busy right now', response: 'totally get it, would ten minutes next week be easier', why: 'Acknowledged, then made the ask smaller.', booked: true, stayed: true, startedAt: '2026-11-02 14:56', callId: 'd1' }] },
    ],
    earlyObjections: [
      { category: 'not_interested', label: 'Not interested', count: 4, handledWell: 1, handledPoorly: 3, bookedAfter: 0, stayedAfter: 1, hungUpAfter: 3, examples: [{ sdrName: 'Tayla Jones', stage: 'opener', quote: 'not interested thanks', response: 'fair enough, can I ask one quick question before you go', why: 'Accepted it, then made the next ask tiny.', booked: false, stayed: true, startedAt: '2026-11-04 10:12', callId: 'd5' }] },
      { category: 'send_email', label: 'Send me an email', count: 3, handledWell: 1, handledPoorly: 2, bookedAfter: 0, stayedAfter: 1, hungUpAfter: 1, examples: [] },
    ],
    openers: [
      { style: 'permission_based', label: 'Permission based', calls: 6, stayed: 4, stayedRate: 0.67, hungUp: 1, hungUpRate: 0.17, booked: 3, bookedRate: 0.5, nextStepRate: 0.67, stayExamples: [{ quote: 'have you got ten seconds', sdrName: 'Tayla Jones' }], hangUpExamples: [] },
      { style: 'direct_pitch', label: 'Direct pitch', calls: 5, stayed: 1, stayedRate: 0.2, hungUp: 3, hungUpRate: 0.6, booked: 1, bookedRate: 0.2, nextStepRate: 0.2, stayExamples: [], hangUpExamples: [{ quote: 'we help companies get more out of monday.com', sdrName: 'Luke Birchley' }] },
      { style: 'referral_or_context', label: 'Referral or context', calls: 1, stayed: 1, stayedRate: 1, hungUp: 0, hungUpRate: 0, booked: 0, bookedRate: 0, nextStepRate: 1, stayExamples: [], hangUpExamples: [] },
    ],
    hangups: {
      count: 4, share: 0.33,
      reasons: [
        { category: 'not_interested', label: 'Not interested', count: 2, examples: [{ quote: 'we do not take sales calls', sdrName: 'Luke Birchley', opener: null }] },
        { category: 'no_objection_given', label: 'Hung up without saying why', count: 2, examples: [] },
      ],
    },
    profile: {
      bySeniority: [
        { label: 'Manager', calls: 5, booked: 2, bookedRate: 0.4 }, { label: 'VP or director', calls: 4, booked: 2, bookedRate: 0.5 },
        { label: 'C-level', calls: 2, booked: 0, bookedRate: 0 }, { label: 'Not stated', calls: 1, booked: 0, bookedRate: 0 },
      ],
      byIndustry: [
        { label: 'software', calls: 4, booked: 2, bookedRate: 0.5 }, { label: 'professional services', calls: 3, booked: 1, bookedRate: 0.33 },
      ],
      bookedRoles: [{ label: 'head of sales', count: 2 }, { label: 'operations manager', count: 1 }],
    },
    talk: {
      booked: { calls: 4, avgSdrShare: 0.41, avgQuestions: 8.5, avgLongestSdrTurnWords: 38, avgDurationMin: 7.2 },
      notBooked: { calls: 8, avgSdrShare: 0.58, avgQuestions: 4.1, avgLongestSdrTurnWords: 71, avgDurationMin: 3.6 },
    },
    sdrs: [
      { id: '3', name: 'Tayla Jones', analysedCalls: 8, booked: 3, stayedRate: 0.63, nextStepRate: 0.5, objectionsHandledWellRate: 0.6, avgCraft: 3.7 },
      { id: '2', name: 'Emad Mahamid', analysedCalls: 4, booked: 1, stayedRate: 0.25, nextStepRate: 0.25, objectionsHandledWellRate: 0.25, avgCraft: 3.1 },
    ],
  },
};
