// A read-only check of what is really saved for each call, set against what the board says.
// It changes nothing. It exists so the numbers on the screens can be checked against the facts.

const { measured } = require('./outcome');

const NON_HUMAN = new Set(['voicemail', 'automated_menu']);
const words = (o) => Boolean(o && (o.recorded || o.quote || o.note));

function buildAudit(pairs, { schema, labels }) {
  const out = {
    rulesVersion: schema,
    total: pairs.length,
    board: { analysed: 0, waiting: 0, reanalyse: 0, blank: 0 },
    saved: { record: 0, none: 0, unreadable: 0 },
    bySchema: {},
    withNumbers: 0,
    withOpener: 0,
    withPositioning: 0,
    onCurrentRules: 0,
    usedByOpeningCards: 0,
    problems: [],
  };
  const problems = {
    analysedButNothingSaved: [],
    analysedButOlderRules: [],
    analysedButNoNumbers: [],
    analysedButIncomplete: [],
    waitingButCurrentAndComplete: [],
  };
  const example = (p) => ({ id: p.call.id, sdr: p.call.sdrName || null, startedAt: p.call.startedAt || null });

  for (const p of pairs) {
    const label = p.call.coachingStatus;
    if (label === labels.analysed) out.board.analysed += 1;
    else if (label === labels.waiting) out.board.waiting += 1;
    else if (label === labels.reanalyse) out.board.reanalyse += 1;
    else out.board.blank += 1;

    const a = p.analysis;
    if (!a) {
      if (p.unreadable) out.saved.unreadable += 1; else out.saved.none += 1;
      if (label === labels.analysed && !p.unreadable) problems.analysedButNothingSaved.push(p);
      continue;
    }
    out.saved.record += 1;
    const sch = a.schema ?? 0;
    out.bySchema[sch] = (out.bySchema[sch] || 0) + 1;
    const human = !NON_HUMAN.has(a.callType);
    const numbers = measured(a);
    const opener = !human || words(a.opener);
    const positioning = !human || words(a.positioning);
    const current = sch >= schema;
    if (numbers) out.withNumbers += 1;
    if (opener) out.withOpener += 1;
    if (positioning) out.withPositioning += 1;
    if (current) out.onCurrentRules += 1;
    const complete = current && numbers && opener && positioning;
    if (current && numbers && human && words(a.opener)) out.usedByOpeningCards += 1;

    if (label === labels.analysed) {
      if (!current) problems.analysedButOlderRules.push(p);
      else if (!numbers) problems.analysedButNoNumbers.push(p);
      else if (!opener || !positioning) problems.analysedButIncomplete.push(p);
    } else if (complete) {
      problems.waitingButCurrentAndComplete.push(p);
    }
  }

  const describe = [
    ['analysedButNothingSaved', 'Board says Analysed, but nothing is saved for the call'],
    ['analysedButOlderRules', 'Board says Analysed, but the saved result is from older rules'],
    ['analysedButNoNumbers', 'Board says Analysed and the rules are current, but the stay-on numbers are missing'],
    ['analysedButIncomplete', 'Board says Analysed, but the opener or what we say we are was never recorded'],
    ['waitingButCurrentAndComplete', 'Board says waiting, but a complete current result is saved'],
  ];
  out.problems = describe.map(([key, label]) => ({ key, label, count: problems[key].length, examples: problems[key].slice(0, 8).map(example) }));
  return out;
}

module.exports = { buildAudit };
