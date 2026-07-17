import React from 'react';

function daysSince(dateStr) {
  if (!dateStr) return 0;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

function staleFlagClass(days) {
  if (days >= 21) return 'bg-red';
  if (days >= 14) return 'bg-amber';
  return 'bg-mint';
}

function psRateClass(rate) {
  if (rate >= 205) return { chip: 'bg-mint-soft text-mint-deep', label: `£${rate}` };
  if (rate >= 180) return { chip: 'bg-amber-soft text-amber',    label: `£${rate}` };
  return           { chip: 'bg-red-soft text-red',               label: `£${rate}` };
}

export default function DealHealth({ opps, loading }) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3.5">
        {[1,2].map(i => <div key={i} className="bg-card border border-line rounded-2xl h-40 animate-pulse" />)}
      </div>
    );
  }

  const stale = opps
    .map(o => ({ ...o, idle: daysSince(o.updated_at) }))
    .filter(o => o.idle >= 14)
    .sort((a, b) => b.idle - a.idle)
    .slice(0, 8);

  const withRate = opps
    .filter(o => {
      const rateText = o.column_values?.find(c => c.id === 'ps_rate')?.text;
      return rateText && parseFloat(rateText) > 0;
    })
    .map(o => ({
      ...o,
      rate: parseFloat(o.column_values.find(c => c.id === 'ps_rate')?.text ?? '0'),
    }))
    .sort((a, b) => a.rate - b.rate)
    .slice(0, 8);

  return (
    <div className="grid grid-cols-2 gap-3.5">
      {/* Stale deals */}
      <div className="bg-card border border-line rounded-2xl shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-[18px] py-[15px] border-b border-line font-display font-semibold text-[14px]">
          Stale deals
          {stale.length > 0 && (
            <span className="text-[11.5px] font-semibold px-2.5 py-0.5 rounded-full bg-red-soft text-red">
              {stale.length} flagged
            </span>
          )}
        </div>
        {stale.length === 0 ? (
          <div className="px-[18px] py-4 text-[13.5px] text-muted">No stale deals. Nice work.</div>
        ) : stale.map(opp => (
          <div key={opp.id} className="flex items-center gap-3 px-[18px] py-3 border-b border-line last:border-0 text-[13.5px]">
            <span className={`w-2 h-2 rounded-full flex-none ${staleFlagClass(opp.idle)}`} />
            <span className="font-semibold truncate">{opp.name}</span>
            <span className="text-muted text-[12px] ml-auto whitespace-nowrap">{opp.idle} days idle</span>
          </div>
        ))}
      </div>

      {/* PS rate check */}
      <div className="bg-card border border-line rounded-2xl shadow-sm overflow-hidden">
        <div className="px-[18px] py-[15px] border-b border-line font-display font-semibold text-[14px]">
          PS rate check
        </div>
        {withRate.length === 0 ? (
          <div className="px-[18px] py-4 text-[13.5px] text-muted">No PS rates set yet.</div>
        ) : withRate.map(opp => {
          const { chip, label } = psRateClass(opp.rate);
          return (
            <div key={opp.id} className="flex items-center gap-3 px-[18px] py-3 border-b border-line last:border-0 text-[13.5px]">
              <span className="font-semibold truncate">{opp.name}</span>
              <span className={`ml-auto font-display font-semibold text-[12.5px] px-2.5 py-0.5 rounded-lg ${chip}`}>
                {label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
