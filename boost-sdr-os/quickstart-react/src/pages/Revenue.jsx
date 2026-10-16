import React, { useEffect, useMemo, useState } from 'react';
import { fetchOpportunitySnapshot } from '../api/monday';
import { fetchLatestInsights } from '../api/insights';
import { parseOpportunity } from '../utils/opportunityMetrics';
import {
  headline, wonBy, monthlyWon, winRateBy, concentration, funnel, lostByReason, leakage, coaching,
  fmtUSD, fmtPct, DEFAULT_RECOVERY_RATE, STALE_DAYS, ASSUMED_PROBABILITY, MIN_CLOSED_FOR_RATE, MIN_CLOSED_FOR_COACHING,
} from '../utils/revenueMetrics';
import { makeDemoOpportunities, makeDemoInsights } from '../utils/revenueDemoData';
import StatCard from '../components/shared/StatCard';
import InsightsPanel from '../components/revenue/InsightsPanel';
import { HBarChart, ColumnChart, StageBars, COLORS } from '../components/revenue/charts';

function Section({ title, sub, children }) {
  return (
    <section className="mb-10">
      <div className="mb-4">
        <h2 className="font-display text-[24px] font-semibold text-ink leading-tight">{title}</h2>
        {sub && <p className="text-muted text-[13px] mt-1 max-w-3xl">{sub}</p>}
      </div>
      {children}
    </section>
  );
}

function Card({ title, note, children, className = '' }) {
  return (
    <div className={`bg-card border border-line rounded-2xl p-5 ${className}`}>
      <div className="flex items-baseline justify-between gap-3 mb-4">
        <div className="font-heading font-bold text-[14px]">{title}</div>
        {note && <div className="text-[11.5px] text-muted text-right">{note}</div>}
      </div>
      {children}
    </div>
  );
}

function Chip({ tone = 'muted', children }) {
  const cls = { warn: 'bg-amber-soft text-amber-ink', good: 'bg-pale text-green-deep', muted: 'bg-sunken text-body' }[tone];
  return <span className={`inline-block text-[11px] font-medium px-2 py-0.5 rounded-full ${cls}`}>{children}</span>;
}

export default function Revenue({ region }) {
  const [useDemo, setUseDemo] = useState(false);
  const [live, setLive] = useState({ opps: [], fetchedAt: null, loading: true, error: null });
  const [insights, setInsights] = useState({ data: null, loading: true, error: null });
  const [recovery, setRecovery] = useState(DEFAULT_RECOVERY_RATE);
  const [coachField, setCoachField] = useState('sdr');
  const [tick, setTick] = useState(0);

  // Live Opportunities. Falls back to sample data if the board cannot be read.
  useEffect(() => {
    if (useDemo) return undefined;
    let alive = true;
    setLive(l => ({ ...l, loading: true, error: null }));
    fetchOpportunitySnapshot({ region, maxAgeMs: tick ? 0 : undefined })
      .then(snap => alive && setLive({ opps: snap.items.map(parseOpportunity), fetchedAt: snap.fetchedAt, loading: false, error: null }))
      .catch(e => alive && setLive({ opps: [], fetchedAt: null, loading: false, error: String(e.message || e) }));
    return () => { alive = false; };
  }, [region, useDemo, tick]);

  const demo = useDemo || !!live.error;

  // Latest Claude scan from the Revenue Insights board.
  useEffect(() => {
    if (demo) { setInsights({ data: makeDemoInsights(), loading: false, error: null }); return undefined; }
    let alive = true;
    setInsights(i => ({ ...i, loading: true, error: null }));
    fetchLatestInsights()
      .then(data => alive && setInsights({ data, loading: false, error: null }))
      .catch(e => alive && setInsights({ data: null, loading: false, error: String(e.message || e) }));
    return () => { alive = false; };
  }, [demo, tick]);

  const now = useMemo(() => new Date(), [live.fetchedAt, demo]);
  const opps = useMemo(() => {
    if (!demo) return live.opps;
    const all = makeDemoOpportunities(now);
    return region && region !== 'All' ? all.filter(o => o.region === region) : all;
  }, [demo, live.opps, region, now]);

  const m = useMemo(() => {
    if (!opps.length) return null;
    return {
      head: headline(opps, now),
      monthly: monthlyWon(opps, now),
      bySource: wonBy(opps, o => o.source, now),
      byRegion: wonBy(opps, o => o.region, now),
      byType: wonBy(opps, o => o.typeOfDeal, now),
      byIndustry: wonBy(opps, o => o.industry, now),
      rateBySource: winRateBy(opps, o => o.source, now),
      rateByRegion: winRateBy(opps, o => o.region, now),
      conc: concentration(opps, now),
      stages: funnel(opps),
      lost: lostByReason(opps, now),
      coach: { sdr: coaching(opps, 'sdr', now), bizDev: coaching(opps, 'bizDev', now) },
    };
  }, [opps, now]);

  const leak = useMemo(() => (opps.length ? leakage(opps, now, recovery) : null), [opps, now, recovery]);

  if (live.loading && !demo) {
    return (
      <div className="px-8 py-16 text-center text-muted">
        <p>Reading the Opportunities board…</p>
        <button type="button" className="mt-4 px-4 py-2 rounded-full border border-line bg-card text-ink text-sm cursor-pointer hover:bg-sunken" onClick={() => setUseDemo(true)}>
          Use sample data instead
        </button>
      </div>
    );
  }
  if (!m || !leak) {
    return (
      <div className="px-8 py-16 text-center">
        <p className="text-ink font-semibold">No opportunities to analyse{region !== 'All' ? ` in ${region}` : ''}.</p>
        <button className="mt-4 px-4 py-2 rounded-full bg-navy text-white text-sm cursor-pointer border-0" onClick={() => setUseDemo(true)}>Show sample data</button>
      </div>
    );
  }

  const { head } = m;
  const scanSummary = insights.data?.summary;
  const rateOverall = head.winRate12;
  const coach = m.coach[coachField];
  const money = fmtUSD;

  return (
    <div className="px-8 py-8 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-end justify-between gap-4 flex-wrap mb-6">
        <div>
          <h1 className="font-display text-[32px] font-semibold text-ink leading-none">Revenue Intelligence</h1>
          <p className="text-muted text-[13.5px] mt-2">
            Where revenue comes from, where it leaks, and who to coach. Last 12 months, all values in USD{region !== 'All' ? `, ${region} region` : ''}.
          </p>
        </div>
        <div className="flex items-center gap-2.5 flex-wrap">
          {demo
            ? <Chip tone="warn">{live.error && !useDemo ? 'Sample data (live board unavailable)' : 'Sample data'}</Chip>
            : <Chip tone="good">Live · {opps.length.toLocaleString()} deals{live.fetchedAt ? ` · ${new Date(live.fetchedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : ''}</Chip>}
          <button type="button" onClick={() => setTick(t => t + 1)} className="px-3.5 py-1.5 rounded-full border border-line bg-card text-[12.5px] text-ink cursor-pointer hover:bg-sunken">Refresh</button>
          <label className="flex items-center gap-2 text-[12.5px] text-body cursor-pointer">
            <input type="checkbox" checked={useDemo} onChange={e => setUseDemo(e.target.checked)} />
            Use sample data
          </label>
        </div>
      </div>
      {live.error && !useDemo && (
        <div className="mb-6 text-[12.5px] text-amber-ink bg-amber-soft rounded-xl px-4 py-2.5">
          Could not read live data ({live.error.slice(0, 140)}). Showing sample data instead.
        </div>
      )}

      {/* KPI row */}
      <div className="grid grid-cols-4 gap-4 mb-6 max-[1100px]:grid-cols-2">
        <StatCard label="Won, last 12 months" value={money(head.won12Value)} meta={`${head.won12Count} deals · avg ${money(head.avgDealSize)}`} />
        <StatCard label="Open pipeline (weighted)" value={money(head.weightedOpen)} meta={`${money(head.openValue)} total · ${head.openCount} open deals`} />
        <StatCard label="Win rate, last 12 months" value={fmtPct(rateOverall)} meta={`${head.won12Count} won · ${head.lost12Count} lost${head.avgCycleDays ? ` · ${Math.round(head.avgCycleDays)} days to close` : ''}`} />
        <StatCard feature label="Left on the table (estimate)" value={money(leak.total)} meta={`${money(leak.atRisk.expected)} at risk in open deals + ${money(leak.recoverable.estimate)} recoverable from lost`} />
      </div>

      {/* Scan summary */}
      <div className="rounded-3xl bg-navy text-on-dark p-7 mb-10 shadow-md">
        <div className="flex items-center gap-2 mb-2">
          <span className="inline-block w-2 h-2 rounded-full bg-pale" />
          <div className="text-[11px] font-semibold uppercase tracking-wide text-white/70">
            Claude scan summary{demo ? ' (sample)' : insights.data?.scanRun ? ` · ${insights.data.scanRun}` : ''}
          </div>
        </div>
        <p className="text-[15px] leading-relaxed text-white/90 max-w-4xl">
          {insights.loading ? 'Loading the latest scan…'
            : insights.error ? `Could not read the Revenue Insights board: ${insights.error}`
            : scanSummary?.narrative
              ? scanSummary.narrative
              : 'No scan has run yet. The scheduled Claude scan writes here at 06:00 and 12:00 UK time, Sunday to Friday. The charts below are calculated live from the Opportunities board.'}
        </p>
      </div>

      {/* 1. Where revenue comes from */}
      <Section title="Where revenue comes from" sub="Won value by month, source, region, type of deal and industry, so you can see what is actually paying the bills.">
        <div className="grid grid-cols-3 gap-4 mb-4 max-[1100px]:grid-cols-1">
          <Card title="Won value by month" note="Last 12 months" className="col-span-2 max-[1100px]:col-span-1">
            <ColumnChart data={m.monthly} format={money} />
          </Card>
          <Card title="Concentration" note="Top 5 deals">
            <div className="font-display text-[40px] font-semibold text-ink leading-none">{fmtPct(m.conc.share)}</div>
            <div className="text-[12.5px] text-muted mt-2 mb-4">of last 12 months won value came from just five deals ({money(m.conc.topValue)} of {money(m.conc.total)}).</div>
            <div className="space-y-1.5">
              {m.conc.deals.map(d => (
                <div key={d.id} className="flex justify-between text-[12.5px]">
                  <span className="truncate pr-3 text-body">{d.name}</span>
                  <span className="font-semibold text-ink flex-shrink-0">{money(d.valueUSD)}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
        <div className="grid grid-cols-2 gap-4 mb-4 max-[1100px]:grid-cols-1">
          <Card title="Won value by source" note="What brings the money in"><HBarChart data={m.bySource.slice(0, 9).map(d => ({ label: d.label, value: d.value, sub: `${d.count} deals` }))} format={money} color={COLORS.emerald} /></Card>
          <Card title="Won value by type of deal"><HBarChart data={m.byType.map(d => ({ label: d.label, value: d.value, sub: `${d.count} deals` }))} format={money} /></Card>
          <Card title="Won value by region"><HBarChart data={m.byRegion.map(d => ({ label: d.label, value: d.value, sub: `${d.count} deals` }))} format={money} color={COLORS.purple} /></Card>
          <Card title="Won value by industry" note="Top 8"><HBarChart data={m.byIndustry.slice(0, 8).map(d => ({ label: d.label, value: d.value, sub: `${d.count} deals` }))} format={money} color={COLORS.amber} /></Card>
        </div>
        <InsightsPanel title="AI scan: revenue sources" sections={['Revenue sources']} insights={insights.data} demo={demo} loading={insights.loading} error={insights.error} />
      </Section>

      {/* 2. Leakage */}
      <Section title="Where we are leaving money on the table" sub={`Deals that are slipping, deals we lost that could come back, and gaps in the data that hide pipeline. Open deals with no win probability are assumed at ${ASSUMED_PROBABILITY}%.`}>
        <div className="grid grid-cols-3 gap-4 mb-4 max-[1100px]:grid-cols-1">
          <Card title="Leak checks on open pipeline" note={`${money(leak.atRisk.value)} in ${leak.atRisk.count} deals flagged stale, overdue or parked`} className="col-span-2 max-[1100px]:col-span-1">
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="text-left text-muted text-[11px] uppercase tracking-wide">
                    <th className="pb-2 font-semibold">Check</th>
                    <th className="pb-2 font-semibold text-right">Deals</th>
                    <th className="pb-2 font-semibold text-right">Value</th>
                    <th className="pb-2 font-semibold text-right">Expected</th>
                    <th className="pb-2 font-semibold pl-4">Biggest deals</th>
                  </tr>
                </thead>
                <tbody>
                  {leak.checks.map(c => (
                    <tr key={c.key} className="border-t border-line align-top" title={c.why}>
                      <td className="py-2.5 pr-3">
                        <div className="font-medium text-ink">{c.label}</div>
                        <div className="text-[11.5px] text-muted max-w-xs">{c.why}</div>
                      </td>
                      <td className="py-2.5 text-right font-semibold">{c.count}</td>
                      <td className="py-2.5 text-right">{money(c.value)}</td>
                      <td className="py-2.5 text-right">{money(c.expected)}</td>
                      <td className="py-2.5 pl-4 text-body text-[11.5px]">{c.sample.slice(0, 3).map(d => d.name).join(', ') || '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="text-[11.5px] text-muted mt-3">Checks overlap, so rows do not add up to the total. "Expected" weights value by win probability. Stale means no change to the record for {STALE_DAYS}+ days.</div>
          </Card>
          <Card title="Recoverable from lost deals" note="Budget, timeline and ghosting">
            <div className="font-display text-[40px] font-semibold text-ink leading-none">{money(leak.recoverable.estimate)}</div>
            <div className="text-[12.5px] text-muted mt-2 mb-4">
              {money(leak.recoverable.lostValue)} across {leak.recoverable.count} deals lost for reasons that can change. At a {Math.round(recovery * 100)}% re-engage rate.
            </div>
            <label className="block text-[12px] text-body">
              Assumed re-engage rate: <strong>{Math.round(recovery * 100)}%</strong>
              <input type="range" min="0.02" max="0.3" step="0.01" value={recovery} onChange={e => setRecovery(parseFloat(e.target.value))} className="w-full mt-1.5" />
            </label>
            {leak.recoverable.noReason > 0 && (
              <div className="mt-3"><Chip tone="warn">{leak.recoverable.noReason} lost deals have no reason recorded</Chip></div>
            )}
          </Card>
        </div>
        <div className="grid grid-cols-2 gap-4 mb-4 max-[1100px]:grid-cols-1">
          <Card title="Open pipeline by stage" note={`${money(head.openValue)} total`}><StageBars data={m.stages} format={money} /></Card>
          <Card title="Lost value by reason" note="Last 12 months"><HBarChart data={m.lost.map(d => ({ label: d.label, value: d.value, sub: `${d.count} deals`, color: ['Timeline is to long', 'Budget', 'Ghosting'].includes(d.label) ? COLORS.amber : COLORS.red }))} format={money} empty="No lost deals in the last 12 months." /><div className="text-[11.5px] text-muted mt-3">Amber reasons can come back and feed the recoverable figure.</div></Card>
          <Card title="Win rate by source" note={`Overall ${fmtPct(rateOverall)} · min ${MIN_CLOSED_FOR_RATE} closed deals`}>
            <HBarChart
              data={m.rateBySource.map(d => ({ label: d.label, value: d.rate, sub: `${d.won}/${d.closed} won`, color: d.rate < (rateOverall ?? 0) - 8 ? COLORS.red : d.rate > (rateOverall ?? 0) + 8 ? COLORS.emerald : COLORS.navy }))}
              format={v => `${Math.round(v)}%`}
              empty="Not enough closed deals per source yet."
            />
            <div className="text-[11.5px] text-muted mt-3">Red is clearly below the overall rate (effort that is not converting). Green is clearly above.</div>
          </Card>
          <Card title="Win rate by region" note={`Min ${MIN_CLOSED_FOR_RATE} closed deals`}>
            <HBarChart data={m.rateByRegion.map(d => ({ label: d.label, value: d.rate, sub: `${d.won}/${d.closed} won`, color: COLORS.purple }))} format={v => `${Math.round(v)}%`} empty="Not enough closed deals per region yet." />
          </Card>
        </div>
        <div className="grid grid-cols-2 gap-4 max-[1100px]:grid-cols-1">
          <InsightsPanel title="AI scan: leakage" sections={['Leakage']} insights={insights.data} demo={demo} loading={insights.loading} error={insights.error} />
          <InsightsPanel title="AI scan: pipeline health" sections={['Pipeline health', 'Events']} insights={insights.data} demo={demo} loading={insights.loading} error={insights.error} />
        </div>
      </Section>

      {/* 3. Coaching */}
      <Section title="Coaching" sub={`Each person against the team over the last 12 months. Flags only appear with at least ${MIN_CLOSED_FOR_COACHING} closed deals, so small samples do not mislead. Use these as conversation starters, not verdicts.`}>
        <Card
          title={coachField === 'sdr' ? 'SDRs' : 'BizDevs'}
          note={coach.team.rate != null ? `Team win rate ${fmtPct(coach.team.rate)}${coach.team.cycle ? ` · ${Math.round(coach.team.cycle)} days to close` : ''}` : 'Not enough closed deals for a team benchmark'}
          className="mb-4"
        >
          <div className="flex gap-1.5 mb-4">
            {[['sdr', 'SDR'], ['bizDev', 'BizDev']].map(([id, label]) => (
              <button key={id} type="button" onClick={() => setCoachField(id)}
                className={`px-3.5 py-1.5 rounded-full text-[12.5px] cursor-pointer border ${coachField === id ? 'bg-navy text-white border-navy' : 'bg-card text-ink border-line hover:bg-sunken'}`}>
                {label}
              </button>
            ))}
          </div>
          {coach.rows.length === 0 ? <p className="text-muted text-[13px]">No people found on these deals.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="text-left text-muted text-[11px] uppercase tracking-wide">
                    <th className="pb-2 font-semibold">Name</th>
                    <th className="pb-2 font-semibold text-right">Won value</th>
                    <th className="pb-2 font-semibold text-right">Win rate</th>
                    <th className="pb-2 font-semibold text-right">Days to close</th>
                    <th className="pb-2 font-semibold text-right">Open</th>
                    <th className="pb-2 font-semibold text-right">Stale</th>
                    <th className="pb-2 font-semibold pl-4">Signals and coaching</th>
                  </tr>
                </thead>
                <tbody>
                  {coach.rows.map(r => (
                    <tr key={r.name} className="border-t border-line align-top">
                      <td className="py-2.5 pr-3 font-medium text-ink">{r.name}</td>
                      <td className="py-2.5 text-right">{money(r.wonValue)}</td>
                      <td className="py-2.5 text-right">{r.closed ? `${fmtPct(r.rate)} (${r.won}/${r.closed})` : '–'}</td>
                      <td className="py-2.5 text-right">{r.cycle != null ? Math.round(r.cycle) : '–'}</td>
                      <td className="py-2.5 text-right">{r.open}</td>
                      <td className="py-2.5 text-right">{r.stale}</td>
                      <td className="py-2.5 pl-4">
                        <div className="flex flex-wrap gap-1.5">
                          {r.flags.length ? r.flags.map((f, i) => <Chip key={i} tone={f.tone}>{f.text}</Chip>) : <span className="text-muted text-[11.5px]">{r.closed < MIN_CLOSED_FOR_COACHING ? 'Too few closed deals to compare' : 'In line with the team'}</span>}
                        </div>
                        {r.tip && <div className="text-[11.5px] text-body mt-1.5">{r.tip}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <InsightsPanel title="AI scan: coaching" sections={['Coaching']} insights={insights.data} demo={demo} loading={insights.loading} error={insights.error} />
      </Section>
    </div>
  );
}
