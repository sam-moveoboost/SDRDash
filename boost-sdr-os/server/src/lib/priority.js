// How much a call is worth a manager's or an SDR's time to review, from 1 to 10.
//
// This is about what there is to LEARN from the call, not how good the call was. A call earns points
// for every teachable moment, good or bad:
//   - an objection handled poorly (a lesson) or handled well (an example to copy)
//   - weak call craft, a missed moment, a strong moment worth sharing
//   - a meeting booked (worth hearing how)
//   - a long, real conversation (more to learn from)
// Calls with nothing to learn from sit at the bottom: voicemail, gatekeepers, quick hang-ups, and
// conversations where nothing stood out.
//
// It is worked out from the saved analysis each time it is needed, so it costs nothing extra and any
// change to these rules applies to calls that were analysed earlier.
//
//   High   (7 to 10): at least one clear example, good or bad, usually in a real conversation
//   Medium (4 to 6):  something worth a look, or a short call with one example
//   Low    (1 to 3):  nothing notable

const { CALL_TYPE_LABELS, CRAFT } = require('./analysis');

const CRAFT_LABELS = Object.fromEntries(CRAFT.map((c) => [c.key, c.label]));
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

const WEAK_CRAFT_SCORE = 2; // out of 5
const LONG_MINUTES = 5;
const LONG_CHARS = 4000;
const MEDIUM_MINUTES = 3;
const MEDIUM_CHARS = 2500;
const LOTS_OF_FEEDBACK_POINTS = 5;
const SHORT_CALL_CAP = 6; // a quick hang-up never outranks a real conversation with the same lessons

// Points for a count of examples: the first matters most, later ones add less, up to a ceiling.
const examplePoints = (count, first, each, ceiling) => (count ? Math.min(ceiling, first + (count - 1) * each) : 0);

function levelFor(score) {
  if (score >= 7) return 'high';
  if (score >= 4) return 'medium';
  return 'low';
}

function reviewPriority(analysis, call = {}) {
  if (!analysis) return null;
  const type = analysis.callType;
  if (type === 'voicemail' || type === 'automated_menu') {
    return { score: 1, level: 'low', reasons: [CALL_TYPE_LABELS[type] || 'Voicemail'] };
  }

  const objections = analysis.objections || [];
  const poor = objections.filter((o) => o.handled === 'poorly').length;
  const well = objections.filter((o) => o.handled === 'well').length;
  const weak = Object.entries(analysis.craft || {})
    .filter(([, c]) => Number.isFinite(c?.score) && c.score <= WEAK_CRAFT_SCORE)
    .map(([key]) => CRAFT_LABELS[key] || key);
  const missed = Boolean(analysis.missedMoment);
  const strong = Boolean(analysis.bestMoment);
  const booked = Array.isArray(call.tags) && call.tags.includes('MeetingBooked');
  const feedbackPoints = weak.length + poor + (missed ? 1 : 0) + (analysis.tryNextTime || []).length;

  const minutes = Number.isFinite(call.durationMin) ? call.durationMin : 0;
  const chars = analysis.stats?.chars ?? 0;
  const coachable = Boolean(analysis.coachable);

  const reasons = [];
  let score = coachable ? 3 : 1;

  if (coachable) {
    if (minutes >= LONG_MINUTES || chars >= LONG_CHARS) {
      score += 1;
      reasons.push('Long conversation');
    } else if (minutes >= MEDIUM_MINUTES || chars >= MEDIUM_CHARS) {
      score += 0.5;
    }
  } else {
    reasons.push(CALL_TYPE_LABELS[type] || 'Short call');
  }

  if (poor) {
    score += examplePoints(poor, 3.5, 1.5, 5);
    reasons.push(`${plural(poor, 'objection')} handled poorly`);
  }
  if (well) {
    score += examplePoints(well, 3.5, 1, 5);
    reasons.push(well === 1 ? 'A well-handled objection' : `${well} well-handled objections`);
  }
  if (weak.length) {
    score += Math.min(3, weak.length * 1.5);
    reasons.push(`Weak: ${weak.slice(0, 3).join(', ')}`);
  }
  if (missed) {
    score += 1.5;
    reasons.push('A missed moment to learn from');
  }
  if (strong) {
    score += 1.5;
    reasons.push('A strong moment to share');
  }
  if (booked) {
    score += 1;
    reasons.push('Meeting booked');
  }
  if (feedbackPoints >= LOTS_OF_FEEDBACK_POINTS) {
    score += 0.5;
    reasons.push('Lots of feedback');
  }
  if (coachable && !poor && !well && !weak.length && !missed && !strong && !booked) reasons.push('Nothing stood out');

  if (!coachable) score = Math.min(score, SHORT_CALL_CAP);
  const rounded = clamp(Math.round(score), 1, 10);
  return { score: rounded, level: levelFor(rounded), reasons };
}

module.exports = { reviewPriority, levelFor };
