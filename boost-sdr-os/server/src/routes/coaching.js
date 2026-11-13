// Coaching hub endpoints. Every route works out who is asking from monday's signed
// token and filters on the server. SDRs only ever receive their own calls.
//
// Which calls are coached:
//  - answered calls only (unanswered calls never get a transcript),
//  - from 1 November 2026 onwards (the "line in the sand"),
//  - with a transcript update of at least 250 characters on the board item,
//  - and not yet marked "Analysed" in the Coaching analysis column.
// Duration is deliberately not used: short hang-ups are some of the best data.

const express = require('express');
const { requireViewer, resolveScope } = require('../lib/auth');
const cfg = require('../lib/config');
const defaults = {
  mondayApi: require('../lib/mondayApi'),
  analysis: require('../lib/analysis'),
  store: require('../lib/store'),
};
const { parseTranscript } = require('../lib/transcript');
const { statsFor, bySdr } = require('../lib/metrics');
const { summarise } = require('../lib/focus');
const { buildTrends, forEveryone } = require('../lib/trends');
const { reviewPriority } = require('../lib/priority');

const CALLS_TTL_MS = 3 * 60 * 1000;
const FRESH_CALL_MS = 60 * 60 * 1000; // a transcript can still arrive for about an hour
const RECHECK_FRESH_MS = 5 * 60 * 1000;
const RECHECK_OLD_MS = 6 * 60 * 60 * 1000;
const MAX_PENDING_LOOKUPS = 400;
const MAX_ROWS = 200;

function createRouter(deps = {}, { auth = requireViewer, now = () => Date.now() } = {}) {
  const { mondayApi, analysis, store } = { ...defaults, ...deps };
  const router = express.Router();
  router.use(auth);

  // ---- caches (per server process) ----
  const callsCache = new Map(); // days -> { at, calls }
  const transcriptCache = new Map(); // itemId -> { at, raw|null }

  async function loadCalls(days) {
    const hit = callsCache.get(days);
    if (hit && now() - hit.at < CALLS_TTL_MS) return hit.calls;
    const calls = await mondayApi.fetchCalls(now() - days * 86400000);
    callsCache.set(days, { at: now(), calls });
    return calls;
  }

  // Looks up transcripts, remembering "none yet" for a short time on fresh calls
  // (one may still arrive) and a long time on old ones.
  async function loadTranscripts(calls) {
    const missing = calls.filter((c) => {
      const cached = transcriptCache.get(c.id);
      if (!cached) return true;
      if (cached.raw != null) return false;
      const fresh = now() - Date.parse(c.createdAt) < FRESH_CALL_MS;
      return now() - cached.at > (fresh ? RECHECK_FRESH_MS : RECHECK_OLD_MS);
    });
    if (missing.length) {
      const found = await mondayApi.fetchTranscripts(missing.map((c) => c.id));
      for (const c of missing) transcriptCache.set(c.id, { at: now(), raw: found[c.id] ?? null });
    }
    return Object.fromEntries(calls.map((c) => [c.id, transcriptCache.get(c.id)?.raw ?? null]));
  }

  // Finds one call without loading weeks of them: the cached lists first, then a direct lookup.
  async function getCall(id) {
    for (const { calls } of callsCache.values()) {
      const hit = calls.find((c) => c.id === id);
      if (hit) return hit;
    }
    return mondayApi.fetchCall(id);
  }

  const inScope = (calls, sdrId) => (sdrId == null ? calls : calls.filter((c) => c.sdrId === sdrId));
  // Answered and not tagged as no answer, busy or voicemail. Untagged calls stay in,
  // because a fresh call may not be tagged yet and its transcript will show what it was.
  const isCandidate = (c) => c.answered && !c.noConnectionTag && Date.parse(c.createdAt) >= cfg.COACHING_FROM_MS;
  const isAnalysed = (c) => c.coachingStatus === cfg.STATUS_ANALYSED;
  const parseDays = (q) => Math.min(cfg.MAX_DAYS, Math.max(7, parseInt(q, 10) || 30));
  const usable = (parsed) => !!parsed && parsed.stats.chars >= cfg.MIN_TRANSCRIPT_CHARS;

  function scopeOr403(req, res) {
    const scope = resolveScope(req.viewer, req.query.userId ?? req.body?.userId);
    if (scope.denied) {
      res.status(403).json({ error: 'forbidden', message: 'You can only see your own coaching.' });
      return null;
    }
    return scope;
  }

  function handle(fn) {
    return async (req, res) => {
      try {
        await fn(req, res);
      } catch (err) {
        if (err.code === 'not_configured') return res.status(503).json({ error: 'not_configured', message: err.message });
        console.error('[coaching]', err.message);
        return res.status(502).json({ error: 'upstream', message: 'Something went wrong fetching data. Try again in a minute.' });
      }
    };
  }

  // Saved analyses for calls already marked Analysed.
  const loadAnalyses = (calls) => store.mapLimit(calls, 8, async (c) => ({ call: c, analysis: await store.getAnalysis(c.id) }));

  router.get('/me', (req, res) => res.json({ userId: req.viewer.userId, isAdmin: req.viewer.isAdmin }));

  router.get('/overview', handle(async (req, res) => {
    const scope = scopeOr403(req, res);
    if (!scope) return;
    const days = parseDays(req.query.days);
    const all = await loadCalls(days);
    const calls = inScope(all, scope.sdrId);

    const analysedCalls = calls.filter(isCandidate).filter(isAnalysed);
    const pairs = (await loadAnalyses(analysedCalls)).filter((p) => p.analysis);
    const analyses = pairs.map((p) => p.analysis);

    // Cross-check of the tags against what the transcripts show: calls tagged as a real
    // connection whose transcript turned out to be a voicemail or phone menu.
    const voicemailLike = (a) => a.callType === 'voicemail' || a.callType === 'automated_menu';
    const connectionCheck = {
      analysed: pairs.length,
      taggedConnectedButVoicemail: pairs.filter((p) => p.call.connected && voicemailLike(p.analysis)).length,
      untaggedButVoicemail: pairs.filter((p) => !p.call.connected && voicemailLike(p.analysis)).length,
    };

    res.json({
      scope: { sdrId: scope.sdrId, isAdmin: req.viewer.isAdmin, days },
      coachingFrom: new Date(cfg.COACHING_FROM_MS).toISOString().slice(0, 10),
      stats: statsFor(calls),
      // Only admins get the per-SDR breakdown of the whole team.
      team: req.viewer.isAdmin && scope.sdrId == null ? bySdr(all) : [],
      sdrs: req.viewer.isAdmin ? bySdr(all).map(({ id, name, calls: n }) => ({ id, name, calls: n })).filter((s) => s.id) : [],
      coaching: summarise(analyses),
      analysedCount: analysedCalls.length,
      connectionCheck,
    });
  }));

  router.get('/calls', handle(async (req, res) => {
    const scope = scopeOr403(req, res);
    if (!scope) return;
    const days = parseDays(req.query.days);
    const candidates = inScope(await loadCalls(days), scope.sdrId).filter(isCandidate);
    const analysedCalls = candidates.filter(isAnalysed);
    const pending = candidates
      .filter((c) => !isAnalysed(c))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, MAX_PENDING_LOOKUPS);

    const transcripts = await loadTranscripts(pending);
    const waiting = pending
      .map((c) => ({ call: c, parsed: parseTranscript(transcripts[c.id], c.agentName) }))
      .filter((p) => usable(p.parsed));
    const done = await loadAnalyses(analysedCalls);

    const row = (c, extra) => ({
      id: c.id,
      sdrId: c.sdrId,
      sdrName: c.sdrName,
      startedAt: c.startedAt,
      createdAt: c.createdAt,
      durationMin: c.durationMin,
      outcome: c.outcome,
      tags: c.tags,
      recordingUrl: c.recordingUrl,
      ...extra,
    });
    // An analysis that is missing, or was saved before findings were written in English (it has no
    // language field), is offered for redoing, so older Hebrew-only wording gets replaced.
    const refreshOf = (analysis) => (!analysis ? 'missing' : !analysis.language ? 'english' : null);
    const byNewest = (x, y) => String(y.createdAt).localeCompare(String(x.createdAt));
    const refreshing = done.filter((p) => refreshOf(p.analysis));

    // Every call that still needs analysing is always sent, so "Analyse all" really covers them all.
    // Finished calls fill the rest of the list, newest first, up to a cap.
    const waitingRows = [
      ...refreshing.map((p) => row(p.call, { status: 'waiting', refresh: refreshOf(p.analysis), transcript: { available: true }, analysis: p.analysis, detailsMissing: !p.analysis })),
      ...waiting.map((p) => row(p.call, { status: 'waiting', refresh: null, transcript: { available: true, chars: p.parsed.stats.chars }, analysis: null })),
    ];
    const finishedRows = done
      .filter((p) => !refreshOf(p.analysis))
      .map((p) => row(p.call, { status: 'analysed', refresh: null, transcript: { available: true }, analysis: p.analysis, detailsMissing: false, priority: reviewPriority(p.analysis, p.call) }))
      .sort(byNewest)
      .slice(0, MAX_ROWS);
    const rows = [...waitingRows, ...finishedRows].sort(byNewest);

    // Managers can see which SDRs actually have transcripts to coach from.
    let coverage = [];
    if (req.viewer.isAdmin) {
      const bySdrId = new Map();
      const bucket = (c) => {
        const k = c.sdrId || `name:${c.sdrName}`;
        if (!bySdrId.has(k)) bySdrId.set(k, { sdrId: c.sdrId, sdrName: c.sdrName, answered: 0, withTranscript: 0 });
        return bySdrId.get(k);
      };
      for (const c of candidates) bucket(c).answered += 1;
      for (const c of analysedCalls) bucket(c).withTranscript += 1;
      for (const p of waiting) bucket(p.call).withTranscript += 1;
      coverage = [...bySdrId.values()].sort((a, b) => b.answered - a.answered);
    }

    res.json({
      calls: rows,
      waitingCount: waitingRows.length,
      refreshCount: refreshing.length,
      // Every call in the period that could be analysed: already analysed plus still waiting.
      transcriptTotals: { valid: analysedCalls.length + waiting.length, analysed: analysedCalls.length, waiting: waiting.length },
      coverage,
      rules: { from: new Date(cfg.COACHING_FROM_MS).toISOString().slice(0, 10), minChars: cfg.MIN_TRANSCRIPT_CHARS },
    });
  }));

  // Team-wide patterns: top objections, the best ways they were handled, how calls open, who books.
  // Everyone sees the whole team's patterns, with nothing that points at an individual or opens a
  // transcript. Managers also get names, links to calls, the SDR comparison, and can look at one SDR.
  router.get('/trends', handle(async (req, res) => {
    const days = parseDays(req.query.days);
    let sdrId = null; // everyone else always gets the whole team, whatever they ask for
    if (req.viewer.isAdmin) {
      const scope = scopeOr403(req, res);
      if (!scope) return;
      sdrId = scope.sdrId;
    }
    const analysedCalls = inScope(await loadCalls(days), sdrId).filter(isCandidate).filter(isAnalysed);
    const pairs = (await loadAnalyses(analysedCalls)).filter((p) => p.analysis);
    const trends = buildTrends(pairs);
    res.json({
      scope: req.viewer.isAdmin ? { sdrId, days } : { days, everyone: true },
      analysedCount: analysedCalls.length,
      trends: req.viewer.isAdmin ? trends : forEveryone(trends),
    });
  }));

  router.get('/calls/:id/transcript', handle(async (req, res) => {
    const call = await getCall(String(req.params.id));
    if (!call || (!req.viewer.isAdmin && call.sdrId !== req.viewer.userId)) {
      return res.status(404).json({ error: 'not_found', message: 'Call not found.' });
    }
    const raw = (await loadTranscripts([call]))[call.id];
    const parsed = parseTranscript(raw, call.agentName);
    if (!parsed) return res.status(404).json({ error: 'no_transcript', message: 'No transcript for this call yet.' });
    // Prospect phone numbers are replaced with a plain label.
    return res.json({ turns: parsed.turns, stats: parsed.stats });
  }));

  // Analyses calls (the app sends one at a time) and saves the result privately in the
  // app's own storage. The board only gets the "Analysed" status, set after the save
  // is confirmed, so a call is never marked done unless its analysis is kept.
  router.post('/analyse', express.json(), handle(async (req, res) => {
    const ids = [...new Set((req.body?.ids || []).map(String))].slice(0, cfg.MAX_ANALYSE_PER_REQUEST);
    if (!ids.length) return res.status(400).json({ error: 'bad_request', message: 'No calls given.' });

    const results = [];
    for (const id of ids) {
      // Time each step and name the one that fails, so a problem is easy to find in the logs.
      let stepName = 'start';
      const t0 = Date.now();
      const step = async (name, fn) => {
        stepName = name;
        const s0 = Date.now();
        const out = await fn();
        console.log(`[analyse] ${id} ${name} ${Date.now() - s0}ms`);
        return out;
      };
      try {
        const call = await step('find call', () => getCall(id));
        // Same rule as everywhere else: SDRs can only analyse their own calls.
        if (!call || (!req.viewer.isAdmin && call.sdrId !== req.viewer.userId) || !isCandidate(call)) {
          results.push({ id, error: 'not_found' });
          continue;
        }
        if (isAnalysed(call)) {
          const existing = await step('read saved analysis', () => store.getAnalysis(id));
          if (existing && existing.language) {
            results.push({ id, analysis: existing, saved: true, marked: true });
            continue;
          }
          // Marked done, but the saved analysis is missing or was made before findings were
          // written in English: fall through and redo it.
        }
        const raw = await step('read transcript', async () => (await loadTranscripts([call]))[id]);
        const parsed = parseTranscript(raw, call.agentName);
        if (!usable(parsed)) {
          results.push({ id, error: parsed ? 'too_short' : 'no_transcript' });
          continue;
        }

        const result = await step('analyse with Claude', () => analysis.analyseCall({ turns: parsed.turns, call }));
        const { sdrShare, sdrQuestions, longestSdrTurnWords, chars } = parsed.stats;
        result.stats = { sdrShare, sdrQuestions, longestSdrTurnWords, chars };

        // The board is only marked once the analysis is confirmed saved permanently.
        const saved = await step('save analysis', () => store.saveAnalysis(id, result));
        let marked = false;
        if (saved) {
          try {
            await step('mark as analysed on the board', () => mondayApi.markAnalysed(id));
            marked = true;
            call.coachingStatus = cfg.STATUS_ANALYSED; // keep the cached list in step
          } catch (err) {
            console.error(`[analyse] ${id} could not mark the board: ${err.message}`);
          }
        }
        console.log(`[analyse] ${id} done in ${Date.now() - t0}ms (saved ${saved}, marked ${marked})`);
        results.push({ id, analysis: result, saved, marked });
      } catch (err) {
        if (err.code === 'not_configured') throw err;
        console.error(`[analyse] ${id} failed at "${stepName}" after ${Date.now() - t0}ms: ${err.message}`);
        results.push({ id, error: 'failed', step: stepName, message: `${stepName}: ${err.message}` });
      }
    }
    return res.json({ results });
  }));

  // Managers only: proves Claude, storage and monday can each be reached from the server.
  router.get('/selftest', handle(async (req, res) => {
    if (!req.viewer.isAdmin) {
      return res.status(403).json({ error: 'forbidden', message: 'This check is for managers.' });
    }
    const run = async (name, fn) => {
      const t0 = Date.now();
      try {
        await fn();
        return { name, ok: true, ms: Date.now() - t0 };
      } catch (err) {
        return { name, ok: false, ms: Date.now() - t0, error: err.message };
      }
    };
    const [claude, saving, monday] = await Promise.all([
      run('Claude (the analysis)', () => analysis.ping()),
      store.selfTest(),
      run('monday (reading the board)', () => mondayApi.ping()),
    ]);
    const checks = [claude, ...saving, monday];
    return res.json({ ok: checks.every((c) => c.ok), checks });
  }));

  return router;
}

module.exports = { createRouter };
