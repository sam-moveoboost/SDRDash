import React, { useState } from 'react';

// Small dependency-free charts in the boost palette. Marks are thin, bars are
// anchored to the baseline, and every mark has a hover tooltip.

export const COLORS = {
  navy: '#1a385e',
  emerald: '#027361',
  purple: '#916aff',
  amber: '#cf9a2b',
  red: '#c44536',
  muted: '#757c77',
  grid: '#e4e6e4',
};

// Horizontal bars. data: [{ label, value, sub?, color?, tip? }]
export function HBarChart({ data, format = String, color = COLORS.navy, empty = 'No data yet.', labelWidth = 150 }) {
  if (!data.length) return <p className="text-muted text-[13px]">{empty}</p>;
  const max = Math.max(...data.map(d => d.value), 1);
  return (
    <div className="space-y-2.5">
      {data.map(d => (
        <div key={d.label} className="flex items-center gap-3 group" title={d.tip || `${d.label}: ${format(d.value)}${d.sub ? ` (${d.sub})` : ''}`}>
          <div className="text-[12.5px] font-medium text-ink truncate flex-shrink-0" style={{ width: labelWidth }}>{d.label}</div>
          <div className="flex-1 h-[14px] bg-sunken rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-opacity group-hover:opacity-80"
              style={{ width: `${Math.max(2, (d.value / max) * 100)}%`, background: d.color || color }}
            />
          </div>
          <div className="text-[12.5px] font-semibold text-ink w-16 text-right flex-shrink-0">{format(d.value)}</div>
          {d.sub != null && <div className="text-[11.5px] text-muted w-24 text-right flex-shrink-0 truncate">{d.sub}</div>}
        </div>
      ))}
    </div>
  );
}

// Vertical columns over time. data: [{ label, value, count?, year? }]
export function ColumnChart({ data, format = String, height = 190, color = COLORS.navy }) {
  const [hover, setHover] = useState(null);
  const W = 640;
  const padL = 44, padR = 8, padT = 14, padB = 26;
  const innerW = W - padL - padR;
  const innerH = height - padT - padB;
  const max = Math.max(...data.map(d => d.value), 1);
  const ticks = [0, 0.5, 1].map(f => max * f);
  const slot = innerW / data.length;
  const barW = Math.min(26, slot - 8);
  const h = hover != null ? data[hover] : null;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${height}`} className="w-full h-auto" role="img" aria-label="Won value by month">
        {ticks.map(t => {
          const y = padT + innerH - (t / max) * innerH;
          return (
            <g key={t}>
              <line x1={padL} x2={W - padR} y1={y} y2={y} stroke={COLORS.grid} strokeWidth="1" />
              <text x={padL - 8} y={y + 4} textAnchor="end" fontSize="10.5" fill={COLORS.muted}>{format(t)}</text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const bh = (d.value / max) * innerH;
          const x = padL + slot * i + (slot - barW) / 2;
          const y = padT + innerH - bh;
          return (
            <g key={d.label + i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={padL + slot * i} y={padT} width={slot} height={innerH + padB} fill="transparent" />
              {bh > 0 && (
                <path
                  d={`M${x},${padT + innerH} V${y + 4} Q${x},${y} ${x + 4},${y} H${x + barW - 4} Q${x + barW},${y} ${x + barW},${y + 4} V${padT + innerH} Z`}
                  fill={color}
                  opacity={hover == null || hover === i ? 1 : 0.45}
                />
              )}
              <text x={x + barW / 2} y={height - 8} textAnchor="middle" fontSize="10.5" fill={COLORS.muted}>{d.label}</text>
            </g>
          );
        })}
      </svg>
      {h && (
        <div className="absolute top-0 right-0 bg-card border border-line rounded-xl shadow-md px-3 py-2 text-[12px] pointer-events-none">
          <div className="font-semibold text-ink">{h.label}{h.year ? ` ${h.year}` : ''}</div>
          <div className="text-body">{format(h.value)}{h.count != null ? ` · ${h.count} deal${h.count === 1 ? '' : 's'}` : ''}</div>
        </div>
      )}
    </div>
  );
}

// Funnel-style rows: bar length is value, text shows count and weighted value.
export function StageBars({ data, format }) {
  if (!data.length) return <p className="text-muted text-[13px]">No open deals.</p>;
  const max = Math.max(...data.map(d => d.value), 1);
  return (
    <div className="space-y-2.5">
      {data.map(d => {
        const parked = d.stage === 'Ghosting' || d.stage === 'On hold';
        return (
          <div key={d.stage} className="flex items-center gap-3" title={`${d.stage}: ${d.count} deals, ${format(d.value)} (weighted ${format(d.weighted)})`}>
            <div className="w-44 text-[12.5px] font-medium text-ink truncate flex-shrink-0">{d.stage}</div>
            <div className="flex-1 h-[14px] bg-sunken rounded-full overflow-hidden relative">
              <div className="h-full rounded-full" style={{ width: `${Math.max(2, (d.value / max) * 100)}%`, background: parked ? COLORS.amber : COLORS.navy, opacity: 0.35 }} />
              <div className="h-full rounded-full absolute left-0 top-0" style={{ width: `${Math.max(1, (d.weighted / max) * 100)}%`, background: parked ? COLORS.amber : COLORS.navy }} />
            </div>
            <div className="text-[12.5px] font-semibold text-ink w-16 text-right flex-shrink-0">{format(d.value)}</div>
            <div className="text-[11.5px] text-muted w-16 text-right flex-shrink-0">{d.count} deals</div>
          </div>
        );
      })}
      <div className="text-[11.5px] text-muted pt-1">Pale bar is total value. Solid bar is weighted by win probability. Amber stages rarely convert without a re-engage.</div>
    </div>
  );
}
