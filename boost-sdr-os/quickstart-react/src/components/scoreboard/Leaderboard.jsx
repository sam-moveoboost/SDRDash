import React from 'react';
import { repMeetings, isLeaderboardRep } from '../../utils/meetingAttribution';

function initials(name) {
  return name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
}

// meetings carry an `attribution` (utils/meetingAttribution) so the podium
// uses exactly the same credit rules as the team total and the meetings drawer
function repMeetingCount(rep, meetings) {
  return repMeetings(rep, meetings).length;
}

// credits = meetings × ramp multiplier (credit boost)
function calcCredits(meetings, multiplier) {
  return meetings * (multiplier || 1);
}

// mode: 'qualified' ranks by ramp-adjusted credits (commission);
// 'sitting' and 'booked' rank by plain meeting count.
const MODE_UNITS = { qualified: 'meeting', sitting: 'sitting', booked: 'booked' };
const MODE_FOOTERS = {
  qualified: 'Credits = qualified meetings × ramp multiplier (credit boost)',
  sitting:   'Meetings whose MB Date falls in this month',
  booked:    'Leads created this month that have an MB Date. No MB Date, no credit',
};

function repScore(rep, meetings, mode) {
  const count = repMeetingCount(rep, meetings);
  return mode === 'qualified' ? calcCredits(count, rep.multiplier) : count;
}

function RepPodium({ rep, meetings, rank, mode, onRepClick }) {
  const meetingCount = repMeetingCount(rep, meetings);
  const credits = calcCredits(meetingCount, rep.multiplier);
  const isRamping = rep.rampMonth && rep.rampMonth !== 'None';

  // Navy podium avatars: primary navy for 1st, supporting navy for 2nd/3rd
  const podiumGradients = ['bg-navy', 'bg-navy-700', 'bg-navy-700'];
  const standHeights = ['h-14', 'h-9', 'h-6'];
  const avatarSizes = [
    'w-[74px] h-[74px] text-[27px]',
    'w-[60px] h-[60px] text-[22px]',
    'w-[60px] h-[60px] text-[22px]',
  ];
  // Medal tints: pale green for 1st, mint and lavender for 2nd/3rd
  const medalColors = [
    'bg-pale text-navy',
    'bg-mint text-navy',
    'bg-lavender text-navy',
  ];

  return (
    <div className="text-center px-3 pb-6 relative">
      <button
        onClick={() => onRepClick?.(rep)}
        className="block mx-auto group"
        title={`View ${rep.name.split(' ')[0]}'s ${mode} meetings`}
      >
        <div className={`rounded-full mx-auto mb-2.5 grid place-items-center font-heading font-bold text-white relative ${podiumGradients[rank - 1]} ${avatarSizes[rank - 1]} ${rank === 1 ? 'shadow-lg' : ''} group-hover:opacity-80 transition-opacity`}>
          {rep.photoThumb
            ? <img src={rep.photoThumb} alt={rep.name} className="absolute inset-0 w-full h-full object-cover rounded-full" />
            : initials(rep.name)
          }
          <span className={`absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full grid place-items-center text-[11px] font-bold border-2 border-card ${medalColors[rank - 1]}`}>
            {rank}
          </span>
        </div>
      </button>
      <button onClick={() => onRepClick?.(rep)} className="font-heading font-bold text-[16px] hover:text-navy transition-colors">{rep.name.split(' ')[0]}</button>
      <div className="text-[11.5px] text-muted mt-0.5">{rep.role}</div>
      {mode === 'qualified' ? (
        <>
          <div className="font-display font-semibold text-[30px] tracking-tight mt-2.5 leading-none">
            {credits.toFixed(1)}<span className="text-[13px] font-medium text-muted"> cr</span>
          </div>
          <div className="text-[11.5px] mt-1 text-muted">
            {meetingCount} meeting{meetingCount !== 1 ? 's' : ''}
          </div>
        </>
      ) : (
        <>
          <div className="font-display font-semibold text-[30px] tracking-tight mt-2.5 leading-none">{meetingCount}</div>
          <div className="text-[11.5px] mt-1 text-muted">{MODE_UNITS[mode]}</div>
        </>
      )}
      {mode !== 'qualified' ? null : isRamping ? (
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-pale text-navy mt-2">
          Ramp M{rep.rampMonth} · {rep.multiplier}×
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-line text-muted mt-2">
          Fully ramped · 1.0×
        </span>
      )}
      {/* Stand */}
      <div className={`mt-3 rounded-t-xl border border-b-0 border-line ${standHeights[rank - 1]} ${
        rank === 1
          ? 'bg-pale'
          : 'bg-line'
      }`} />
    </div>
  );
}

export default function Leaderboard({ team, meetings, excludedCount = 0, mode = 'qualified', loading, region, onRepClick, onExcludedClick }) {
  if (loading) {
    return (
      <div className="bg-card border border-line rounded-2xl p-8 animate-pulse">
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="flex flex-col items-center gap-3">
              <div className="w-16 h-16 rounded-full bg-line" />
              <div className="h-4 w-20 bg-line rounded" />
              <div className="h-8 w-16 bg-line rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const reps = team.filter(m => {
    if (!isLeaderboardRep(m)) return false;
    if (region && region !== 'All' && m.region !== region) return false;
    return true;
  });

  const sorted = [...reps].sort((a, b) => repScore(b, meetings, mode) - repScore(a, meetings, mode));

  const top3 = sorted.slice(0, 3);
  const rest = sorted.slice(3);

  // Reorder for podium: 2nd, 1st, 3rd
  const podiumOrder = top3.length >= 3
    ? [top3[1], top3[0], top3[2]]
    : top3;

  return (
    <div className="bg-card border border-line rounded-2xl shadow-sm overflow-hidden">
      <div className="flex">
        {/* Podium */}
        <div className="flex-1 grid grid-cols-3 items-end px-6 pt-7 bg-sunken">
          {podiumOrder.map(rep => {
            const rank = sorted.indexOf(rep) + 1;
            return <RepPodium key={rep.id} rep={rep} meetings={meetings} rank={rank} mode={mode} onRepClick={onRepClick} />;
          })}
        </div>

        {/* Non-podium sidebar: 4th, 5th+ */}
        {rest.length > 0 && (
          <div className="w-52 flex-shrink-0 border-l border-line bg-sunken flex flex-col justify-center gap-4 px-5 pt-7 pb-6">
            {rest.map((rep, i) => {
              const meetingCount = repMeetingCount(rep, meetings);
              const credits = calcCredits(meetingCount, rep.multiplier);
              return (
                <button key={rep.id} onClick={() => onRepClick?.(rep)} className="flex items-center gap-2.5 w-full text-left group">
                  <span className="w-5 h-5 rounded-full bg-line text-muted text-[10px] font-bold grid place-items-center flex-shrink-0">
                    {i + 4}
                  </span>
                  {rep.photoThumb ? (
                    <img src={rep.photoThumb} alt={rep.name} className="w-8 h-8 rounded-full object-cover flex-shrink-0 group-hover:opacity-75 transition-opacity" />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-navy-700 text-white grid place-items-center font-heading font-bold text-[12px] flex-shrink-0 group-hover:opacity-75 transition-opacity">
                      {initials(rep.name)}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-heading font-semibold text-[13px] truncate group-hover:text-navy transition-colors">{rep.name.split(' ')[0]}</div>
                    <div className="text-muted text-[10.5px]">{rep.role}</div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    {mode === 'qualified' ? (
                      <>
                        <div className="font-heading font-bold text-[16px]">
                          {credits.toFixed(1)}<span className="text-[10px] font-normal text-muted ml-0.5">cr</span>
                        </div>
                        <div className="text-muted text-[10.5px]">{meetingCount} mtg</div>
                      </>
                    ) : (
                      <>
                        <div className="font-heading font-bold text-[16px]">{meetingCount}</div>
                        <div className="text-muted text-[10.5px]">{MODE_UNITS[mode]}</div>
                      </>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex justify-between items-center px-5 py-3.5 border-t border-line bg-sunken text-[12.5px] text-muted">
        <span>{MODE_FOOTERS[mode]}</span>
        {excludedCount > 0 ? (
          <button onClick={onExcludedClick} className="font-semibold text-red hover:underline">
            {excludedCount} excluded (no company or SDR) · review ↗
          </button>
        ) : (
          <span>Nothing excluded · live data</span>
        )}
      </div>
    </div>
  );
}
