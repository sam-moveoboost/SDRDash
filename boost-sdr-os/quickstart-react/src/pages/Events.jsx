import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { fetchEventReport, fetchWorkspaceUsers } from '../api/monday';
import { buildEventReport } from '../utils/eventMetrics';
import EventCalendar from '../components/events/EventCalendar';
import EventModal from '../components/events/EventModal';
import EventInsights from '../components/events/EventInsights';
import ProgressBar from '../components/shared/ProgressBar';

const YEAR_OPTIONS = [2025, 2026, 2027, 2028];

export default function Events({ user }) {
  const [loading, setLoading]   = useState(true);
  const [raw, setRaw]           = useState(null);
  const [users, setUsers]       = useState([]);
  const [userMap, setUserMap]   = useState({});
  const [year, setYear]         = useState(new Date().getFullYear());
  const [error, setError]       = useState(null);

  // Modal: undefined = closed, { id: null } = create, { id, tab } = existing event
  const [modal, setModal] = useState(undefined);

  // Reloads the whole report — called after any link is added or removed, so
  // every tile, table and tab reflects what's actually on the boards.
  const reload = useCallback(() => (
    fetchEventReport()
      .then(setRaw)
      .catch(err => setError(err.message))
  ), []);

  useEffect(() => {
    setLoading(true);
    Promise.all([reload(), fetchWorkspaceUsers()])
      .then(([, allUsers]) => {
        setUsers(allUsers);
        const map = {};
        allUsers.forEach(u => { map[String(u.id)] = u; });
        setUserMap(map);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [reload]);

  const report = useMemo(() => (raw ? buildEventReport(raw, year) : null), [raw, year]);
  const events = raw?.events ?? [];

  const handleSaved = useCallback(async () => {
    setModal(undefined);
    setLoading(true);
    await reload();
    setLoading(false);
  }, [reload]);

  const handleChanged = useCallback(async () => {
    setLoading(true);
    await reload();
    setLoading(false);
  }, [reload]);

  const modalEvent = modal?.id ? events.find(e => e.id === modal.id) ?? null : null;
  const modalRow   = modal?.id ? report?.rows.find(r => r.event.id === modal.id) ?? null : null;

  if (error) return (
    <div className="max-w-5xl mx-auto px-7 py-10 text-red">Failed to load events: {error}</div>
  );

  return (
    <>
      <ProgressBar loading={loading} />

      <div className="max-w-6xl mx-auto px-7 py-8 pb-20">

        {/* Page title + controls */}
        <div className="flex items-end justify-between mb-7">
          <div>
            <p className="text-[12px] font-semibold tracking-[.08em] uppercase text-emerald mb-1.5">
              Event Planning
            </p>
            <h1 className="font-display text-[36px] leading-[1.1] font-semibold tracking-tight mb-2">Events</h1>
            <p className="text-muted text-[15px] max-w-xl">
              UK event calendar, plus the leads, opportunities and revenue each event brings in.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setModal({ id: null })}
              className="flex items-center gap-2 px-4 py-2 bg-navy text-white rounded-full text-[13.5px] font-semibold hover:bg-navy-700 transition-colors shadow-sm"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="7" y1="1" x2="7" y2="13" />
                <line x1="1" y1="7" x2="13" y2="7" />
              </svg>
              New Event
            </button>

            <div className="flex items-center gap-2 bg-card border border-line rounded-xl px-3 py-2 shadow-sm">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-muted flex-shrink-0">
                <rect x="1" y="2" width="12" height="11" rx="2" />
                <path d="M1 5h12M4 1v2M10 1v2" />
              </svg>
              <label className="text-[11px] font-semibold text-muted uppercase tracking-wide">Year</label>
              <select
                value={year}
                onChange={e => setYear(Number(e.target.value))}
                className="bg-transparent border-0 text-ink text-[13px] font-semibold cursor-pointer outline-none"
              >
                {YEAR_OPTIONS.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* Event results */}
        <div className="text-[13px] font-semibold tracking-[.08em] uppercase text-muted mb-3.5 flex items-center gap-2.5 after:content-[''] after:flex-1 after:h-px after:bg-line">
          Event Results · {year}
        </div>
        {!report
          ? <div className="bg-card border border-line rounded-2xl h-48 animate-pulse mb-8" />
          : (
            <div className="mb-10">
              <EventInsights
                report={report}
                userMap={userMap}
                year={year}
                onOpenEvent={(id, tab) => setModal({ id, tab })}
                onChanged={handleChanged}
              />
            </div>
          )
        }

        {/* Calendar — shows ALL events, free month navigation */}
        <div className="text-[13px] font-semibold tracking-[.08em] uppercase text-muted mb-3.5 flex items-center gap-2.5 after:content-[''] after:flex-1 after:h-px after:bg-line">
          Event Calendar
        </div>
        {!raw
          ? <div className="bg-card border border-line rounded-2xl h-[420px] animate-pulse" />
          : (
            <EventCalendar
              events={events}
              userMap={userMap}
              onEventClick={e => setModal({ id: e.id, tab: 'details' })}
            />
          )
        }
      </div>

      {modal !== undefined && (modal.id === null || modalEvent) && (
        <EventModal
          key={modal.id ?? 'new'}
          event={modalEvent}
          row={modalRow}
          events={events}
          users={users}
          me={user}
          fx={report?.fx}
          initialTab={modal.tab}
          onSaved={handleSaved}
          onChanged={handleChanged}
          onClose={() => setModal(undefined)}
        />
      )}
    </>
  );
}
