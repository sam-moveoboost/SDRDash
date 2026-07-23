import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { fetchEvents, fetchWorkspaceUsers } from '../api/monday';
import EventCalendar from '../components/events/EventCalendar';
import EventLeaderboard from '../components/events/EventLeaderboard';
import EventModal from '../components/events/EventModal';
import EventInsights from '../components/events/EventInsights';
import ProgressBar from '../components/shared/ProgressBar';

const YEAR_OPTIONS = [2025, 2026, 2027, 2028];

export default function Events() {
  const [loading, setLoading]   = useState(true);
  const [events, setEvents]     = useState([]);
  const [users, setUsers]       = useState([]);
  const [userMap, setUserMap]   = useState({});
  const [year, setYear]         = useState(new Date().getFullYear());
  const [error, setError]       = useState(null);

  // Modal state: null = closed, 'new' = create, event object = edit
  const [modalEvent, setModalEvent] = useState(undefined);
  const modalOpen = modalEvent !== undefined;

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchEvents(), fetchWorkspaceUsers()])
      .then(([evts, allUsers]) => {
        setEvents(evts);
        setUsers(allUsers);
        const map = {};
        allUsers.forEach(u => { map[String(u.id)] = u; });
        setUserMap(map);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  // Called after a successful create or update
  const handleSaved = useCallback((savedEvent) => {
    setEvents(prev => {
      const idx = prev.findIndex(e => e.id === savedEvent.id);
      if (idx >= 0) {
        // Update existing
        const next = [...prev];
        next[idx] = savedEvent;
        return next;
      }
      // New event — append and re-sort by start date
      return [...prev, savedEvent].sort((a, b) =>
        (a.startDate ?? '').localeCompare(b.startDate ?? '')
      );
    });
    setModalEvent(undefined);
  }, []);

  // Events filtered to selected year for the leaderboard
  const leaderboardEvents = useMemo(() => {
    const start = year === 2026 ? `${year}-09-01` : `${year}-01-01`;
    const end   = `${year}-12-31`;
    return events.filter(e => e.startDate && e.startDate >= start && e.startDate <= end);
  }, [events, year]);

  if (error) return (
    <div className="max-w-5xl mx-auto px-7 py-10 text-red">Failed to load events: {error}</div>
  );

  return (
    <>
      <ProgressBar loading={loading} />

      <div className="max-w-5xl mx-auto px-7 py-8 pb-20">

        {/* Page title + controls */}
        <div className="flex items-end justify-between mb-7">
          <div>
            <p className="font-display text-[11px] font-semibold tracking-[.14em] uppercase text-mint-deep mb-1.5">
              Event Planning
            </p>
            <h1 className="font-display text-[27px] font-bold tracking-tight mb-1">Events</h1>
            <p className="text-muted text-[15px] max-w-xl">
              UK event calendar and team attendance tracking.
              {year === 2026 && ' Leaderboard counts events from 1 Sep 2026.'}
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Create event button */}
            <button
              onClick={() => setModalEvent(null)}
              className="flex items-center gap-2 px-4 py-2 bg-teal text-white rounded-xl text-[13.5px] font-semibold hover:bg-teal-mid transition-colors shadow-sm"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="7" y1="1" x2="7" y2="13" />
                <line x1="1" y1="7" x2="13" y2="7" />
              </svg>
              New Event
            </button>

            {/* Year selector */}
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

        {/* Calendar — shows ALL events, free month navigation */}
        <div className="font-display text-[13px] font-semibold tracking-[.04em] uppercase text-muted mb-3.5 flex items-center gap-2.5 after:content-[''] after:flex-1 after:h-px after:bg-line">
          Event Calendar
        </div>
        {loading
          ? <div className="bg-card border border-line rounded-2xl h-[420px] animate-pulse mb-8" />
          : (
            <div className="mb-8">
              <EventCalendar
                events={events}
                userMap={userMap}
                onEventClick={e => setModalEvent(e)}
              />
            </div>
          )
        }

        {/* Opportunity Insights — filtered by selected year */}
        <div className="font-display text-[13px] font-semibold tracking-[.04em] uppercase text-muted mb-3.5 flex items-center gap-2.5 after:content-[''] after:flex-1 after:h-px after:bg-line">
          Opportunity Insights · {year}
          {year === 2026 && <span className="text-[11px] normal-case font-normal ml-1">(from 1 Sep)</span>}
        </div>
        {loading
          ? <div className="bg-card border border-line rounded-2xl h-48 animate-pulse mb-8" />
          : <div className="mb-8"><EventInsights events={leaderboardEvents} userMap={userMap} /></div>
        }

        {/* Attendance Leaderboard — filtered by selected year */}
        <div className="font-display text-[13px] font-semibold tracking-[.04em] uppercase text-muted mb-3.5 flex items-center gap-2.5 after:content-[''] after:flex-1 after:h-px after:bg-line">
          Attendance Leaderboard · {year}
          {year === 2026 && <span className="text-[11px] normal-case font-normal ml-1">(from 1 Sep)</span>}
        </div>
        {loading
          ? <div className="bg-card border border-line rounded-2xl h-48 animate-pulse" />
          : <EventLeaderboard events={leaderboardEvents} userMap={userMap} year={year} />
        }

      </div>

      {/* Modal — null = create new, event object = edit */}
      {modalOpen && (
        <EventModal
          event={modalEvent}
          users={users}
          onSave={handleSaved}
          onClose={() => setModalEvent(undefined)}
        />
      )}
    </>
  );
}
