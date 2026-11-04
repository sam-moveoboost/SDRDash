// Shared constants for the coaching hub.

module.exports = {
  // monday user IDs allowed to see every SDR. Everyone else sees only their own calls.
  ADMIN_USER_IDS: ['97429928', '94869273'], // Sam Moore, Yarden Berrebi

  CALLS_BOARD: '5092898618', // Aircall Calls

  // Aircall Calls board columns
  COLS: {
    callId: 'text_mm19bbdq',
    bizdev: 'multiple_person_mm2cff2x',
    outcome: 'text_mm19p3gx',
    direction: 'text_mm195peh',
    agentName: 'text_mm19wwhm',
    tags: 'tag_mm193gqc',
    startedAt: 'date_mm19a9qc',
    answeredAt: 'date_mm19artx',
    endedAt: 'date_mm19jrq',
    recording: 'link_mm19c866',
    duration: 'formula_mm3jzhbk',
    coachingStatus: 'color_mm8sjkwt', // "Coaching analysis" status column, set to Analysed by the app
  },

  // Aircall counts a voicemail pick-up as "answered". SDRs tag those calls with one of
  // these, so a call only counts as a real connection if it carries none of them.
  NOT_CONNECTED_TAGS: ['1.NoAnswer', '3.Busy', 'LeftVoicemail', 'BadData'],

  STATUS_ANALYSED: 'Analysed',
  COACHING_FROM_MS: Date.parse('2026-11-01T00:00:00Z'), // nothing before this is analysed
  MIN_TRANSCRIPT_CHARS: 250, // shorter transcripts are ignored; short hang-ups still count above this

  CONVERSATION_MINUTES: 1, // matches the board's own "Conversation formula"
  MAX_DAYS: 120,
  MAX_ANALYSE_PER_REQUEST: 5,

  RUBRIC_VERSION: 1, // bump to re-analyse everything after changing the rubric
  CLAUDE_MODEL: 'claude-sonnet-5-5',
};
