import React, { useEffect, useState, useMemo } from 'react';
import { fetchOpportunities } from '../api/monday';
import ProgressBar from '../components/shared/ProgressBar';
import {
  parseOpportunity, quarterOf, quarterLabel, inQuarter, inYear,
  groupBy, monthlyTrend, periodStats, formatMoney, formatByCurrency,
  planningBuckets, historicalClosed,
} from '../utils/opportunityMetrics';

const PALETTE = ['#192D3F', '#8DC63A', '#E29A2E', '#579bfc', '#9d50dd', '#E0544A', '#4eccc6', '#254154', '#df2f4a', '#00c875'];
const colorFor = i => PALETTE[i % PALETTE.length];

// ── Small building blocks ────────────────────────────────────────────

function MiniStat({ label, value, sub }) {
  return (
    <div>
      <div className="text-muted text-[11px] font-semibold uppercase tracking-wide mb-1">{label}</div>
      <div className="font-display font-bold text-[19px] leading-tight text-ink">{value}</div>
      {sub && <div className="text-muted text-[11.5px] mt-1">{sub}</div>}
    </div>
  );
}

function TotalPipelineBanner({ count, valueUSD, missingCloseDateCount }) {
  return (
    <div className="rounded-2xl bg-gradient-to-br from-teal to-teal-mid text-white p-6 mb-6 shadow-sm">
      <div className="flex items-center justify-between flex-wrap gap-6">
        <div>
          <div className="text-white/70 text-[11px] font-semibold uppercase tracking-wide mb-1.5">
            Total Current Pipeline (USD)
          </div>
          <div className="font-display font-bold text-[36px] leading-none">
            {formatMoney(valueUSD, 'USD') ?? '$0'}
          </div>
          <div className="text-white/75 text-[13px] mt-2">
            {count} open opportunit{count === 1 ? 'y' : 'ies'} — every deal not yet Won or Lost, regardless of timing
          </div>
        </div>
        {missingCloseDateCount > 0 && (
          <div className="text-white/70 text-[12px] max-w-[220px] text-right">
            {missingCloseDateCount} of these have no Expected Close Date set, so they're excluded from the quarter/year timing stats below.
          </div>
        )}
      </div>
    </div>
  );
}

function PeriodCard({ title, stats }) {
  const winRateText = stats.winRate === null ? '—' : `${stats.winRate.toFixed(0)}%`;
  return (
    <div className="bg-card border border-line rounded-2xl p-6">
      <div className="font-display font-bold text-[16px] mb-5">{title}</div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-5">
        <MiniStat
          label="Expected to Close (USD)"
          value={formatMoney(stats.openValueUSD, 'USD') ?? '$0'}
          sub={`${stats.openCount} opportunit${stats.openCount === 1 ? 'y' : 'ies'}`}
        />
        <MiniStat
          label="Win Rate"
          value={winRateText}
          sub={stats.closedTotal > 0 ? `${stats.wonCount} won · ${stats.lostCount} lost` : 'No closed deals yet'}
        />
        <MiniStat
          label="Closed-Won Value (USD)"
          value={formatMoney(stats.wonValueUSD, 'USD') ?? '$0'}
          sub={`${stats.wonCount} deal${stats.wonCount === 1 ? '' : 's'} won`}
        />
        <MiniStat
          label="Avg Deal Size (USD)"
          value={formatMoney(stats.avgDealSizeUSD, 'USD') ?? '$0'}
          sub="per won deal"
        />
      </div>
    </div>
  );
}

function HBar({ label, count, sub, max, color }) {
  const pct = max > 0 ? Math.max(4, Math.round((count / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-3">
      <div className="w-36 text-[12.5px] font-medium text-ink truncate flex-shrink-0" title={label}>{label}</div>
      <div className="flex-1 h-[18px] bg-line rounded-full overflow-hidden">
        <div
          className="h-full rounded-full flex items-center justify-end pr-2 transition-all"
          style={{ width: `${pct}%`, backgroundColor: color }}
        >
          {pct > 12 && <span className="text-white text-[10px] font-bold">{count}</span>}
        </div>
      </div>
      {pct <= 12 && <span className="text-[12px] font-bold w-4 text-ink flex-shrink-0">{count}</span>}
      <span className="text-muted text-[11px] w-32 text-right flex-shrink-0 truncate" title={sub}>{sub}</span>
    </div>
  );
}

function Breakdown({ title, items, empty }) {
  const max = items[0]?.count ?? 1;
  return (
    <div className="bg-card border border-line rounded-2xl p-5">
      <div className="font-display font-bold text-[14px] mb-4">{title}</div>
      {items.length === 0
        ? <p className="text-muted text-[13px]">{empty}</p>
        : (
          <div className="space-y-3">
            {items.map((it, i) => (
              <HBar key={it.label} label={it.label} count={it.count} sub={formatByCurrency(it.byCurrency)} max={max} color={colorFor(i)} />
            ))}
          </div>
        )
      }
    </div>
  );
}

function MonthlyTrendChart({ data }) {
  const maxVal = Math.max(1, ...data.map(d => Math.max(d.won.count, d.created)));
  return (
    <div>
      <div className="flex items-end gap-2 h-40">
        {data.map(d => (
          <div key={d.label} className="flex-1 flex flex-col items-center justify-end h-full">
            <div className="flex items-end gap-0.5 h-full">
              <div
                className="w-3 rounded-t bg-teal"
                style={{ height: `${Math.max(2, (d.won.count / maxVal) * 100)}%` }}
                title={`${d.won.count} won · ${formatByCurrency(d.won.byCurrency)}`}
              />
              <div
                className="w-3 rounded-t bg-mint"
                style={{ height: `${Math.max(2, (d.created / maxVal) * 100)}%` }}
                title={`${d.created} opportunities created`}
              />
            </div>
            <span className="text-[10.5px] text-muted mt-1.5">{d.label}</span>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-4 mt-3 text-[11.5px] text-muted">
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-teal inline-block" /> Won</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-mint inline-block" /> Created</span>
      </div>
    </div>
  );
}

function fmtDate(d) {
  return d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
}

// Generic deals table used for the quarter/year/unscheduled pipeline-planning
// lists, the historical closed report, and the top-open-deals list. Value is
// always shown blended into USD — PS deals show "Pending FX rate" instead of
// $0 so a deal awaiting its FX Calculator conversion doesn't read as worthless.
function DealsList({ title, deals, dateLabel, getDate, showOutcome, empty, scroll }) {
  return (
    <div className="bg-card border border-line rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-line flex items-center justify-between">
        <span className="font-display font-bold text-[14px]">{title}</span>
        <span className="text-[12px] text-muted">{deals.length} deal{deals.length !== 1 ? 's' : ''}</span>
      </div>
      {deals.length === 0 ? (
        <div className="px-5 py-6 text-muted text-[13px]">{empty}</div>
      ) : (
        <div className={`overflow-x-auto ${scroll ? 'max-h-80 overflow-y-auto' : ''}`}>
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-line bg-[#FAF8F5]">
                <th className="text-left px-5 py-2.5 font-semibold text-muted">Deal</th>
                <th className="text-left px-3 py-2.5 font-semibold text-muted">{showOutcome ? 'Outcome' : 'Stage'}</th>
                <th className="text-left px-3 py-2.5 font-semibold text-muted">Type</th>
                <th className="text-left px-3 py-2.5 font-semibold text-muted">{dateLabel}</th>
                <th className="text-right px-5 py-2.5 font-semibold text-muted">Value (USD)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {deals.map(o => (
                <tr key={o.id} className="hover:bg-[#FAF8F5] transition-colors">
                  <td className="px-5 py-3 font-semibold text-ink">{o.name}</td>
                  <td className="px-3 py-3">
                    {showOutcome
                      ? <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full text-white ${o.isWon ? 'bg-mint-deep' : 'bg-red'}`}>{o.stage}</span>
                      : <span className="text-muted">{o.stage}</span>
                    }
                  </td>
                  <td className="px-3 py-3 text-muted">{o.typeOfDeal}</td>
                  <td className="px-3 py-3 text-muted tabular-nums">{fmtDate(getDate(o))}</td>
                  <td className="px-5 py-3 text-right font-display font-bold text-teal">
                    {o.valueUSD > 0
                      ? formatMoney(o.valueUSD, 'USD')
                      : o.isPS
                        ? <span className="text-muted italic font-normal text-[11px]">Pending FX rate</span>
                        : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────

export default function OpportunityScoreboard({ region }) {
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [rawOpps, setRawOpps] = useState([]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchOpportunities({ region })
      .then(setRawOpps)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [region]);

  const opps = useMemo(() => rawOpps.map(parseOpportunity), [rawOpps]);

  const now = new Date();
  const year = now.getFullYear();
  const quarter = quarterOf(now);

  const quarterStats = useMemo(() => periodStats(opps, {
    openPredicate:   o => inQuarter(o.expectedClose, year, quarter),
    closedPredicate: o => inQuarter(o.actualClose, year, quarter),
  }), [opps, year, quarter]);

  const yearStats = useMemo(() => periodStats(opps, {
    openPredicate:   o => inYear(o.expectedClose, year),
    closedPredicate: o => inYear(o.actualClose, year),
  }), [opps, year]);

  const trend = useMemo(() => monthlyTrend(opps, year), [opps, year]);

  const openOpps = useMemo(() => opps.filter(o => o.isOpen), [opps]);
  const totalOpenValueUSD = useMemo(() => openOpps.reduce((s, o) => s + (o.valueUSD || 0), 0), [openOpps]);
  const missingCloseDateCount = useMemo(() => openOpps.filter(o => !o.expectedClose).length, [openOpps]);
  const stageBreakdown  = useMemo(() => groupBy(openOpps, o => o.stage), [openOpps]);
  const typeBreakdown   = useMemo(() => groupBy(openOpps, o => o.typeOfDeal), [openOpps]);
  const sourceBreakdown = useMemo(() => groupBy(openOpps, o => o.source).slice(0, 8), [openOpps]);

  const lostThisYear = useMemo(() => opps.filter(o => o.isLost && inYear(o.actualClose, year)), [opps, year]);
  const reasonBreakdown = useMemo(() => groupBy(lostThisYear, o => o.reasonLost || 'Not recorded'), [lostThisYear]);

  const topOpenDeals = useMemo(() => [...openOpps].sort((a, b) => b.valueUSD - a.valueUSD).slice(0, 10), [openOpps]);

  // Pipeline planning: sort open opportunities into this quarter / later this year / unscheduled.
  const buckets = useMemo(() => planningBuckets(opps, year, quarter), [opps, year, quarter]);
  // Historical reporting: everything already closed (Won or Lost), most recent first.
  const closedHistory = useMemo(() => historicalClosed(opps).slice(0, 25), [opps]);

  if (error) return (
    <div className="max-w-6xl mx-auto px-7 py-10 text-red">Failed to load opportunities: {error}</div>
  );

  return (
    <>
      <ProgressBar loading={loading} />

      <div className="max-w-6xl mx-auto px-7 py-8 pb-20">

        {/* Header */}
        <div className="mb-7">
          <p className="font-display text-[11px] font-semibold tracking-[.14em] uppercase text-mint-deep mb-1.5">
            Pipeline
          </p>
          <h1 className="font-display text-[27px] font-bold tracking-tight mb-1">Opportunities</h1>
          <p className="text-muted text-[15px] max-w-xl">
            {region && region !== 'All' ? `${region} territory` : 'All territories'} · live from monday.com
          </p>
        </div>

        {/* Total current pipeline — every open deal, no timing filter */}
        <TotalPipelineBanner
          count={openOpps.length}
          valueUSD={totalOpenValueUSD}
          missingCloseDateCount={missingCloseDateCount}
        />

        {/* Quarter & Year period cards — timing view, based on Expected Close Date */}
        <div className="grid grid-cols-2 gap-6 mb-6">
          <PeriodCard title={`This Quarter · ${quarterLabel(year, quarter)}`} stats={quarterStats} />
          <PeriodCard title={`This Year · ${year}`} stats={yearStats} />
        </div>

        {/* Pipeline planning: sort open opportunities into quarter / year / unscheduled */}
        <div className="mb-6">
          <p className="font-display font-bold text-[16px] mb-3">Pipeline Planning</p>
          <div className="space-y-4">
            <DealsList
              title={`Closing This Quarter · ${quarterLabel(year, quarter)}`}
              deals={buckets.thisQuarter}
              dateLabel="Expected Close"
              getDate={o => o.expectedClose}
              empty="No open deals expected to close this quarter."
              scroll
            />
            <DealsList
              title={`Closing Later This Year · ${year}`}
              deals={buckets.laterThisYear}
              dateLabel="Expected Close"
              getDate={o => o.expectedClose}
              empty="No open deals expected to close later this year."
              scroll
            />
            <DealsList
              title="Unscheduled (No Expected Close Date)"
              deals={buckets.unscheduled}
              dateLabel="Created"
              getDate={o => o.created}
              empty="Every open deal has an Expected Close Date set. Nice."
              scroll
            />
          </div>
        </div>

        {/* Monthly trend */}
        <div className="bg-card border border-line rounded-2xl p-5 mb-6">
          <div className="font-display font-bold text-[14px] mb-4">Closed-Won by Month · {year}</div>
          <MonthlyTrendChart data={trend} />
        </div>

        {/* Pipeline composition */}
        <div className="grid grid-cols-2 gap-6 mb-6">
          <Breakdown title="Open Pipeline by Stage" items={stageBreakdown} empty="No open pipeline yet." />
          <Breakdown title="Open Pipeline by Type of Deal" items={typeBreakdown} empty="No open pipeline yet." />
        </div>
        <div className="grid grid-cols-2 gap-6 mb-6">
          <Breakdown title="Open Pipeline by Source" items={sourceBreakdown} empty="No source data yet." />
          <Breakdown title={`Lost Reasons · ${year}`} items={reasonBreakdown} empty="No lost deals recorded this year." />
        </div>

        {/* Top open deals */}
        <div className="mb-6">
          <DealsList
            title="Top Open Deals by Value (USD)"
            deals={topOpenDeals}
            dateLabel="Expected Close"
            getDate={o => o.expectedClose}
            empty="No open deals in this territory."
          />
        </div>

        {/* Historical reporting: everything already closed */}
        <DealsList
          title="Historical — Closed Deals"
          deals={closedHistory}
          dateLabel="Closed On"
          getDate={o => o.actualClose}
          showOutcome
          empty="No closed deals recorded yet."
          scroll
        />
      </div>
    </>
  );
}
