// ── Qualified meeting attribution ──────────────────────────────────
// One source of truth for "which rep gets credit for this meeting" and
// "which region does it belong to", shared by the stat cards, the
// leaderboard and the meetings drawer so their numbers always reconcile.
//
// Before this existed the team total counted every qualifying lead in the
// region, but the leaderboard only credited a rep when they were in the SDR
// column. Leads with a blank SDR column (common when a Hybrid rep or an SDR
// logs their own meeting and only fills Bizdev) were counted in the total
// and credited to nobody, and leads with a blank Region were dropped from
// every regional view even when the rep who booked them was in that region.

export const MEETING_COLS = {
  STATUS:        'lead_status',
  SDR:           'multiple_person_mm2bjm2z',
  BIZDEV:        'lead_owner',
  QUALIFIED:     'date_mm4wkg8g',
  REGION:        'color_mkz4y1yv',
  CHANNEL:       'color_mkxeqbfx',
  SOURCE:        'color_mkwrdphn',
  COMPANY:       'lead_company',
  MEETING_DATE:  'date_mm45gm2e',   // "MB Date" — when the meeting is booked for
  FIRST_MEETING: 'date_mkzvbcj4',
  CREATED:       'date_mkxsaf',
};

export const QUALIFYING_STATUSES = ['Qualified Opportunity', 'Qualifed Lead No Opp'];
export const EXCLUDED_CHANNELS = new Set(['monday.com Channel', 'monday.com Sales', 'monday.com PS']);

// Active (non-deactivated) labels on the Leads board's Status column, in board order.
export const LEAD_STATUS_OPTIONS = [
  'New Lead', 'Attempted to contact', 'Contacted', 'Priority Lead', 'Meeting Booked',
  'No Show/Resch.', 'Waiting to Qual.', 'Qualifed Lead No Opp', 'Qualified Opportunity',
  'Lead Unqualified', 'Duplicate', 'Referral Scheme',
];

export function meetingCol(item, id) {
  const cv = item.column_values?.find(c => c.id === id);
  return cv?.text || cv?.display_value || '';
}

function personIds(item, id) {
  const raw = item.column_values?.find(c => c.id === id)?.value;
  if (!raw) return [];
  try { return (JSON.parse(raw).personsAndTeams ?? []).map(p => String(p.id)); }
  catch { return []; }
}

export function isQualifyingMeeting(item) {
  return QUALIFYING_STATUSES.includes(meetingCol(item, MEETING_COLS.STATUS)) &&
    !EXCLUDED_CHANNELS.has(meetingCol(item, MEETING_COLS.CHANNEL));
}

export function isLeaderboardRep(member) {
  return ['SDR', 'Hybrid'].includes(member.role);
}

export function createdDate(item) {
  return meetingCol(item, MEETING_COLS.CREATED) || item.created_at?.slice(0, 10) || '';
}

export function meetingDate(item) {
  return meetingCol(item, MEETING_COLS.MEETING_DATE);
}

function inDateRange(date, { startDate, endDate }) {
  return !!date && date >= startDate && date <= endDate;
}

// Booked: the lead was created in the period AND has a meeting date. No MB
// Date means no credit: filling it in is what puts a booking on the board.
export function isBookedIn(item, range) {
  return !!meetingDate(item) && inDateRange(createdDate(item), range);
}

// Sitting: the meeting date (MB Date) falls in the period.
export function isSittingIn(item, range) {
  return inDateRange(meetingDate(item), range);
}

// Returns { reps, via, region, excluded } for a lead:
//   via = 'sdr'    — credited to the rep(s) in the SDR column
//   via = 'bizdev' — SDR column blank, Bizdev is an SDR/Hybrid rep, so they booked it themselves
//   via = null     — nobody on the leaderboard can be credited (needs an SDR assigned)
// region falls back to the credited rep's region when the lead's Region is blank.
// excluded = why the lead doesn't count anywhere ('No company' | 'No SDR'), or null.
// Excluded leads stay visible in the drawer but never reach a total or the podium,
// so the team figures always equal the sum of the reps.
export function attributeMeeting(item, team) {
  const reps = team.filter(isLeaderboardRep).filter(r => r.mondayUserId);
  const byId = new Map(reps.map(r => [r.mondayUserId, r]));

  const sdrIds = personIds(item, MEETING_COLS.SDR);
  let credited = sdrIds.map(id => byId.get(id)).filter(Boolean);
  let via = credited.length ? 'sdr' : null;

  if (!credited.length && sdrIds.length === 0) {
    credited = personIds(item, MEETING_COLS.BIZDEV).map(id => byId.get(id)).filter(Boolean);
    if (credited.length) via = 'bizdev';
  }

  const region = meetingCol(item, MEETING_COLS.REGION) || credited[0]?.region || '';
  const excluded = !meetingCol(item, MEETING_COLS.COMPANY).trim() ? 'No company'
    : !via ? 'No SDR'
    : null;
  return { reps: credited, via, region, excluded };
}

export function withAttribution(meetings, team) {
  return meetings.map(m => ({ ...m, attribution: attributeMeeting(m, team) }));
}

export function inRegion(meeting, region) {
  return !region || region === 'All' || meeting.attribution.region === region;
}

export function isCounted(meeting) {
  return !meeting.attribution.excluded;
}

export function repMeetings(rep, meetings) {
  if (!rep.mondayUserId) return [];
  return meetings.filter(m => m.attribution.reps.some(r => r.mondayUserId === rep.mondayUserId));
}
