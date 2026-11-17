// Turns saved analyses into "where to focus" and "what is working", without another AI call.

const { MEDDPICC, CRAFT } = require('./analysis');

// MEDDPICC elements an SDR can realistically open up on a first call. Paper process
// and decision criteria are mostly for later in the deal, so they are shown but not
// used to pick focus areas.
const SDR_RELEVANT = new Set(['identify_pain', 'economic_buyer', 'champion', 'metrics', 'competition', 'decision_process']);
const MIN_CALLS_FOR_FOCUS = 3;

function summarise(analyses) {
  const real = analyses.filter((a) => a && a.coachable && a.callType !== 'not_a_conversation');
  // Call craft is also scored on short calls (the opening, objection handling), so it uses every
  // call with a person on the line. MEDDPICC is only judged on full two-way conversations.
  const human = analyses.filter((a) => a && a.callType !== 'voicemail' && a.callType !== 'automated_menu');
  const meddpicc = {};
  for (const { key, label } of MEDDPICC) {
    const scores = real.map((a) => a.meddpicc?.[key]?.score).filter((s) => Number.isFinite(s));
    meddpicc[key] = {
      label,
      avg: scores.length ? scores.reduce((s, v) => s + v, 0) / scores.length : null,
      touchedShare: scores.length ? scores.filter((s) => s >= 1).length / scores.length : null,
    };
  }
  const craft = {};
  for (const { key, label } of CRAFT) {
    const scores = human.map((a) => a.craft?.[key]?.score).filter((s) => Number.isFinite(s));
    craft[key] = { label, avg: scores.length ? scores.reduce((s, v) => s + v, 0) / scores.length : null };
  }

  // Everything on a 0 to 1 scale so craft and MEDDPICC can be ranked together.
  const areas = [
    ...CRAFT.map(({ key, label }) => ({ key, label, kind: 'craft', value: craft[key].avg == null ? null : (craft[key].avg - 1) / 4 })),
    ...MEDDPICC.filter(({ key }) => SDR_RELEVANT.has(key)).map(({ key, label }) => ({
      key, label, kind: 'meddpicc', value: meddpicc[key].avg == null ? null : meddpicc[key].avg / 2,
    })),
  ].filter((a) => a.value != null);

  const enough = real.length >= MIN_CALLS_FOR_FOCUS;
  const ranked = [...areas].sort((a, b) => a.value - b.value);
  return {
    totalAnalysed: human.length,
    analysedCalls: real.length,
    craftCalls: human.filter((a) => Object.values(a.craft || {}).some((c) => Number.isFinite(c?.score))).length,
    enoughForFocus: enough,
    minCallsForFocus: MIN_CALLS_FOR_FOCUS,
    meddpicc,
    craft,
    focus: enough ? ranked.slice(0, 3).map(({ key, label, kind, value }) => ({ key, label, kind, value })) : [],
    strengths: enough ? ranked.slice(-2).reverse().map(({ key, label, kind, value }) => ({ key, label, kind, value })) : [],
    nextStepRate: real.length ? real.filter((a) => a.nextStepSecured).length / real.length : null,
  };
}

module.exports = { summarise, MIN_CALLS_FOR_FOCUS };
