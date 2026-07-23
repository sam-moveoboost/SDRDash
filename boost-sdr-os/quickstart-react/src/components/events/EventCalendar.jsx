import React, { useState, useMemo } from 'react';

const ATTEND_HOST_COLORS = {
  'Rec: Attend':        '#fdab3d',
  'Rec: Host':          '#00c875',
  'Decided: Attending': '#df2f4a',
  'Decided: Hosting':   '#007eb5',
  'Not Going':          '#9d50dd',
};

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Monday-first day index (0=Mon … 6=Sun)
function isoDay(date) { return (date.getDay() + 6) % 7; }

function Avatar({ id, userMap, size = 14 }) {
  const u = userMap[id];
  const initials = u ? u.name.split(' ').map(n => n[0]).slice(0, 2).join('') : '?';
  const style = { width: size, height: size, fontSize: size * 0.48, flexShrink: 0 };
  if (u?.photo_thumb) {
    return (
      <img
        src={u.photo_thumb}
        alt={u.name}
        title={u.name}
        className="rounded-full border border-white/40 object-cover"
        style={style}
      />
    );
  }
  return (
    <div
      title={u?.name ?? id}
      className="rounded-full bg-white/30 flex items-center justify-center font-bold border border-white/40 text-white"
      style={style}
    >
      {initials}
    </div>
  );
}

export default function EventCalendar({ events, userMap, onEventClick }) {
  const today = new Date();
  const [viewYear, setViewYear]   = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [search, setSearch]       = useState('');

  function prevMonth() {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); }
    else setViewMonth(m => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); }
    else setViewMonth(m => m + 1);
  }

  const monthStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}`;
  const firstDay = new Date(viewYear, viewMonth, 1);
  const totalDays = new Date(viewYear, viewMonth + 1, 0).getDate();
  const startOffset = isoDay(firstDay);
  const totalCells = Math.ceil((startOffset + totalDays) / 7) * 7;
  const cells = Array.from({ length: totalCells }, (_, i) => {
    const d = i - startOffset + 1;
    return d >= 1 && d <= totalDays ? d : null;
  });

  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const eventsByDay = useMemo(() => {
    const term = search.trim().toLowerCase();
    const map  = {};
    for (const e of events) {
      if (!e.startDate?.startsWith(monthStr)) continue;
      if (term && !e.name.toLowerCase().includes(term) && !e.location.toLowerCase().includes(term)) continue;
      const day = parseInt(e.startDate.split('-')[2], 10);
      (map[day] ??= []).push(e);
    }
    return map;
  }, [events, monthStr, search]);

  const monthLabel = firstDay.toLocaleString('en-GB', { month: 'long', year: 'numeric' });

  return (
    <div className="bg-card border border-line rounded-2xl shadow-sm overflow-hidden">
      {/* Header row */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-line">
        {/* Month navigation */}
        <button
          onClick={prevMonth}
          className="w-8 h-8 rounded-lg hover:bg-[#F0EBE2] flex items-center justify-center text-muted text-[18px] transition-colors"
        >
          ‹
        </button>
        <span className="font-display font-bold text-[15px] w-40 text-center">{monthLabel}</span>
        <button
          onClick={nextMonth}
          className="w-8 h-8 rounded-lg hover:bg-[#F0EBE2] flex items-center justify-center text-muted text-[18px] transition-colors"
        >
          ›
        </button>

        {/* Search */}
        <div className="relative ml-auto w-56">
          <svg
            width="13" height="13" viewBox="0 0 13 13" fill="none"
            stroke="currentColor" strokeWidth="1.5"
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
          >
            <circle cx="5.5" cy="5.5" r="4" />
            <line x1="8.5" y1="8.5" x2="12" y2="12" />
          </svg>
          <input
            type="text"
            placeholder="Search events…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 bg-canvas border border-line rounded-lg text-[13px] outline-none focus:border-teal transition-colors"
          />
        </div>
      </div>

      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 border-b border-line bg-[#FAF8F5]">
        {DOW.map(d => (
          <div key={d} className="py-2 text-center text-[11px] font-semibold text-muted tracking-wide uppercase">
            {d}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 divide-x divide-y divide-line">
        {cells.map((day, idx) => {
          if (!day) return <div key={idx} className="min-h-[96px] bg-[#FAFAF8]" />;
          const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const isToday = dateStr === todayStr;
          const dayEvents = eventsByDay[day] ?? [];

          return (
            <div key={idx} className={`min-h-[96px] p-1.5 ${isToday ? 'bg-mint-soft/40' : ''}`}>
              <div className={`text-[11.5px] font-semibold mb-1 w-5 h-5 flex items-center justify-center rounded-full ${isToday ? 'bg-teal text-white' : 'text-muted'}`}>
                {day}
              </div>
              <div className="flex flex-col gap-0.5">
                {dayEvents.map(e => {
                  const hex = ATTEND_HOST_COLORS[e.attendOrHostText] ?? '#c4c4c4';
                  const tooltip = [
                    e.name,
                    e.eventTypeText && `Type: ${e.eventTypeText}`,
                    e.location && `📍 ${e.location}`,
                    e.attendOrHostText && `Status: ${e.attendOrHostText}`,
                    e.bookingStatusText && `Booking: ${e.bookingStatusText}`,
                  ].filter(Boolean).join('\n');
                  return (
                    <div
                      key={e.id}
                      title={tooltip}
                      onClick={() => onEventClick?.(e)}
                      className="rounded px-1 py-0.5 text-white leading-tight cursor-pointer hover:opacity-85 transition-opacity"
                      style={{ backgroundColor: hex }}
                    >
                      <div className="text-[10px] font-semibold truncate">{e.name}</div>
                      {e.attendeeIds.length > 0 && (
                        <div className="flex gap-0.5 mt-0.5 flex-wrap items-center">
                          {e.attendeeIds.slice(0, 5).map(id => (
                            <Avatar key={id} id={id} userMap={userMap} size={13} />
                          ))}
                          {e.attendeeIds.length > 5 && (
                            <span className="text-[8px] text-white/70">+{e.attendeeIds.length - 5}</span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="px-4 py-3 border-t border-line bg-[#FAF8F5] flex flex-wrap gap-x-4 gap-y-1.5">
        {Object.entries(ATTEND_HOST_COLORS).map(([label, hex]) => (
          <span key={label} className="flex items-center gap-1.5 text-[11px] text-muted">
            <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: hex }} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
