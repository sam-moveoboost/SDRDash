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
const { ANALYSIS_SCHEMA } = require('../lib/analysis');

const CALLS_TTL_MS = 2 * 60 * 1000; // newer than this: served as is
const CALLS_STALE_MS = 6 * 60 * 60 * 1000; // older: served at once while a top-up loads behind it
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

  // The calls list is kept and served straight away. When it is older than the TTL it is topped
  // up in the background (one shared load, however many requests ask), so opening the tab never
  // waits on monday once the server has the list. `fresh` (the Refresh button) waits for a reload.
  const loading = new Map(); // days -> in-flight load
  function reloadCalls(days) {
    if (!loading.has(days)) {
      const p = mondayApi.fetchCalls(now() - days * 86400000)
        .then((calls) => { callsCache.set(days, { at: now(), calls }); return calls; })
        .finally(() => loading.delete(days));
      loading.set(days, p);
    }
    return loading.get(days);
  }
  async function loadCalls(days, { fresh = false } = {}) {
    const hit = callsCache.get(days);
    if (hit && !fresh) {
      const age = now() - hit.at;
      if (age < CALLS_TTL_MS) return hit.calls;
      if (age < CALLS_STALE_MS) {
        reloadCalls(days).catch((err) => console.error(`[calls] background refresh failed: ${err.message}`));
        return hit.calls;
      }
    }
    return reloadCalls(days);
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
  const loadAnalyses = (calls) => store.mapLimit(calls, 6, async (c) => ({ call: c, ...(await store.getAnalysisChecked(c.id)) }));

  router.get('/me', (req, res) => res.json({ userId: req.viewer.userId, isAdmin: req.viewer.isAdmin }));

  router.get('/overview', handle(async (req, res) => {
    const scope = scopeOr403(req, res);
    if (!scope) return;
    const days = parseDays(req.query.days);
    const all = await loadCalls(days, { fresh: req.query.fresh === '1' });
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
    const candidates = inScope(await loadCalls(days, { fresh: req.query.fresh === '1' }), scope.sdrId).filter(isCandidate);
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
    // An analysis that is missing, or was made under older rules (before English findings, before the
    // five opening types), is offered for redoing so the whole set follows the current rules.
    const refreshOf = (analysis) => (!analysis ? 'missing' : !(analysis.schema >= ANALYSIS_SCHEMA) ? 'outdated' : null);
    const byNewest = (x, y) => String(y.createdAt).localeCompare(String(x.createdAt));
    const unreadable = done.filter((p) => !p.analysis && p.unreadable);
    const refreshing = done.filter((p) => !(!p.analysis && p.unreadable) && refreshOf(p.analysis));

    // Every call that still needs analysing is always sent, so "Analyse all" really covers them all.
    // Finished calls fill the rest of the list, newest first, up to a cap.
    const waitingRows = [
      ...refreshing.map((p) => row(p.call, { status: 'waiting', refresh: refreshOf(p.analysis), transcript: { available: true }, analysis: p.analysis, detailsMissing: !p.analysis, priority: p.analysis ? reviewPriority(p.analysis, p.call) : null })),
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
      // Calls marked Analysed whose saved result could not be read just now (storage slow). They are
      // not offered for re-analysis, so nothing is paid for twice; Refresh reads them again.
      unreadableCount: unreadable.length,
      // Why, for managers: the distinct errors the stores gave, so a real fault is not hidden behind "slow".
      unreadableReasons: req.viewer.isAdmin ? [...new Set(unreadable.flatMap((p) => p.errors || []))].slice(0, 4) : [],
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
    const analysedCalls = inScope(await loadCalls(days, { fresh: req.query.fresh === '1' }), sdrId).filter(isCandidate).filter(isAnalysed);
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
  // Analyses one call and says what happened. Used by the request that waits for the answer and by
  // the background jobs below.
  async function analyseOne(id, viewer) {
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
      if (!call || (!viewer.isAdmin && call.sdrId !== viewer.userId) || !isCandidate(call)) {
        return { id, error: 'not_found' };
      }
      if (isAnalysed(call)) {
        const checked = await step('read saved analysis', () => store.getAnalysisChecked(id));
        if (!checked.analysis && checked.unreadable) {
          return { id, error: 'storage_unreadable', message: 'The saved analysis could not be read just now because storage was slow. It was not redone, so nothing was paid for twice. Try again in a minute.' };
        }
        const existing = checked.analysis;
        if (existing && existing.schema >= ANALYSIS_SCHEMA) {
          return { id, analysis: existing, saved: true, marked: true };
        }
        // Marked done, but the saved analysis is missing or was made under older rules: redo it.
      }
      const raw = await step('read transcript', async () => (await loadTranscripts([call]))[id]);
      const parsed = parseTranscript(raw, call.agentName);
      if (!usable(parsed)) {
        return { id, error: parsed ? 'too_short' : 'no_transcript' };
      }

      // The CRM record (industry, company, title) gives the analysis context the call may never state.
      const prospect = typeof mondayApi.fetchProspect === 'function' ? await step('look up the prospect', () => mondayApi.fetchProspect(call)) : null;
      const result = await step('analyse with Claude', () => analysis.analyseCall({ turns: parsed.turns, call, prospect }));
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
      return { id, analysis: result, saved, marked };
    } catch (err) {
      if (err.code === 'not_configured') throw err;
      console.error(`[analyse] ${id} failed at "${stepName}" after ${Date.now() - t0}ms: ${err.message}`);
      return { id, error: 'failed', step: stepName, message: `${stepName}: ${err.message}` };
    }
  }

  // The request that waits for the answer (kept for small jobs and for tests).
  router.post('/analyse', express.json(), handle(async (req, res) => {
    const ids = [...new Set((req.body?.ids || []).map(String))].slice(0, cfg.MAX_ANALYSE_PER_REQUEST);
    if (!ids.length) return res.status(400).json({ error: 'bad_request', message: 'No calls given.' });
    const results = [];
    for (const id of ids) results.push(await analyseOne(id, req.viewer));
    return res.json({ results });
  }));

  // ---- background analysis ----
  // One analysis can take a minute now that the coaching is richer, and a long request can be cut off
  // by the hosting. So the page starts the work and then asks how it is going: the server does the
  // analysing on its own, a couple at a time, and the page only ever makes short requests. Results
  // are kept in memory for a while; the analyses themselves are saved permanently as before.
  const JOB_KEEP_MS = 30 * 60 * 1000;
  const MAX_JOB_WORKERS = 2;
  const MAX_JOB_IDS = 200;
  const jobs = new Map(); // id -> { state, viewerId, result?, at }
  const jobQueue = [];
  let jobWorkers = 0;

  function runJobs() {
    while (jobWorkers < MAX_JOB_WORKERS && jobQueue.length) {
      const { id, viewer } = jobQueue.shift();
      const job = jobs.get(id);
      if (!job || job.state !== 'queued') continue; // cancelled
      jobWorkers += 1;
      job.state = 'running';
      job.at = now();
      analyseOne(id, viewer)
        .then((result) => { jobs.set(id, { state: result.error ? 'failed' : 'done', viewerId: viewer.userId, result, at: now() }); })
        .catch((err) => { jobs.set(id, { state: 'failed', viewerId: viewer.userId, result: { id, error: 'failed', message: err.message }, at: now() }); })
        .finally(() => { jobWorkers -= 1; runJobs(); });
    }
  }
  const sweepJobs = () => { for (const [id, j] of jobs) if (now() - j.at > JOB_KEEP_MS && j.state !== 'running') jobs.delete(id); };
  const mayRead = (job, viewer) => viewer.isAdmin || job.viewerId === viewer.userId;

  router.post('/analyse/start', express.json(), handle(async (req, res) => {
    const ids = [...new Set((req.body?.ids || []).map(String))].slice(0, MAX_JOB_IDS);
    if (!ids.length) return res.status(400).json({ error: 'bad_request', message: 'No calls given.' });
    sweepJobs();
    const accepted = [];
    for (const id of ids) {
      const existing = jobs.get(id);
      if (existing && (existing.state === 'queued' || existing.state === 'running')) { accepted.push(id); continue; } // already on its way
      jobs.set(id, { state: 'queued', viewerId: req.viewer.userId, at: now() });
      jobQueue.push({ id, viewer: { userId: req.viewer.userId, isAdmin: req.viewer.isAdmin } });
      accepted.push(id);
    }
    runJobs();
    return res.status(202).json({ accepted });
  }));

  router.get('/analyse/status', handle(async (req, res) => {
    const ids = String(req.query.ids || '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, MAX_JOB_IDS);
    const out = {};
    for (const id of ids) {
      const job = jobs.get(id);
      if (!job || !mayRead(job, req.viewer)) { out[id] = { state: 'unknown' }; continue; }
      out[id] = job.state === 'done' || job.state === 'failed' ? { state: job.state, result: job.result } : { state: job.state };
    }
    return res.json({ jobs: out, queued: jobQueue.length, running: jobWorkers });
  }));

  router.post('/analyse/cancel', express.json(), handle(async (req, res) => {
    const ids = new Set((req.body?.ids || []).map(String));
    let cancelled = 0;
    for (const id of ids) {
      const job = jobs.get(id);
      if (job && job.state === 'queued' && mayRead(job, req.viewer)) { jobs.delete(id); cancelled += 1; }
    }
    return res.json({ cancelled });
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

  // Run once when the server starts, so the first person to open the tab does not wait for it.
  router.warm = async (days = 30) => {
    try {
      const all = await loadCalls(days);
      await loadAnalyses(all.filter(isCandidate).filter(isAnalysed));
      console.log(`[warm] ${all.length} calls and their analyses are ready`);
    } catch (err) {
      console.error(`[warm] could not preload: ${err.message}`);
    }
  };

  return router;
}

module.exports = { createRouter };
