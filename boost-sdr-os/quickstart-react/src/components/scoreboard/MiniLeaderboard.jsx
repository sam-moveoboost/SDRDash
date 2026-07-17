import React from 'react';

function initials(name) {
  return name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
}

// Lime (#C8EC78) is light — use dark teal text for contrast
const MEDAL_BG   = ['bg-mint',        'bg-[#CBD8D5]',      'bg-[#E0C9A0]'      ];
const MEDAL_TEXT = ['text-teal-deep', 'text-teal-deep',    'text-[#6b4e1e]'    ];
const STAND_H    = ['h-9',            'h-6',               'h-3'               ];

function PodiumSlot({ rep, value, rank, unit, onRepClick }) {
  const avatarCls = rank === 1
    ? 'w-[52px] h-[52px] text-[17px]'
    : 'w-[40px] h-[40px] text-[13px]';

  // Navy-based avatar gradients
  const avatarGrad = rank === 1
    ? 'from-teal to-teal-mid'
    : rank === 2
      ? 'from-[#1E3650] to-[#192D3F]'
      : 'from-[#2E4A63] to-[#1E3650]';

  return (
    <div className="flex flex-col items-center text-center px-1.5">
      {/* Avatar — clickable */}
      <button onClick={() => onRepClick?.(rep)} className="group block">
        <div className={`rounded-full grid place-items-center font-display font-bold text-white mb-1.5 relative bg-gradient-to-br ${avatarGrad} ${avatarCls} group-hover:opacity-75 transition-opacity`}>
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
      <button onClick={() => onRepClick?.(rep)} className="font-display font-semibold text-[12px] leading-tight truncate max-w-[56px] hover:text-teal transition-colors">
        {rep.name.split(' ')[0]}
      </button>

      {/* Score */}
      <div className={`font-display font-bold leading-none mt-0.5 ${rank === 1 ? 'text-[20px] text-teal' : 'text-[16px] text-ink'}`}>
        {value}
        <span className="text-[10px] font-normal text-muted ml-0.5">{unit}</span>
      </div>

      {/* Stand */}
      <div className={`mt-2 w-full rounded-t-lg border border-b-0 border-line ${STAND_H[rank - 1]} ${
        rank === 1
          ? 'bg-gradient-to-b from-mint-soft to-[#D8F09A]'
          : 'bg-gradient-to-b from-[#EAE5DC] to-[#DDD7CE]'
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
      <div className="px-4 pt-3.5 flex items-baseline justify-between bg-gradient-to-b from-[#F0EBE2] to-card">
        <p className="font-display font-bold text-[15px] tracking-tight">{title}</p>
        {subtitle && <p className="text-muted text-[11.5px]">{subtitle}</p>}
      </div>

      {/* Body: podium + sidebar */}
      <div className="flex flex-1 bg-gradient-to-b from-[#F0EBE2] to-card">
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
                  <div className="w-6 h-6 rounded-full bg-gradient-to-br from-[#2E4A63] to-[#1E3650] text-white grid place-items-center font-display font-bold text-[9px] flex-shrink-0 group-hover:opacity-75 transition-opacity">
                    {initials(rep.name)}
                  </div>
                )}
                <span className="font-display font-semibold text-[12px] flex-1 truncate group-hover:text-teal transition-colors">{rep.name.split(' ')[0]}</span>
                <span className={`font-display font-bold text-[13px] ${value > 0 ? 'text-ink' : 'text-muted'}`}>
                  {loading ? '—' : value}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex justify-between items-center px-4 py-2.5 border-t border-line bg-[#FAF8F5] text-[11.5px] text-muted">
        <span>{subtitle ?? title}</span>
        <span>Live data</span>
      </div>
    </div>
  );
}
