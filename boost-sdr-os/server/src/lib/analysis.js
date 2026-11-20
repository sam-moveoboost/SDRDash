// Call coaching analysis of a transcript with Claude. Each call is
// analysed once and saved. Short calls are included on purpose: how a call opens
// and why people hang up is some of the most useful coaching data.

const { getSecret } = require('./secrets');
const { CLAUDE_MODEL, CLAUDE_EFFORT, RUBRIC_VERSION } = require('./config');
const { renderForModel } = require('./transcript');


const CRAFT = [
  { key: 'opening', label: 'Opening' },
  { key: 'discovery', label: 'Discovery' },
  { key: 'objection_handling', label: 'Objection handling' },
  { key: 'next_step_ask', label: 'Asking for the next step' },
  { key: 'tone_and_control', label: 'Tone and call control' },
];

const CALL_TYPES = ['conversation', 'early_hangup', 'gatekeeper', 'voicemail', 'automated_menu', 'wrong_person', 'other'];
// How the SDR describes who boost is in the first part of the call, and how the prospect reacts.
const POSITIONING_LEADS = ['monday', 'ai', 'other', 'none'];
const POSITIONING_OTHER_KINDS = ['generic_company', 'results_only', 'credentials_only', 'none'];
const POSITIONING_WHEN = ['opening', 'early', 'later', 'never'];
const POSITIONING_REACTIONS = ['engaged', 'neutral', 'pushed_back', 'ended', 'unclear'];
// The most teachable exchanges: what the prospect said or asked, what the SDR answered, and a verdict.
const KX_KINDS = ['prospect_question', 'objection', 'buying_signal', 'discovery', 'pitch', 'next_step', 'other'];
const KX_VERDICTS = ['landed', 'partly', 'missed'];
const OPENER_RESULTS = ['stayed_engaged', 'brushed_off', 'hung_up', 'blocked_by_gatekeeper', 'unclear'];
// Objection groups, kept broad so "other" stays rare. "Not a good time" covers both "I have no time"
// and "bad timing" (they are the same thing said two ways); "already covered" covers an existing
// tool, a competitor or partner, an in-house team, or already doing it with AI.
const OBJECTION_CATEGORIES = [
  'not_interested', 'not_a_good_time', 'send_email', 'already_covered',
  'no_budget', 'too_small_or_no_need', 'wrong_person', 'data_source_challenge', 'other',
];
// Names used by analyses saved under earlier rules, mapped onto the groups above.
const LEGACY_OBJECTION = { no_time: 'not_a_good_time', bad_timing: 'not_a_good_time', already_have_solution: 'already_covered', using_competitor: 'already_covered' };
const LEGACY_OPENER = { named_person_ask: 'other', permission_based: 'cold_permission_ask', direct_pitch: 'credentials_first', referral_or_context: 'warm_followup', pattern_interrupt: 'pain_question_hook' };
const modernCategory = (c) => LEGACY_OBJECTION[c] || c;
const modernOpener = (c) => LEGACY_OPENER[c] || c;
// Five opening types, grouped from a read of the real transcripts since 1 Nov (65 valid ones):
// about half referred to an earlier connection, a fifth were a cold request for a moment, and the
// rest were credentials first, asking for a named person, or opening with a pain-point question.
const OPENER_STYLES = ['warm_followup', 'apology', 'role_check', 'cold_permission_ask', 'credentials_first', 'pain_question_hook', 'other'];

// Bump when the shape or the rules of an analysis change, so earlier analyses are offered for redoing.
const ANALYSIS_SCHEMA = 6;
const SENIORITY = ['c_level', 'vp_director', 'manager', 'individual', 'unknown'];
// One fixed list so "Who books, by industry" groups cleanly instead of every call having its own wording.
const INDUSTRIES = [
  'Software and IT', 'Real estate and property', 'Energy and utilities', 'Professional services', 'Financial services',
  'Construction and engineering', 'Manufacturing and industrial', 'Retail and e-commerce', 'Healthcare and life sciences',
  'Education and non-profit', 'Marketing and media', 'Transport and logistics', 'Hospitality and leisure', 'Public sector', 'Other',
];
const INDUSTRY_SOURCES = ['crm', 'call', 'company_name', 'unknown'];
// How the CRM writes seniority, mapped onto the app's levels.
const CRM_SENIORITY = { 'c suite': 'c_level', c_suite: 'c_level', owner: 'c_level', founder: 'c_level', partner: 'c_level', vp: 'vp_director', director: 'vp_director', head: 'vp_director', manager: 'manager', senior: 'individual', entry: 'individual', intern: 'individual' };
const crmSeniority = (v) => CRM_SENIORITY[String(v || '').trim().toLowerCase()] || null;
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
          industry: { type: 'string', enum: INDUSTRIES },
          industry_source: { type: 'string', enum: INDUSTRY_SOURCES },
        },
      },
      opener: {
        type: 'object',
        properties: { style: { type: 'string', enum: OPENER_STYLES }, quote: str, quote_en: str, note: str },
      },
      positioning: {
        type: 'object',
        properties: {
          lead: { type: 'string', enum: POSITIONING_LEADS },
          other_kind: { type: 'string', enum: POSITIONING_OTHER_KINDS },
          mentions_monday: { type: 'boolean' },
          mentions_ai: { type: 'boolean' },
          when: { type: 'string', enum: POSITIONING_WHEN },
          quote: str,
          quote_en: str,
          reaction: { type: 'string', enum: POSITIONING_REACTIONS },
          note: str,
        },
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
      key_exchanges: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: KX_KINDS },
            prospect_quote: str,
            prospect_quote_en: str,
            sdr_quote: str,
            sdr_quote_en: str,
            verdict: { type: 'string', enum: KX_VERDICTS },
            what_happened: str,
            better: str,
          },
          required: ['verdict', 'what_happened'],
        },
      },
      best_moment: { type: ['object', 'null'], properties: { quote: str, quote_en: str, why: str } },
      missed_moment: { type: ['object', 'null'], properties: { quote: str, quote_en: str, better: str } },
      try_next_time: { type: 'array', items: str, minItems: 1 },
    },
    required: ['call_type', 'coachable', 'summary', 'opener_result', 'next_step_secured', 'craft', 'prospect', 'opener', 'objections', 'key_exchanges', 'positioning', 'try_next_time'],
  },
};

// The shape Claude must answer in. Structured outputs on the API guarantee the answer matches it exactly: every
// object lists all its fields as required and allows nothing else, and a field that may be empty says so with
// null. Number limits are not supported there, so they are checked in validate() instead.
function strictSchema(node) {
  if (Array.isArray(node)) return node.map(strictSchema);
  if (!node || typeof node !== 'object') return node;
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (['minimum', 'maximum', 'minItems', 'maxItems', 'minLength', 'maxLength'].includes(k)) continue;
    out[k] = k === 'properties' ? Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, strictSchema(pv)])) : strictSchema(v);
  }
  // ["object", "null"] and the like become anyOf, the form structured outputs accept.
  if (Array.isArray(out.type)) {
    const { type, ...rest } = out;
    return { anyOf: type.map((t) => (t === 'null' ? { type: 'null' } : strictSchema({ ...rest, type: t }))) };
  }
  if (out.type === 'object' && out.properties) {
    out.required = Object.keys(out.properties);
    out.additionalProperties = false;
  }
  return out;
}
const OUTPUT_SCHEMA = strictSchema(ANALYSIS_TOOL.input_schema);

const SYSTEM = `You are a sales coach reviewing a recorded call by an SDR (sales development rep) at boost, a monday.com partner that sells implementation and consulting services. Coach the way a good sales manager would: specific, fair, practical and kind, never harsh.

You will get a transcript where the SDR is labelled "SDR" and the other person "PROSPECT". Transcripts are machine-generated and can contain errors; do not criticise transcription mistakes. Many calls are short. A prospect who hangs up or brushes the SDR off within the first few exchanges is useful data, so analyse it, do not dismiss it.

Judge three things:
1. How the call opened and what happened next (did the prospect stay, brush the SDR off, or hang up?).
2. Any objection or brush-off, where in the call it came, and how the SDR answered.
3. For real two-way conversations, call craft.

Set "coachable" to true for ANY real two-way conversation: the prospect spoke at least about four times and the two of them actually exchanged views, whatever the language, and even when it was mostly the prospect asking questions or the SDR talking too much. A call of several minutes is always coachable. Set it to false only for voicemail, phone menus, gatekeeper-only calls and quick hang-ups or brush-offs in the first few turns; for those still score the opening (and any objection handling), leave the other craft dimensions null, and record any exchange that happened.

Call craft is scored 1 (weak) to 5 (excellent): opening, discovery, objection handling, asking for the next step, tone and call control. Score the opening on EVERY call where a person answered, however short: a call that was brushed off after an apology still has an opening to score, judged from how the SDR opened (the first lines). Score objection handling whenever the prospect raised an objection or brushed the SDR off, and tone and call control whenever there was any exchange. Score discovery and asking for the next step when they could have happened; on a call that ended within the first few turns use null for those two. On a longer conversation score all five: an SDR who never asked about the prospect's situation scores discovery 1 or 2, not null.

Rules:
- Calls may be in Hebrew or another language. Write every finding in English: the summary, the notes, the reasons, the suggestions and the explanations. Never answer in the language of the call.
- Every quote is given twice. The main field ("quote", "evidence" or "response_quote") is copied word for word in the original language, exactly as it appears in the transcript, short (under 30 words) and never invented. That copy is checked against the transcript, so never translate it. The matching field ending in _en is a faithful English translation of the same words (identical to the original when the call is already in English).
- Base everything on the transcript. If something is unclear, say so instead of guessing.
- "try_next_time" must be one to three concrete actions for the next call, each tied to something that actually happened on this call. Quote the SDR's own words that should change (short, exact) and give the replacement wording the SDR could say, written as natural speech and not as a script. Never give generic advice such as "ask more open questions" or "build rapport". For early hang-ups, focus on the first ten seconds.
- "summary": two or three plain sentences a manager could read in ten seconds: who the prospect was, what the SDR did well or badly, and how it ended. Name the single most important thing to coach.
- "key_exchanges": the heart of the coaching. For every real conversation give 3 to 6 of the most teachable exchanges, in the order they happened. Each pairs what the PROSPECT said or asked (prospect_quote) with the SDR's actual answer (sdr_quote). Always include every time the prospect asked a direct question (for example "what do you actually offer?"), raised an objection or showed interest, and the exchange where the SDR asked for the next step. Give a verdict: "landed" (the answer worked), "partly" (some of it worked) or "missed" (it did not land, for example a long, shifting or vague answer to a simple question). In what_happened, critique specifically: say what the SDR did, quote the exact words that were weak or strong, and why that landed or did not. In better, say what to say instead, written as the natural words the SDR could use (for a "landed" exchange, say why it is worth repeating). Include one or two "landed" exchanges where they exist. For short calls give one or two. Never return an empty list for a real conversation.
- "best_moment" and "missed_moment": pick the moment that teaches the most, quote it, and say specifically why it worked or what a stronger SDR would have said instead. Use null only when nothing on the call qualifies.
- Coach on what the SDR controls (the opening, listening, how they answered the objection, the ask for the next step), not on the prospect's behaviour. Praise only specific things, and keep the tone of a manager who wants this person to improve.
- Be honest. Praise only what happened.
- "objections": each genuine objection or brush-off from the prospect (up to four) with the SDR's actual reply and where it came ("opener" means within the first couple of exchanges). Use an empty list if there were none.
- "prospect": only use what is said on the call. Use null or "unknown" when it is not stated; never guess a job title.
- "opener" and "positioning": always fill these in for every call where a person answered, even a very short one. Judge them from the first things the SDR said; if the call ended before the SDR said anything usable, use style "other" or lead "none" and say so in the note.
- "industry": always choose the closest item from the fixed list, so industries can be compared across calls. If the message includes a CRM record, use its industry (mapped onto the list) and set industry_source to "crm". Otherwise use what is said on the call ("call"), or, when the company name makes the industry clear, that ("company_name"). If it cannot be told, use "Other" with industry_source "unknown". The CRM record is context from our own database and can be incomplete; the call itself wins if they clearly disagree.

Opener style: almost every call starts by checking who is on the line ("is that Alex?", "am I speaking to the right person?"). Ignore that step, and any automated screener ("record your name and reason"). Judge by the FIRST THING the SDR says after it: what they do next, not how the call went. Choose exactly one, using this order when more than one fits (warm reference, apology, role check, then the rest):
- warm_followup: the first thing refers to an earlier meeting, event, call or conversation, a named person who referred them, or a previous attempt (for example "we met at the event", "we spoke yesterday", "Gershon suggested I call you", "it's Emad again").
- apology: the first thing is an apology or an admission that this is an interruption (for example "I'm sorry for calling you out of the blue", "sorry that this is a cold call", "I know you're busy, I'm sorry to take your time", "apologies for the interruption"), even when a request for a moment follows.
- role_check: opens by checking their role or that they are still in post, using what we know about them (for example "I saw you're head of operations at X, is that still right?", "are you still at Y?"). This is not the plain check on who is on the line.
- cold_permission_ask: gives a name and company and asks for a moment or any request to continue, without apologising and without saying what we do yet (for example "do you have 30 seconds?", "how are you, have you got a minute?").
- credentials_first: goes straight into what the company does or who it works with, naming clients or partners (for example "we work with monday.com and Anthropic and clients like ..."), before or while asking for a minute.
- pain_question_hook: opens with a problem or a result and a question as the hook (for example "how do you handle leads that sit untouched in the CRM?", "hours wasted on spreadsheets, is that familiar?").
- other: use ONLY when there was no real opening to judge (the call joined mid-sentence, or the SDR said nothing usable). If the opening is unusual, still pick the closest of the five. Aim for "other" on fewer than one call in five.

Positioning (who boost says it is): look at what the SDR says boost is in the first 20 to 30 seconds of the call (the first few turns, before the real conversation). Always fill this in, even when the call was short: if the SDR never says what boost is in that time, say so with lead "none". Record:
- lead: the FIRST way the SDR describes what boost is. "monday" if boost is described as a monday.com business or partner (for example "we are a monday.com partner", "we implement monday.com"). "ai" if it is described as an AI business (for example "we build AI agents", "we do AI automation"). "other" if it is described another way (a consultancy, a software company, services, clients or partners named, or only what boost achieves for customers). "none" if the SDR never says who boost is.
- other_kind: only when lead is "other". "generic_company" = a vague company description (for example "an implementation company for technology solutions", "a consulting firm", "back end systems", "process improvement"). "results_only" = only what we achieve for customers (for example "we help teams get back time spent on spreadsheets", "we work with real estate teams on leads"). "credentials_only" = only clients, partners or awards named with no plain description of what boost does (for example "we are an Anthropic partner"). Otherwise "none".
- mentions_monday and mentions_ai: whether monday.com, and whether AI, are mentioned at all as part of what boost is or does in that first part.
- when: where it first happened: "opening" (the first couple of turns), "early" (within about the first 30 seconds), "later" (after that), or "never".
- quote: the SDR's own words for it, verbatim in the original language, under 30 words; an empty string if there are none.
- reaction: how the prospect responded straight after: "engaged" (asked a question, stayed, showed interest), "neutral", "pushed_back" (for example "what is this about", "not interested"), "ended" (hung up) or "unclear".
Judge only from what is actually said; do not infer it.

Objection category: choose the closest group and use "other" only when none fits.
- not_interested: a plain no, "we do not take sales calls", "not for us".
- not_a_good_time: busy, in a meeting, "not a great time", "can you call later", "I have no time", or priorities and bandwidth are elsewhere right now. These are one group, however they are worded.
- send_email: asks for an email, brochure or information instead of talking.
- already_covered: already has a tool, partner, competitor or an in-house team, or is already doing this (for example already using AI).
- no_budget: no money, no budget, too expensive, spend frozen.
- too_small_or_no_need: the team is too small or not big enough, or they say they do not need it.
- wrong_person: not the right contact, has left the role or company, or someone else decides.
- data_source_challenge: asks how the SDR got their number or details.
Give each distinct objection its own entry. If the prospect misunderstood what boost does, pick the closest group and explain in "why".

Return your analysis as one JSON object in exactly this shape:
{
  "call_type": ${list(CALL_TYPES)},
  "language": "the main language the call was spoken in, written in English, for example English or Hebrew",
  "coachable": boolean,
  "summary": "two sentences on what happened and where the call ended",
  "opener_result": ${list(OPENER_RESULTS)},
  "ended_by": "prospect" | "sdr" | "unclear",
  "next_step_secured": boolean,
  "craft": { ${CRAFT.map((c) => `"${c.key}": { "score": 1-5 or null, "note": "one sentence" }`).join(', ')} },
  "prospect": { "role_or_title": "as said on the call, or null", "seniority": ${list(SENIORITY)}, "company_type_or_industry": "as said or clearly implied, or null", "industry": ${list(INDUSTRIES)}, "industry_source": ${list(INDUSTRY_SOURCES)} },
  "positioning": { "lead": ${list(POSITIONING_LEADS)}, "other_kind": ${list(POSITIONING_OTHER_KINDS)}, "mentions_monday": true|false, "mentions_ai": true|false, "when": ${list(POSITIONING_WHEN)}, "quote": "verbatim, original language: how the SDR described who boost is, or empty", "quote_en": "English translation", "reaction": ${list(POSITIONING_REACTIONS)}, "note": "one sentence" },
  "opener": { "style": ${list(OPENER_STYLES)}, "quote": "verbatim, original language: how the SDR opened, the first thing said after the greeting", "quote_en": "English translation", "note": "one sentence" },
  "objections": [ { "category": ${list(OBJECTION_CATEGORIES)}, "stage": ${list(STAGES)}, "quote": "verbatim prospect words, original language", "quote_en": "English translation", "response_quote": "verbatim SDR reply in the original language, or empty string", "response_quote_en": "English translation of the reply", "handled": "well" | "ok" | "poorly", "why": "one sentence" } ],
  "key_exchanges": [ { "kind": ${list(KX_KINDS)}, "prospect_quote": "verbatim prospect words, original language", "prospect_quote_en": "English translation", "sdr_quote": "verbatim SDR answer, original language", "sdr_quote_en": "English translation", "verdict": ${list(KX_VERDICTS)}, "what_happened": "specific critique with the exact words", "better": "what to say instead" } ],
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
// Several turns from the prospect and a fair amount said: a conversation, not a brush-off.
function isRealExchange(turns, callType) {
  if (callType && callType !== 'conversation') return false;
  const prospectTurns = (turns || []).filter((t) => t.who === 'prospect' && String(t.text || '').trim().split(/\s+/).length >= 3).length;
  const chars = (turns || []).reduce((n, t) => n + String(t.text || '').length, 0);
  return prospectTurns >= 4 && chars >= 500;
}

function validate(raw, turns, crm = null) {
  const tNorm = norm(turns.map((t) => t.text).join(' '));
  const posRaw = raw.positioning && typeof raw.positioning === 'object' ? raw.positioning : null;
  const posQuote = raw.positioning?.quote && quoteIsReal(tNorm, raw.positioning.quote) ? String(raw.positioning.quote) : null;
  const posWhen = oneOf(raw.positioning?.when, POSITIONING_WHEN, 'never');
  let posLead = oneOf(raw.positioning?.lead, POSITIONING_LEADS, 'none');
  if (posWhen === 'never') posLead = 'none';
  const openerQuote = raw.opener?.quote && quoteIsReal(tNorm, raw.opener.quote) ? String(raw.opener.quote) : null;
  const out = {
    version: RUBRIC_VERSION,
    schema: ANALYSIS_SCHEMA,
    callType: oneOf(raw.call_type, CALL_TYPES, 'other'),
    language: String(raw.language || 'English').trim().slice(0, 30) || 'English',
    // A real exchange is always coachable, whatever the model said, so a long conversation can never be
    // written off as nothing to learn from.
    coachable: raw.coachable === true || isRealExchange(turns, raw.call_type),
    summary: String(raw.summary || '').slice(0, 600),
    openerResult: oneOf(raw.opener_result, OPENER_RESULTS, 'unclear'),
    endedBy: oneOf(raw.ended_by, ['prospect', 'sdr', 'unclear'], 'unclear'),
    nextStepSecured: Boolean(raw.next_step_secured),
    craft: {},
    prospect: {
      role: raw.prospect?.role_or_title ? String(raw.prospect.role_or_title).slice(0, 80) : null,
      seniority: oneOf(raw.prospect?.seniority, SENIORITY, 'unknown'),
      industry: raw.prospect?.company_type_or_industry ? String(raw.prospect.company_type_or_industry).slice(0, 80) : null,
      industryGroup: null,
      industrySource: 'unknown',
      company: null,
    },
    // No positioning in the answer means it was not recorded, which is different from the SDR not saying it.
    positioning: !posRaw ? null : {
      recorded: true,
      lead: posLead,
      otherKind: posLead === 'other' ? oneOf(raw.positioning?.other_kind, POSITIONING_OTHER_KINDS, 'generic_company') : 'none',
      // The lead always counts as mentioned; with no lead nothing was said.
      mentionsMonday: posLead !== 'none' && (posLead === 'monday' || Boolean(raw.positioning?.mentions_monday)),
      mentionsAi: posLead !== 'none' && (posLead === 'ai' || Boolean(raw.positioning?.mentions_ai)),
      when: posWhen,
      quote: posQuote,
      quoteEn: posQuote ? english(posQuote, raw.positioning?.quote_en) : null,
      reaction: oneOf(raw.positioning?.reaction, POSITIONING_REACTIONS, 'unclear'),
      note: String(raw.positioning?.note || '').slice(0, 300),
    },
    // No opener in the answer means it was not recorded, which is different from an opener that fits no type.
    opener: !(raw.opener && typeof raw.opener === 'object') ? null : {
      recorded: true,
      style: oneOf(modernOpener(raw.opener.style), OPENER_STYLES, 'other'),
      quote: openerQuote,
      quoteEn: openerQuote ? english(openerQuote, raw.opener.quote_en) : null,
      note: String(raw.opener.note || '').slice(0, 300),
    },
    objections: [],
    keyExchanges: [],
    bestMoment: null,
    missedMoment: null,
    tryNextTime: Array.isArray(raw.try_next_time) ? raw.try_next_time.map(String).slice(0, 3) : [],
    analysedAt: new Date().toISOString(),
  };

  // Industry: the CRM record wins when there is one; otherwise the model's pick from the fixed list.
  const picked = oneOf(raw.prospect?.industry, INDUSTRIES, 'Other');
  const pickedSource = oneOf(raw.prospect?.industry_source, INDUSTRY_SOURCES, 'unknown');
  out.prospect.industryGroup = picked;
  out.prospect.industrySource = crm?.industry ? 'crm' : pickedSource === 'crm' ? 'unknown' : pickedSource;
  if (crm) {
    out.prospect.company = crm.company ? String(crm.company).slice(0, 80) : null;
    if (!out.prospect.role && crm.title) out.prospect.role = String(crm.title).slice(0, 80);
    if (out.prospect.seniority === 'unknown') out.prospect.seniority = crmSeniority(crm.seniority) || 'unknown';
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
        category: oneOf(modernCategory(o.category), OBJECTION_CATEGORIES, 'other'),
        stage: oneOf(o.stage, STAGES, 'middle'),
        quote: String(o.quote),
        quoteEn: english(String(o.quote), o.quote_en),
        responseQuote,
        responseQuoteEn: responseQuote ? english(responseQuote, o.response_quote_en) : null,
        handled: oneOf(o.handled, ['well', 'ok', 'poorly'], 'ok'),
        why: String(o.why || '').slice(0, 300),
      };
    });

  for (const e of (Array.isArray(raw.key_exchanges) ? raw.key_exchanges : []).slice(0, 6)) {
    const pq = e?.prospect_quote && quoteIsReal(tNorm, e.prospect_quote) ? String(e.prospect_quote) : null;
    const sq = e?.sdr_quote && quoteIsReal(tNorm, e.sdr_quote) ? String(e.sdr_quote) : null;
    if (!pq && !sq) continue; // nothing in it can be traced to the transcript
    out.keyExchanges.push({
      kind: oneOf(e.kind, KX_KINDS, 'other'),
      prospectQuote: pq,
      prospectQuoteEn: pq ? english(pq, e.prospect_quote_en) : null,
      sdrQuote: sq,
      sdrQuoteEn: sq ? english(sq, e.sdr_quote_en) : null,
      verdict: oneOf(e.verdict, KX_VERDICTS, 'partly'),
      whatHappened: String(e.what_happened || '').slice(0, 600),
      better: String(e.better || '').slice(0, 600),
    });
  }
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
  const timer = setTimeout(() => ctrl.abort(), 120000);
  try {
    const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: ctrl.signal,
      headers: anthropicHeaders(apiKey),
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        // Room for an analysis with several quotes in the original language and in English. Only tokens
        // actually produced are paid for.
        max_tokens: 16000,
        system: SYSTEM,
        // The answer must match OUTPUT_SCHEMA exactly (structured outputs). Effort is kept low: classifying and
        // coaching one call does not need long deliberation, and high effort is what made each call slow.
        output_config: { effort: CLAUDE_EFFORT, format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
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
  if (json.stop_reason === 'refusal') throw new Error('Claude declined to analyse this call');
  const blocks = json.content || [];
  const tool = blocks.find((b) => b.type === 'tool_use' && b.name === ANALYSIS_TOOL.name);
  if (tool && tool.input && typeof tool.input === 'object') return tool.input;
  return extractJson(blocks.filter((b) => b.type === 'text').map((b) => b.text).join(''));
}

async function analyseCall({ turns, call, prospect = null }, { fetchImpl = fetch } = {}) {
  const apiKey = getSecret('ANTHROPIC_API_KEY');
  if (!apiKey) throw Object.assign(new Error('The server is missing ANTHROPIC_API_KEY.'), { code: 'not_configured' });

  const length = call.durationMin == null ? 'unknown length' : `about ${Math.round(call.durationMin)} minute${Math.round(call.durationMin) === 1 ? '' : 's'}`;
  const crmLines = prospect ? [
    prospect.company && `Company: ${prospect.company}`,
    prospect.title && `Job title: ${prospect.title}`,
    prospect.seniority && `Seniority: ${prospect.seniority}`,
    prospect.employees && `Employees: ${prospect.employees}`,
    prospect.industry && `Industry (CRM): ${prospect.industry}`,
  ].filter(Boolean) : [];
  const crm = crmLines.length ? `\n\nCRM record for the person called (from our own database, may be incomplete):\n${crmLines.join('\n')}` : '';
  const user = `Call length: ${length}.${crm}\n\nTranscript:\n${renderForModel(turns)}\n\nReturn your analysis as JSON.`;

  // One request. An unreadable answer (which structured outputs should prevent) is tried once more. An answer
  // missing a required part is sent back once naming what is missing; if it is still missing, the call fails
  // with the reason and is NOT saved, so an incomplete result can never be counted as analysed.
  let note = '';
  let unreadable = 0;
  for (;;) {
    const json = await askClaude(user + note, apiKey, fetchImpl);
    let result;
    try {
      result = validate(readAnalysis(json), turns, prospect);
    } catch (err) {
      const isUnreadable = err instanceof SyntaxError || /did not return JSON/.test(err.message);
      if (!isUnreadable || unreadable >= 1) throw err;
      unreadable += 1;
      continue;
    }
    const missing = missingParts(result);
    if (!missing.length) return result;
    if (note) {
      throw Object.assign(new Error(`incomplete: ${missing.map((m) => m.split(':')[0]).join(', ')}`), { code: 'incomplete' });
    }
    note = `\n\nYour previous answer left out: ${missing.join('; and ')}. Please fill these in.`;
  }
}

// A call with a person on the line and no craft scores at all has not been coached, however short it was.
function isThin(a) {
  return Boolean(a && ['conversation', 'early_hangup'].includes(a.callType)
    && !Object.values(a.craft || {}).some((c) => Number.isFinite(c?.score)));
}

// Parts an answer must have but left out, so it can be asked for again.
function missingParts(a) {
  const parts = [];
  if (isThin(a)) parts.push('the call craft scores: score the opening on every call where a person answered, and every other dimension that happened, from 1 to 5 (opening, discovery, objection handling, asking for the next step, tone and call control), with a note each, and give 3 to 6 key exchanges (what the prospect asked or said, how the SDR answered, a verdict, a specific critique and what to say instead)');
  if (a && !['voicemail', 'automated_menu'].includes(a.callType) && !a.positioning) parts.push('"positioning": how the SDR described who boost is in the first 20 to 30 seconds, or lead "none" if they did not');
  if (a && !['voicemail', 'automated_menu'].includes(a.callType) && !a.opener) parts.push('"opener": the type of opening (what the SDR said first after checking who was on the line) with the SDR\'s own words');
  return parts;
}

// Analyses saved with no real opener (a default "other" with no words and no note) were never judged.
function openerUnrecorded(a) {
  if (!a || ['voicemail', 'automated_menu'].includes(a.callType)) return false;
  const o = a.opener;
  if (o === null || o === undefined) return true; // never recorded
  if (o.recorded) return false;
  return o.style === 'other' && !o.quote && !o.note;
}

// Analyses saved before positioning was required may hold a default "did not say" the model never
// actually judged (no words, no reaction, no note). Those are not evidence; they are offered for redoing.
function positioningUnrecorded(a) {
  if (!a || ['voicemail', 'automated_menu'].includes(a.callType)) return false;
  const p = a.positioning;
  if (p === null || p === undefined) return true; // never recorded
  if (p.recorded) return false;
  return p.lead === 'none' && p.when === 'never' && !p.quote && p.reaction === 'unclear' && !p.note;
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
      // Sends the real answer schema too, so a format Anthropic would reject shows up here
      // and not on every analysis. The tiny token limit keeps the cost negligible; running out
      // of room is fine because only the request being accepted matters.
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 16,
        output_config: { effort: CLAUDE_EFFORT, format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
        messages: [{ role: 'user', content: 'Check: return a test analysis.' }],
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
  not_a_good_time: 'Not a good time',
  send_email: 'Send me an email',
  already_covered: 'Already covered',
  no_budget: 'No budget',
  too_small_or_no_need: 'Too small or no need',
  wrong_person: 'Wrong person',
  data_source_challenge: 'Asks how they got the number',
  other: 'Other',
};
const OBJECTION_DESCRIPTIONS = {
  not_interested: 'A plain no, or "we do not take sales calls".',
  not_a_good_time: 'Busy, in a meeting, "not a great time", "call me later" or "no time".',
  send_email: 'Asks for an email or information instead of talking.',
  already_covered: 'Already has a tool, partner, competitor or in-house team, or is already doing AI.',
  no_budget: 'No money, no budget, too expensive or spend frozen.',
  too_small_or_no_need: 'Team too small, not big enough, or "we do not need it".',
  wrong_person: 'Not the right contact, left the role, or the decision sits with someone else.',
  data_source_challenge: 'Asks how the SDR got their number or details.',
  other: 'Does not clearly fit one of these.',
};
// The ways of saying who boost is, grouped for the trends (see trends.js).
const POSITIONING_LABELS = {
  monday: 'monday.com business',
  ai: 'AI business',
  both: 'monday.com and AI',
  consultancy: 'Consultancy or technology company',
  other: 'Something else',
  none: 'Did not say in the first 20 seconds',
};
const POSITIONING_DESCRIPTIONS = {
  monday: 'Said we are a monday.com partner or implement monday.com, with no mention of AI.',
  ai: 'Said we are an AI business or build AI, with no mention of monday.com.',
  both: 'Mentioned both monday.com and AI.',
  consultancy: 'Said something like "an implementation company for technology solutions" or "a consulting firm", without saying monday.com or AI.',
  other: 'Described only the results we get, or only clients and partners we work with.',
  none: 'Did not say what we are in that time, or the call ended before it could be said.',
};
const OPENER_LABELS = {
  warm_followup: 'Warm reference',
  apology: 'Apology',
  role_check: 'Role check',
  cold_permission_ask: 'Permission ask',
  credentials_first: 'Who we are first',
  pain_question_hook: 'Problem or result hook',
  other: 'Other',
};
const OPENER_DESCRIPTIONS = {
  warm_followup: 'Refers to an earlier call, meeting, event, a referrer or a previous attempt ("we spoke yesterday").',
  apology: 'Starts by apologising for the interruption ("sorry for calling out of the blue", "I know you are busy").',
  role_check: 'Starts by checking their role or that they are still in post ("I saw you are head of operations at X, is that still right?").',
  cold_permission_ask: 'Gives a name and company and asks for a moment, without apologising or saying what we do yet ("30 seconds?").',
  credentials_first: 'Goes straight into what we do or names clients or partners, then asks for a minute.',
  pain_question_hook: 'Opens with a problem or a result and a question ("how do you handle leads that go untouched?"). Rarely used so far, worth an A/B test.',
  other: 'Does not clearly fit one of the five. The check on who is on the line is ignored; this is about what comes next.',
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
  OUTPUT_SCHEMA,
  analyseCall, isThin, missingParts, positioningUnrecorded, openerUnrecorded, ping, validate, extractJson, CRAFT, SYSTEM, ANALYSIS_SCHEMA, INDUSTRIES,
  OBJECTION_LABELS, OBJECTION_DESCRIPTIONS, POSITIONING_LABELS, POSITIONING_DESCRIPTIONS, OPENER_LABELS, OPENER_DESCRIPTIONS, modernCategory, modernOpener, SENIORITY_LABELS, CALL_TYPE_LABELS,
};
