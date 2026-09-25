import React, { useEffect, useMemo, useRef, useState } from 'react';
import { HOW_MET_OPTIONS, isStandEvent } from '../../utils/eventMetrics';

function formatDate(d) {
  if (!d) return 'No date';
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Recent past events first (the one you were at last week), then upcoming,
// then older — "Not Going" / "Skipping" events sink to the bottom.
function rankEvents(events) {
  const today = new Date().toISOString().slice(0, 10);
  const skipped = e => e.attendOrHostText === 'Not Going' || e.bookingStatusText === 'Skipping';
  const bucket = e => {
    if (skipped(e)) return 3;
    const d = e.startDate ?? '';
    if (!d) return 2;
    if (d <= today) {
      const days = (Date.parse(today) - Date.parse(d)) / 86400000;
      return days <= 120 ? 0 : 2;
    }
    return 1;
  };
  return [...events].sort((a, b) => {
    const ba = bucket(a), bb = bucket(b);
    if (ba !== bb) return ba - bb;
    const da = a.startDate ?? '', db = b.startDate ?? '';
    return ba === 1 ? da.localeCompare(db) : db.localeCompare(da);
  });
}

export function EventTag({ event }) {
  if (!event) return null;
  return (
    <span className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide leading-none ${
      isStandEvent(event) ? 'bg-pale text-emerald' : 'bg-info-soft text-info'
    }`}>
      {isStandEvent(event) ? 'Stand' : 'Attended'}
    </span>
  );
}

// Single-event picker: one event per lead (first-touch attribution).
export function EventPicker({ events, value, onChange, dirty = false }) {
  const [query, setQuery] = useState('');
  const [open, setOpen]   = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    function handleClick(e) { if (!wrapRef.current?.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const ranked = useMemo(() => rankEvents(events), [events]);
  const selected = events.find(e => e.id === value) ?? null;
  const term = query.trim().toLowerCase();
  const options = ranked
    .filter(e => !term || e.name.toLowerCase().includes(term) || (e.location ?? '').toLowerCase().includes(term))
    .slice(0, 30);

  if (selected) {
    return (
      <div className={`flex items-center gap-2 border rounded-xl px-3 py-2 ${dirty ? 'border-navy bg-pale/30' : 'border-line bg-white'}`}>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-ink truncate">{selected.name}</p>
          <p className="text-[11px] text-muted">{formatDate(selected.startDate)}{selected.location ? ` · ${selected.location}` : ''}</p>
        </div>
        <EventTag event={selected} />
        <button
          onClick={() => onChange(null)}
          title="Remove event"
          className="text-muted hover:text-red text-[18px] leading-none px-1 transition-colors"
        >&times;</button>
      </div>
    );
  }

  return (
    <div className="relative" ref={wrapRef}>
      <input
        type="text"
        value={query}
        onFocus={() => setOpen(true)}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        placeholder="Search events…"
        className={`w-full border rounded-xl px-3 py-2 text-[13px] bg-white focus:outline-none focus:ring-1 focus:ring-navy focus:border-navy transition-colors ${dirty ? 'border-navy' : 'border-line'}`}
      />
      {open && (
        <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-card border border-line rounded-xl shadow-lg max-h-64 overflow-y-auto">
          {options.length === 0 && <div className="px-3 py-2.5 text-muted text-[12.5px]">No events found</div>}
          {options.map(e => (
            <button
              key={e.id}
              onMouseDown={ev => { ev.preventDefault(); onChange(e.id); setQuery(''); setOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-sunken text-left transition-colors"
            >
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-ink truncate">{e.name}</p>
                <p className="text-[11px] text-muted">{formatDate(e.startDate)}{e.location ? ` · ${e.location}` : ''}</p>
              </div>
              <EventTag event={e} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// "How did you meet them?" — sets Conversion Activity.
export function HowMetChoice({ value, onChange }) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {HOW_MET_OPTIONS.map(o => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`px-2.5 py-1 rounded-full text-[12px] font-semibold border transition-colors ${
            value === o.value
              ? 'bg-navy text-white border-navy'
              : 'bg-white text-muted border-line hover:border-navy hover:text-navy'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export { formatDate as formatEventDate };
