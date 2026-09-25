import React from 'react';

export default function StatCard({ label, value, meta, feature, valueClass }) {
  return (
    <div className={`rounded-2xl border p-6 shadow-sm relative overflow-hidden ${
      feature
        ? 'bg-navy border-transparent text-on-dark'
        : 'bg-card border-line text-ink'
    }`}>
      <div className={`text-[12.5px] font-medium ${feature ? 'text-on-dark/75' : 'text-muted'}`}>
        {label}
      </div>
      <div className={`font-display text-[36px] font-semibold tracking-tight mt-3 leading-none ${feature ? 'text-white' : ''} ${valueClass ?? ''}`}>
        {value}
      </div>
      {meta && (
        <div className={`text-[12.5px] mt-2 ${feature ? 'text-on-dark/75' : 'text-muted'}`}>
          {meta}
        </div>
      )}
    </div>
  );
}
