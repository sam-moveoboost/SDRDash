import React, { useMemo } from 'react';

const TYPE_COLORS = {
  'All Day Conference':   '#579bfc',
  'Short Conference':     '#037f4c',
  'In Person Networking': '#df2f4a',
  'Online Networking':    '#cab641',
  'Other':                '#7f5347',
};

const ATTEND_HOST_COLORS = {
  'Rec: Attend':        '#fdab3d',
  'Rec: Host':          '#00c875',
  'Decided: Attending': '#df2f4a',
  'Decided: Hosting':   '#007eb5',
  'Not Going':          '#9d50dd',
};

// ── Sub-components ────────────────────────────────────────────────

function StatCard({ label, value, sub, highlight }) {
  return (
    <div className="bg-card border border-line rounded-2xl p-5">
      <div className="text-muted text-[11px] font-semibold uppercase tracking-wide mb-2">{label}</div>
      <div className={`font-display font-bold text-[30px] leading-none ${highlight ? 'text-teal' : 'text-ink'}`}>
        {value}
      </div>
      {sub && <div className="text-muted text-[12px] mt-1.5">{sub}</div>}
    </div>
  );
}

function HBar({ label, opps, events: evtCount, max, color }) {
  const pct = max > 0 ? Math.max(2, Math.round((opps / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-3 group">
      <div className="w-40 text-[12.5px] font-medium text-ink truncate flex-shrink-0" title={label}>{label || '—'}</div>
      <div className="flex-1 h-[18px] bg-line rounded-full overflow-hidden">
        <div
          className="h-full rounded-full flex items-center justify-end pr-2 transition-all"
          style={{ width: `${pct}%`, backgroundColor: color }}
        >
          {pct > 14 && <span className="text-white text-[10px] font-bold">{opps}</span>}
        </div>
      </div>
      {pct <= 14 && <span className="text-[12px] font-bold w-4 text-ink">{opps}</span>}
      <span className="text-muted text-[11px] w-20 text-right flex-shrink-0 tabular-nums">
        {evtCount} event{evtCount !== 1 ? 's' : ''}
      </span>
    </div>
  );
}

function SectionHeading({ children }) {
  return (
    <div className="font-display font-bold text-[14px] mb-4">{children}</div>
  );
}

// ── Main component ────────────────────────────────────────────────

export default function EventInsights({ events, userMap }) {
  const stats = useMemo(() => {
    // Total unique opportunity IDs across all events
    const allOppIds = new Set(events.flatMap(e => e.linkedOpportunityIds));
    const totalOpps   = allOppIds.size;
    const withOpps    = events.filter(e => e.linkedOpportunityIds.length > 0).length;

    // Group helpers
    const byType    = {};
    const byScale   = {};
    const byStatus  = {};
    const bySector  = {};
    const byPerson  = {};

    for (const e of events) {
      const n = e.linkedOpportunityIds.length;

      const inc = (map, key) => {
        if (!key) return;
        map[key] ??= { opps: 0, events: 0 };
        map[key].opps   += n;
        map[key].events += 1;
      };

      inc(byType,   e.eventTypeText);
      inc(byScale,  e.scaleText);
      inc(byStatus, e.attendOrHostText);
      inc(bySector, e.sector);

      for (const id of e.attendeeIds) {
        byPerson[id] ??= { opps: 0, events: 0 };
        byPerson[id].opps   += n;
        byPerson[id].events += 1;
      }
    }

    const sorted = obj => Object.entries(obj).sort((a, b) => b[1].opps - a[1].opps);

    const topEvents = [...events]
      .filter(e => e.linkedOpportunityIds.length > 0)
      .sort((a, b) => b.linkedOpportunityIds.length - a.linkedOpportunityIds.length)
      .slice(0, 10);

    return {
      totalOpps, withOpps,
      byType:   sorted(byType),
      byScale:  sorted(byScale),
      byStatus: sorted(byStatus),
      bySector: sorted(bySector),
      byPerson: sorted(byPerson),
      topEvents,
    };
  }, [events]);

  const { totalOpps, withOpps, byType, byScale, byStatus, bySector, byPerson, topEvents } = stats;

  const decidedCount = events.filter(e =>
    e.attendOrHostText === 'Decided: Attending' || e.attendOrHostText === 'Decided: Hosting'
  ).length;
  const avgOpps = decidedCount > 0 ? (totalOpps / decidedCount).toFixed(1) : '0';
  const bestType   = byType[0]?.[0];
  const bestStatus = byStatus[0]?.[0];

  const maxType   = byType[0]?.[1].opps   ?? 1;
  const maxScale  = byScale[0]?.[1].opps  ?? 1;
  const maxStatus = byStatus[0]?.[1].opps ?? 1;
  const maxSector = bySector[0]?.[1].opps ?? 1;
  const maxPerson = byPerson[0]?.[1].opps ?? 1;

  if (events.length === 0) {
    return (
      <div className="bg-card border border-line rounded-2xl p-10 text-center text-muted text-[14px]">
        No events in the selected year. Add events and link opportunities in Monday to see insights.
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* ── Summary stat cards ────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard
          label="Linked opportunities"
          value={totalOpps}
          sub={`from ${withOpps} of ${events.length} events`}
          highlight
        />
        <StatCard
          label="Avg opps per event"
          value={avgOpps}
          sub={decidedCount > 0 ? `across ${decidedCount} decided event${decidedCount !== 1 ? 's' : ''}` : 'No decided events yet'}
        />
        <StatCard
          label="Best event type"
          value={bestType ?? '—'}
          sub={bestType ? `${byType[0][1].opps} opp${byType[0][1].opps !== 1 ? 's' : ''}` : 'No data yet'}
        />
        <StatCard
          label="Best approach"
          value={bestStatus?.replace('Decided: ', '').replace('Rec: ', '') ?? '—'}
          sub={bestStatus ? `${byStatus[0][1].opps} opp${byStatus[0][1].opps !== 1 ? 's' : ''}` : 'No data yet'}
        />
      </div>

      {/* ── Charts row ────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-6">

        {/* By event type */}
        <div className="bg-card border border-line rounded-2xl p-5">
          <SectionHeading>By Event Type</SectionHeading>
          <div className="space-y-3">
            {byType.length > 0
              ? byType.map(([type, d]) => (
                  <HBar key={type} label={type} opps={d.opps} events={d.events} max={maxType} color={TYPE_COLORS[type] ?? '#aaa'} />
                ))
              : <p className="text-muted text-[13px]">Link opportunities to events to see this breakdown.</p>
            }
          </div>
        </div>

        {/* Right column: scale + attend/host */}
        <div className="space-y-5">
          <div className="bg-card border border-line rounded-2xl p-5">
            <SectionHeading>National vs Local</SectionHeading>
            <div className="space-y-3">
              {byScale.length > 0
                ? byScale.map(([scale, d]) => (
                    <HBar key={scale} label={scale || 'Unset'} opps={d.opps} events={d.events} max={maxScale} color="#00c875" />
                  ))
                : <p className="text-muted text-[13px]">No scale data yet.</p>
              }
            </div>
          </div>

          <div className="bg-card border border-line rounded-2xl p-5">
            <SectionHeading>Attend vs Host</SectionHeading>
            <div className="space-y-3">
              {byStatus.length > 0
                ? byStatus.map(([status, d]) => (
                    <HBar key={status} label={status} opps={d.opps} events={d.events} max={maxStatus} color={ATTEND_HOST_COLORS[status] ?? '#aaa'} />
                  ))
                : <p className="text-muted text-[13px]">No status data yet.</p>
              }
            </div>
          </div>
        </div>
      </div>

      {/* ── Sector breakdown ──────────────────────────────────── */}
      {bySector.length > 0 && (
        <div className="bg-card border border-line rounded-2xl p-5">
          <SectionHeading>By Sector</SectionHeading>
          <div className="grid grid-cols-2 gap-x-10 gap-y-3">
            {bySector.map(([sector, d]) => (
              <HBar key={sector} label={sector} opps={d.opps} events={d.events} max={maxSector} color="#9b59b6" />
            ))}
          </div>
        </div>
      )}

      {/* ── Opportunity attribution by person ─────────────────── */}
      {byPerson.length > 0 && (
        <div className="bg-card border border-line rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-line">
            <div className="font-display font-bold text-[14px]">Opportunity Attribution by Attendee</div>
            <div className="text-muted text-[12px] mt-0.5">
              All attendees of an event share credit for that event's opportunities
            </div>
          </div>
          <div className="divide-y divide-line">
            {byPerson.slice(0, 12).map(([id, d], i) => {
              const u    = userMap[id];
              const name = u?.name ?? `User ${id}`;
              const pct  = maxPerson > 0 ? Math.round((d.opps / maxPerson) * 100) : 0;
              return (
                <div key={id} className="px-5 py-3.5 flex items-center gap-4">
                  <span className="w-5 text-[12px] font-bold text-muted flex-shrink-0">{i + 1}</span>
                  {u?.photo_thumb
                    ? <img src={u.photo_thumb} alt={name} className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
                    : <div className="w-8 h-8 rounded-full bg-gradient-to-br from-teal to-teal-mid text-white grid place-items-center font-bold text-[11px] flex-shrink-0">
                        {name.split(' ').map(n => n[0]).slice(0, 2).join('')}
                      </div>
                  }
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-baseline mb-1.5">
                      <span className="font-semibold text-[13px]">{name}</span>
                      <span className="text-[12px] text-muted">{d.events} event{d.events !== 1 ? 's' : ''} attended</span>
                    </div>
                    <div className="h-1.5 bg-line rounded-full overflow-hidden">
                      <div className="h-full bg-teal rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0 ml-3">
                    <div className="font-display font-bold text-[20px] leading-none text-teal">{d.opps}</div>
                    <div className="text-muted text-[10.5px]">opp{d.opps !== 1 ? 's' : ''}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Top events table ──────────────────────────────────── */}
      {topEvents.length > 0 && (
        <div className="bg-card border border-line rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-line font-display font-bold text-[14px]">
            Top Events by Opportunities Generated
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-line bg-[#FAF8F5]">
                  <th className="text-left px-5 py-2.5 font-semibold text-muted">Event</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-muted">Date</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-muted">Type</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-muted">Scale</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-muted">Approach</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-muted">Attendees</th>
                  <th className="text-right px-5 py-2.5 font-semibold text-muted">Opps</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {topEvents.map(e => (
                  <tr key={e.id} className="hover:bg-[#FAF8F5] transition-colors">
                    <td className="px-5 py-3 font-semibold text-ink">{e.name}</td>
                    <td className="px-3 py-3 text-muted tabular-nums">{e.startDate ?? '—'}</td>
                    <td className="px-3 py-3">
                      {e.eventTypeText && (
                        <span
                          className="px-2 py-0.5 rounded-full text-[10.5px] font-semibold text-white"
                          style={{ backgroundColor: TYPE_COLORS[e.eventTypeText] ?? '#aaa' }}
                        >
                          {e.eventTypeText}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-muted">{e.scaleText || '—'}</td>
                    <td className="px-3 py-3">
                      <span className="text-[11.5px] font-medium" style={{ color: ATTEND_HOST_COLORS[e.attendOrHostText] ?? '#888' }}>
                        {e.attendOrHostText || '—'}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex -space-x-1">
                        {e.attendeeIds.slice(0, 5).map(id => {
                          const u = userMap[id];
                          return u?.photo_thumb
                            ? <img key={id} src={u.photo_thumb} title={u.name} className="w-6 h-6 rounded-full object-cover border-2 border-card" />
                            : <div key={id} title={u?.name ?? id} className="w-6 h-6 rounded-full bg-gradient-to-br from-teal to-teal-mid text-white grid place-items-center text-[8px] font-bold border-2 border-card">
                                {(u?.name ?? '?').split(' ').map(n => n[0]).slice(0,2).join('')}
                              </div>;
                        })}
                        {e.attendeeIds.length > 5 && (
                          <div className="w-6 h-6 rounded-full bg-line text-muted grid place-items-center text-[8px] font-bold border-2 border-card">
                            +{e.attendeeIds.length - 5}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <span className="font-display font-bold text-[18px] text-teal">
                        {e.linkedOpportunityIds.length}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-5 py-3 border-t border-line bg-[#FAF8F5] text-[11px] text-muted">
            Opportunities counted via the Opportunities column on the Events board
          </div>
        </div>
      )}

      {totalOpps === 0 && (
        <div className="bg-card border border-line rounded-2xl p-8 text-center">
          <div className="text-[14px] font-semibold text-ink mb-1">No opportunities linked yet</div>
          <div className="text-muted text-[13px]">
            Open an event in Monday and use the Opportunities column to link deals created from that event.
          </div>
        </div>
      )}
    </div>
  );
}
