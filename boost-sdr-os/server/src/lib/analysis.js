// MEDDPICC and opener analysis of a call transcript with Claude. Each call is
// analysed once and saved. Short calls are included on purpose: how a call opens
// and why people hang up is some of the most useful coaching data.

const { getSecret } = require('./secrets');
const { CLAUDE_MODEL, RUBRIC_VERSION } = require('./config');
const { renderForModel } = require('./transcript');

const MEDDPICC = [
  { key: 'metrics', label: 'Metrics' },
  { key: 'economic_buyer', label: 'Economic buyer' },
  { key: 'decision_criteria', label: 'Decision criteria' },
  { key: 'decision_process', label: 'Decision process' },
  { key: 'paper_process', label: 'Paper process' },
  { key: 'identify_pain', label: 'Identify pain' },
  { key: 'champion', label: 'Champion' },
  { key: 'competition', label: 'Competition' },
];

const CRAFT = [
  { key: 'opening', label: 'Opening' },
  { key: 'discovery', label: 'Discovery' },
  { key: 'objection_handling', label: 'Objection handling' },
  { key: 'next_step_ask', label: 'Asking for the next step' },
  { key: 'tone_and_control', label: 'Tone and call control' },
];

const CALL_TYPES = ['conversation', 'early_hangup', 'gatekeeper', 'voicemail', 'automated_menu', 'wrong_person', 'other'];
const OPENER_RESULTS = ['stayed_engaged', 'brushed_off', 'hung_up', 'blocked_by_gatekeeper', 'unclear'];
const OBJECTION_CATEGORIES = [
  'not_interested', 'no_time', 'send_email', 'already_have_solution', 'using_competitor',
  'no_budget', 'wrong_person', 'bad_timing', 'other',
];
const OPENER_STYLES = ['permission_based', 'direct_pitch', 'referral_or_context', 'pattern_interrupt', 'other'];
const SENIORITY = ['c_level', 'vp_director', 'manager', 'individual', 'unknown'];
const STAGES = ['opener', 'middle', 'close'];

const list = (xs) => xs.map((s) => `"${s}"`).join(' | ');

const SYSTEM = `You are a sales coach reviewing a recorded call by an SDR (sales development rep) at boost, a monday.com partner that sells implementation and consulting services. Coach the way a good sales manager would: specific, fair, practical and kind, never harsh.

You will get a transcript where the SDR is labelled "SDR" and the other person "PROSPECT". Transcripts are machine-generated and can contain errors; do not criticise transcription mistakes. Many calls are short. A prospect who hangs up or brushes the SDR off within the first few exchanges is useful data, so analyse it, do not dismiss it.

Judge three things:
1. How the call opened and what happened next (did the prospect stay, brush the SDR off, or hang up?).
2. Any objection or brush-off, where in the call it came, and how the SDR answered.
3. For real two-way conversations only, MEDDPICC and call craft.

MEDDPICC scoring, judging what was realistic for an SDR: 0 = not touched on, 1 = touched on or partly explored, 2 = explored well. Most calls score 0 on most elements. That is normal and is never a failing. Set "coachable" to true only when the call was a real two-way conversation with enough substance to judge discovery. For short, one-sided or blocked calls set it to false, score every MEDDPICC element 0 and score craft dimensions that did not come up as null.

Call craft is scored 1 (weak) to 5 (excellent): opening, discovery, objection handling, asking for the next step, tone and call control. Use null for any dimension that did not come up.

Rules:
- Calls may be in Hebrew or another language. Write every finding in English: the summary, the notes, the reasons, the suggestions and the explanations. Never answer in the language of the call.
- Every quote is given twice. The main field ("quote", "evidence" or "response_quote") is copied word for word in the original language, exactly as it appears in the transcript, short (under 30 words) and never invented. That copy is checked against the transcript, so never translate it. The matching field ending in _en is a faithful English translation of the same words (identical to the original when the call is already in English).
- Base everything on the transcript. If something is unclear, say so instead of guessing.
- "try_next_time" must be one to three concrete actions for the next call, ideally with a suggested phrase. For early hang-ups, focus on the first ten seconds.
- Be honest. Praise only what happened.
- "objections": each genuine objection or brush-off from the prospect (up to four) with the SDR's actual reply and where it came ("opener" means within the first couple of exchanges). Use an empty list if there were none.
- "prospect" and "opener": only use what is said on the call. Use null or "unknown" when it is not stated; never guess a job title.

Reply with a single JSON object and nothing else, in exactly this shape:
{
  "call_type": ${list(CALL_TYPES)},
  "language": "the main language the call was spoken in, written in English, for example English or Hebrew",
  "coachable": boolean,
  "summary": "two sentences on what happened and where the call ended",
  "opener_result": ${list(OPENER_RESULTS)},
  "ended_by": "prospect" | "sdr" | "unclear",
  "next_step_secured": boolean,
  "meddpicc": { ${MEDDPICC.map((m) => `"${m.key}": { "score": 0|1|2, "evidence": "verbatim quote in the original language, or empty string", "evidence_en": "English translation of the evidence" }`).join(', ')} },
  "craft": { ${CRAFT.map((c) => `"${c.key}": { "score": 1-5 or null, "note": "one sentence" }`).join(', ')} },
  "prospect": { "role_or_title": "as said on the call, or null", "seniority": ${list(SENIORITY)}, "company_type_or_industry": "as said or clearly implied, or null" },
  "opener": { "style": ${list(OPENER_STYLES)}, "quote": "verbatim, original language: how the SDR opened, the first thing said after the greeting", "quote_en": "English translation", "note": "one sentence" },
  "objections": [ { "category": ${list(OBJECTION_CATEGORIES)}, "stage": ${list(STAGES)}, "quote": "verbatim prospect words, original language", "quote_en": "English translation", "response_quote": "verbatim SDR reply in the original language, or empty string", "response_quote_en": "English translation of the reply", "handled": "well" | "ok" | "poorly", "why": "one sentence" } ],
  "best_moment": { "quote": "verbatim, original language", "quote_en": "English translation", "why": "one sentence" } | null,
  "missed_moment": { "quote": "verbatim, original language", "quote_en": "English translation", "better": "what could have been said or asked instead" } | null,
  "try_next_time": ["...", "..."]
}`;

function anthropicHeaders(apiKey) {
  return { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' };
}

// Anthropic says why a request was refused (for example a model name or the account balance).
// That text is safe to show; it never contains the key.
async function describeFailure(res) {
  let detail = '';
  try {
    const body = JSON.parse(await res.text());
    detail = body?.error?.message ? `: ${String(body.error.message).slice(0, 220)}` : '';
  } catch (_err) {
    // no readable explanation
  }
  return `Claude API HTTP ${res.status}${detail}`;
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function quoteIsReal(transcriptNorm, quote) {
  const q = norm(quote);
  return q.length >= 8 && transcriptNorm.includes(q);
}

function clampScore(v, min, max) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : null;
}

const oneOf = (v, options, fallback) => (options.includes(v) ? v : fallback);

// The English wording to show. Falls back to the original when no translation came back
// (which is correct when the call was already in English).
const english = (original, translated) => {
  const t = translated == null ? '' : String(translated).trim();
  return t ? t.slice(0, 400) : original;
};

// Cleans the model output and removes any quote that is not really in the transcript.
function validate(raw, turns) {
  const tNorm = norm(turns.map((t) => t.text).join(' '));
  const openerQuote = raw.opener?.quote && quoteIsReal(tNorm, raw.opener.quote) ? String(raw.opener.quote) : null;
  const out = {
    version: RUBRIC_VERSION,
    callType: oneOf(raw.call_type, CALL_TYPES, 'other'),
    language: String(raw.language || 'English').trim().slice(0, 30) || 'English',
    coachable: raw.coachable === true,
    summary: String(raw.summary || '').slice(0, 600),
    openerResult: oneOf(raw.opener_result, OPENER_RESULTS, 'unclear'),
    endedBy: oneOf(raw.ended_by, ['prospect', 'sdr', 'unclear'], 'unclear'),
    nextStepSecured: Boolean(raw.next_step_secured),
    meddpicc: {},
    craft: {},
    prospect: {
      role: raw.prospect?.role_or_title ? String(raw.prospect.role_or_title).slice(0, 80) : null,
      seniority: oneOf(raw.prospect?.seniority, SENIORITY, 'unknown'),
      industry: raw.prospect?.company_type_or_industry ? String(raw.prospect.company_type_or_industry).slice(0, 80) : null,
    },
    opener: {
      style: oneOf(raw.opener?.style, OPENER_STYLES, 'other'),
      quote: openerQuote,
      quoteEn: openerQuote ? english(openerQuote, raw.opener?.quote_en) : null,
      note: String(raw.opener?.note || '').slice(0, 300),
    },
    objections: [],
    bestMoment: null,
    missedMoment: null,
    tryNextTime: Array.isArray(raw.try_next_time) ? raw.try_next_time.map(String).slice(0, 3) : [],
    analysedAt: new Date().toISOString(),
  };

  for (const { key } of MEDDPICC) {
    const m = raw.meddpicc?.[key] || {};
    const evidence = m.evidence && quoteIsReal(tNorm, m.evidence) ? String(m.evidence) : null;
    out.meddpicc[key] = { score: clampScore(m.score, 0, 2) ?? 0, evidence, evidenceEn: evidence ? english(evidence, m.evidence_en) : null };
  }
  for (const { key } of CRAFT) {
    const c = raw.craft?.[key] || {};
    out.craft[key] = { score: c.score == null ? null : clampScore(c.score, 1, 5), note: String(c.note || '').slice(0, 300) };
  }

  // An objection only counts if the prospect's words really are in the transcript.
  out.objections = (Array.isArray(raw.objections) ? raw.objections : [])
    .filter((o) => o?.quote && quoteIsReal(tNorm, o.quote))
    .slice(0, 4)
    .map((o) => {
      const responseQuote = o.response_quote && quoteIsReal(tNorm, o.response_quote) ? String(o.response_quote) : null;
      return {
        category: oneOf(o.category, OBJECTION_CATEGORIES, 'other'),
        stage: oneOf(o.stage, STAGES, 'middle'),
        quote: String(o.quote),
        quoteEn: english(String(o.quote), o.quote_en),
        responseQuote,
        responseQuoteEn: responseQuote ? english(responseQuote, o.response_quote_en) : null,
        handled: oneOf(o.handled, ['well', 'ok', 'poorly'], 'ok'),
        why: String(o.why || '').slice(0, 300),
      };
    });

  if (raw.best_moment?.quote && quoteIsReal(tNorm, raw.best_moment.quote)) {
    out.bestMoment = { quote: String(raw.best_moment.quote), quoteEn: english(String(raw.best_moment.quote), raw.best_moment.quote_en), why: String(raw.best_moment.why || '').slice(0, 300) };
  }
  if (raw.missed_moment?.quote && quoteIsReal(tNorm, raw.missed_moment.quote)) {
    out.missedMoment = { quote: String(raw.missed_moment.quote), quoteEn: english(String(raw.missed_moment.quote), raw.missed_moment.quote_en), better: String(raw.missed_moment.better || '').slice(0, 400) };
  }
  return out;
}

function extractJson(text) {
  const cleaned = String(text).replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('The model did not return JSON.');
  return JSON.parse(cleaned.slice(start, end + 1));
}

async function analyseCall({ turns, call }, { fetchImpl = fetch } = {}) {
  const apiKey = getSecret('ANTHROPIC_API_KEY');
  if (!apiKey) throw Object.assign(new Error('The server is missing ANTHROPIC_API_KEY.'), { code: 'not_configured' });

  const length = call.durationMin == null ? 'unknown length' : `about ${Math.round(call.durationMin)} minute${Math.round(call.durationMin) === 1 ? '' : 's'}`;
  const user = `Call length: ${length}.\n\nTranscript:\n${renderForModel(turns)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 55000);
  try {
    const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: ctrl.signal,
      headers: anthropicHeaders(apiKey),
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 2000,
        system: SYSTEM,
        messages: [{ role: 'user', content: user }],
      }),
    });
    if (!res.ok) throw new Error(await describeFailure(res));
    const json = await res.json();
    const text = (json.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    return validate(extractJson(text), turns);
  } finally {
    clearTimeout(timer);
  }
}

// Tiny request that proves the key works and Claude can be reached from this server.
async function ping({ fetchImpl = fetch } = {}) {
  const apiKey = getSecret('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('The server is missing ANTHROPIC_API_KEY.');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: ctrl.signal,
      headers: anthropicHeaders(apiKey),
      body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 8, messages: [{ role: 'user', content: 'Reply with the single word OK.' }] }),
    });
    if (!res.ok) throw new Error(await describeFailure(res));
  } catch (err) {
    throw new Error(err.name === 'AbortError' ? 'Claude did not answer within 15 seconds' : err.message);
  } finally {
    clearTimeout(timer);
  }
}

const OBJECTION_LABELS = {
  not_interested: 'Not interested',
  no_time: 'No time',
  send_email: 'Send me an email',
  already_have_solution: 'Already have a solution',
  using_competitor: 'Using a competitor',
  no_budget: 'No budget',
  wrong_person: 'Wrong person',
  bad_timing: 'Bad timing',
  other: 'Other',
};
const OPENER_LABELS = {
  permission_based: 'Permission based',
  direct_pitch: 'Direct pitch',
  referral_or_context: 'Referral or context',
  pattern_interrupt: 'Pattern interrupt',
  other: 'Other',
};
const SENIORITY_LABELS = {
  c_level: 'C-level',
  vp_director: 'VP or director',
  manager: 'Manager',
  individual: 'Individual contributor',
  unknown: 'Not stated',
};
const CALL_TYPE_LABELS = {
  conversation: 'Conversation',
  early_hangup: 'Early hang-up',
  gatekeeper: 'Gatekeeper',
  voicemail: 'Voicemail',
  automated_menu: 'Phone menu',
  wrong_person: 'Wrong person',
  other: 'Other',
};

module.exports = {
  analyseCall, ping, validate, extractJson, MEDDPICC, CRAFT, SYSTEM,
  OBJECTION_LABELS, OPENER_LABELS, SENIORITY_LABELS, CALL_TYPE_LABELS,
};
