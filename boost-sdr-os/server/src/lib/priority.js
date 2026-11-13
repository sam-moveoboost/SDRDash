// How much a call is worth a manager's time to review, from 1 to 10.
//
// It is worked out from the saved analysis each time it is needed, so it costs nothing extra
// and changes to the rules apply to calls that were analysed earlier.
//
//  High  (7 to 10): a real conversation with a lot to learn from. Long, poorly handled
//                   objections, weak call craft, a missed moment, lots of feedback.
//  Medium (4 to 6): a conversation that went reasonably, or a short call with something to learn.
//  Low   (1 to 3):  quick hang-ups, gatekeepers and voicemail, or a call where everything went well.

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

function levelFor(score) {
  if (score >= 7) return 'high';
  if (score >= 4) return 'medium';
  return 'low';
}

function reviewPriority(analysis, call = {}) {
  if (!analysis) return null;
  const type = analysis.callType;
  const reasons = [];

  if (type === 'voicemail' || type === 'automated_menu') {
    return { score: 1, level: 'low', reasons: [CALL_TYPE_LABELS[type] || 'Voicemail'] };
  }

  const objections = analysis.objections || [];
  const poor = objections.filter((o) => o.handled === 'poorly').length;
  const weak = Object.entries(analysis.craft || {})
    .filter(([, c]) => Number.isFinite(c?.score) && c.score <= WEAK_CRAFT_SCORE)
    .map(([key]) => CRAFT_LABELS[key] || key);
  const missed = Boolean(analysis.missedMoment);
  const feedbackPoints = weak.length + poor + (missed ? 1 : 0) + (analysis.tryNextTime || []).length;

  const minutes = Number.isFinite(call.durationMin) ? call.durationMin : 0;
  const chars = analysis.stats?.chars ?? 0;

  let score;
  if (analysis.coachable) {
    // A real two-way conversation: there is plenty to learn from, and more so when it was long.
    score = 3;
    if (minutes >= LONG_MINUTES || chars >= LONG_CHARS) {
      score += 1;
      reasons.push('Long conversation');
    } else if (minutes >= MEDIUM_MINUTES || chars >= MEDIUM_CHARS) {
      score += 0.5;
    }
    if (poor) {
      score += Math.min(3, poor * 1.5);
      reasons.push(`${plural(poor, 'objection')} handled poorly`);
    }
    if (weak.length) {
      score += Math.min(2, weak.length);
      reasons.push(`Weak: ${weak.slice(0, 3).join(', ')}`);
    }
    if (missed) {
      score += 1;
      reasons.push('A missed moment to learn from');
    }
    if (feedbackPoints >= LOTS_OF_FEEDBACK_POINTS) {
      score += 0.5;
      reasons.push('Lots of feedback');
    }
    if (!poor && !weak.length && !missed) reasons.push('Went well');
  } else {
    // A quick hang-up, gatekeeper or wrong number: little to learn unless the opener went badly.
    score = 1;
    reasons.push(CALL_TYPE_LABELS[type] || 'Short call');
    if (poor) {
      score += 2;
      reasons.push(`${plural(poor, 'objection')} handled poorly`);
    }
    if (missed) {
      score += 1;
      reasons.push('A missed moment to learn from');
    }
    score = Math.min(score, 5);
  }

  const rounded = clamp(Math.round(score), 1, 10);
  return { score: rounded, level: levelFor(rounded), reasons };
}

module.exports = { reviewPriority, levelFor };
