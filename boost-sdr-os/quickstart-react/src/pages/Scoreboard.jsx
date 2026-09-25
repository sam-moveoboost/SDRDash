import React, { useEffect, useState, useMemo } from 'react';
import { fetchTeamRegister, fetchQualifiedMeetings, fetchAircallCalls, fetchOpportunities, fetchNewProspects, fetchEvents, fetchWorkspaceUsers, fetchCurrentUser, fetchLeadsWithMeetingDate } from '../api/monday';
import Leaderboard from '../components/scoreboard/Leaderboard';
import MiniLeaderboard from '../components/scoreboard/MiniLeaderboard';
import ActivityTracker from '../components/scoreboard/ActivityTracker';
import RepCallPanel from '../components/scoreboard/RepCallPanel';
import StaleDealsModal from '../components/scoreboard/StaleDealsModal';
import MeetingsPanel from '../components/scoreboard/MeetingsPanel';
import StatCard from '../components/shared/StatCard';
import ProgressBar from '../components/shared/ProgressBar';
import EventLeaderboard from '../components/events/EventLeaderboard';
import { OPP_COLS } from '../utils/opportunityMetrics';
import { withAttribution, inRegion, isQualifyingMeeting, isLeaderboardRep, repMeetings, isCounted, isBookedIn, isSittingIn, MEETING_COLS, meetingCol } from '../utils/meetingAttribution';

const LEADERBOARD_YEAR_OPTIONS = [2025, 2026, 2027, 2028];
const CLOSED_OPP_STAGES = new Set(['Won', 'Lost']);

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

function oppStage(o) {
  const cv = o.column_values?.find(c => c.id === OPP_COLS.STAGE);
  return cv?.text || cv?.display_value || '';
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
  // Every lead with an MB Date: source for "booked" and "sitting" in any period
  const [datedLeads, setDatedLeads] = useState([]);
  const [calls, setCalls]           = useState([]);
  const [opps, setOpps]             = useState([]);
  const [newProspects, setNewProspects] = useState([]);

  // Activity period: 'week' | 'month'
  const [activityPeriod, setActivityPeriod] = useState('week');
  const [selectedRep, setSelectedRep] = useState(null);
  const [showStaleModal, setShowStaleModal] = useState(false);
  // Leaderboard ranking: 'qualified' (credits, commission) | 'sitting' | 'booked'
  const [leaderboardMode, setLeaderboardMode] = useState('qualified');
  // Meetings drawer: null (closed) or { tab, filter, scope }
  //   tab:    'qualified' | 'sitting' | 'booked'
  //   filter: 'all' | 'excluded' | team register item id
  //   scope:  'month' (stat cards, leaderboard) | 'activity' (activity cards: week or month)
  const [meetingsPanel, setMeetingsPanel] = useState(null);
  // Leads edited in the drawer this session stay listed even if their new status stops them counting
  const [touchedMeetingIds, setTouchedMeetingIds] = useState(() => new Set());
  const [accountSlug, setAccountSlug] = useState('');

  // Events leaderboard (independent — loads once, not tied to region/month)
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [allEvents, setAllEvents]         = useState([]);
  const [eventUserMap, setEventUserMap]   = useState({});
  const [leaderboardYear, setLeaderboardYear] = useState(new Date().getFullYear());

  useEffect(() => {
    setLoadingPrimary(true);
    setLoadingSecondary(true);
    setError(null);

    const dateRange = activityPeriod === 'week' ? thisWeekRange() : monthRange(month);

    async function load() {
      try {
        // Phase 1 — run team + meetings in parallel; render leaderboard as soon as they land
        const [t, m, d] = await Promise.all([
          fetchTeamRegister(),
          fetchQualifiedMeetings({ month }),
          fetchLeadsWithMeetingDate(),
        ]);
        setTeam(t);
        setMeetings(m);
        setDatedLeads(d);
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

  useEffect(() => {
    Promise.all([fetchEvents(), fetchWorkspaceUsers()])
      .then(([evts, users]) => {
        setAllEvents(evts);
        const map = {};
        users.forEach(u => { map[String(u.id)] = u; });
        setEventUserMap(map);
      })
      .catch(() => {})
      .finally(() => setLoadingEvents(false));
    fetchCurrentUser().then(u => setAccountSlug(u?.account?.slug ?? '')).catch(() => {});
  }, []);

  // Attribution + region filtering happen here (not in the API) so a lead
  // with a blank Region still lands in the region of the rep who booked it,
  // and the team total, podium and drawer all use the same credit rules.
  const regionMeetings = useMemo(
    () => withAttribution(meetings, team).filter(m =>
      inRegion(m, region) && (isQualifyingMeeting(m) || touchedMeetingIds.has(m.id))
    ),
    [meetings, team, region, touchedMeetingIds]
  );
  const countedMeetings = useMemo(
    () => regionMeetings.filter(m => isQualifyingMeeting(m) && isCounted(m)),
    [regionMeetings]
  );
  const excludedQualified = regionMeetings.filter(m => isQualifyingMeeting(m) && !isCounted(m)).length;

  // Booked / sitting — computed for the selected month (cards, leaderboard)
  // and for the activity period (week or month toggle on the activity cards).
  const datedRegionLeads = useMemo(
    () => withAttribution(datedLeads, team).filter(m => inRegion(m, region)),
    [datedLeads, team, region]
  );
  const monthDates    = monthRange(month);
  const activityDates = activityPeriod === 'week' ? thisWeekRange() : monthRange(month);
  const sittingMonth    = datedRegionLeads.filter(m => isSittingIn(m, monthDates));
  const bookedMonth     = datedRegionLeads.filter(m => isBookedIn(m, monthDates));
  const sittingActivity = datedRegionLeads.filter(m => isSittingIn(m, activityDates));
  const bookedActivity  = datedRegionLeads.filter(m => isBookedIn(m, activityDates));

  const monthLists = { qualified: regionMeetings, sitting: sittingMonth, booked: bookedMonth };
  const activityLists = {
    qualified: regionMeetings.filter(m => {
      const d = meetingCol(m, MEETING_COLS.QUALIFIED);
      return d >= activityDates.startDate && d <= activityDates.endDate;
    }),
    sitting: sittingActivity,
    booked: bookedActivity,
  };

  function applyPatch(m, patch) {
    const exists = m.column_values.some(c => c.id === patch.id);
    return {
      ...m,
      column_values: exists
        ? m.column_values.map(c => (c.id === patch.id ? { ...c, ...patch } : c))
        : [...m.column_values, patch],
    };
  }

  // Drawer edits update both sources. Setting an MB Date on a qualified lead
  // that had none adds it to the dated set so it shows up as booked/sitting.
  function handleMeetingUpdate(id, patch) {
    setTouchedMeetingIds(prev => new Set(prev).add(id));
    setMeetings(prev => prev.map(m => (m.id === id ? applyPatch(m, patch) : m)));
    setDatedLeads(prev => {
      if (prev.some(m => m.id === id)) return prev.map(m => (m.id === id ? applyPatch(m, patch) : m));
      const source = meetings.find(m => m.id === id);
      return source && patch.id === MEETING_COLS.MEETING_DATE && patch.text
        ? [...prev, applyPatch(source, patch)]
        : prev;
    });
  }

  if (error) return (
    <div className="max-w-5xl mx-auto px-7 py-10 text-red">
      Failed to load: {error}
    </div>
  );

  // Reps in selected region (for stat cards)
  const regionReps = team.filter(t =>
    isLeaderboardRep(t) &&
    (!region || region === 'All' || t.region === region)
  );
  const regionUserIds = new Set(regionReps.map(t => t.mondayUserId).filter(Boolean));

  // Calls attributed to reps in the selected region
  const regionCalls = calls.filter(c => {
    const raw = c.column_values?.find(col => col.id === 'multiple_person_mm2cff2x')?.value;
    if (!raw) return false;
    return parsePersonIds(raw).some(id => regionUserIds.has(id));
  });

  // Closed (Won/Lost) deals are excluded — they're finished, not stale, and
  // now that fetchOpportunities pages through the whole board (1000+ items)
  // instead of just the first 100, leaving this unfiltered surfaced every
  // historical closed deal that hadn't been touched in 14+ days.
  const staleOpps = opps.filter(o => daysSince(o.updated_at) >= 14 && !CLOSED_OPP_STAGES.has(oppStage(o)));
  const totalMeetings = countedMeetings.length;
  const leaderboardLists = {
    qualified: countedMeetings,
    sitting:   sittingMonth.filter(isCounted),
    booked:    bookedMonth.filter(isCounted),
  };
  const leaderboardExcluded = {
    qualified: excludedQualified,
    sitting:   sittingMonth.length - leaderboardLists.sitting.length,
    booked:    bookedMonth.length - leaderboardLists.booked.length,
  };
  const activityLabel = activityPeriod === 'week' ? `Week of ${activityDates.startDate}` : month;
  const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
  const monthProgress = new Date().getDate() / daysInMonth;

  const onTrack = regionReps.filter(rep => {
    const pace = (rep.monthlyTarget || rep.fullQuota) * monthProgress;
    return repMeetings(rep, countedMeetings).length >= pace;
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
          Meetings qualified, sitting and booked, ramp-adjusted credits and weekly activity.
        </p>

        {/* Meeting stat cards (phase 1): qualified = commission, sitting + booked = celebrate */}
        <div className="grid grid-cols-3 gap-3.5 mb-3.5">
          {[
            { tab: 'qualified', label: 'Team qualified meetings', value: totalMeetings, rule: 'Qualified Date', feature: true },
            { tab: 'sitting',   label: 'Meetings sitting',        value: leaderboardLists.sitting.length, rule: 'MB Date' },
            { tab: 'booked',    label: 'Meetings booked',         value: leaderboardLists.booked.length,  rule: 'Created + MB Date' },
          ].map(card => (
            <button
              key={card.tab}
              onClick={() => !loadingPrimary && setMeetingsPanel({ tab: card.tab, filter: 'all', scope: 'month' })}
              className="text-left"
              disabled={loadingPrimary}
            >
              <StatCard
                feature={card.feature}
                label={card.label}
                value={loadingPrimary ? '—' : card.value}
                meta={loadingPrimary
                  ? `${card.rule} · ${month}`
                  : leaderboardExcluded[card.tab] > 0
                    ? `${card.rule} · ${month} · ${leaderboardExcluded[card.tab]} excluded ↗`
                    : `${card.rule} · ${month} · view ↗`}
              />
            </button>
          ))}
        </div>

        <div className="grid grid-cols-3 gap-3.5 mb-8">
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
        <div className="mt-8 mb-3.5 flex items-center gap-2.5">
          <span className="font-display text-[13px] font-semibold tracking-[.04em] uppercase text-muted">
            Leaderboard · meetings {leaderboardMode} · {month}
          </span>
          <div className="flex items-center gap-1 ml-auto">
            {['qualified', 'sitting', 'booked'].map(mode => (
              <button
                key={mode}
                onClick={() => setLeaderboardMode(mode)}
                className={`px-3 py-1 rounded-lg text-[12px] font-semibold capitalize transition-all ${
                  leaderboardMode === mode
                    ? 'bg-teal text-white'
                    : 'bg-transparent text-muted hover:text-ink border border-line'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
          <span className="h-px flex-1 bg-line" />
        </div>
        <Leaderboard
          team={team}
          meetings={leaderboardLists[leaderboardMode]}
          excludedCount={leaderboardExcluded[leaderboardMode]}
          mode={leaderboardMode}
          loading={loadingPrimary}
          region={region}
          onRepClick={rep => setMeetingsPanel({ tab: leaderboardMode, filter: rep.id, scope: 'month' })}
          onExcludedClick={() => setMeetingsPanel({ tab: leaderboardMode, filter: 'excluded', scope: 'month' })}
        />

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
        <ActivityTracker
          team={team}
          calls={calls}
          newProspects={newProspects}
          bookedMeetings={bookedActivity.filter(isCounted)}
          sittingMeetings={sittingActivity.filter(isCounted)}
          loading={loadingSecondary}
          meetingsLoading={loadingPrimary}
          period={activityPeriod}
          region={region}
          onRepClick={rep => setSelectedRep(rep)}
          onMeetingStatClick={(rep, tab) => setMeetingsPanel({ tab, filter: rep.id, scope: 'activity' })}
        />

        {/* Attendance Leaderboard */}
        <div className="mt-10 mb-3.5 flex items-center gap-2.5">
          <span className="font-display text-[13px] font-semibold tracking-[.04em] uppercase text-muted">
            Attendance Leaderboard · {leaderboardYear}
            {leaderboardYear === 2026 && <span className="text-[11px] normal-case font-normal ml-1"> (from 1 Sep)</span>}
          </span>
          <div className="flex items-center gap-1 ml-auto">
            <select
              value={leaderboardYear}
              onChange={e => setLeaderboardYear(Number(e.target.value))}
              className="bg-canvas border border-line rounded-lg px-2.5 py-1 text-[12px] font-semibold cursor-pointer outline-none focus:border-teal transition-colors"
            >
              {LEADERBOARD_YEAR_OPTIONS.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <span className="h-px flex-1 bg-line" />
        </div>
        {loadingEvents
          ? <div className="bg-card border border-line rounded-2xl h-48 animate-pulse" />
          : <EventLeaderboard
              events={allEvents.filter(e => {
                const start = leaderboardYear === 2026 ? `${leaderboardYear}-09-01` : `${leaderboardYear}-01-01`;
                const end   = `${leaderboardYear}-12-31`;
                return e.startDate && e.startDate >= start && e.startDate <= end;
              })}
              userMap={eventUserMap}
              year={leaderboardYear}
            />
        }

      </div>
      {selectedRep && (
        <RepCallPanel
          rep={selectedRep}
          calls={calls}
          periodLabel={activityPeriod === 'week' ? `Week of ${startDate}` : month}
          onClose={() => setSelectedRep(null)}
        />
      )}
      {meetingsPanel && (
        <MeetingsPanel
          lists={meetingsPanel.scope === 'activity' ? activityLists : monthLists}
          reps={regionReps}
          periodLabel={meetingsPanel.scope === 'activity' ? activityLabel : month}
          regionLabel={region === 'All' || !region ? 'All regions' : region}
          initialTab={meetingsPanel.tab}
          initialFilter={meetingsPanel.filter}
          accountSlug={accountSlug}
          onClose={() => setMeetingsPanel(null)}
          onMeetingUpdate={handleMeetingUpdate}
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
