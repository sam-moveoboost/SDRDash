import React from 'react';

// 2026 is special: measuring from 1 Sep, reduced targets
const TARGETS = {
  default: { allDay: 10, other: 30 },
  2026:    { allDay:  8, other: 12 },
};

function Bar({ value, max, color }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="h-1.5 bg-line rounded-full overflow-hidden">
      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
    </div>
  );
}

function PersonAvatar({ name, photo }) {
  if (photo) {
    return <img src={photo} alt={name} className="w-10 h-10 rounded-full object-cover flex-shrink-0" />;
  }
  const initials = name.split(' ').map(n => n[0]).slice(0, 2).join('');
  return (
    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-teal to-teal-mid text-white grid place-items-center font-display font-bold text-[13px] flex-shrink-0">
      {initials}
    </div>
  );
}

export default function EventLeaderboard({ events, userMap, year }) {
  const t = TARGETS[year] ?? TARGETS.default;
  const total = t.allDay + t.other;

  // Build per-person stats from all attendeeIds across filtered events
  const statsMap = {};
  for (const e of events) {
    const isAllDay = e.eventTypeText === 'All Day Conference';
    for (const id of e.attendeeIds) {
      if (!statsMap[id]) statsMap[id] = { allDay: 0, other: 0 };
      if (isAllDay) statsMap[id].allDay++;
      else          statsMap[id].other++;
    }
  }

  const rows = Object.entries(statsMap)
    .map(([id, counts]) => {
      const u = userMap[id];
      return {
        id,
        name:  u?.name       ?? `User ${id}`,
        photo: u?.photo_thumb ?? null,
        ...counts,
        sum: counts.allDay + counts.other,
      };
    })
    .sort((a, b) => b.sum - a.sum || b.allDay - a.allDay);

  if (rows.length === 0) {
    return (
      <div className="bg-card border border-line rounded-2xl p-10 text-center text-muted text-[14px]">
        No attendee data recorded for {year}
        {year === 2026 ? ' (from 1 Sep 2026)' : ''}.
      </div>
    );
  }

  return (
    <div className="bg-card border border-line rounded-2xl shadow-sm overflow-hidden">
      {/* Card header */}
      <div className="px-5 py-4 border-b border-line">
        <div className="font-display font-bold text-[15px]">Attendance Tracker · {year}</div>
        <div className="text-muted text-[12px] mt-0.5">
          Target per person: {t.allDay} all-day conferences + {t.other} other events = {total} total
          {year === 2026 && ' · measuring from 1 Sep 2026'}
        </div>
      </div>

      {/* Rows */}
      <div className="divide-y divide-line">
        {rows.map((p, i) => {
          const allDayMet = p.allDay >= t.allDay;
          const otherMet  = p.other  >= t.other;
          const bothMet   = allDayMet && otherMet;
          const pct       = Math.round(Math.min(100, (p.sum / total) * 100));

          return (
            <div key={p.id} className="px-5 py-4 flex items-start gap-4">
              {/* Rank */}
              <div className="w-6 text-center text-[13px] font-bold text-muted pt-2 flex-shrink-0">
                {i + 1}
              </div>

              {/* Avatar */}
              <PersonAvatar name={p.name} photo={p.photo} />

              {/* Stats */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-2.5">
                  <span className="font-display font-semibold text-[14px] truncate">{p.name}</span>
                  {bothMet && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-mint text-teal-deep whitespace-nowrap">
                      Target met ✓
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                  {/* All-day conferences */}
                  <div>
                    <div className="flex justify-between text-[11px] mb-1">
                      <span className="text-muted">All-day conferences</span>
                      <span className={`font-semibold ${allDayMet ? 'text-mint-deep' : 'text-ink'}`}>
                        {p.allDay} / {t.allDay}
                      </span>
                    </div>
                    <Bar value={p.allDay} max={t.allDay} color="#579bfc" />
                  </div>

                  {/* Other events */}
                  <div>
                    <div className="flex justify-between text-[11px] mb-1">
                      <span className="text-muted">Other events</span>
                      <span className={`font-semibold ${otherMet ? 'text-mint-deep' : 'text-ink'}`}>
                        {p.other} / {t.other}
                      </span>
                    </div>
                    <Bar value={p.other} max={t.other} color="#00c875" />
                  </div>
                </div>
              </div>

              {/* Total + % */}
              <div className="text-right flex-shrink-0 pt-1">
                <div className="font-display font-bold text-[24px] leading-none">{p.sum}</div>
                <div className="text-muted text-[10.5px]">of {total}</div>
                <div className={`text-[11px] font-semibold mt-1 ${
                  bothMet ? 'text-mint-deep' : pct >= 60 ? 'text-amber' : 'text-muted'
                }`}>
                  {pct}%
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-line bg-[#FAF8F5] flex gap-4 text-[11px] text-muted">
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-1.5 rounded-full bg-[#579bfc]" />
          All-day conference
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-1.5 rounded-full bg-[#00c875]" />
          Other event
        </span>
        <span className="ml-auto">Based on Attendees column · live data</span>
      </div>
    </div>
  );
}
