import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { readCoachingCache, writeCoachingCache } from '../utils/coachingCache';
import { coachingApi } from '../api/coaching';
import { demoOverview, demoCalls, demoTrends } from '../utils/coachingDemoData';
import StatCard from '../components/shared/StatCard';
import AuditPanel from '../components/coaching/AuditPanel';
import {
  Section, Card, Chip, Empty, WeekBars, TeamTable, FocusPanel, CallDetail, TrendsPanel, CoverageTable, fmtWhen, pct, num, CALL_TYPE_LABELS,
} from '../components/coaching/CoachingParts';

const DAY_OPTIONS = [14, 30, 60, 90];
const fmtDay = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const BATCH = 5;
const ALL_WORKERS = 2; // calls analysed at the same time when running them all
const SECONDS_PER_CALL = 45; // rough guide for the time estimate

// Turns a failed request into something a person can act on.
function explain(err) {
  if (err?.code === 'not_configured' || err?.status === 503) {
    return { kind: 'setup', text: 'The coaching server is not fully set up yet. It still needs its monday login secrets, which an admin adds in the Developer Center.' };
  }
  if (err?.code === 'not_signed_in' || err?.status === 401) {
    return { kind: 'signin', text: 'Could not confirm who you are. Open this app from inside monday and try again.' };
  }
  if (err?.status === 403) return { kind: 'forbidden', text: err.message };
  if (err instanceof TypeError || [502, 504].includes(err?.status)) return { kind: 'unreachable', text: 'The coaching server is being updated, which usually takes about 4 minutes. This page tries again by itself.' };
  return { kind: 'error', text: err?.message || 'Something went wrong.' };
}

export default function Coaching({ user }) {
  const [demo, setDemo] = useState(false);
  const [days, setDays] = useState(30);
  const [sdrId, setSdrId] = useState('all');
  const [temp, setTemp] = useState('all'); // all | warm | cold: which kind of call the trends cover
  const [tick, setTick] = useState(0);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false); // showing remembered data while the newest loads
  const freshRef = useRef(false); // the Refresh button asks the server to re-read the board
  const [problem, setProblem] = useState(null);
  const [restart, setRestart] = useState(null); // { tries } while the server cannot be reached
  const [notice, setNotice] = useState(null); // a failed update while earlier data is still on screen
  const [overview, setOverview] = useState(null);
  const [calls, setCalls] = useState([]);
  const [meta, setMeta] = useState({ waitingCount: 0, refreshCount: 0, unreadableCount: 0, unreadableReasons: [], coverage: [], rules: null, totals: null });
  const [trends, setTrends] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [analysing, setAnalysing] = useState({ busy: false, message: null });
  const [confirmAll, setConfirmAll] = useState(false);
  const [showWaiting, setShowWaiting] = useState(false);
  const [reviewSdr, setReviewSdr] = useState('all');
  const [sortBy, setSortBy] = useState('priority'); // 'priority' | 'newest'
  const [levelFilter, setLevelFilter] = useState('all'); // 'all' | 'high' | 'medium' | 'low'
  const stopRef = useRef(false);
  const [check, setCheck] = useState(null); // { busy, checks, error }

  const viewerKey = String(user?.id ?? user?.name ?? 'me'); // a plain string, so it is safe in the effect's list
  const isAdmin = !!overview?.scope?.isAdmin;
  const userIdParam = sdrId === 'all' ? undefined : sdrId;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setProblem(null);
    setNotice(null);

    if (demo) {
      const picked = sdrId === 'all' ? demoCalls.calls : demoCalls.calls.filter((c) => c.sdrId === sdrId);
      setOverview(demoOverview);
      setCalls(picked);
      setMeta({ waitingCount: demoCalls.waitingCount, refreshCount: 0, coverage: demoCalls.coverage, rules: demoCalls.rules, totals: demoCalls.transcriptTotals });
      setTrends(demoTrends);
      setLoading(false);
      return undefined;
    }

    const fresh = freshRef.current;
    freshRef.current = false;
    // Show what this tab last loaded straight away, then update it behind.
    const remembered = fresh ? null : readCoachingCache(viewerKey, `${sdrId}|${temp}`, days);
    if (remembered?.overview) {
      setOverview(remembered.overview);
      setCalls(remembered.calls ?? []);
      setMeta(remembered.meta);
      setTrends(remembered.trends ?? null);
      setLoading(false);
      setRefreshing(true);
    } else {
      setRefreshing(false);
    }

    (async () => {
      try {
        const [ov, cl, tr] = await Promise.all([
          coachingApi.overview(userIdParam, days, fresh),
          coachingApi.calls(userIdParam, days, fresh),
          coachingApi.trends(userIdParam, days, fresh, temp),
        ]);
        if (!alive) return;
        const nextMeta = { waitingCount: cl.waitingCount, refreshCount: cl.refreshCount ?? 0, unreadableCount: cl.unreadableCount ?? 0, unreadableReasons: cl.unreadableReasons ?? [], coverage: cl.coverage, rules: cl.rules, totals: cl.transcriptTotals ?? null, diagnosis: cl.diagnosis ?? null };
        setOverview(ov);
        setCalls(cl.calls);
        setMeta(nextMeta);
        setTrends(tr);
        setProblem(null);
        setNotice(null);
        setRestart(null);
        writeCoachingCache(viewerKey, `${sdrId}|${temp}`, days, { overview: ov, calls: cl.calls, meta: nextMeta, trends: tr });
      } catch (e) {
        // With remembered data on screen, a failed update is a soft notice, not a blank page.
        if (!alive) return;
        const why = explain(e);
        if (why.kind === 'unreachable') setRestart((r) => ({ tries: (r?.tries ?? 0) + 1 }));
        if (remembered?.overview) setNotice(`${why.text} Showing what was loaded earlier.`);
        else setProblem(why);
      } finally {
        if (alive) { setLoading(false); setRefreshing(false); }
      }
    })();
    return () => { alive = false; };
  }, [demo, days, sdrId, temp, tick, userIdParam, viewerKey]);

  // While the server is being updated, look again every 20 seconds (for about five minutes).
  useEffect(() => {
    if (!restart || restart.tries > 15) return undefined;
    const timer = setTimeout(() => setTick((t) => t + 1), 20000);
    return () => clearTimeout(timer);
  }, [restart]);

  // Storage only lets so many saved analyses be read per minute, so some load in the background.
  // While any are still loading, look again every 15 seconds (up to about five minutes).
  const loadingPasses = useRef(0);
  useEffect(() => {
    if (!meta.unreadableCount) { loadingPasses.current = 0; return undefined; }
    if (loadingPasses.current >= 20) return undefined;
    const timer = setTimeout(() => { loadingPasses.current += 1; setTick((t) => t + 1); }, 15000);
    return () => clearTimeout(timer);
  }, [meta.unreadableCount, calls]);

  // Re-read the summaries (focus areas, trends) after new analyses land.
  const refreshSummaries = useCallback(async () => {
    try {
      const ov = await coachingApi.overview(userIdParam, days);
      setOverview(ov);
      setTrends(await coachingApi.trends(userIdParam, days, false, temp));
    } catch { /* the page already shows the earlier numbers */ }
  }, [userIdParam, days, temp]);

  const waiting = useMemo(() => calls.filter((c) => c.status === 'waiting'), [calls]);
  const numbersCount = waiting.filter((c) => c.refresh === 'numbers').length; // only need their stay-on numbers: free
  const redoCount = waiting.filter((c) => c.refresh && c.refresh !== 'numbers').length;

  // Calls to review: only analysed ones, ordered by how much they are worth a manager's time.
  // Calls analysed under older rules stay here with their score (flagged to redo); only calls with no analysis at all wait.
  const analysedAll = useMemo(() => calls.filter((c) => c.analysis), [calls]);
  const sdrKey = (c) => c.sdrId || `name:${c.sdrName}`;
  const reviewSdrOptions = useMemo(() => {
    const m = new Map();
    for (const c of analysedAll) m.set(sdrKey(c), c.sdrName);
    return [...m.entries()].map(([key, name]) => ({ key, name })).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }, [analysedAll]);
  const finished = useMemo(() => (reviewSdr === 'all' ? analysedAll : analysedAll.filter((c) => sdrKey(c) === reviewSdr)), [analysedAll, reviewSdr]);
  const levelCounts = useMemo(() => finished.reduce((m, c) => { const l = c.priority?.level; if (l) m[l] += 1; return m; }, { high: 0, medium: 0, low: 0 }), [finished]);
  const reviewList = useMemo(() => {
    const shown = levelFilter === 'all' ? finished : finished.filter((c) => c.priority?.level === levelFilter);
    const newest = (a, b) => String(b.createdAt).localeCompare(String(a.createdAt));
    return [...shown].sort(sortBy === 'newest' ? newest : (a, b) => (b.priority?.score ?? 0) - (a.priority?.score ?? 0) || newest(a, b));
  }, [finished, levelFilter, sortBy]);

  // Re-read the list after a run, so counts and statuses match the server.
  const reloadCalls = useCallback(async () => {
    try {
      const cl = await coachingApi.calls(userIdParam, days);
      setCalls(cl.calls);
      setMeta({ waitingCount: cl.waitingCount, refreshCount: cl.refreshCount ?? 0, unreadableCount: cl.unreadableCount ?? 0, unreadableReasons: cl.unreadableReasons ?? [], coverage: cl.coverage, rules: cl.rules, totals: cl.transcriptTotals ?? null });
    } catch { /* the page keeps showing what it has */ }
  }, [userIdParam, days]);

  // Starts the analysis on the server and follows it with short requests. The server does the work a
  // couple of calls at a time on its own, so a slow call can no longer be cut off by the hosting;
  // this page only asks how it is going. Stopping cancels what has not started yet.
  const runAnalysis = async (ids) => {
    if (demo) { setAnalysing({ busy: false, message: 'This is sample data, so nothing was analysed.' }); return; }
    if (!ids.length) return;

    stopRef.current = false;
    setConfirmAll(false);
    const started = Date.now();
    setAnalysing({ busy: true, message: `Starting ${ids.length} call${ids.length === 1 ? '' : 's'}...` });
    try {
      await coachingApi.analyseStart(ids);
    } catch (e) {
      setAnalysing({ busy: false, message: explain(e).text });
      return;
    }

    const pending = new Set(ids);
    let done = 0;
    let unsaved = 0;
    let failed = 0;
    let lost = 0;
    let lastMessage = null;
    let pollErrors = 0;
    let gaveUp = false;
    let summaryAt = 0; // how many were done when the trends and focus panel were last refreshed
    let summaryTime = Date.now();

    const progress = () => {
      const finished = done + unsaved + failed + lost;
      let eta = ` Each takes about ${SECONDS_PER_CALL} seconds, two at a time.`;
      // Only calls that really went through Claude say how long one takes; quick refusals would
      // make the estimate far too hopeful.
      const analysed = done + unsaved;
      if (analysed >= 3) {
        const minutes = Math.max(1, Math.ceil(((ids.length - finished) * ((Date.now() - started) / analysed)) / 60000));
        eta = ` About ${minutes} minute${minutes === 1 ? '' : 's'} left.`;
      }
      return `Analysing: ${finished} of ${ids.length} finished.${eta} You can leave this page open and carry on.`;
    };

    while (pending.size && !stopRef.current) {
      await new Promise((resolve) => { setTimeout(resolve, 3000); });
      let status;
      try {
        status = await coachingApi.analyseStatus([...pending]);
        pollErrors = 0;
      } catch {
        pollErrors += 1; // a dropped connection or a restart: keep asking for a while
        if (pollErrors >= 20) { gaveUp = true; break; }
        setAnalysing({ busy: true, message: 'Waiting for the server to answer...' });
        continue;
      }
      for (const id of [...pending]) {
        const job = status.jobs?.[id];
        if (!job) continue;
        if (job.state === 'unknown') { pending.delete(id); lost += 1; continue; } // the server restarted and forgot it
        if (job.state !== 'done' && job.state !== 'failed') continue;
        pending.delete(id);
        const r = job.result;
        if (r?.analysis) {
          // Only a saved analysis counts as done. If it could not be kept permanently the call
          // stays in the waiting list so it is offered again.
          setCalls((prev) => prev.map((c) => (c.id === id ? { ...c, analysis: r.analysis, status: r.saved ? 'analysed' : c.status, refresh: r.saved ? null : c.refresh, detailsMissing: false, priority: c.priority } : c)));
          if (r.saved) done += 1; else unsaved += 1;
        } else {
          failed += 1;
          if (r?.message) lastMessage = r.message;
        }
      }
      setAnalysing({ busy: true, message: progress() });
      // Keep the trends and focus panel up to date while the run goes on: every 10 finished calls,
      // or every couple of minutes if some have finished since.
      if (done - summaryAt >= 10 || (done > summaryAt && Date.now() - summaryTime >= 120000)) {
        summaryAt = done;
        summaryTime = Date.now();
        refreshSummaries();
      }
    }

    if (stopRef.current && pending.size) {
      try { await coachingApi.analyseCancel([...pending]); } catch { /* it will simply finish */ }
    }

    let message = failed ? `${done} analysed, ${failed} could not be.` : `${done} analysed.`;
    if (unsaved) message += ` ${unsaved} could not be saved permanently, so ${unsaved === 1 ? 'it' : 'they'} will be offered again.`;
    if (lost) message += ` The server restarted part way, so ${lost} ${lost === 1 ? 'was' : 'were'} not finished. Press the button again; anything that finished is saved.`;
    if (gaveUp) message = `${done} analysed. The server did not answer for a while. Anything that finished is saved, so press the button again in a few minutes.`;
    else if (stopRef.current) message = `Stopped. ${message} Up to two calls already running will still finish in the background.`;
    else if (!done && lastMessage) message = `Could not analyse. ${lastMessage}`;
    setAnalysing({ busy: false, message });

    await reloadCalls(); // the server may have finished calls we did not hear back about
    if (done) refreshSummaries();
  };

  const analyseNext = () => runAnalysis(waiting.slice(0, BATCH).map((c) => c.id));
  const analyseAll = () => runAnalysis(waiting.map((c) => c.id));
  const estimateMinutes = Math.max(1, Math.ceil((waiting.length * SECONDS_PER_CALL) / ALL_WORKERS / 60));

  const runCheck = async () => {
    setCheck({ busy: true, checks: [], error: null });
    try {
      const res = await coachingApi.selftest();
      setCheck({ busy: false, checks: res.checks, error: null });
    } catch (e) {
      setCheck({ busy: false, checks: [], error: explain(e).text });
    }
  };

  const stats = overview?.stats;
  const who = !isAdmin ? 'you' : sdrId === 'all' ? 'the team' : overview?.sdrs?.find((s) => s.id === sdrId)?.name || 'this SDR';
  const sdrOptions = [...(overview?.sdrs ?? [])].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="px-8 py-8 max-w-[1400px] mx-auto">
      <div className="flex items-end justify-between gap-4 flex-wrap mb-6">
        <div>
          <h1 className="font-display text-[32px] font-semibold text-ink leading-none">Coaching{refreshing && <span className="ml-3 align-middle text-[12.5px] font-normal text-muted">Updating...</span>}</h1>
          <p className="text-muted text-[13.5px] mt-2">
            {isAdmin
              ? 'Calls, call craft and what is working across the team. Everyone sees the team summary; each person sees the detail of their own calls only.'
              : `Your calls and your coaching${user?.name ? `, ${user.name.split(' ')[0]}` : ''}. Only you and your managers can see it.`}
          </p>
        </div>
        <div className="flex items-center gap-2.5 flex-wrap">
          {isAdmin && (
            <select value={sdrId} onChange={(e) => { setSdrId(e.target.value); setOpenId(null); }} className="bg-card border border-line rounded-full px-3.5 py-1.5 text-sm font-medium text-ink cursor-pointer">
              <option value="all">Whole team</option>
              {sdrOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="bg-card border border-line rounded-full px-3.5 py-1.5 text-sm font-medium text-ink cursor-pointer">
            {DAY_OPTIONS.map((d) => <option key={d} value={d}>Last {d} days</option>)}
          </select>
          <button type="button" onClick={() => { freshRef.current = true; setTick((t) => t + 1); }} className="bg-card border border-line rounded-full px-3.5 py-1.5 text-sm font-medium text-ink cursor-pointer hover:bg-sunken">Refresh</button>
          {isAdmin && !demo && (
            <button type="button" onClick={runCheck} disabled={check?.busy} className="bg-card border border-line rounded-full px-3.5 py-1.5 text-sm font-medium text-ink cursor-pointer hover:bg-sunken disabled:opacity-50">
              {check?.busy ? 'Checking...' : 'Check connections'}
            </button>
          )}
          <button type="button" onClick={() => { setDemo((d) => !d); setSdrId('all'); }} className="bg-transparent border-0 text-[12.5px] text-muted underline cursor-pointer">
            {demo ? 'Use live data' : 'Show sample data'}
          </button>
        </div>
      </div>

      {check && !check.busy && (
        <div className="mb-6 rounded-xl border border-line bg-card px-4 py-3 text-[13px]">
          <div className="flex items-center justify-between mb-1.5">
            <span className="font-heading font-bold">Connection check</span>
            <button type="button" onClick={() => setCheck(null)} className="bg-transparent border-0 text-muted underline cursor-pointer text-[12px]">Close</button>
          </div>
          {check.error && <div className="text-red">{check.error}</div>}
          <ul className="space-y-1">
            {check.checks.map((c) => (
              <li key={c.name} className="flex gap-2 items-baseline">
                <span className={c.ok ? 'text-emerald' : 'text-red'}>{c.ok ? 'Working' : 'Not working'}</span>
                <span className="text-body">{c.name}</span>
                <span className="text-muted">{(c.ms / 1000).toFixed(1)}s</span>
                {c.error && <span className="text-red">{c.error}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {demo && <div className="mb-6 rounded-xl bg-info-soft text-info text-[13px] px-4 py-3">You are looking at sample data, not real calls.</div>}
      {problem && (
        <div className="mb-6 rounded-xl bg-amber-soft text-amber-ink text-[13px] px-4 py-3 flex items-center justify-between gap-4 flex-wrap">
          <span>{problem.text}</span>
          <button type="button" onClick={() => setDemo(true)} className="bg-transparent border-0 underline cursor-pointer text-amber-ink">See it with sample data</button>
        </div>
      )}
      {loading && !problem && <Empty>Loading calls...</Empty>}

      {notice && (
        <div className="mb-6 rounded-xl bg-amber-soft text-amber-ink text-[13px] px-4 py-3 flex items-center justify-between gap-4 flex-wrap">
          <span>{notice}</span>
          <button type="button" onClick={() => { freshRef.current = true; setTick((t) => t + 1); }} className="bg-transparent border-0 underline cursor-pointer text-amber-ink">Try again</button>
        </div>
      )}

      {stats && !problem && (
        <>
          <div className="grid gap-4 grid-cols-2 lg:grid-cols-6 mb-10">
            <StatCard feature label="Calls" value={stats.calls} meta={`${stats.outbound} outbound dials`} />
            <StatCard
              label="Connected"
              value={stats.connected}
              meta={`${pct(stats.connectRate)} of dials. Aircall says ${stats.answered} answered, which includes voicemails.${stats.untaggedAnswered ? ` ${stats.untaggedAnswered} answered calls have no tag yet.` : ''}`}
            />
            <StatCard label="Conversations" value={stats.conversations} meta={`${pct(stats.conversationRate)} of dials, connected and over a minute`} />
            <StatCard label="Meetings booked" value={stats.meetingsBooked} meta={`${pct(stats.bookingRate)} of conversations`} />
            <StatCard label="Average conversation" value={stats.avgConversationMin == null ? 'n/a' : `${num(stats.avgConversationMin)} min`} meta={`${stats.talkMinutes} minutes talking`} />
            <StatCard label="Calls analysed" value={overview.analysedCount} meta={`connected calls since ${fmtDay(overview.coachingFrom)}`} />
          </div>

          {meta.unreadableCount > 0 && (
            <div className="mb-6 rounded-xl bg-amber-soft text-amber-ink text-[13px] px-4 py-3 flex items-center justify-between gap-4 flex-wrap">
              <span>
                {meta.unreadableCount} saved analys{meta.unreadableCount === 1 ? 'is is' : 'es are'} still loading. Storage only allows so many reads per minute, so they are loaded in small batches. Nothing is lost, nothing is paid for twice, and this page checks again by itself.
                {meta.unreadableReasons?.length > 0 && <span className="block text-[12px] mt-1">Storage said: {meta.unreadableReasons.join('; ')}</span>}
              </span>
              <button type="button" onClick={() => { freshRef.current = true; setTick((t) => t + 1); }} className="bg-transparent border-0 underline cursor-pointer text-amber-ink">Refresh</button>
            </div>
          )}

          {/* Managers run the analysis. SDRs see the results for their own calls. */}
          {isAdmin && (
            <Section title="Analyse calls" sub="Claude reads each call's transcript and scores it. Calls that are already analysed are skipped.">
              <Card>
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="text-[13.5px] text-body">
                    {waiting.length === 0 ? (
                      <span className="text-ink font-medium">Every call is analysed.</span>
                    ) : (
                      <>
                        <span className="font-medium text-ink">{waiting.length}</span> call{waiting.length === 1 ? '' : 's'} waiting to be analysed
                        {(redoCount > 0 || numbersCount > 0) && ` (${[redoCount > 0 && `${redoCount} to redo with the new rules`, numbersCount > 0 && `${numbersCount} only need their numbers updated, which costs nothing`].filter(Boolean).join(', ')})`}.
                      </>
                    )}
                    {meta.diagnosis && waiting.length > 0 && (
                      <div className="text-[12.5px] text-muted mt-1">
                        What is saved for these: {[
                          meta.diagnosis.olderRules > 0 && `${meta.diagnosis.olderRules} made under older rules`,
                          meta.diagnosis.noOpener > 0 && `${meta.diagnosis.noOpener} with no opener recorded`,
                          meta.diagnosis.noPositioning > 0 && `${meta.diagnosis.noPositioning} with no "what we say we are" recorded`,
                          meta.diagnosis.notSaved > 0 && `${meta.diagnosis.notSaved} with nothing saved`,
                          meta.diagnosis.unreadable > 0 && `${meta.diagnosis.unreadable} that could not be read just now`,
                        ].filter(Boolean).join(', ') || 'nothing to report'}.
                      </div>
                    )}
                    {analysing.message && <div className="text-[12.5px] text-muted mt-1">{analysing.message}</div>}
                  </div>
                  <div className="flex items-center gap-2.5 flex-wrap">
                    {analysing.busy ? (
                      <button type="button" onClick={() => { stopRef.current = true; }} className="rounded-full bg-card border border-line text-ink text-sm font-medium px-4 py-2 cursor-pointer hover:bg-sunken">
                        Stop
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          disabled={waiting.length === 0}
                          onClick={analyseNext}
                          className="rounded-full bg-navy text-white text-sm font-medium px-4 py-2 border-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {waiting.length ? `Analyse next ${Math.min(BATCH, waiting.length)}` : 'Nothing to analyse'}
                        </button>
                        {waiting.length > BATCH && (
                          <button type="button" onClick={() => setConfirmAll(true)} className="rounded-full bg-card border border-line text-ink text-sm font-medium px-4 py-2 cursor-pointer hover:bg-sunken">
                            Analyse all {waiting.length}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {confirmAll && !analysing.busy && (
                  <div className="mt-4 rounded-xl border border-line bg-sunken px-4 py-3 text-[13px] flex items-center justify-between gap-4 flex-wrap">
                    <span className="text-body">
                      This analyses all {waiting.length} waiting calls, {ALL_WORKERS} at a time. It will take roughly {estimateMinutes} minute{estimateMinutes === 1 ? '' : 's'}, uses Claude for each call, and runs on the server, so it carries on if you close this tab. You can stop at any point and nothing already finished is lost.
                    </span>
                    <span className="flex gap-2">
                      <button type="button" onClick={analyseAll} className="rounded-full bg-navy text-white text-sm font-medium px-4 py-1.5 border-0 cursor-pointer">Start</button>
                      <button type="button" onClick={() => setConfirmAll(false)} className="rounded-full bg-card border border-line text-ink text-sm font-medium px-4 py-1.5 cursor-pointer hover:bg-sunken">Cancel</button>
                    </span>
                  </div>
                )}

                {waiting.length > 0 && (
                  <div className="mt-3">
                    <button type="button" onClick={() => setShowWaiting((v) => !v)} className="bg-transparent border-0 p-0 text-[12.5px] text-info underline cursor-pointer">
                      {showWaiting ? 'Hide the waiting calls' : 'Show the waiting calls'}
                    </button>
                    {showWaiting && (
                      <ul className="mt-2 divide-y divide-line text-[12.5px] max-h-64 overflow-y-auto">
                        {waiting.map((c) => (
                          <li key={c.id} className="py-1.5 flex items-center gap-4 flex-wrap">
                            <span className="w-[110px] text-ink font-medium">{fmtWhen(c.startedAt)}</span>
                            {isAdmin && <span className="w-[150px] text-body">{c.sdrName}</span>}
                            <span className="w-[60px] text-muted">{c.durationMin == null ? '' : `${Math.round(c.durationMin)} min`}</span>
                            {c.refresh === 'outdated' && <Chip tone="warn">Redo with new rules</Chip>}
                            {c.refresh === 'numbers' && <Chip tone="info">Update numbers (no cost)</Chip>}
                            {c.refresh === 'missing' && <Chip tone="warn">Details missing, redo</Chip>}
                            {c.tags.includes('MeetingBooked') && <Chip tone="good">Meeting booked</Chip>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </Card>
            </Section>
          )}

          {isAdmin && sdrId === 'all' && (
            <Section title="The team" sub="Numbers cover every call in the period, including those before transcripts were switched on. A call counts as connected when it was answered and the SDR has not tagged it 1.NoAnswer, 3.Busy, LeftVoicemail or BadData.">
              <Card><TeamTable team={overview.team} onPick={(id) => { setSdrId(id); setOpenId(null); }} /></Card>
            </Section>
          )}

          <Section
            title="Trends"
            sub={isAdmin
              ? `What is happening on the phones for ${who}: objections, who books and what the outreach sounds like.`
              : 'What is working across the whole team: the top objections, the best ways they were handled, how calls open and who books. Everyone sees this. Individual calls and transcripts stay private.'}
            right={trends?.temperature && (
              <div className="flex items-center gap-2 flex-wrap justify-end" title="Warm: the SDR referred to an earlier contact, or we had already spoken to this number. Cold: everything else. Compare wordings within the same kind of call.">
                {[['all', 'All'], ['warm', 'Warm'], ['cold', 'Cold']].map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setTemp(id)}
                    className={`rounded-full text-[12.5px] font-medium px-3 py-1.5 cursor-pointer border ${temp === id ? 'bg-navy text-white border-navy' : 'bg-card text-ink border-line hover:bg-sunken'}`}
                  >
                    {label} {trends.temperature[id]}
                  </button>
                ))}
              </div>
            )}
          >
            <TrendsPanel data={trends} />
          </Section>

          <Section title={isAdmin ? `Coaching focus for ${who}` : 'Where to focus'} sub="Built from the calls that have been scored on call craft: the opening, discovery, objection handling, asking for the next step, and tone and control.">
            <FocusPanel coaching={overview.coaching} who={who} canAnalyse={isAdmin} />
          </Section>

          <Section title="Activity by week" sub="Calls, conversations and meetings booked.">
            <Card note={(
              <span className="inline-flex items-center gap-3">
                <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-line-warm" />calls</span>
                <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-navy" />conversations</span>
                <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald" />booked</span>
              </span>
            )}><WeekBars weekly={stats.weekly} /></Card>
          </Section>

          {isAdmin && sdrId === 'all' && meta.coverage.length > 0 && (
            <Section title="Transcript coverage" sub="Answered calls that have a transcript to coach from. A gap here usually means call recording or transcription is not switched on for that person in Aircall.">
              <Card>
                <CoverageTable coverage={meta.coverage} onPick={(key) => { setReviewSdr(key); setLevelFilter('all'); setOpenId(null); document.getElementById('calls-to-review')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }} />
                {overview.connectionCheck?.analysed > 0 && (
                  <div className="text-[12px] text-muted mt-3 pt-3 border-t border-line">
                    Cross-check against the transcripts: of {overview.connectionCheck.analysed} analysed calls, {overview.connectionCheck.taggedConnectedButVoicemail} tagged as a real connection turned out to be a voicemail or phone menu, and {overview.connectionCheck.untaggedButVoicemail} untagged or no-answer calls did too.
                  </div>
                )}
              </Card>
            </Section>
          )}

          {isAdmin && !demo && (
            <Section title="Check what is saved" sub="Sets what the board says against what is really saved for each call, so the numbers on this page can be trusted.">
              <Card><AuditPanel /></Card>
            </Section>
          )}

          <div id="calls-to-review" />
          <Section
            title="Calls to review"
            sub="Analysed calls, with a priority out of 10. Long conversations, poorly handled objections, weak call craft and lots of feedback score high. Quick hang-ups and calls that went well score lower."
            right={(
              <div className="flex items-center gap-2 flex-wrap justify-end">
                {[['all', `All ${finished.length}`], ['high', `High ${levelCounts.high}`], ['medium', `Medium ${levelCounts.medium}`], ['low', `Low ${levelCounts.low}`]].map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setLevelFilter(id)}
                    className={`rounded-full text-[12.5px] font-medium px-3 py-1.5 cursor-pointer border ${levelFilter === id ? 'bg-navy text-white border-navy' : 'bg-card text-ink border-line hover:bg-sunken'}`}
                  >
                    {label}
                  </button>
                ))}
                {isAdmin && reviewSdrOptions.length > 0 && (
                  <select value={reviewSdr} onChange={(e) => { setReviewSdr(e.target.value); setOpenId(null); }} className="bg-card border border-line rounded-full px-3 py-1.5 text-[12.5px] font-medium text-ink cursor-pointer">
                    <option value="all">Everyone</option>
                    {reviewSdrOptions.map((o) => <option key={o.key} value={o.key}>{o.name}</option>)}
                  </select>
                )}
                <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="bg-card border border-line rounded-full px-3 py-1.5 text-[12.5px] font-medium text-ink cursor-pointer">
                  <option value="priority">Highest priority first</option>
                  <option value="newest">Newest first</option>
                </select>
              </div>
            )}
          >
            {finished.length === 0 ? (
              <Card><Empty>{isAdmin ? 'No calls have been analysed yet. Use the Analyse calls panel above to start.' : 'None of your calls have been analysed yet. Your managers run the analysis, so check back soon.'}</Empty></Card>
            ) : reviewList.length === 0 ? (
              <Card><Empty>No calls at this priority.</Empty></Card>
            ) : (
              <div className="space-y-2">
                {reviewList.map((c) => {
                  const open = openId === c.id;
                  const a = c.analysis;
                  const pr = c.priority;
                  const badge = { high: 'bg-red-soft text-red', medium: 'bg-amber-soft text-amber-ink', low: 'bg-sunken text-muted' }[pr?.level] || 'bg-sunken text-muted';
                  return (
                    <div key={c.id} className="bg-card border border-line rounded-2xl">
                      <button type="button" onClick={() => setOpenId(open ? null : c.id)} className="w-full text-left bg-transparent border-0 px-5 py-3.5 cursor-pointer flex items-center gap-4 flex-wrap">
                        <span className={`w-14 shrink-0 rounded-xl py-1 text-center ${badge}`} title={pr ? `Review priority ${pr.score} out of 10` : ''}>
                          <span className="font-display text-[20px] font-semibold leading-none">{pr?.score ?? '-'}</span>
                          <span className="text-[10.5px] opacity-70">/10</span>
                        </span>
                        <span className="text-[13px] font-medium text-ink w-[110px]">{fmtWhen(c.startedAt)}</span>
                        {isAdmin && <span className="text-[13px] text-body w-[150px]">{c.sdrName}</span>}
                        <span className="text-[13px] text-muted w-[60px]">{c.durationMin == null ? '' : `${Math.round(c.durationMin)} min`}</span>
                        <span className="flex gap-1.5 flex-wrap flex-1">
                          {(pr?.reasons || []).slice(0, 3).map((r) => <Chip key={r} tone={/poorly|Weak|missed|Lots of/.test(r) ? 'warn' : /well-handled|strong moment|Meeting booked/.test(r) ? 'good' : 'muted'}>{r}</Chip>)}
                          {c.tags.includes('MeetingBooked') && <Chip tone="good">Meeting booked</Chip>}
                          {a?.nextStepSecured && <Chip tone="info">Next step secured</Chip>}
                          {c.refresh === 'outdated' && <Chip tone="warn">Redo with new rules</Chip>}
                          {c.refresh === 'numbers' && <Chip tone="info">Update numbers (no cost)</Chip>}
                        </span>
                        <span className="text-muted text-[12px]">{open ? 'Hide' : 'Open'}</span>
                      </button>
                      {open && <div className="px-5 pb-5 pt-1 border-t border-line"><div className="pt-4"><CallDetail call={c} demo={demo} /></div></div>}
                    </div>
                  );
                })}
              </div>
            )}
          </Section>
        </>
      )}
    </div>
  );
}
