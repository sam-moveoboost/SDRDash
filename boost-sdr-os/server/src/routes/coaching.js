// Coaching hub endpoints. Every route works out who is asking from monday's signed
// token and filters on the server. SDRs only ever receive their own calls.

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
const { buildTrends } = require('../lib/trends');

const CALLS_TTL_MS = 3 * 60 * 1000;
const MISSING_TRANSCRIPT_TTL_MS = 10 * 60 * 1000;

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

  async function loadTranscripts(itemIds) {
    const missing = itemIds.filter((id) => {
      const c = transcriptCache.get(id);
      return !c || (c.raw == null && now() - c.at > MISSING_TRANSCRIPT_TTL_MS);
    });
    if (missing.length) {
      const found = await mondayApi.fetchTranscripts(missing);
      for (const id of missing) transcriptCache.set(id, { at: now(), raw: found[id] ?? null });
    }
    return Object.fromEntries(itemIds.map((id) => [id, transcriptCache.get(id)?.raw ?? null]));
  }

  const inScope = (calls, sdrId) => (sdrId == null ? calls : calls.filter((c) => c.sdrId === sdrId));
  const parseDays = (q) => Math.min(cfg.MAX_DAYS, Math.max(7, parseInt(q, 10) || 30));
  const isTranscribed = (c) => (c.durationMin ?? 0) >= cfg.MIN_TRANSCRIBED_MINUTES;

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

  // Who am I, and may I pick other people?
  router.get('/me', (req, res) => res.json({ userId: req.viewer.userId, isAdmin: req.viewer.isAdmin }));

  router.get('/overview', handle(async (req, res) => {
    const scope = scopeOr403(req, res);
    if (!scope) return;
    const days = parseDays(req.query.days);
    const all = await loadCalls(days);
    const calls = inScope(all, scope.sdrId);

    // Focus areas come from saved analyses of this scope's transcribed calls.
    const long = calls.filter(isTranscribed);
    const analyses = (await Promise.all(long.map((c) => store.getAnalysis(c.id)))).filter(Boolean);

    res.json({
      scope: { sdrId: scope.sdrId, isAdmin: req.viewer.isAdmin, days },
      stats: statsFor(calls),
      // Only admins get the per-SDR breakdown of the whole team.
      team: req.viewer.isAdmin && scope.sdrId == null ? bySdr(all) : [],
      sdrs: req.viewer.isAdmin ? bySdr(all).map(({ id, name, calls: n }) => ({ id, name, calls: n })).filter((s) => s.id) : [],
      coaching: summarise(analyses),
      transcribedCalls: long.length,
    });
  }));

  router.get('/calls', handle(async (req, res) => {
    const scope = scopeOr403(req, res);
    if (!scope) return;
    const days = parseDays(req.query.days);
    const long = inScope(await loadCalls(days), scope.sdrId)
      .filter(isTranscribed)
      .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))
      .slice(0, 150);

    const transcripts = await loadTranscripts(long.map((c) => c.id));
    const rows = await store.mapLimit(long, 8, async (c) => {
      const parsed = parseTranscript(transcripts[c.id], c.agentName);
      return {
        id: c.id,
        sdrId: c.sdrId,
        sdrName: c.sdrName,
        startedAt: c.startedAt,
        durationMin: c.durationMin,
        outcome: c.outcome,
        tags: c.tags,
        recordingUrl: c.recordingUrl,
        transcript: parsed ? { available: true, ...parsed.stats } : { available: false },
        analysis: parsed ? await store.getAnalysis(c.id) : null,
      };
    });
    res.json({ calls: rows });
  }));

  // Team-wide patterns. Managers only: SDRs are refused even if they ask for their own.
  router.get('/trends', handle(async (req, res) => {
    if (!req.viewer.isAdmin) {
      return res.status(403).json({ error: 'forbidden', message: 'Trends are for managers.' });
    }
    const scope = scopeOr403(req, res);
    if (!scope) return;
    const days = parseDays(req.query.days);
    const long = inScope(await loadCalls(days), scope.sdrId).filter(isTranscribed);

    const analysed = (await store.mapLimit(long, 8, async (c) => ({ call: c, analysis: await store.getAnalysis(c.id) })))
      .filter((p) => p.analysis);
    const transcripts = await loadTranscripts(analysed.map((p) => p.call.id));
    const pairs = analysed.map((p) => ({ ...p, stats: parseTranscript(transcripts[p.call.id], p.call.agentName)?.stats }));

    res.json({
      scope: { sdrId: scope.sdrId, days },
      transcribedCalls: long.length,
      trends: buildTrends(pairs),
    });
  }));

  router.get('/calls/:id/transcript', handle(async (req, res) => {
    const all = await loadCalls(cfg.MAX_DAYS);
    const call = all.find((c) => c.id === String(req.params.id));
    if (!call || (!req.viewer.isAdmin && call.sdrId !== req.viewer.userId)) {
      return res.status(404).json({ error: 'not_found', message: 'Call not found.' });
    }
    const raw = (await loadTranscripts([call.id]))[call.id];
    const parsed = parseTranscript(raw, call.agentName);
    if (!parsed) return res.status(404).json({ error: 'no_transcript', message: 'No transcript for this call yet.' });
    // Prospect phone numbers are replaced with a plain label.
    return res.json({ turns: parsed.turns, stats: parsed.stats });
  }));

  router.post('/analyse', express.json(), handle(async (req, res) => {
    const ids = [...new Set((req.body?.ids || []).map(String))].slice(0, cfg.MAX_ANALYSE_PER_REQUEST);
    if (!ids.length) return res.status(400).json({ error: 'bad_request', message: 'No calls given.' });

    const all = await loadCalls(cfg.MAX_DAYS);
    const results = [];
    for (const id of ids) {
      const call = all.find((c) => c.id === id);
      // Same rule as everywhere else: SDRs can only analyse their own calls.
      if (!call || (!req.viewer.isAdmin && call.sdrId !== req.viewer.userId)) {
        results.push({ id, error: 'not_found' });
        continue;
      }
      const existing = await store.getAnalysis(id);
      if (existing) {
        results.push({ id, analysis: existing });
        continue;
      }
      const parsed = parseTranscript((await loadTranscripts([id]))[id], call.agentName);
      if (!parsed) {
        results.push({ id, error: 'no_transcript' });
        continue;
      }
      let result;
      if (!parsed.stats.hasConversation) {
        result = analysis.notAConversation();
      } else {
        result = await analysis.analyseCall({ turns: parsed.turns, call });
      }
      await store.saveAnalysis(id, result);
      results.push({ id, analysis: result });
    }
    return res.json({ results });
  }));

  return router;
}

module.exports = { createRouter };
