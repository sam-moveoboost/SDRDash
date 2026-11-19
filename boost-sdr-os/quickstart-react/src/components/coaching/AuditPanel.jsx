import React, { useState } from 'react';
import { coachingApi } from '../../api/coaching';

// Managers only. Reads what is really saved for every call and sets it against the board. Changes nothing.
export default function AuditPanel() {
  const [state, setState] = useState({ busy: false, data: null, error: null });

  const run = async (fresh) => {
    setState({ busy: true, data: null, error: null });
    try {
      setState({ busy: false, data: await coachingApi.audit(fresh), error: null });
    } catch (err) {
      setState({ busy: false, data: null, error: err.message || 'The check could not run.' });
    }
  };

  const d = state.data;
  const Row = ({ label, value, note }) => (
    <div className="flex items-baseline justify-between gap-4 py-1.5 border-b border-line last:border-0">
      <span className="text-[13px] text-body">{label}{note && <span className="block text-[12px] text-muted">{note}</span>}</span>
      <span className="text-[14px] font-medium text-ink tabular-nums">{value}</span>
    </div>
  );

  return (
    <div>
      <div className="flex items-center gap-3 flex-wrap">
        <button type="button" disabled={state.busy} onClick={() => run(false)} className="rounded-full bg-navy text-white text-[13px] font-medium px-4 py-2 border-0 cursor-pointer disabled:opacity-60">
          {state.busy ? 'Checking, this can take a minute...' : 'Check what is saved'}
        </button>
        <span className="text-[12.5px] text-muted">Reads every call and what is saved for it. It changes nothing.</span>
      </div>
      {state.error && <div className="text-[13px] text-red-700 mt-3">{state.error}</div>}
      {d && (
        <div className="mt-4 grid gap-6 md:grid-cols-2">
          <div>
            <div className="text-[12px] font-semibold uppercase tracking-wide text-muted mb-1">The board says</div>
            <Row label="Calls with a usable status" value={d.total} />
            <Row label="Analysed" value={d.board.analysed} />
            <Row label="Waiting to be analysed" value={d.board.waiting} />
            <Row label="Waiting to be re-analysed" value={d.board.reanalyse} />
            <Row label="No status" value={d.board.blank} />
          </div>
          <div>
            <div className="text-[12px] font-semibold uppercase tracking-wide text-muted mb-1">What is actually saved</div>
            <Row label="A saved result" value={d.saved.record} />
            <Row label="Nothing saved" value={d.saved.none} />
            <Row label="Could not be read just now" value={d.saved.unreadable} note={d.saved.unreadable ? 'Check again in a minute; storage was busy.' : undefined} />
            <Row label={`Made under the current rules (version ${d.rulesVersion})`} value={d.onCurrentRules} />
            <Row label="With the stay-on numbers" value={d.withNumbers} />
            <Row label="With an opener recorded" value={d.withOpener} />
            <Row label="With what we say we are recorded" value={d.withPositioning} />
            <Row label="Counted in the opening cards" value={d.usedByOpeningCards} />
          </div>
          <div className="md:col-span-2">
            <div className="text-[12px] font-semibold uppercase tracking-wide text-muted mb-1">By rules version</div>
            <div className="text-[13px] text-body">
              {Object.keys(d.bySchema).length ? Object.entries(d.bySchema).sort(([a], [b]) => Number(b) - Number(a)).map(([v, n]) => `version ${v}: ${n}`).join(', ') : 'No saved results.'}
            </div>
          </div>
          <div className="md:col-span-2">
            <div className="text-[12px] font-semibold uppercase tracking-wide text-muted mb-1">Where the board and the saved results disagree</div>
            {d.problems.every((p) => p.count === 0) ? (
              <div className="text-[13px] text-body">They agree.</div>
            ) : d.problems.filter((p) => p.count > 0).map((p) => (
              <div key={p.key} className="py-1.5 border-b border-line last:border-0">
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-[13px] text-body">{p.label}</span>
                  <span className="text-[14px] font-medium text-ink tabular-nums">{p.count}</span>
                </div>
                <div className="text-[12px] text-muted">e.g. {p.examples.map((e) => `${e.sdr || 'unknown'} ${e.startedAt || ''} (${e.id})`).join('; ')}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
