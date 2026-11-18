// Turns saved analyses into "where to focus" and "what is working", without another AI call.
// This is about call craft: these are cold calls, not discovery calls, so there is no qualification
// framework scoring here, only how the SDR handled the call.

const { CRAFT } = require('./analysis');

const MIN_CALLS_FOR_FOCUS = 3;

function summarise(analyses) {
  // A full conversation is one where the prospect really took part.
  const real = analyses.filter((a) => a && a.coachable && a.callType !== 'not_a_conversation');
  // Call craft is scored on every call with a person on the line that was coached.
  const human = analyses.filter((a) => a && a.callType !== 'voicemail' && a.callType !== 'automated_menu');

  const craft = {};
  for (const { key, label } of CRAFT) {
    const scores = human.map((a) => a.craft?.[key]?.score).filter((s) => Number.isFinite(s));
    craft[key] = { label, avg: scores.length ? scores.reduce((s, v) => s + v, 0) / scores.length : null, calls: scores.length };
  }

  const craftCalls = human.filter((a) => Object.values(a.craft || {}).some((c) => Number.isFinite(c?.score))).length;
  // On a 0 to 1 scale (1 is the weakest score, 5 the strongest).
  const areas = CRAFT.map(({ key, label }) => ({ key, label, kind: 'craft', value: craft[key].avg == null ? null : (craft[key].avg - 1) / 4 })).filter((a) => a.value != null);
  const enough = craftCalls >= MIN_CALLS_FOR_FOCUS;
  const ranked = [...areas].sort((a, b) => a.value - b.value);
  const pick = (x) => ({ key: x.key, label: x.label, kind: x.kind, value: x.value });
  return {
    totalAnalysed: human.length,
    analysedCalls: real.length,
    craftCalls,
    enoughForFocus: enough,
    minCallsForFocus: MIN_CALLS_FOR_FOCUS,
    craft,
    focus: enough ? ranked.slice(0, 3).map(pick) : [],
    strengths: enough ? ranked.slice(-2).reverse().map(pick) : [],
    nextStepRate: real.length ? real.filter((a) => a.nextStepSecured).length / real.length : null,
  };
}

module.exports = { summarise, MIN_CALLS_FOR_FOCUS };
