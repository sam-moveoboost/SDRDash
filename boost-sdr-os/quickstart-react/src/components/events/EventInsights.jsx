import React, { useMemo, useState } from 'react';
import { formatMoney } from '../../utils/opportunityMetrics';
import { wonValue, openValue } from '../../utils/eventMetrics';
import { setLeadEvent, addOpportunityEvent } from '../../api/monday';
import { EventTag, formatEventDate } from './EventPicker';

const TYPE_COLORS = {
  'All Day Conference':   '#579bfc',
  'Short Conference':     '#037f4c',
  'In Person Networking': '#df2f4a',
  'Online Networking':    '#cab641',
  'Other':                '#7f5347',
  'Stand':                '#027361',
  'Attended':             '#2c5180',
};

const usd = v => formatMoney(v, 'USD') ?? '$0';
const gbp = v => formatMoney(v, 'GBP') ?? '£0';

// Breakdown metric toggle
const METRICS = [
  { id: 'leads', label: 'Leads',     get: g => g.leads,       fmt: v => v },
  { id: 'opps',  label: 'Opps',      get: g => g.opps,        fmt: v => v },
  { id: 'won',   label: 'Won value', get: g => wonValue(g),   fmt: v => usd(v) },
];

// ── Sub-components ────────────────────────────────────────────────

function StatCard({ label, value, sub, highlight }) {
  return (
    <div className="bg-card border border-line rounded-2xl p-5">
      <div className="text-muted text-[11px] font-semibold uppercase tracking-wide mb-2">{label}</div>
      <div className={`font-display font-semibold text-[28px] leading-none ${highlight ? 'text-navy' : 'text-ink'}`}>{value}</div>
      {sub && <div className="text-muted text-[12px] mt-1.5">{sub}</div>}
    </div>
  );
}

function HBar({ label, value, display, events: evtCount, max, color }) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-3">
      <div className="w-40 text-[12.5px] font-medium text-ink truncate flex-shrink-0" title={label}>{label || '—'}</div>
      <div className="flex-1 h-[18px] bg-line rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="text-[12px] font-bold w-20 text-right text-ink tabular-nums flex-shrink-0">{display}</span>
      <span className="text-muted text-[11px] w-16 text-right flex-shrink-0 tabular-nums">
        {evtCount} event{evtCount !== 1 ? 's' : ''}
      </span>
    </div>
  );
}

function Card({ title, sub, right, children, flush }) {
  return (
    <div className="bg-card border border-line rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-line flex items-start justify-between gap-4">
        <div>
          <div className="font-heading font-bold text-[14px]">{title}</div>
          {sub && <div className="text-muted text-[12px] mt-0.5">{sub}</div>}
        </div>
        {right}
      </div>
      <div className={flush ? '' : 'p-5'}>{children}</div>
    </div>
  );
}

function Breakdown({ title, rows, metric, colorFor }) {
  const sorted = [...rows].sort((a, b) => metric.get(b[1]) - metric.get(a[1]));
  const max = sorted.length ? metric.get(sorted[0][1]) : 0;
  return (
    <div className="bg-card border border-line rounded-2xl p-5">
      <div className="font-heading font-bold text-[14px] mb-4">{title}</div>
      <div className="space-y-3">
        {sorted.length === 0
          ? <p className="text-muted text-[13px]">No data yet.</p>
          : sorted.map(([key, g]) => (
              <HBar key={key} label={key} value={metric.get(g)} display={metric.fmt(metric.get(g))} events={g.events} max={max} color={colorFor(key)} />
            ))}
      </div>
    </div>
  );
}

// Inline "link to event" control for the data-quality lists
function LinkToEvent({ events, onLink }) {
  const [eventId, setEventId] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex items-center gap-1.5 flex-shrink-0">
      <select
        value={eventId}
        onChange={e => setEventId(e.target.value)}
        className="max-w-[200px] px-2 py-1 bg-canvas border border-line rounded-lg text-[12px] outline-none focus:border-navy cursor-pointer"
      >
        <option value="">Choose event…</option>
        {events.map(e => <option key={e.id} value={e.id}>{e.name} · {formatEventDate(e.startDate)}</option>)}
      </select>
      <button
        disabled={!eventId || busy}
        onClick={async () => { setBusy(true); try { await onLink(eventId); } finally { setBusy(false); } }}
        className="px-2.5 py-1 rounded-full text-[11.5px] font-semibold bg-navy text-white hover:bg-navy-700 disabled:opacity-40"
      >
        {busy ? '…' : 'Link'}
      </button>
    </div>
  );
}

const TABLE_COLS = [
  { id: 'name',      label: 'Event',      align: 'left',  sort: r => r.event.startDate ?? '' },
  { id: 'leads',     label: 'Leads',      align: 'right', sort: r => r.totals.leads },
  { id: 'qualified', label: 'Qual.',      align: 'right', sort: r => r.totals.qualified },
  { id: 'opps',      label: 'Opps',       align: 'right', sort: r => r.totals.opps },
  { id: 'won',       label: 'Won',        align: 'right', sort: r => r.totals.wonOpps },
  { id: 'wonARR',    label: 'Won ARR',    align: 'right', sort: r => r.totals.wonARR },
  { id: 'wonPS',     label: 'Won PS',     align: 'right', sort: r => r.totals.wonPS },
  { id: 'pipeline',  label: 'Pipeline',   align: 'right', sort: r => openValue(r.totals) },
  { id: 'spend',     label: 'Spend',      align: 'right', sort: r => r.spend ?? -1 },
  { id: 'cpl',       label: '£ / lead',   align: 'right', sort: r => r.costPerLead ?? Infinity },
  { id: 'roi',       label: 'ROI',        align: 'right', sort: r => r.roi ?? -1 },
];

// ── Main component ────────────────────────────────────────────────

export default function EventInsights({ report, userMap, year, onOpenEvent, onChanged }) {
  const [metricId, setMetricId] = useState('opps');
  const [sort, setSort]         = useState({ id: 'name', dir: -1 });
  const [syncing, setSyncing]   = useState(false);
  const [syncMsg, setSyncMsg]   = useState('');
  const [showSyncList, setShowSyncList] = useState(false);
  const metric = METRICS.find(m => m.id === metricId);

  const { totals, yearRows, spend, spendEvents, happenedCount, fx, dataQuality: dq } = report;

  // Events worth listing: ones that happened, or anything with results already
  const tableRows = useMemo(() => {
    const col = TABLE_COLS.find(c => c.id === sort.id);
    return yearRows
      .filter(r => r.happened || r.totals.leads || r.totals.opps)
      .sort((a, b) => {
        const va = col.sort(a), vb = col.sort(b);
        return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir;
      });
  }, [yearRows, sort]);

  // Events offered in the data-quality "link" pickers — ones that happened, most recent first
  const linkableEvents = useMemo(
    () => yearRows.filter(r => r.happened).map(r => r.event).sort((a, b) => (b.startDate ?? '').localeCompare(a.startDate ?? '')),
    [yearRows],
  );

  const byPerson = [...report.byPerson]
    .filter(([, p]) => p.leads || p.opps)
    .sort((a, b) => wonValue(b[1]) - wonValue(a[1]) || b[1].opps - a[1].opps || b[1].leads - a[1].leads);
  const maxPerson = byPerson.length ? Math.max(...byPerson.map(([, p]) => p.opps || p.leads)) : 0;

  const totalSpendUSD = spend * fx.rate;
  const overallROI = totalSpendUSD > 0 ? wonValue(totals) / totalSpendUSD : null;

  async function runSync() {
    setSyncing(true);
    setSyncMsg('');
    let linked = 0;
    try {
      for (const s of dq.toSync) {
        if (await addOpportunityEvent(s.oppId, s.eventId)) linked++;
      }
      setSyncMsg(`${linked} opportunit${linked === 1 ? 'y' : 'ies'} linked to their lead's event`);
      await onChanged();
    } catch (e) {
      setSyncMsg(`Error after ${linked} linked: ${e.message}`);
    } finally {
      setSyncing(false);
    }
  }

  const colorFor = key => TYPE_COLORS[key] ?? '#757c77';
  const dqCount = dq.toSync.length + dq.happenedNoLeads.length + dq.missingSpend.length + dq.unlinkedLeads.length + dq.unlinkedOpps.length;

  return (
    <div className="space-y-6">

      {/* ── Headline tiles ───────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard
          label="Event leads"
          value={totals.leads}
          sub={`${totals.qualified} qualified · ${totals.inPerson} met in person · ${totals.outreach} outreach`}
          highlight
        />
        <StatCard
          label="Opportunities"
          value={totals.opps}
          sub={`${totals.openOpps} open · ${totals.wonOpps} won · ${totals.lostOpps} lost`}
          highlight
        />
        <StatCard
          label="Open pipeline"
          value={usd(openValue(totals))}
          sub={`${usd(totals.openARR)} ARR · ${usd(totals.openPS)} PS`}
        />
        <StatCard label="Won ARR" value={usd(totals.wonARR)} sub={`${totals.wonOpps} won deal${totals.wonOpps !== 1 ? 's' : ''}`} />
        <StatCard label="Won PS" value={usd(totals.wonPS)} sub="USD, after FX" />
        <StatCard
          label="Actual spend"
          value={spendEvents ? gbp(spend) : '—'}
          sub={spendEvents
            ? `${totals.opps ? `${gbp(spend / totals.opps)} per opp · ` : ''}${overallROI !== null ? `${overallROI.toFixed(1)}× ROI` : 'no won value yet'}`
            : `Add Actual Spend to the ${happenedCount} event${happenedCount !== 1 ? 's' : ''} attended`}
        />
      </div>

      {/* ── Results by event ─────────────────────────────────── */}
      <Card
        title="Results by event"
        sub="Events attended this year, plus any event with leads or opportunities linked. Click a row for details."
        flush
      >
        {tableRows.length === 0 ? (
          <div className="p-8 text-center text-muted text-[13px]">No attended events or linked leads for {year} yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-line bg-sunken">
                  {TABLE_COLS.map(c => (
                    <th
                      key={c.id}
                      onClick={() => setSort(s => ({ id: c.id, dir: s.id === c.id ? -s.dir : -1 }))}
                      className={`px-3 first:pl-5 last:pr-5 py-2.5 font-semibold text-muted cursor-pointer select-none hover:text-ink whitespace-nowrap ${c.align === 'right' ? 'text-right' : 'text-left'}`}
                    >
                      {c.label}{sort.id === c.id ? (sort.dir < 0 ? ' ↓' : ' ↑') : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {tableRows.map(r => (
                  <tr key={r.event.id} onClick={() => onOpenEvent(r.event.id, 'results')} className="hover:bg-sunken transition-colors cursor-pointer">
                    <td className="pl-5 pr-3 py-3">
                      <div className="font-semibold text-ink">{r.event.name}</div>
                      <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-muted">
                        {formatEventDate(r.event.startDate)} <EventTag event={r.event} />
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums font-semibold">{r.totals.leads}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{r.totals.qualified}</td>
                    <td className="px-3 py-3 text-right tabular-nums font-semibold">{r.totals.opps}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{r.totals.wonOpps}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{r.totals.wonARR ? usd(r.totals.wonARR) : '—'}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{r.totals.wonPS ? usd(r.totals.wonPS) : '—'}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{openValue(r.totals) ? usd(openValue(r.totals)) : '—'}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{r.spend !== null ? gbp(r.spend) : <span className="text-muted">—</span>}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{r.costPerLead ? gbp(r.costPerLead) : '—'}</td>
                    <td className="pl-3 pr-5 py-3 text-right tabular-nums font-semibold">{r.roi !== null ? `${r.roi.toFixed(1)}×` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="px-5 py-3 border-t border-line bg-sunken text-[11px] text-muted">
          Opportunities count if linked to the event directly or converted from one of its leads. Values in USD; spend in £, converted at £1 = ${fx.rate.toFixed(2)}{fx.estimated ? ' (estimated)' : ' (from the Opportunities board FX rate)'} for ROI.
        </div>
      </Card>

      {/* ── Breakdowns ───────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="text-[12px] font-semibold uppercase tracking-wide text-muted">What works best</div>
          <div className="flex bg-card border border-line rounded-full p-0.5">
            {METRICS.map(m => (
              <button
                key={m.id}
                onClick={() => setMetricId(m.id)}
                className={`px-3 py-1 rounded-full text-[12px] font-semibold transition-colors ${metricId === m.id ? 'bg-navy text-white' : 'text-muted hover:text-ink'}`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-6">
          <Breakdown title="Stand vs attended" rows={report.byFormat} metric={metric} colorFor={colorFor} />
          <Breakdown title="By event type" rows={report.byType} metric={metric} colorFor={colorFor} />
          <Breakdown title="National vs local" rows={report.byScale} metric={metric} colorFor={() => '#027361'} />
          <Breakdown title="By sector" rows={report.bySector} metric={metric} colorFor={() => '#916aff'} />
        </div>
      </div>

      {/* ── Attendee credit ──────────────────────────────────── */}
      {byPerson.length > 0 && (
        <Card title="Results by attendee" sub="Everyone at an event shares credit for its leads, opportunities and won value" flush>
          <div className="divide-y divide-line">
            {byPerson.slice(0, 12).map(([id, p], i) => {
              const u = userMap[id];
              const name = u?.name ?? `User ${id}`;
              const pct = maxPerson > 0 ? Math.round(((p.opps || p.leads) / maxPerson) * 100) : 0;
              return (
                <div key={id} className="px-5 py-3.5 flex items-center gap-4">
                  <span className="w-5 text-[12px] font-bold text-muted flex-shrink-0">{i + 1}</span>
                  {u?.photo_thumb
                    ? <img src={u.photo_thumb} alt={name} className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
                    : <div className="w-8 h-8 rounded-full bg-navy text-white grid place-items-center font-bold text-[11px] flex-shrink-0">
                        {name.split(' ').map(n => n[0]).slice(0, 2).join('')}
                      </div>}
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-baseline mb-1.5">
                      <span className="font-semibold text-[13px]">{name}</span>
                      <span className="text-[12px] text-muted">{p.events} event{p.events !== 1 ? 's' : ''} · {p.leads} leads · {p.opps} opps</span>
                    </div>
                    <div className="h-1.5 bg-line rounded-full overflow-hidden">
                      <div className="h-full bg-navy rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0 ml-3 w-24">
                    <div className="font-heading font-bold text-[16px] leading-none text-navy">{usd(wonValue(p))}</div>
                    <div className="text-muted text-[10.5px] mt-0.5">won</div>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* ── Data quality ─────────────────────────────────────── */}
      <Card
        title={`Data to tidy up${dqCount ? ` · ${dqCount}` : ''}`}
        sub="Gaps that make the numbers above under-count"
        flush
      >
        {dqCount === 0 && <div className="p-6 text-center text-muted text-[13px]">Nothing to tidy up. Every event lead is linked.</div>}

        {dq.toSync.length > 0 && (
          <div className="px-5 py-4 border-b border-line">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-[13px] font-semibold text-ink">{dq.toSync.length} opportunit{dq.toSync.length === 1 ? 'y is' : 'ies are'} linked to an event only through their lead</p>
                <p className="text-[12px] text-muted">They already count here. Syncing writes the event onto the opportunity so monday's own views and filters match.</p>
                <button onClick={() => setShowSyncList(s => !s)} className="text-[12px] font-semibold text-navy mt-1">{showSyncList ? 'Hide' : 'Preview'} list</button>
              </div>
              <button
                onClick={runSync}
                disabled={syncing}
                className="px-4 py-2 rounded-full text-[12.5px] font-semibold bg-navy text-white hover:bg-navy-700 disabled:opacity-60 whitespace-nowrap"
              >
                {syncing ? 'Syncing…' : 'Sync event links'}
              </button>
            </div>
            {showSyncList && (
              <ul className="mt-3 space-y-1 text-[12px] text-body">
                {dq.toSync.map(s => <li key={`${s.oppId}-${s.eventId}`}>{s.oppName} → {s.eventName} <span className="text-muted">(via {s.leadName})</span></li>)}
              </ul>
            )}
          </div>
        )}
        {syncMsg && <p className={`px-5 py-2 text-[12px] font-semibold ${syncMsg.startsWith('Error') ? 'text-red' : 'text-emerald'}`}>{syncMsg}</p>}

        {dq.unlinkedLeads.length > 0 && (
          <div className="px-5 py-4 border-b border-line">
            <p className="text-[13px] font-semibold text-ink">{dq.unlinkedLeads.length} UK lead{dq.unlinkedLeads.length !== 1 ? 's' : ''} with Source “Events/Conferences” but no event</p>
            <p className="text-[12px] text-muted mb-2.5">Created in {year}. Pick the event to credit it.</p>
            <div className="divide-y divide-line border border-line rounded-xl overflow-hidden">
              {dq.unlinkedLeads.map(l => (
                <div key={l.id} className="px-3 py-2 flex items-center gap-3 bg-white">
                  <div className="min-w-0 flex-1">
                    <p className="text-[12.5px] font-semibold text-ink truncate">{l.name}</p>
                    <p className="text-[11px] text-muted truncate">{[l.company, l.conversion, l.status].filter(Boolean).join(' · ')}</p>
                  </div>
                  <LinkToEvent events={linkableEvents} onLink={async id => { await setLeadEvent(l.id, id, l.oppIds); await onChanged(); }} />
                </div>
              ))}
            </div>
          </div>
        )}

        {dq.unlinkedOpps.length > 0 && (
          <div className="px-5 py-4 border-b border-line">
            <p className="text-[13px] font-semibold text-ink">{dq.unlinkedOpps.length} UK opportunit{dq.unlinkedOpps.length !== 1 ? 'ies' : 'y'} with Source “Events/Conferences” but no event</p>
            <p className="text-[12px] text-muted mb-2.5">Created in {year}. Linking the lead instead is better where there is one.</p>
            <div className="divide-y divide-line border border-line rounded-xl overflow-hidden">
              {dq.unlinkedOpps.map(o => (
                <div key={o.id} className="px-3 py-2 flex items-center gap-3 bg-white">
                  <div className="min-w-0 flex-1">
                    <p className="text-[12.5px] font-semibold text-ink truncate">{o.name}</p>
                    <p className="text-[11px] text-muted truncate">{o.stage}</p>
                  </div>
                  <LinkToEvent events={linkableEvents} onLink={async id => { await addOpportunityEvent(o.id, id); await onChanged(); }} />
                </div>
              ))}
            </div>
          </div>
        )}

        {dq.happenedNoLeads.length > 0 && (
          <div className="px-5 py-4 border-b border-line">
            <p className="text-[13px] font-semibold text-ink">{dq.happenedNoLeads.length} attended event{dq.happenedNoLeads.length !== 1 ? 's' : ''} with no leads logged</p>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {dq.happenedNoLeads.map(r => (
                <button key={r.event.id} onClick={() => onOpenEvent(r.event.id, 'leads')} className="px-2.5 py-1 rounded-full text-[12px] font-semibold bg-canvas border border-line hover:border-navy hover:text-navy">
                  {r.event.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {dq.missingSpend.length > 0 && (
          <div className="px-5 py-4">
            <p className="text-[13px] font-semibold text-ink">{dq.missingSpend.length} attended event{dq.missingSpend.length !== 1 ? 's' : ''} with no Actual Spend</p>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {dq.missingSpend.map(r => (
                <button key={r.event.id} onClick={() => onOpenEvent(r.event.id, 'details')} className="px-2.5 py-1 rounded-full text-[12px] font-semibold bg-canvas border border-line hover:border-navy hover:text-navy">
                  {r.event.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
