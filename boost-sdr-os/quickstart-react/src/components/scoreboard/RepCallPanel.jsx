import React, { useMemo } from 'react';

// ── Helpers ───────────────────────────────────────────────────────

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

// #1.NoAnswer tag — text field returns comma-separated tag names e.g. "1.NoAnswer"
function isNoAnswer(call) {
  const text = call.column_values?.find(c => c.id === 'tag_mm193gqc')?.text ?? '';
  return text.toLowerCase().includes('noanswer');
}

function recordingUrl(call) {
  try {
    const v = JSON.parse(call.column_values?.find(c => c.id === 'link_mm19c866')?.value ?? 'null');
    return v?.url ?? null;
  } catch { return null; }
}

function randomPick(arr) {
  if (!arr || !arr.length) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

// ── Sub-components ────────────────────────────────────────────────

function StatBox({ label, value, sub }) {
  return (
    <div className="text-center">
      <div className="font-display font-bold text-[22px] text-ink leading-none">{value}</div>
      {sub && <div className="text-[10px] text-mint-deep font-semibold mt-0.5">{sub}</div>}
      <div className="text-[11px] text-muted mt-1">{label}</div>
    </div>
  );
}

function DurationBar({ label, count, total, color }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="mb-2.5 last:mb-0">
      <div className="flex justify-between text-[12px] mb-1">
        <span className="text-muted">{label}</span>
        <span className="font-display font-semibold text-ink">
          {count} calls <span className="text-muted font-normal">({pct}%)</span>
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-[#E8E3DA] overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function RecordingCard({ label, call, mins }) {
  const url = call ? recordingUrl(call) : null;
  return (
    <div className="border border-line rounded-xl p-3.5 bg-canvas">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</span>
        <span className="text-[12px] font-display font-bold text-ink">
          {mins != null ? `${mins}m` : '—'}
        </span>
      </div>
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-teal hover:text-teal-mid transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <polygon points="10,8 16,12 10,16" fill="currentColor" stroke="none"/>
          </svg>
          Listen to recording
        </a>
      ) : (
        <span className="text-[12px] text-muted italic">No recording available</span>
      )}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────

export default function RepCallPanel({ rep, calls, periodLabel, onClose }) {
  const repCalls = calls.filter(c => {
    const raw = c.column_values?.find(col => col.id === 'multiple_person_mm2cff2x')?.value;
    return raw && parsePersonIds(raw).includes(rep.mondayUserId ?? '');
  });

  const enriched = useMemo(() => repCalls.map(c => ({
    call: c,
    mins: callDurationMins(c),
    noAnswer: isNoAnswer(c),
  })), [rep.id, calls.length]);

  const totalDials  = enriched.length;
  const connected   = enriched.filter(e => !e.noAnswer);
  const connectRate = totalDials > 0 ? Math.round((connected.length / totalDials) * 100) : 0;

  // Buckets — 0-1 min includes all calls (NoAnswer always lands here)
  // 2-3 min and >3 min exclude NoAnswer
  const zeroTo1   = connected.filter(e => e.mins <= 1);
  const two2three = connected.filter(e => e.mins >= 2 && e.mins <= 3);
  const over3     = connected.filter(e => e.mins > 3);

  const avgMins = connected.length > 0
    ? Math.round(connected.filter(e => e.mins > 0).reduce((a, e) => a + e.mins, 0) / connected.filter(e => e.mins > 0).length)
    : 0;

  // Sample recordings — one per bucket, prefer those with recordings
  const withRecording = (arr) => arr.filter(e => recordingUrl(e.call));
  const sampleShort = randomPick(withRecording(zeroTo1))   ?? randomPick(zeroTo1);
  const sampleMid   = randomPick(withRecording(two2three)) ?? randomPick(two2three);
  const sampleLong  = randomPick(withRecording(over3))     ?? randomPick(over3);

  const initials = rep.name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-ink/20 z-40 backdrop-blur-[1px]" onClick={onClose} />

      {/* Panel */}
      <div className="fixed inset-y-0 right-0 w-[400px] bg-card border-l border-line shadow-2xl z-50 flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-line bg-gradient-to-b from-[#F0EBE2] to-card flex-shrink-0">
          {rep.photoThumb ? (
            <img src={rep.photoThumb} alt={rep.name} className="w-10 h-10 rounded-full object-cover flex-shrink-0" />
          ) : (
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-teal to-teal-mid text-white grid place-items-center font-display font-bold text-[15px] flex-shrink-0">
              {initials}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="font-display font-bold text-[16px]">{rep.name}</div>
            <div className="text-[11.5px] text-muted">{rep.role} · {periodLabel}</div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-canvas hover:bg-line flex items-center justify-center text-muted hover:text-ink transition-colors flex-shrink-0"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">

          {/* Summary stats */}
          <div className="px-5 py-5 border-b border-line">
            <p className="font-display text-[11px] font-semibold tracking-[.12em] uppercase text-muted mb-4">Call summary</p>
            <div className="grid grid-cols-3 gap-4">
              <StatBox label="Total dials"   value={totalDials} />
              <StatBox label="Connected"     value={connected.length} />
              <StatBox
                label="Connect rate"
                value={`${connectRate}%`}
                sub={connectRate >= 30 ? '▲ Strong' : connectRate >= 15 ? '→ Avg' : '▼ Low'}
              />
            </div>
            <div className="grid grid-cols-3 gap-4 mt-5 pt-4 border-t border-line">
              <StatBox label="0–1 min (connected)"  value={zeroTo1.length} />
              <StatBox label="2–3 min"    value={two2three.length} />
              <StatBox label="> 3 min"    value={over3.length} />
            </div>
            <div className="mt-4 pt-4 border-t border-line text-center">
              <div className="text-[11px] text-muted uppercase tracking-wide font-semibold mb-1">Avg connected call</div>
              <div className="font-display font-bold text-[24px] text-ink">
                {avgMins > 0 ? `${avgMins}m` : '—'}
              </div>
            </div>
          </div>

          {/* Duration breakdown */}
          <div className="px-5 py-5 border-b border-line">
            <p className="font-display text-[11px] font-semibold tracking-[.12em] uppercase text-muted mb-4">Duration breakdown</p>
            <DurationBar label="0–1 min (connected)"        count={zeroTo1.length}   total={totalDials} color="bg-red" />
            <DurationBar label="2–3 min"                    count={two2three.length} total={totalDials} color="bg-amber" />
            <DurationBar label="> 3 min (meaningful)"       count={over3.length}     total={totalDials} color="bg-mint-deep" />
          </div>

          {/* Sample recordings */}
          <div className="px-5 py-5">
            <p className="font-display text-[11px] font-semibold tracking-[.12em] uppercase text-muted mb-1">Sample recordings</p>
            <p className="text-[11.5px] text-muted mb-4">One random call from each bucket — refreshes each time you open.</p>
            <div className="flex flex-col gap-2.5">
              <RecordingCard label="0–1 min"    call={sampleShort?.call} mins={sampleShort?.mins} />
              <RecordingCard label="2–3 min"    call={sampleMid?.call}   mins={sampleMid?.mins} />
              <RecordingCard label="> 3 min"    call={sampleLong?.call}  mins={sampleLong?.mins} />
            </div>
          </div>

        </div>
      </div>
    </>
  );
}
