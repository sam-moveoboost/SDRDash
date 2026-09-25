import React from 'react';

function initials(name) {
  return name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
}

// Medal tints are light, so pair them with navy text
const MEDAL_BG   = ['bg-pale',        'bg-mint',      'bg-lavender'      ];
const MEDAL_TEXT = ['text-navy', 'text-navy',    'text-navy'    ];
const STAND_H    = ['h-9',            'h-6',               'h-3'               ];

function PodiumSlot({ rep, value, rank, unit, onRepClick }) {
  const avatarCls = rank === 1
    ? 'w-[52px] h-[52px] text-[17px]'
    : 'w-[40px] h-[40px] text-[13px]';

  // Navy avatars: primary navy for 1st, supporting navy for 2nd/3rd
  const avatarGrad = rank === 1 ? 'bg-navy' : 'bg-navy-700';

  return (
    <div className="flex flex-col items-center text-center px-1.5">
      {/* Avatar — clickable */}
      <button onClick={() => onRepClick?.(rep)} className="group block">
        <div className={`rounded-full grid place-items-center font-heading font-bold text-white mb-1.5 relative ${avatarGrad} ${avatarCls} group-hover:opacity-75 transition-opacity`}>
          {rep.photoThumb
            ? <img src={rep.photoThumb} alt={rep.name} className="absolute inset-0 w-full h-full object-cover rounded-full" />
            : initials(rep.name)
          }
          <span
            className={`absolute -top-1 -right-1 rounded-full grid place-items-center text-[9px] font-bold border border-white ${MEDAL_BG[rank - 1]} ${MEDAL_TEXT[rank - 1]}`}
            style={{ width: 16, height: 16 }}
          >
            {rank}
          </span>
        </div>
      </button>

      {/* Name — clickable */}
      <button onClick={() => onRepClick?.(rep)} className="font-heading font-semibold text-[12px] leading-tight truncate max-w-[56px] hover:text-navy transition-colors">
        {rep.name.split(' ')[0]}
      </button>

      {/* Score */}
      <div className={`font-heading font-bold leading-none mt-0.5 ${rank === 1 ? 'text-[20px] text-navy' : 'text-[16px] text-ink'}`}>
        {value}
        <span className="text-[10px] font-normal text-muted ml-0.5">{unit}</span>
      </div>

      {/* Stand */}
      <div className={`mt-2 w-full rounded-t-lg border border-b-0 border-line ${STAND_H[rank - 1]} ${
        rank === 1
          ? 'bg-pale'
          : 'bg-line'
      }`} />
    </div>
  );
}

export default function MiniLeaderboard({ title, subtitle, team, getData, unit, loading, region, onRepClick }) {
  const reps = team.filter(m => {
    if (!['SDR', 'Hybrid'].includes(m.role)) return false;
    if (region && region !== 'All' && m.region !== region) return false;
    return true;
  });

  const ranked = [...reps]
    .map(rep => ({ rep, value: loading ? 0 : getData(rep) }))
    .sort((a, b) => b.value - a.value);

  const top3 = ranked.slice(0, 3);
  const rest = ranked.slice(3);

  // Classic podium ordering: 2nd left, 1st centre, 3rd right
  const podiumOrder = top3.length >= 3
    ? [top3[1], top3[0], top3[2]]
    : top3.length === 2
      ? [top3[1], top3[0]]
      : top3;

  return (
    <div className="bg-card border border-line rounded-2xl shadow-sm overflow-hidden flex flex-col">
      {/* Header */}
      <div className="px-4 pt-3.5 flex items-baseline justify-between bg-sunken">
        <p className="font-heading font-bold text-[15px] tracking-tight">{title}</p>
        {subtitle && <p className="text-muted text-[11.5px]">{subtitle}</p>}
      </div>

      {/* Body: podium + sidebar */}
      <div className="flex flex-1 bg-sunken">
        {/* Podium area */}
        <div className="flex-1 flex items-end justify-around px-3 pt-3">
          {loading ? (
            <>
              {[1, 2, 3].map(i => (
                <div key={i} className="flex flex-col items-center gap-1.5 pb-0">
                  <div className={`rounded-full bg-line animate-pulse ${i === 1 ? 'w-12 h-12' : 'w-10 h-10'}`} />
                  <div className="h-3 w-14 bg-line rounded animate-pulse" />
                  <div className="h-4 w-8 bg-line rounded animate-pulse" />
                  <div className={`w-12 rounded-t-lg bg-line ${i === 1 ? 'h-9' : 'h-5'}`} />
                </div>
              ))}
            </>
          ) : podiumOrder.length === 0 ? (
            <div className="py-8 text-center text-muted text-[13px] w-full">No data</div>
          ) : (
            podiumOrder.map(({ rep, value }) => {
              const rank = ranked.findIndex(r => r.rep.id === rep.id) + 1;
              return (
                <PodiumSlot key={rep.id} rep={rep} value={value} rank={rank} unit={unit} onRepClick={onRepClick} />
              );
            })
          )}
        </div>

        {/* Sidebar: 4th, 5th+ */}
        {rest.length > 0 && (
          <div className="w-[128px] flex-shrink-0 border-l border-line flex flex-col justify-center gap-2 px-3 py-4">
            {rest.map(({ rep, value }, i) => (
              <button key={rep.id} onClick={() => onRepClick?.(rep)} className="flex items-center gap-1.5 w-full text-left group">
                <span className="text-muted text-[11px] font-semibold w-3.5 text-center">{i + 4}</span>
                {rep.photoThumb ? (
                  <img src={rep.photoThumb} alt={rep.name} className="w-6 h-6 rounded-full object-cover flex-shrink-0 group-hover:opacity-75 transition-opacity" />
                ) : (
                  <div className="w-6 h-6 rounded-full bg-navy-700 text-white grid place-items-center font-heading font-bold text-[9px] flex-shrink-0 group-hover:opacity-75 transition-opacity">
                    {initials(rep.name)}
                  </div>
                )}
                <span className="font-heading font-semibold text-[12px] flex-1 truncate group-hover:text-navy transition-colors">{rep.name.split(' ')[0]}</span>
                <span className={`font-heading font-bold text-[13px] ${value > 0 ? 'text-ink' : 'text-muted'}`}>
                  {loading ? '—' : value}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex justify-between items-center px-4 py-2.5 border-t border-line bg-sunken text-[11.5px] text-muted">
        <span>{subtitle ?? title}</span>
        <span>Live data</span>
      </div>
    </div>
  );
}
