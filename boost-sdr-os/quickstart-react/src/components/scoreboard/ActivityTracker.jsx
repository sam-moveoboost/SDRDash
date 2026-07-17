import React from 'react';

function parsePersonIds(value) {
  try { return (JSON.parse(value).personsAndTeams ?? []).map(p => String(p.id)); }
  catch { return []; }
}

function callDurationMins(call) {
  try {
    const sv = JSON.parse(call.column_values?.find(c => c.id === 'date_mm19a9qc')?.value ?? 'null');
    const ev = JSON.parse(call.column_values?.find(c => c.id === 'date_mm19jrq')?.value ?? 'null');
    if (!sv?.time || !ev?.time) return 0;
    const start = new Date(`${sv.date}T${sv.time}Z`).getTime();
    const end   = new Date(`${ev.date}T${ev.time}Z`).getTime();
    return Math.max(0, Math.floor((end - start) / 60000));
  } catch { return 0; }
}

function isNoAnswer(call) {
  const text = call.column_values?.find(c => c.id === 'tag_mm193gqc')?.text ?? '';
  return text.toLowerCase().includes('noanswer');
}

function repProspectCount(rep, newProspects) {
  if (!rep.mondayUserId) return 0;
  return newProspects.filter(item => {
    const raw = item.column_values?.find(c => c.id === 'person')?.value;
    return raw && parsePersonIds(raw).includes(rep.mondayUserId);
  }).length;
}

function MetricBar({ label, value, target, loading }) {
  const pct = target > 0 ? Math.min(100, Math.round((value / target) * 100)) : 0;
  const color   = pct >= 100 ? 'bg-mint-deep' : pct >= 75 ? 'bg-amber' : 'bg-red';
  const textClr = pct >= 100 ? 'text-mint-deep' : pct >= 75 ? 'text-amber' : 'text-red';

  return (
    <div className="mb-2.5 last:mb-0">
      <div className="flex justify-between text-[12.5px] mb-1.5">
        <span className="text-muted font-medium">{label}</span>
        <span className={`font-display font-semibold ${textClr}`}>
          {loading ? '—' : `${value} / ${target}`}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-[#E8E3DA] overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${color}`}
          style={{ width: loading ? '0%' : `${pct}%` }}
        />
      </div>
    </div>
  );
}

function RepCard({ rep, calls, newProspects, loading, period, onRepClick }) {
  const mul = period === 'month' ? 4 : 1;
  const callTarget     = (rep.weeklyCallTarget || 0) * mul;
  const prospectTarget = (rep.weeklyProspects  || 0) * mul;
  const convoTarget    = (rep.weeklyConvos     || 0) * mul;

  // Untracked weekly targets shown as reminder text
  const emailTarget    = (rep.weeklyEmailTarget || 0) * mul;
  const linkedInTarget = (rep.weeklyLinkedIn    || 0) * mul;

  const isRamping = rep.rampMonth && rep.rampMonth !== 'None';
  const meetingTarget = isRamping ? rep.monthlyTarget : rep.fullQuota;

  // Outbound calls (Aircall)
  const repCalls = calls.filter(c => {
    if (!rep.mondayUserId) return false;
    try {
      const raw = c.column_values?.find(col => col.id === 'multiple_person_mm2cff2x')?.value;
      if (!raw) return false;
      return parsePersonIds(raw).includes(rep.mondayUserId);
    } catch { return false; }
  });

  const callCount = repCalls.length;

  // Meaningful convos: connected calls (non-NoAnswer) lasting > 3 minutes
  const convoCount = repCalls.filter(c => !isNoAnswer(c) && callDurationMins(c) > 3).length;

  // New prospects
  const prospectCount = repProspectCount(rep, newProspects);

  // Untracked targets reminder
  const untrackedParts = [];
  if (emailTarget > 0)    untrackedParts.push(`Emails ${emailTarget}`);
  if (linkedInTarget > 0) untrackedParts.push(`LinkedIn ${linkedInTarget}`);

  return (
    <div className="bg-card border border-line rounded-2xl p-[18px] shadow-sm">
      {/* Rep header — clickable to open call panel */}
      <button
        onClick={() => onRepClick?.(rep)}
        className="flex items-start gap-3 mb-4 w-full text-left group"
      >
        {rep.photoThumb ? (
          <img src={rep.photoThumb} alt={rep.name} className="w-[38px] h-[38px] rounded-full object-cover flex-none mt-0.5 group-hover:opacity-80 transition-opacity" />
        ) : (
          <div className="w-[38px] h-[38px] rounded-full bg-gradient-to-br from-teal to-teal-mid text-white grid place-items-center font-display font-bold text-[15px] flex-none mt-0.5 group-hover:opacity-80 transition-opacity">
            {rep.name.split(' ').map(n => n[0]).slice(0, 2).join('')}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="font-display font-semibold text-[15px] leading-tight group-hover:text-teal transition-colors">
            {rep.name}
            <span className="ml-1.5 text-[10px] text-muted font-normal opacity-0 group-hover:opacity-100 transition-opacity">
              View calls →
            </span>
          </div>
          <div className="text-[11.5px] text-muted mt-0.5">
            {isRamping
              ? `Ramp month ${rep.rampMonth} · target ${meetingTarget} meetings`
              : `${rep.role} · target ${meetingTarget} meetings`}
          </div>
          {untrackedParts.length > 0 && (
            <div className="text-[10.5px] text-muted/70 mt-0.5 italic">
              Also: {untrackedParts.join(' · ')} /wk
            </div>
          )}
        </div>
      </button>

      {/* Tracked metric bars */}
      <MetricBar label="Outbound calls"     value={callCount}     target={callTarget}     loading={loading} />
      <MetricBar label="Meaningful convos"  value={convoCount}    target={convoTarget}    loading={loading} />
      <MetricBar label="New prospects"      value={prospectCount} target={prospectTarget} loading={loading} />
    </div>
  );
}

export default function ActivityTracker({ team, calls, newProspects = [], loading, period = 'week', region, onRepClick }) {
  const reps = team.filter(m => {
    if (!['SDR', 'Hybrid'].includes(m.role)) return false;
    if (region && region !== 'All' && m.region !== region) return false;
    return true;
  });

  return (
    <div className="grid grid-cols-3 gap-3.5">
      {loading
        ? [1, 2, 3].map(i => (
            <div key={i} className="bg-card border border-line rounded-2xl p-5 animate-pulse h-52" />
          ))
        : reps.map(rep => (
            <RepCard
              key={rep.id}
              rep={rep}
              calls={calls}
              newProspects={newProspects}
              loading={loading}
              period={period}
              onRepClick={onRepClick}
            />
          ))
      }
    </div>
  );
}
