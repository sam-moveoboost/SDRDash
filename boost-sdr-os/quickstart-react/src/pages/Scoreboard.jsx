import React, { useEffect, useState } from 'react';
import { fetchTeamRegister, fetchQualifiedMeetings, fetchAircallCalls, fetchOpportunities, fetchNewProspects } from '../api/monday';
import Leaderboard from '../components/scoreboard/Leaderboard';
import MiniLeaderboard from '../components/scoreboard/MiniLeaderboard';
import ActivityTracker from '../components/scoreboard/ActivityTracker';
import RepCallPanel from '../components/scoreboard/RepCallPanel';
import StaleDealsModal from '../components/scoreboard/StaleDealsModal';
import StatCard from '../components/shared/StatCard';
import ProgressBar from '../components/shared/ProgressBar';

// ── Per-rep data helpers (ID-based matching) ───────────────────────

function parsePersonIds(value) {
  try { return (JSON.parse(value).personsAndTeams ?? []).map(p => String(p.id)); }
  catch { return []; }
}

function repCallCount(rep, calls) {
  if (!rep.mondayUserId) return 0;
  return calls.filter(c => {
    const raw = c.column_values?.find(col => col.id === 'multiple_person_mm2cff2x')?.value;
    return raw && parsePersonIds(raw).includes(rep.mondayUserId);
  }).length;
}

// ── Date range helpers ─────────────────────────────────────────────

function toDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function thisWeekRange() {
  const today = new Date();
  const dow = today.getDay(); // 0=Sun … 6=Sat
  const sunday = new Date(today);
  sunday.setDate(today.getDate() - dow);       // roll back to Sunday
  const saturday = new Date(sunday);
  saturday.setDate(sunday.getDate() + 6);      // forward to Saturday
  return { startDate: toDateStr(sunday), endDate: toDateStr(saturday) };
}

function monthRange(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  const start = `${monthStr}-01`;
  const end = toDateStr(new Date(y, m, 0));
  return { startDate: start, endDate: end };
}

function daysSince(dateStr) {
  if (!dateStr) return 0;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

// ── Scoreboard ────────────────────────────────────────────────────

export default function Scoreboard({ region, month }) {
  // Phase 1: team register + qualified meetings (drives the leaderboard)
  const [loadingPrimary, setLoadingPrimary] = useState(true);
  // Phase 2: calls + opps + new prospects (drives activity / stale deals)
  const [loadingSecondary, setLoadingSecondary] = useState(true);
  const [error, setError]           = useState(null);
  const [team, setTeam]             = useState([]);
  const [meetings, setMeetings]     = useState([]);
  const [calls, setCalls]           = useState([]);
  const [opps, setOpps]             = useState([]);
  const [newProspects, setNewProspects] = useState([]);

  // Activity period: 'week' | 'month'
  const [activityPeriod, setActivityPeriod] = useState('week');
  const [selectedRep, setSelectedRep] = useState(null);
  const [showStaleModal, setShowStaleModal] = useState(false);

  useEffect(() => {
    setLoadingPrimary(true);
    setLoadingSecondary(true);
    setError(null);

    const dateRange = activityPeriod === 'week' ? thisWeekRange() : monthRange(month);

    async function load() {
      try {
        // Phase 1 — run team + meetings in parallel; render leaderboard as soon as they land
        const [t, m] = await Promise.all([
          fetchTeamRegister(),
          fetchQualifiedMeetings({ region, month }),
        ]);
        setTeam(t);
        setMeetings(m);
        setLoadingPrimary(false);

        // Phase 2 — run calls + opps + new prospects in parallel
        const [c, o, np] = await Promise.all([
          fetchAircallCalls(dateRange),
          fetchOpportunities({ region }),
          fetchNewProspects(dateRange),
        ]);
        setCalls(c);
        setOpps(o);
        setNewProspects(np);
      } catch (err) {
        setError(err.message);
        setLoadingPrimary(false);
      } finally {
        setLoadingSecondary(false);
      }
    }
    load();
  }, [region, month, activityPeriod]);

  if (error) return (
    <div className="max-w-5xl mx-auto px-7 py-10 text-red">
      Failed to load: {error}
    </div>
  );

  // Reps in selected region (for stat cards)
  const regionReps = team.filter(t =>
    ['SDR', 'Hybrid'].includes(t.role) &&
    (!region || region === 'All' || t.region === region)
  );
  const regionUserIds = new Set(regionReps.map(t => t.mondayUserId).filter(Boolean));

  // Calls attributed to reps in the selected region
  const regionCalls = calls.filter(c => {
    const raw = c.column_values?.find(col => col.id === 'multiple_person_mm2cff2x')?.value;
    if (!raw) return false;
    return parsePersonIds(raw).some(id => regionUserIds.has(id));
  });

  const staleOpps = opps.filter(o => daysSince(o.updated_at) >= 14);
  const totalMeetings = meetings.length;
  const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
  const monthProgress = new Date().getDate() / daysInMonth;

  const onTrack = regionReps.filter(rep => {
    const repMeetings = meetings.filter(m => {
      const raw = m.column_values?.find(c => c.id === 'multiple_person_mm2bjm2z')?.value;
      return raw && parsePersonIds(raw).includes(rep.mondayUserId ?? '');
    }).length;
    const pace = (rep.monthlyTarget || rep.fullQuota) * monthProgress;
    return repMeetings >= pace;
  }).length;

  const { startDate } = activityPeriod === 'week' ? thisWeekRange() : monthRange(month);

  return (
    <>
      {/* Progress bar tracks whichever phase is still loading */}
      <ProgressBar loading={loadingPrimary || loadingSecondary} />

      <div className="max-w-5xl mx-auto px-7 py-8 pb-20">
        <p className="font-display text-[11px] font-semibold tracking-[.14em] uppercase text-mint-deep mb-1.5">
          Sales Development
        </p>
        <h1 className="font-display text-[27px] font-bold tracking-tight mb-1">The Scoreboard</h1>
        <p className="text-muted text-[15px] mb-7 max-w-xl">
          Live qualified meetings, ramp-adjusted credits and weekly activity.
        </p>

        <div className="grid grid-cols-4 gap-3.5 mb-8">
          {/* Phase 1 stat cards — ready as soon as meetings land */}
          <StatCard
            feature
            label="Team qualified meetings"
            value={loadingPrimary ? '—' : totalMeetings}
            meta={`Qualified/SQL · ${month}`}
          />
          <StatCard
            label="On-track reps"
            value={loadingPrimary ? '—' : `${onTrack}/${regionReps.length}`}
            meta="Tracking toward target"
          />
          {/* Phase 2 stat cards — ready when opps / calls land */}
          <button
            onClick={() => !loadingSecondary && staleOpps.length > 0 && setShowStaleModal(true)}
            className="text-left group relative"
            disabled={loadingSecondary || staleOpps.length === 0}
          >
            <StatCard
              label="Stale deals"
              value={loadingSecondary ? '—' : staleOpps.length}
              valueClass={staleOpps.length > 0 ? 'text-amber' : 'text-mint-deep'}
              meta={loadingSecondary ? 'Loading…' : staleOpps.length > 0 ? 'Click to review ↗' : 'No stale deals'}
            />
          </button>
          <StatCard
            label="Outbound calls"
            value={loadingSecondary ? '—' : regionCalls.length}
            meta={`${activityPeriod === 'week' ? 'This week' : 'This month'} · ${region === 'All' ? 'all regions' : region}`}
          />
        </div>

        {/* Meetings leaderboard — appears as soon as phase 1 completes */}
        <div className="font-display text-[13px] font-semibold tracking-[.04em] uppercase text-muted mt-8 mb-3.5 flex items-center gap-2.5 after:content-[''] after:flex-1 after:h-px after:bg-line">
          Leaderboard · qualified meetings · {month}
        </div>
        <Leaderboard team={team} meetings={meetings} loading={loadingPrimary} region={region} onRepClick={rep => setSelectedRep(rep)} />

        {/* Outbound calls leaderboard — phase 2 */}
        <div className="font-display text-[13px] font-semibold tracking-[.04em] uppercase text-muted mt-6 mb-3.5 flex items-center gap-2.5 after:content-[''] after:flex-1 after:h-px after:bg-line">
          Outbound calls · {activityPeriod === 'week' ? `week of ${startDate}` : month}
        </div>
        <MiniLeaderboard
          title="Outbound calls"
          subtitle={activityPeriod === 'week' ? `Week of ${startDate}` : month}
          team={team}
          getData={rep => repCallCount(rep, calls)}
          unit="calls"
          loading={loadingSecondary}
          region={region}
          onRepClick={rep => setSelectedRep(rep)}
        />

        {/* Activity section — phase 2 */}
        <div className="mt-8 mb-3.5 flex items-center gap-2.5">
          <span className="font-display text-[13px] font-semibold tracking-[.04em] uppercase text-muted">
            Activity · {activityPeriod === 'week' ? `week of ${startDate}` : month}
          </span>
          <div className="flex items-center gap-1 ml-auto">
            <button
              onClick={() => setActivityPeriod('week')}
              className={`px-3 py-1 rounded-lg text-[12px] font-semibold transition-all ${
                activityPeriod === 'week'
                  ? 'bg-teal text-white'
                  : 'bg-transparent text-muted hover:text-ink border border-line'
              }`}
            >
              This week
            </button>
            <button
              onClick={() => setActivityPeriod('month')}
              className={`px-3 py-1 rounded-lg text-[12px] font-semibold transition-all ${
                activityPeriod === 'month'
                  ? 'bg-teal text-white'
                  : 'bg-transparent text-muted hover:text-ink border border-line'
              }`}
            >
              This month
            </button>
          </div>
          <span className="h-px flex-1 bg-line" />
        </div>
        <ActivityTracker team={team} calls={calls} newProspects={newProspects} loading={loadingSecondary} period={activityPeriod} region={region} onRepClick={rep => setSelectedRep(rep)} />

      </div>
      {selectedRep && (
        <RepCallPanel
          rep={selectedRep}
          calls={calls}
          periodLabel={activityPeriod === 'week' ? `Week of ${startDate}` : month}
          onClose={() => setSelectedRep(null)}
        />
      )}
      {showStaleModal && (
        <StaleDealsModal
          staleOpps={staleOpps}
          team={team}
          onClose={() => setShowStaleModal(false)}
          onDealUpdate={(dealId, updatedCvs) =>
            setOpps(prev => prev.map(o =>
              o.id === dealId ? { ...o, column_values: updatedCvs } : o
            ))
          }
        />
      )}
    </>
  );
}
