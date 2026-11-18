// What "stayed on" means, in one place, so every card measures it the same way.
//
// A call stayed on when the prospect said at least 40 words after our opening and the call carried
// on for at least 6 more turns. Anything shorter hung up early, and a gatekeeper that blocked the
// call counts as hung up early too (it is also counted separately). It is worked out from the
// transcript, not from anyone's judgement, so the same call always gives the same answer.

const MIN_WORDS_AFTER_OPENING = 40;
const MIN_TURNS_AFTER_OPENING = 6;

const measured = (a) => Number.isFinite(a?.stats?.prospectWordsAfterOpening) && Number.isFinite(a?.stats?.turnsAfterOpening);
const isBlocked = (a) => a?.callType === 'gatekeeper' || a?.openerResult === 'blocked_by_gatekeeper';
const stayedOn = (a) => measured(a) && !isBlocked(a)
  && a.stats.prospectWordsAfterOpening >= MIN_WORDS_AFTER_OPENING && a.stats.turnsAfterOpening >= MIN_TURNS_AFTER_OPENING;

module.exports = { stayedOn, isBlocked, measured, MIN_WORDS_AFTER_OPENING, MIN_TURNS_AFTER_OPENING };
