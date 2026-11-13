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
// Five opening types, grouped from a read of the real transcripts since 1 Nov (65 valid ones):
// about half referred to an earlier connection, a fifth were a cold request for a moment, and the
// rest were credentials first, asking for a named person, or opening with a pain-point question.
const OPENER_STYLES = ['warm_followup', 'cold_permission_ask', 'credentials_first', 'named_person_ask', 'pain_question_hook', 'other'];

// Bump when the shape or the rules of an analysis change, so earlier analyses are offered for redoing.
const ANALYSIS_SCHEMA = 2;
const SENIORITY = ['c_level', 'vp_director', 'manager', 'individual', 'unknown'];
const STAGES = ['opener', 'middle', 'close'];

const list = (xs) => xs.map((s) => `"${s}"`).join(' | ');


// Claude records its analysis by calling this tool. The API then hands back structured data
// directly, so a quote containing speech marks can no longer break the reply (which is what
// happened when the analysis was written out as free text and parsed afterwards).
const str = { type: 'string' };
const ANALYSIS_TOOL = {
  name: 'record_call_analysis',
  description: 'Record the coaching analysis of this call.',
  input_schema: {
    type: 'object',
    properties: {
      call_type: { type: 'string', enum: CALL_TYPES },
      language: str,
      coachable: { type: 'boolean' },
      summary: str,
      opener_result: { type: 'string', enum: OPENER_RESULTS },
      ended_by: { type: 'string', enum: ['prospect', 'sdr', 'unclear'] },
      next_step_secured: { type: 'boolean' },
      meddpicc: {
        type: 'object',
        properties: Object.fromEntries(MEDDPICC.map((m) => [m.key, {
          type: 'object',
          properties: { score: { type: 'integer', enum: [0, 1, 2] }, evidence: str, evidence_en: str },
          required: ['score'],
        }])),
        required: MEDDPICC.map((m) => m.key),
      },
      craft: {
        type: 'object',
        properties: Object.fromEntries(CRAFT.map((c) => [c.key, {
          type: 'object',
          properties: { score: { type: ['integer', 'null'], minimum: 1, maximum: 5 }, note: str },
          required: ['score'],
        }])),
        required: CRAFT.map((c) => c.key),
      },
      prospect: {
        type: 'object',
        properties: {
          role_or_title: { type: ['string', 'null'] },
          seniority: { type: 'string', enum: SENIORITY },
          company_type_or_industry: { type: ['string', 'null'] },
        },
      },
      opener: {
        type: 'object',
        properties: { style: { type: 'string', enum: OPENER_STYLES }, quote: str, quote_en: str, note: str },
      },
      objections: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            category: { type: 'string', enum: OBJECTION_CATEGORIES },
            stage: { type: 'string', enum: STAGES },
            quote: str,
            quote_en: str,
            response_quote: str,
            response_quote_en: str,
            handled: { type: 'string', enum: ['well', 'ok', 'poorly'] },
            why: str,
          },
          required: ['category', 'stage', 'quote', 'handled'],
        },
      },
      best_moment: { type: ['object', 'null'], properties: { quote: str, quote_en: str, why: str } },
      missed_moment: { type: ['object', 'null'], properties: { quote: str, quote_en: str, better: str } },
      try_next_time: { type: 'array', items: str },
    },
    required: ['call_type', 'coachable', 'summary', 'opener_result', 'next_step_secured', 'meddpicc', 'craft', 'objections', 'try_next_time'],
  },
};

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

Opener style: judge only from how the SDR opened (their first lines after the greeting), not from how the call went. Choose exactly one:
- warm_followup: the first lines refer to an earlier meeting, event, conversation, a named person who referred them, or a previous call attempt (for example "we met at the event", "we spoke before", "Gershon suggested I call you", "it's Emad again").
- cold_permission_ask: the SDR gives their name and company and asks for a moment or half a minute before saying anything about what they offer, with no earlier connection (for example "I'm calling out of the blue, do you have 30 seconds?").
- credentials_first: the SDR explains what the company does and names clients or partners to build credibility (for example "we work with monday.com and Anthropic and clients like ...") before or while asking for a minute.
- named_person_ask: the SDR opens by asking for a named person, or checking they have the right company or number, and holds back the pitch (for example "is that Galaxy Realty?", "can I speak to Alex Stewart?").
- pain_question_hook: the SDR states a common problem in the prospect's industry and asks how they handle it, as the hook (for example "how do you handle leads that sit untouched in the CRM?").
- other: anything that does not clearly fit one of the five. Use it sparingly.

Record your analysis by calling the record_call_analysis tool, using exactly this shape:
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
    schema: ANALYSIS_SCHEMA,
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

async function askClaude(user, apiKey, fetchImpl) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 55000);
  try {
    const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: ctrl.signal,
      headers: anthropicHeaders(apiKey),
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        // Generous: an analysis with several quotes, each given in the original language and in
        // English (Hebrew costs more tokens), can run long. Only tokens actually produced are paid for.
        max_tokens: 8000,
        system: SYSTEM,
        tools: [ANALYSIS_TOOL],
        // Forcing the tool is refused by this model, so it is offered and asked for instead.
        // A plain-text reply is still understood (see readAnalysis).
        tool_choice: { type: 'auto' },
        messages: [{ role: 'user', content: user }],
      }),
    });
    if (!res.ok) throw new Error(await describeFailure(res));
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// The structured answer, or (if Claude replied in plain text instead) JSON pulled out of the text.
function readAnalysis(json) {
  if (json.stop_reason === 'max_tokens') throw new Error('Claude ran out of room before finishing its answer');
  const blocks = json.content || [];
  const tool = blocks.find((b) => b.type === 'tool_use' && b.name === ANALYSIS_TOOL.name);
  if (tool && tool.input && typeof tool.input === 'object') return tool.input;
  return extractJson(blocks.filter((b) => b.type === 'text').map((b) => b.text).join(''));
}

async function analyseCall({ turns, call }, { fetchImpl = fetch } = {}) {
  const apiKey = getSecret('ANTHROPIC_API_KEY');
  if (!apiKey) throw Object.assign(new Error('The server is missing ANTHROPIC_API_KEY.'), { code: 'not_configured' });

  const length = call.durationMin == null ? 'unknown length' : `about ${Math.round(call.durationMin)} minute${Math.round(call.durationMin) === 1 ? '' : 's'}`;
  const user = `Call length: ${length}.\n\nTranscript:\n${renderForModel(turns)}\n\nRecord your analysis by calling the record_call_analysis tool.`;

  // An unreadable answer is retried once; any other failure is reported straight away.
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    const json = await askClaude(user, apiKey, fetchImpl);
    try {
      return validate(readAnalysis(json), turns);
    } catch (err) {
      const unreadable = err instanceof SyntaxError || /did not return JSON/.test(err.message);
      if (!unreadable) throw err;
      lastError = err;
    }
  }
  throw lastError;
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
      // Sends the real analysis tool too, so a format Anthropic would reject shows up here
      // and not on every analysis. The tiny token limit keeps the cost negligible; running out
      // of room is fine because only the request being accepted matters.
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 16,
        tools: [ANALYSIS_TOOL],
        tool_choice: { type: 'auto' },
        messages: [{ role: 'user', content: 'Check: record a test analysis.' }],
      }),
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
  warm_followup: 'Warm follow-up',
  cold_permission_ask: 'Cold permission ask',
  credentials_first: 'Credentials first',
  named_person_ask: 'Asking for a person',
  pain_question_hook: 'Pain-point question',
  other: 'Other',
};
const OPENER_DESCRIPTIONS = {
  warm_followup: 'Refers to an earlier meeting, event, conversation, a named referrer or a previous attempt.',
  cold_permission_ask: 'Gives a name and company, then asks for a moment before saying what they offer.',
  credentials_first: 'Says what the company does and names clients or partners, then asks for a minute.',
  named_person_ask: 'Opens by asking for a named person, or checking the company or number, and holds back the pitch.',
  pain_question_hook: 'States a common problem in the prospect\'s industry and asks how they handle it.',
  other: 'Does not clearly fit one of the five types.',
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
  analyseCall, ping, validate, extractJson, MEDDPICC, CRAFT, SYSTEM, ANALYSIS_SCHEMA,
  OBJECTION_LABELS, OPENER_LABELS, OPENER_DESCRIPTIONS, SENIORITY_LABELS, CALL_TYPE_LABELS,
};
