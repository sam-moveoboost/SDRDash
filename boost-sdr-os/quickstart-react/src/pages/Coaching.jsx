import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { coachingApi } from '../api/coaching';
import { demoOverview, demoCalls, demoTrends } from '../utils/coachingDemoData';
import StatCard from '../components/shared/StatCard';
import {
  Section, Card, Chip, Empty, WeekBars, TeamTable, FocusPanel, CallDetail, TrendsPanel, fmtWhen, pct, num,
} from '../components/coaching/CoachingParts';

const DAY_OPTIONS = [14, 30, 60, 90];
const BATCH = 5;

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
  const [trends, setTrends] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [analysing, setAnalysing] = useState({ busy: false, message: null });

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

  const waiting = useMemo(
    () => calls
      .filter((c) => c.transcript?.available && !c.analysis)
      .sort((a, b) => Number(!!b.transcript.hasConversation) - Number(!!a.transcript.hasConversation)),
    [calls],
  );

  const analyseNext = async () => {
    if (demo) { setAnalysing({ busy: false, message: 'This is sample data, so nothing was analysed.' }); return; }
    const ids = waiting.slice(0, BATCH).map((c) => c.id);
    if (!ids.length) return;
    setAnalysing({ busy: true, message: `Analysing ${ids.length} call${ids.length === 1 ? '' : 's'}. This can take a minute.` });
    try {
      const { results } = await coachingApi.analyse(ids);
      const byId = Object.fromEntries(results.map((r) => [r.id, r]));
      setCalls((prev) => prev.map((c) => (byId[c.id]?.analysis ? { ...c, analysis: byId[c.id].analysis } : c)));
      const failed = results.filter((r) => r.error).length;
      setAnalysing({ busy: false, message: failed ? `${results.length - failed} analysed, ${failed} could not be.` : `${results.length} analysed.` });
      refreshSummaries();
    } catch (e) {
      setAnalysing({ busy: false, message: explain(e).text });
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
          <button type="button" onClick={() => { setDemo((d) => !d); setSdrId('all'); }} className="bg-transparent border-0 text-[12.5px] text-muted underline cursor-pointer">
            {demo ? 'Use live data' : 'Show sample data'}
          </button>
        </div>
      </div>

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
          <div className="grid gap-4 grid-cols-2 lg:grid-cols-5 mb-10">
            <StatCard feature label="Calls" value={stats.calls} meta={`${stats.outbound} outbound, ${pct(stats.connectRate)} answered`} />
            <StatCard label="Conversations" value={stats.conversations} meta={`${pct(stats.conversationRate)} of outbound calls`} />
            <StatCard label="Meetings booked" value={stats.meetingsBooked} meta={`${pct(stats.bookingRate)} of conversations`} />
            <StatCard label="Average conversation" value={stats.avgConversationMin == null ? 'n/a' : `${num(stats.avgConversationMin)} min`} meta={`${stats.talkMinutes} minutes talking`} />
            <StatCard label="Calls analysed" value={`${overview.coaching.analysedCalls} / ${overview.transcribedCalls}`} meta="transcribed calls over 2 minutes" />
          </div>

          {isAdmin && sdrId === 'all' && (
            <Section title="The team" sub="Numbers cover every call in the period, including those before transcripts were switched on.">
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

          <Section
            title="Calls to review"
            sub="Transcribed calls over 2 minutes, newest first. Only calls since transcripts were switched on appear here."
            right={(
              <div className="flex items-center gap-3">
                {analysing.message && <span className="text-[12.5px] text-muted">{analysing.message}</span>}
                <button
                  type="button"
                  disabled={analysing.busy || waiting.length === 0}
                  onClick={analyseNext}
                  className="rounded-full bg-navy text-white text-sm font-medium px-4 py-2 border-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {analysing.busy ? 'Analysing...' : waiting.length ? `Analyse new calls (${waiting.length} waiting)` : 'All calls analysed'}
                </button>
              </div>
            )}
          >
            {calls.length === 0 ? (
              <Card><Empty>No transcribed calls in this period yet.</Empty></Card>
            ) : (
              <div className="space-y-2">
                {calls.map((c) => {
                  const open = openId === c.id;
                  const a = c.analysis;
                  const status = a
                    ? a.callType === 'not_a_conversation' ? <Chip>No conversation</Chip> : <Chip tone="good">Analysed</Chip>
                    : c.transcript?.available ? <Chip tone="warn">Waiting</Chip> : <Chip>No transcript yet</Chip>;
                  return (
                    <div key={c.id} className="bg-card border border-line rounded-2xl">
                      <button type="button" onClick={() => setOpenId(open ? null : c.id)} className="w-full text-left bg-transparent border-0 px-5 py-3.5 cursor-pointer flex items-center gap-4 flex-wrap">
                        <span className="text-[13px] font-medium text-ink w-[110px]">{fmtWhen(c.startedAt)}</span>
                        {isAdmin && <span className="text-[13px] text-body w-[150px]">{c.sdrName}</span>}
                        <span className="text-[13px] text-muted w-[70px]">{Math.round(c.durationMin)} min</span>
                        <span className="flex gap-1.5 flex-wrap flex-1">
                          {status}
                          {c.tags.includes('MeetingBooked') && <Chip tone="good">Meeting booked</Chip>}
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
