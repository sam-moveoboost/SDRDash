import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { coachingApi } from '../api/coaching';
import { demoOverview, demoCalls, demoTrends } from '../utils/coachingDemoData';
import StatCard from '../components/shared/StatCard';
import {
  Section, Card, Chip, Empty, WeekBars, TeamTable, FocusPanel, CallDetail, TrendsPanel, CoverageTable, fmtWhen, pct, num, CALL_TYPE_LABELS,
} from '../components/coaching/CoachingParts';

const DAY_OPTIONS = [14, 30, 60, 90];
const fmtDay = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const BATCH = 5;
const ALL_WORKERS = 2; // calls analysed at the same time when running them all
const SECONDS_PER_CALL = 30; // rough guide for the time estimate
const MAX_FAILURES_IN_A_ROW = 3; // stop rather than keep hitting a problem

// Turns a failed request into something a person can act on.
function explain(err) {
  if (err?.code === 'not_configured' || err?.status === 503) {
    return { kind: 'setup', text: 'The coaching server is not fully set up yet. It still needs its monday login secrets, which an admin adds in the Developer Center.' };
  }
  if (err?.code === 'not_signed_in' || err?.status === 401) {
    return { kind: 'signin', text: 'Could not confirm who you are. Open this app from inside monday and try again.' };
  }
  if (err?.status === 403) return { kind: 'forbidden', text: err.message };
  if (err instanceof TypeError) return { kind: 'unreachable', text: 'Could not reach the coaching server.' };
  return { kind: 'error', text: err?.message || 'Something went wrong.' };
}

export default function Coaching({ user }) {
  const [demo, setDemo] = useState(false);
  const [days, setDays] = useState(30);
  const [sdrId, setSdrId] = useState('all');
  const [tick, setTick] = useState(0);

  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState(null);
  const [overview, setOverview] = useState(null);
  const [calls, setCalls] = useState([]);
  const [meta, setMeta] = useState({ waitingCount: 0, refreshCount: 0, coverage: [], rules: null });
  const [trends, setTrends] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [analysing, setAnalysing] = useState({ busy: false, message: null });
  const [confirmAll, setConfirmAll] = useState(false);
  const stopRef = useRef(false);
  const [check, setCheck] = useState(null); // { busy, checks, error }

  const isAdmin = !!overview?.scope?.isAdmin;
  const userIdParam = sdrId === 'all' ? undefined : sdrId;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setProblem(null);

    if (demo) {
      const picked = sdrId === 'all' ? demoCalls.calls : demoCalls.calls.filter((c) => c.sdrId === sdrId);
      setOverview(demoOverview);
      setCalls(picked);
      setMeta({ waitingCount: demoCalls.waitingCount, refreshCount: 0, coverage: demoCalls.coverage, rules: demoCalls.rules });
      setTrends(demoTrends);
      setLoading(false);
      return undefined;
    }

    (async () => {
      try {
        const ov = await coachingApi.overview(userIdParam, days);
        if (!alive) return;
        setOverview(ov);
        const [cl, tr] = await Promise.all([
          coachingApi.calls(userIdParam, days),
          ov.scope.isAdmin ? coachingApi.trends(userIdParam, days) : Promise.resolve(null),
        ]);
        if (!alive) return;
        setCalls(cl.calls);
        setMeta({ waitingCount: cl.waitingCount, refreshCount: cl.refreshCount ?? 0, coverage: cl.coverage, rules: cl.rules });
        setTrends(tr);
      } catch (e) {
        if (alive) setProblem(explain(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [demo, days, sdrId, tick, userIdParam]);

  // Re-read the summaries (focus areas, trends) after new analyses land.
  const refreshSummaries = useCallback(async () => {
    try {
      const ov = await coachingApi.overview(userIdParam, days);
      setOverview(ov);
      if (ov.scope.isAdmin) setTrends(await coachingApi.trends(userIdParam, days));
    } catch { /* the page already shows the earlier numbers */ }
  }, [userIdParam, days]);

  const waiting = useMemo(() => calls.filter((c) => c.status === 'waiting'), [calls]);

  // Re-read the list after a run, so counts and statuses match the server.
  const reloadCalls = useCallback(async () => {
    try {
      const cl = await coachingApi.calls(userIdParam, days);
      setCalls(cl.calls);
      setMeta({ waitingCount: cl.waitingCount, refreshCount: cl.refreshCount ?? 0, coverage: cl.coverage, rules: cl.rules });
    } catch { /* the page keeps showing what it has */ }
  }, [userIdParam, days]);

  // Analyses the given calls, one request per call (each takes 20 to 40 seconds, and one long
  // request for several can be cut off by the hosting). Running them all uses a couple of workers
  // at once, can be stopped, and stops by itself after a few failures in a row.
  const runAnalysis = async (ids, { workers = 1 } = {}) => {
    if (demo) { setAnalysing({ busy: false, message: 'This is sample data, so nothing was analysed.' }); return; }
    if (!ids.length) return;

    stopRef.current = false;
    setConfirmAll(false);
    const started = Date.now();
    let next = 0;
    let done = 0;
    let unsaved = 0;
    let failed = 0;
    let streak = 0;
    let cutOff = false;
    let lastError = null;
    let lastMessage = null;

    const progress = () => {
      const finished = done + unsaved + failed;
      let eta = ` Each takes about ${SECONDS_PER_CALL} seconds.`;
      if (finished >= 2) {
        const minutes = Math.max(1, Math.ceil(((ids.length - finished) * ((Date.now() - started) / finished)) / 60000));
        eta = ` About ${minutes} minute${minutes === 1 ? '' : 's'} left.`;
      }
      return `Analysing call ${Math.min(finished + 1, ids.length)} of ${ids.length}.${eta}`;
    };

    const worker = async () => {
      while (!stopRef.current && !cutOff && streak < MAX_FAILURES_IN_A_ROW && next < ids.length) {
        const id = ids[next];
        next += 1;
        setAnalysing({ busy: true, message: progress() });
        try {
          const { results } = await coachingApi.analyse([id]);
          const r = results?.[0];
          if (r?.analysis) {
            // Only a saved analysis counts as done. If it could not be kept permanently the
            // call stays in the waiting list so it is offered again.
            setCalls((prev) => prev.map((c) => (c.id === id ? { ...c, analysis: r.analysis, status: r.saved ? 'analysed' : c.status, refresh: r.saved ? null : c.refresh, detailsMissing: false } : c)));
            if (r.saved) { done += 1; streak = 0; } else { unsaved += 1; streak += 1; }
          } else {
            failed += 1;
            streak += 1;
            if (r?.message) lastMessage = r.message;
          }
        } catch (e) {
          failed += 1;
          streak += 1;
          lastError = e;
          if (e instanceof TypeError) cutOff = true; // connection dropped; stop rather than repeat it
        }
      }
    };
    await Promise.all(Array.from({ length: workers }, worker));

    let message = failed ? `${done} analysed, ${failed} could not be.` : `${done} analysed.`;
    if (unsaved) message += ` ${unsaved} could not be saved permanently, so ${unsaved === 1 ? 'it' : 'they'} will be offered again.`;
    if (cutOff) message = `${done} analysed. The server stopped answering part way, so try again. Anything that finished is saved.`;
    else if (streak >= MAX_FAILURES_IN_A_ROW) {
      message = `Stopped after ${MAX_FAILURES_IN_A_ROW} failures in a row (${done} analysed). ${lastMessage || (lastError && explain(lastError).text) || 'The analysis did not complete.'}`;
    } else if (stopRef.current) message = `Stopped. ${message}`;
    else if (!done && lastError) message = explain(lastError).text;
    else if (!done && lastMessage) message = `Could not analyse. ${lastMessage}`;
    setAnalysing({ busy: false, message });

    await reloadCalls(); // the server may have finished calls we did not hear back about
    if (done) refreshSummaries();
  };

  const analyseNext = () => runAnalysis(waiting.slice(0, BATCH).map((c) => c.id), { workers: 1 });
  const analyseAll = () => runAnalysis(waiting.map((c) => c.id), { workers: ALL_WORKERS });
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
          <h1 className="font-display text-[32px] font-semibold text-ink leading-none">Coaching</h1>
          <p className="text-muted text-[13.5px] mt-2">
            {isAdmin
              ? 'Calls, MEDDPICC and what is working across the team. Only managers see this view.'
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
          <button type="button" onClick={() => setTick((t) => t + 1)} className="bg-card border border-line rounded-full px-3.5 py-1.5 text-sm font-medium text-ink cursor-pointer hover:bg-sunken">Refresh</button>
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

          {isAdmin && sdrId === 'all' && (
            <Section title="The team" sub="Numbers cover every call in the period, including those before transcripts were switched on. A call counts as connected when it was answered and the SDR has not tagged it 1.NoAnswer, 3.Busy, LeftVoicemail or BadData.">
              <Card><TeamTable team={overview.team} onPick={(id) => { setSdrId(id); setOpenId(null); }} /></Card>
            </Section>
          )}

          {isAdmin && (
            <Section title="Trends" sub={`What is happening on the phones for ${who}: objections, who books and what the outreach sounds like.`}>
              <TrendsPanel data={trends} />
            </Section>
          )}

          <Section title={isAdmin ? `Coaching focus for ${who}` : 'Where to focus'} sub="Built from the calls that have been analysed against MEDDPICC and call craft.">
            <FocusPanel coaching={overview.coaching} who={who} />
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
                <CoverageTable coverage={meta.coverage} />
                {overview.connectionCheck?.analysed > 0 && (
                  <div className="text-[12px] text-muted mt-3 pt-3 border-t border-line">
                    Cross-check against the transcripts: of {overview.connectionCheck.analysed} analysed calls, {overview.connectionCheck.taggedConnectedButVoicemail} tagged as a real connection turned out to be a voicemail or phone menu, and {overview.connectionCheck.untaggedButVoicemail} untagged or no-answer calls did too.
                  </div>
                )}
              </Card>
            </Section>
          )}

          <Section
            title="Calls to review"
            right={(
              <div className="flex items-center gap-3 flex-wrap justify-end">
                {analysing.message && <span className="text-[12.5px] text-muted max-w-[420px] text-right">{analysing.message}</span>}
                {analysing.busy ? (
                  <button type="button" onClick={() => { stopRef.current = true; }} className="rounded-full bg-card border border-line text-ink text-sm font-medium px-4 py-2 cursor-pointer hover:bg-sunken">
                    Stop after this call
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      disabled={meta.waitingCount === 0}
                      onClick={analyseNext}
                      className="rounded-full bg-navy text-white text-sm font-medium px-4 py-2 border-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {meta.waitingCount ? `Analyse next ${Math.min(BATCH, meta.waitingCount)} (${meta.waitingCount} waiting)` : 'All calls analysed'}
                    </button>
                    {waiting.length > BATCH && (
                      <button
                        type="button"
                        onClick={() => setConfirmAll(true)}
                        className="rounded-full bg-card border border-line text-ink text-sm font-medium px-4 py-2 cursor-pointer hover:bg-sunken"
                      >
                        Analyse all {waiting.length} waiting
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          >
            {confirmAll && !analysing.busy && (
              <div className="mb-4 rounded-xl border border-line bg-card px-4 py-3 text-[13px] flex items-center justify-between gap-4 flex-wrap">
                <span className="text-body">
                  This analyses all {waiting.length} waiting calls, {ALL_WORKERS} at a time. {meta.refreshCount > 0 && ` ${meta.refreshCount} of them ${meta.refreshCount === 1 ? 'is an older analysis' : 'are older analyses'} that will be redone in English.`} It will take roughly {estimateMinutes} minute{estimateMinutes === 1 ? '' : 's'}, uses Claude for each call, and needs this tab left open. You can stop at any point and nothing already finished is lost.
                </span>
                <span className="flex gap-2">
                  <button type="button" onClick={analyseAll} className="rounded-full bg-navy text-white text-sm font-medium px-4 py-1.5 border-0 cursor-pointer">Start</button>
                  <button type="button" onClick={() => setConfirmAll(false)} className="rounded-full bg-card border border-line text-ink text-sm font-medium px-4 py-1.5 cursor-pointer hover:bg-sunken">Cancel</button>
                </span>
              </div>
            )}
            {calls.length === 0 ? (
              <Card><Empty>No transcribed calls in this period yet.</Empty></Card>
            ) : (
              <div className="space-y-2">
                {calls.map((c) => {
                  const open = openId === c.id;
                  const a = c.analysis;
                  const status = c.refresh === 'english' ? <Chip tone="warn">Update to English</Chip>
                    : c.refresh === 'missing' ? <Chip tone="warn">Re-analyse (details missing)</Chip>
                    : a && c.status === 'analysed' ? <Chip tone="good">Analysed</Chip>
                    : a ? <Chip tone="warn">Not saved yet</Chip>
                    : <Chip tone="warn">Waiting</Chip>;
                  return (
                    <div key={c.id} className="bg-card border border-line rounded-2xl">
                      <button type="button" onClick={() => setOpenId(open ? null : c.id)} className="w-full text-left bg-transparent border-0 px-5 py-3.5 cursor-pointer flex items-center gap-4 flex-wrap">
                        <span className="text-[13px] font-medium text-ink w-[110px]">{fmtWhen(c.startedAt)}</span>
                        {isAdmin && <span className="text-[13px] text-body w-[150px]">{c.sdrName}</span>}
                        <span className="text-[13px] text-muted w-[70px]">{c.durationMin == null ? '' : `${Math.round(c.durationMin)} min`}</span>
                        <span className="flex gap-1.5 flex-wrap flex-1">
                          {status}
                          {c.tags.includes('MeetingBooked') && <Chip tone="good">Meeting booked</Chip>}
                          {a && a.callType !== 'conversation' && <Chip>{CALL_TYPE_LABELS[a.callType] || a.callType}</Chip>}
                          {a?.nextStepSecured && <Chip tone="info">Next step secured</Chip>}
                          {a?.objections?.length > 0 && <Chip>{a.objections.length} objection{a.objections.length === 1 ? '' : 's'}</Chip>}
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
