import React from 'react';

export default function StatCard({ label, value, meta, feature, valueClass }) {
  return (
    <div className={`rounded-2xl border p-5 shadow-sm relative overflow-hidden ${
      feature
        ? 'bg-gradient-to-br from-teal to-teal-mid border-transparent text-white'
        : 'bg-card border-line text-ink'
    }`}>
      <div className={`text-[12.5px] font-semibold tracking-wide ${feature ? 'text-white/70' : 'text-muted'}`}>
        {label}
      </div>
      <div className={`font-display text-[34px] font-bold tracking-tight mt-2 leading-none ${valueClass ?? ''}`}>
        {value}
      </div>
      {meta && (
        <div className={`text-[12.5px] mt-2 ${feature ? 'text-white/75' : 'text-muted'}`}>
          {meta}
        </div>
      )}
    </div>
  );
}
