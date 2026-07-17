import React from 'react';

function initials(name) {
  return name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
}

function parsePersonIds(value) {
  try { return (JSON.parse(value).personsAndTeams ?? []).map(p => String(p.id)); }
  catch { return []; }
}

function repMeetingCount(rep, meetings) {
  if (!rep.mondayUserId) return 0;
  return meetings.filter(m => {
    // multiple_person_mm2bjm2z = the SDR column; lead_owner = the BDM
    const raw = m.column_values?.find(c => c.id === 'multiple_person_mm2bjm2z')?.value;
    return raw && parsePersonIds(raw).includes(rep.mondayUserId);
  }).length;
}

// credits = meetings × ramp multiplier (credit boost)
function calcCredits(meetings, multiplier) {
  return meetings * (multiplier || 1);
}

function RepPodium({ rep, meetings, rank, onRepClick }) {
  const meetingCount = repMeetingCount(rep, meetings);
  const credits = calcCredits(meetingCount, rep.multiplier);
  const isRamping = rep.rampMonth && rep.rampMonth !== 'None';

  // Navy-based podium gradients
  const podiumGradients = [
    'from-teal to-teal-mid',            // 1st — primary navy
    'from-[#1E3650] to-[#192D3F]',      // 2nd — mid navy
    'from-[#2E4A63] to-[#1E3650]',      // 3rd — lighter navy
  ];
  const standHeights = ['h-14', 'h-9', 'h-6'];
  const avatarSizes = [
    'w-[74px] h-[74px] text-[27px]',
    'w-[60px] h-[60px] text-[22px]',
    'w-[60px] h-[60px] text-[22px]',
  ];
  // Medal: lime for 1st, silver/bronze for 2nd/3rd
  const medalColors = [
    'bg-mint text-teal-deep',
    'bg-[#CBD8D5] text-teal-deep',
    'bg-[#E0C9A0] text-[#6b4e1e]',
  ];

  return (
    <div className="text-center px-3 pb-6 relative">
      <button
        onClick={() => onRepClick?.(rep)}
        className="block mx-auto group"
        title={`View ${rep.name.split(' ')[0]}'s calls`}
      >
        <div className={`rounded-full mx-auto mb-2.5 grid place-items-center font-display font-bold text-white relative bg-gradient-to-br ${podiumGradients[rank - 1]} ${avatarSizes[rank - 1]} ${rank === 1 ? 'shadow-[0_8px_20px_rgba(25,45,63,.30)]' : ''} group-hover:opacity-80 transition-opacity`}>
          {rep.photoThumb
            ? <img src={rep.photoThumb} alt={rep.name} className="absolute inset-0 w-full h-full object-cover rounded-full" />
            : initials(rep.name)
          }
          <span className={`absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full grid place-items-center text-[11px] font-bold border-2 border-card ${medalColors[rank - 1]}`}>
            {rank}
          </span>
        </div>
      </button>
      <button onClick={() => onRepClick?.(rep)} className="font-display font-bold text-[16px] hover:text-teal transition-colors">{rep.name.split(' ')[0]}</button>
      <div className="text-[11.5px] text-muted mt-0.5">{rep.role}</div>
      <div className="font-display font-bold text-[30px] tracking-tight mt-2.5 leading-none">
        {credits.toFixed(1)}<span className="text-[13px] font-medium text-muted"> cr</span>
      </div>
      <div className="text-[11.5px] mt-1 text-muted">
        {meetingCount} meeting{meetingCount !== 1 ? 's' : ''}
      </div>
      {isRamping ? (
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-mint-soft text-teal mt-2">
          Ramp M{rep.rampMonth} · {rep.multiplier}×
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-[#E8E3DA] text-muted mt-2">
          Fully ramped · 1.0×
        </span>
      )}
      {/* Stand */}
      <div className={`mt-3 rounded-t-xl border border-b-0 border-line ${standHeights[rank - 1]} ${
        rank === 1
          ? 'bg-gradient-to-b from-mint-soft to-[#D8F09A]'
          : 'bg-gradient-to-b from-[#EAE5DC] to-[#DDD7CE]'
      }`} />
    </div>
  );
}

export default function Leaderboard({ team, meetings, loading, region, onRepClick }) {
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
    if (!['SDR', 'Hybrid'].includes(m.role)) return false;
    if (region && region !== 'All' && m.region !== region) return false;
    return true;
  });

  const sorted = [...reps].sort((a, b) => {
    const credA = calcCredits(repMeetingCount(a, meetings), a.multiplier);
    const credB = calcCredits(repMeetingCount(b, meetings), b.multiplier);
    return credB - credA;
  });

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
        <div className="flex-1 grid grid-cols-3 items-end px-6 pt-7 bg-gradient-to-b from-[#F0EBE2] to-card">
          {podiumOrder.map(rep => {
            const rank = sorted.indexOf(rep) + 1;
            return <RepPodium key={rep.id} rep={rep} meetings={meetings} rank={rank} onRepClick={onRepClick} />;
          })}
        </div>

        {/* Non-podium sidebar: 4th, 5th+ */}
        {rest.length > 0 && (
          <div className="w-52 flex-shrink-0 border-l border-line bg-gradient-to-b from-[#F0EBE2] to-card flex flex-col justify-center gap-4 px-5 pt-7 pb-6">
            {rest.map((rep, i) => {
              const meetingCount = repMeetingCount(rep, meetings);
              const credits = calcCredits(meetingCount, rep.multiplier);
              return (
                <button key={rep.id} onClick={() => onRepClick?.(rep)} className="flex items-center gap-2.5 w-full text-left group">
                  <span className="w-5 h-5 rounded-full bg-[#E8E3DA] text-muted text-[10px] font-bold grid place-items-center flex-shrink-0">
                    {i + 4}
                  </span>
                  {rep.photoThumb ? (
                    <img src={rep.photoThumb} alt={rep.name} className="w-8 h-8 rounded-full object-cover flex-shrink-0 group-hover:opacity-75 transition-opacity" />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#2E4A63] to-[#1E3650] text-white grid place-items-center font-display font-bold text-[12px] flex-shrink-0 group-hover:opacity-75 transition-opacity">
                      {initials(rep.name)}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-display font-semibold text-[13px] truncate group-hover:text-teal transition-colors">{rep.name.split(' ')[0]}</div>
                    <div className="text-muted text-[10.5px]">{rep.role}</div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="font-display font-bold text-[16px]">
                      {credits.toFixed(1)}<span className="text-[10px] font-normal text-muted ml-0.5">cr</span>
                    </div>
                    <div className="text-muted text-[10.5px]">{meetingCount} mtg</div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex justify-between items-center px-5 py-3.5 border-t border-line bg-[#FAF8F5] text-[12.5px] text-muted">
        <span>Credits = qualified meetings × ramp multiplier (credit boost)</span>
        <span>Live data</span>
      </div>
    </div>
  );
}
