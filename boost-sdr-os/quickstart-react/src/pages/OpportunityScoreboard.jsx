import React, { useEffect, useState, useMemo } from 'react';
import { fetchOpportunities, fetchBoardColumns, fetchWorkspaceUsers, BOARDS } from '../api/monday';
import ProgressBar from '../components/shared/ProgressBar';
import OpportunityDetailPanel from '../components/opportunities/OpportunityDetailPanel';
import {
  parseOpportunity, quarterOf, quarterLabel, inQuarter, inYear,
  groupBy, monthlyTrend, periodStats, sumUSDBySide, formatMoney, formatByCurrency,
  planningBuckets, historicalClosed,
  DEFAULT_DEAL_FILTERS, hasActiveDealFilters, distinctValues, filterOpps,
} from '../utils/opportunityMetrics';

const PALETTE = ['#192D3F', '#8DC63A', '#E29A2E', '#579bfc', '#9d50dd', '#E0544A', '#4eccc6', '#254154', '#df2f4a', '#00c875'];
const colorFor = i => PALETTE[i % PALETTE.length];

// Stub item for the "Add Opportunity" modal — no id yet, no column values.
const BLANK_OPPORTUNITY = { id: null, name: '', column_values: [] };

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

// Total current pipeline — ARR and PS shown separately (different source fields,
// different currencies pre-conversion). Always every open deal, regardless of
// Expected Close Date / quarter / year — this banner is never timing-scoped.
function TotalPipelineBanner({ split, totalCount, missingCloseDateCount }) {
  return (
    <div className="rounded-2xl bg-gradient-to-br from-teal to-teal-mid text-white p-6 mb-6 shadow-sm">
      <div className="flex items-center justify-between flex-wrap gap-6">
        <div className="flex flex-wrap gap-10">
          <div>
            <div className="text-white/70 text-[11px] font-semibold uppercase tracking-wide mb-1.5">
              Total Open Pipeline — ARR + CS (USD)
            </div>
            <div className="font-display font-bold text-[32px] leading-none">
              {formatMoney(split.arr, 'USD') ?? '$0'}
            </div>
            <div className="text-white/75 text-[12.5px] mt-1.5">{split.arrCount} open opportunit{split.arrCount === 1 ? 'y' : 'ies'}</div>
          </div>
          <div>
            <div className="text-white/70 text-[11px] font-semibold uppercase tracking-wide mb-1.5">
              Total Open Pipeline — Professional Services (USD)
            </div>
            <div className="font-display font-bold text-[32px] leading-none">
              {formatMoney(split.ps, 'USD') ?? '$0'}
            </div>
            <div className="text-white/75 text-[12.5px] mt-1.5">{split.psCount} open opportunit{split.psCount === 1 ? 'y' : 'ies'}</div>
          </div>
        </div>
        <div className="text-white/75 text-[13px] max-w-[240px] text-right">
          {totalCount} open opportunit{totalCount === 1 ? 'y' : 'ies'} total — every deal not yet Won or Lost, regardless of timing.
          {missingCloseDateCount > 0 && (
            <div className="text-white/60 text-[11.5px] mt-1.5">
              {missingCloseDateCount} have no Expected Close Date, so they're excluded from the quarter/year cards below.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// One side (ARR or PS) of a period card's stats.
function SideStats({ label, badgeColor, stats }) {
  const winRateText = stats.winRate === null ? '—' : `${stats.winRate.toFixed(0)}%`;
  return (
    <div>
      <span
        className="inline-flex items-center text-[10.5px] font-bold uppercase tracking-wider text-white px-2 py-0.5 rounded-full mb-3"
        style={{ background: badgeColor }}
      >
        {label}
      </span>
      <div className="grid grid-cols-2 gap-x-4 gap-y-4">
        <MiniStat
          label="Expected to Close (weighted)"
          value={formatMoney(stats.weightedOpenValueUSD, 'USD') ?? '$0'}
          sub={`${stats.openCount} open · win-probability weighted`}
        />
        <MiniStat
          label="Win Rate"
          value={winRateText}
          sub={stats.closedTotal > 0 ? `${stats.wonCount} won · ${stats.lostCount} lost` : 'No closed deals yet'}
        />
        <MiniStat
          label="Closed-Won Value"
          value={formatMoney(stats.wonValueUSD, 'USD') ?? '$0'}
          sub={`${stats.wonCount} deal${stats.wonCount === 1 ? '' : 's'} won`}
        />
        <MiniStat
          label="Avg Deal Size"
          value={formatMoney(stats.avgDealSizeUSD, 'USD') ?? '$0'}
          sub="per won deal"
        />
      </div>
    </div>
  );
}

function PeriodCard({ title, stats }) {
  return (
    <div className="bg-card border border-line rounded-2xl p-6">
      <div className="font-display font-bold text-[16px] mb-5">{title}</div>
      <div className="grid grid-cols-2 gap-6">
        <SideStats label="ARR + CS" badgeColor="#579bfc" stats={stats.arr} />
        <SideStats label="Professional Services" badgeColor="#9d50dd" stats={stats.ps} />
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

function selectCls(active) {
  return `border rounded-lg pl-2.5 pr-1.5 py-1.5 text-[12.5px] bg-white focus:outline-none focus:ring-1 focus:ring-teal focus:border-teal transition-colors ${
    active ? 'border-teal text-ink font-medium' : 'border-line text-muted'
  }`;
}

// Filters the Pipeline Planning / Top Open Deals / Historical tables below —
// the summary banners, period cards, breakdowns, and monthly trend chart
// above stay unfiltered so they always reflect the full pipeline.
function FilterBar({ filters, setFilters, options }) {
  const active = hasActiveDealFilters(filters);
  const set = (key, value) => setFilters(prev => ({ ...prev, [key]: value }));
  return (
    <div className="bg-card border border-line rounded-2xl px-4 py-3 mb-6 flex items-center gap-2.5 flex-wrap">
      <span className="text-[11px] font-bold uppercase tracking-wider text-muted mr-1">Filter tables</span>

      <input
        type="text"
        placeholder="Search deal name…"
        value={filters.text}
        onChange={e => set('text', e.target.value)}
        className={`${selectCls(!!filters.text)} w-40`}
      />

      <select className={selectCls(filters.typeOfDeal !== 'All')} value={filters.typeOfDeal} onChange={e => set('typeOfDeal', e.target.value)}>
        <option value="All">Deal type: All</option>
        {options.typeOfDeal.map(v => <option key={v} value={v}>{v}</option>)}
      </select>

      <select className={selectCls(filters.arrSourceType !== 'All')} value={filters.arrSourceType} onChange={e => set('arrSourceType', e.target.value)}>
        <option value="All">Source type: All</option>
        {options.arrSourceType.map(v => <option key={v} value={v}>{v}</option>)}
      </select>

      <select className={selectCls(filters.sdr !== 'All')} value={filters.sdr} onChange={e => set('sdr', e.target.value)}>
        <option value="All">SDR: All</option>
        {options.sdr.map(v => <option key={v} value={v}>{v}</option>)}
      </select>

      <select className={selectCls(filters.bizDev !== 'All')} value={filters.bizDev} onChange={e => set('bizDev', e.target.value)}>
        <option value="All">BizDev: All</option>
        {options.bizDev.map(v => <option key={v} value={v}>{v}</option>)}
      </select>

      <div className="flex items-center gap-1.5">
        <span className="text-[11.5px] text-muted">Close date</span>
        <input type="date" className={selectCls(!!filters.closeFrom)} value={filters.closeFrom} onChange={e => set('closeFrom', e.target.value)} />
        <span className="text-muted text-[11.5px]">–</span>
        <input type="date" className={selectCls(!!filters.closeTo)} value={filters.closeTo} onChange={e => set('closeTo', e.target.value)} />
      </div>

      {active && (
        <button
          onClick={() => setFilters(DEFAULT_DEAL_FILTERS)}
          className="ml-auto text-[12px] font-semibold text-teal hover:text-teal-mid transition-colors"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}

// Generic deals table used for the quarter/year/unscheduled pipeline-planning
// lists, the historical closed report, and the top-open-deals list. Value is
// always shown blended into USD — PS deals show "Pending FX rate" instead of
// $0 so a deal awaiting its FX Calculator conversion doesn't read as worthless.
// Rows are clickable — click opens the shared OpportunityDetailPanel, same
// editing behaviour the old standalone Pipeline Board had.
function DealsList({ title, deals, dateLabel, getDate, showOutcome, showWinProb, empty, scroll, selectedId, onSelect }) {
  const subtotal = useMemo(() => sumUSDBySide(deals), [deals]);
  return (
    <div className="bg-card border border-line rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-line flex items-center justify-between flex-wrap gap-2">
        <span className="font-display font-bold text-[14px]">{title}</span>
        <div className="flex items-center gap-3 text-[12px] text-muted">
          {subtotal.arrCount > 0 && <span>ARR: <span className="font-semibold text-ink">{formatMoney(subtotal.arr, 'USD') ?? '$0'}</span></span>}
          {subtotal.psCount > 0 && <span>PS: <span className="font-semibold text-ink">{formatMoney(subtotal.ps, 'USD') ?? '$0'}</span></span>}
          <span>{deals.length} deal{deals.length !== 1 ? 's' : ''}</span>
        </div>
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
                <th className="text-left px-3 py-2.5 font-semibold text-muted">BizDev</th>
                {showWinProb && <th className="text-right px-3 py-2.5 font-semibold text-muted">Win %</th>}
                <th className="text-left px-3 py-2.5 font-semibold text-muted">{dateLabel}</th>
                <th className="text-right px-5 py-2.5 font-semibold text-muted">Value (USD)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {deals.map(o => (
                <tr
                  key={o.id}
                  onClick={() => onSelect?.(o.id)}
                  className={`transition-colors ${onSelect ? 'cursor-pointer' : ''} ${selectedId === o.id ? 'bg-mint-soft/40' : 'hover:bg-[#FAF8F5]'}`}
                >
                  <td className="px-5 py-3 font-semibold text-ink">
                    <span className="inline-flex items-center gap-1.5">
                      {o.isOpen && o.missingEssentials && (
                        <span
                          title={`Missing: ${o.missingFields.join(', ')}`}
                          className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-amber text-white text-[10px] font-bold flex-shrink-0"
                        >
                          !
                        </span>
                      )}
                      {o.name}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    {showOutcome
                      ? <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full text-white ${o.isWon ? 'bg-mint-deep' : 'bg-red'}`}>{o.stage}</span>
                      : <span className="text-muted">{o.stage}</span>
                    }
                  </td>
                  <td className="px-3 py-3 text-muted">{o.typeOfDeal}</td>
                  <td className="px-3 py-3 text-muted truncate max-w-[120px]">{o.bizDev}</td>
                  {showWinProb && (
                    <td className="px-3 py-3 text-right tabular-nums text-muted">{o.winProbability > 0 ? `${o.winProbability}%` : '—'}</td>
                  )}
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

export default function OpportunityScoreboard({ region, user }) {
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [rawOpps, setRawOpps] = useState([]);
  const [wsUsers, setWsUsers] = useState([]);
  const [boardCols, setBoardCols] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [filters, setFilters] = useState(DEFAULT_DEAL_FILTERS);

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([fetchOpportunities({ region }), fetchBoardColumns(BOARDS.OPPORTUNITIES), fetchWorkspaceUsers()])
      .then(([o, cols, u]) => { setRawOpps(o); setBoardCols(cols); setWsUsers(u); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [region]);

  const accountSlug = user?.account?.slug ?? '';

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

  // Total open pipeline — every open deal, no timing filter. Split ARR vs PS.
  const openOpps = useMemo(() => opps.filter(o => o.isOpen), [opps]);
  const openSplit = useMemo(() => sumUSDBySide(openOpps), [openOpps]);
  const missingCloseDateCount = useMemo(() => openOpps.filter(o => !o.expectedClose).length, [openOpps]);
  const stageBreakdown  = useMemo(() => groupBy(openOpps, o => o.stage), [openOpps]);
  const typeBreakdown   = useMemo(() => groupBy(openOpps, o => o.typeOfDeal), [openOpps]);
  const sourceBreakdown = useMemo(() => groupBy(openOpps, o => o.source).slice(0, 8), [openOpps]);

  const lostThisYear = useMemo(() => opps.filter(o => o.isLost && inYear(o.actualClose, year)), [opps, year]);
  const reasonBreakdown = useMemo(() => groupBy(lostThisYear, o => o.reasonLost || 'Not recorded'), [lostThisYear]);

  // Deal-table filters (type of deal, ARR source type, SDR, BizDev, close date) — only
  // scoped to the Pipeline Planning / Top Open Deals / Historical tables below, not the
  // banners/breakdowns/trend chart above, so those always show the full pipeline.
  const filterOptions = useMemo(() => ({
    typeOfDeal:    distinctValues(opps, o => o.typeOfDeal),
    arrSourceType: distinctValues(opps, o => o.arrSourceType),
    sdr:           distinctValues(opps, o => o.sdr),
    bizDev:        distinctValues(opps, o => o.bizDev),
  }), [opps]);

  const filtersActive = hasActiveDealFilters(filters);
  const filteredOpenOpps = useMemo(() => filterOpps(openOpps, filters, 'expectedClose'), [openOpps, filters]);
  const topOpenDeals = useMemo(() => [...filteredOpenOpps].sort((a, b) => b.valueUSD - a.valueUSD).slice(0, 10), [filteredOpenOpps]);

  // Pipeline planning: sort open opportunities into this quarter / later this year / unscheduled.
  const buckets = useMemo(
    () => planningBuckets(filterOpps(opps, filters, 'expectedClose'), year, quarter),
    [opps, filters, year, quarter]
  );
  // Historical reporting: everything already closed (Won or Lost), most recent first.
  const closedHistory = useMemo(
    () => historicalClosed(filterOpps(opps, filters, 'actualClose')).slice(0, 25),
    [opps, filters]
  );

  const selectedRawItem = useMemo(
    () => (selectedId ? rawOpps.find(o => o.id === selectedId) : null),
    [rawOpps, selectedId]
  );

  function handleUpdate(itemId, updatedCvs, updatedName) {
    setRawOpps(prev => prev.map(o => (o.id === itemId
      ? { ...o, column_values: updatedCvs, ...(updatedName !== undefined ? { name: updatedName } : {}) }
      : o)));
  }

  function handleCreate(created) {
    setRawOpps(prev => [created, ...prev]);
    setShowCreate(false);
  }

  function openCreate() {
    setSelectedId(null);
    setShowCreate(true);
  }

  function selectDeal(id) {
    setShowCreate(false);
    setSelectedId(id);
  }

  if (error) return (
    <div className="max-w-6xl mx-auto px-7 py-10 text-red">Failed to load opportunities: {error}</div>
  );

  return (
    <>
      <ProgressBar loading={loading} />

      <div className="max-w-6xl mx-auto px-7 py-8 pb-20">

        {/* Header */}
        <div className="mb-7 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="font-display text-[11px] font-semibold tracking-[.14em] uppercase text-mint-deep mb-1.5">
              Pipeline
            </p>
            <h1 className="font-display text-[27px] font-bold tracking-tight mb-1">Opportunities</h1>
            <p className="text-muted text-[15px] max-w-xl">
              {region && region !== 'All' ? `${region} territory` : 'All territories'} · live from monday.com
            </p>
          </div>
          <button
            onClick={openCreate}
            className="flex-shrink-0 inline-flex items-center gap-1.5 font-display font-semibold text-[13.5px] px-4 py-2.5 rounded-xl bg-teal text-white hover:bg-teal-mid transition-colors"
          >
            + Add Opportunity
          </button>
        </div>

        {/* Total current pipeline — every open deal, no timing filter, split ARR vs PS */}
        <TotalPipelineBanner
          split={openSplit}
          totalCount={openOpps.length}
          missingCloseDateCount={missingCloseDateCount}
        />

        {/* Quarter & Year period cards — timing view, based on Expected Close Date */}
        <div className="grid grid-cols-2 gap-6 mb-6">
          <PeriodCard title={`This Quarter · ${quarterLabel(year, quarter)}`} stats={quarterStats} />
          <PeriodCard title={`This Year · ${year}`} stats={yearStats} />
        </div>

        {/* Filters — applies to Pipeline Planning, Top Open Deals, and Historical below only */}
        <FilterBar filters={filters} setFilters={setFilters} options={filterOptions} />

        {/* Pipeline planning: sort open opportunities into quarter / year / unscheduled — interactive, click a row to edit */}
        <div className="mb-6">
          <p className="font-display font-bold text-[16px] mb-3">Pipeline Planning</p>
          <div className="space-y-4">
            <DealsList
              title={`Closing This Quarter · ${quarterLabel(year, quarter)}`}
              deals={buckets.thisQuarter}
              dateLabel="Expected Close"
              getDate={o => o.expectedClose}
              empty={filtersActive ? 'No open deals match these filters, closing this quarter.' : 'No open deals expected to close this quarter.'}
              showWinProb
              scroll
              selectedId={selectedId}
              onSelect={selectDeal}
            />
            <DealsList
              title={`Closing Later This Year · ${year}`}
              deals={buckets.laterThisYear}
              dateLabel="Expected Close"
              getDate={o => o.expectedClose}
              empty={filtersActive ? 'No open deals match these filters, closing later this year.' : 'No open deals expected to close later this year.'}
              showWinProb
              scroll
              selectedId={selectedId}
              onSelect={selectDeal}
            />
            <DealsList
              title="Unscheduled (No Expected Close Date)"
              deals={buckets.unscheduled}
              dateLabel="Created"
              getDate={o => o.created}
              empty={filtersActive ? 'No unscheduled open deals match these filters.' : 'Every open deal has an Expected Close Date set. Nice.'}
              showWinProb
              scroll
              selectedId={selectedId}
              onSelect={selectDeal}
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
            empty={filtersActive ? 'No open deals match these filters.' : 'No open deals in this territory.'}
            showWinProb
            selectedId={selectedId}
            onSelect={selectDeal}
          />
        </div>

        {/* Historical reporting: everything already closed */}
        <DealsList
          title="Historical — Closed Deals"
          deals={closedHistory}
          dateLabel="Closed On"
          getDate={o => o.actualClose}
          showOutcome
          empty={filtersActive ? 'No closed deals match these filters.' : 'No closed deals recorded yet.'}
          scroll
          selectedId={selectedId}
          onSelect={selectDeal}
        />
      </div>

      {/* Slide-over edit panel — same editing behaviour the standalone Pipeline Board had */}
      {selectedRawItem && (
        <div className="fixed inset-0 z-40 flex justify-end">
          <div className="absolute inset-0 bg-black/30" onClick={() => setSelectedId(null)} />
          <div className="relative w-full sm:w-[460px] h-full bg-white shadow-2xl overflow-hidden">
            <OpportunityDetailPanel
              item={selectedRawItem}
              boardCols={boardCols}
              wsUsers={wsUsers}
              accountSlug={accountSlug}
              onClose={() => setSelectedId(null)}
              onUpdate={handleUpdate}
            />
          </div>
        </div>
      )}

      {/* Add Opportunity — same fields as the edit panel, in create mode */}
      {showCreate && (
        <div className="fixed inset-0 z-40 flex justify-end">
          <div className="absolute inset-0 bg-black/30" onClick={() => setShowCreate(false)} />
          <div className="relative w-full sm:w-[460px] h-full bg-white shadow-2xl overflow-hidden">
            <OpportunityDetailPanel
              item={BLANK_OPPORTUNITY}
              isNew
              boardCols={boardCols}
              wsUsers={wsUsers}
              accountSlug={accountSlug}
              onClose={() => setShowCreate(false)}
              onCreate={handleCreate}
            />
          </div>
        </div>
      )}
    </>
  );
}
