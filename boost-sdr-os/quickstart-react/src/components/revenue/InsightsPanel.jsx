import React, { useState } from 'react';
import { fmtUSD } from '../../utils/revenueMetrics';
import { ACTION_STATUSES, updateInsightStatus, scanDate } from '../../api/insights';

const SEVERITY = {
  Critical: 'bg-red text-white',
  High: 'bg-red-soft text-red',
  Medium: 'bg-amber-soft text-amber-ink',
  Low: 'bg-sunken text-body',
  Info: 'bg-info-soft text-info',
};

function ageLabel(scanRun) {
  const d = scanDate(scanRun);
  if (!d) return null;
  const hrs = (Date.now() - d.getTime()) / 3600000;
  if (hrs < 0) return 'just now';
  if (hrs < 1) return 'less than an hour ago';
  if (hrs < 48) return `${Math.round(hrs)} hours ago`;
  return `${Math.round(hrs / 24)} days ago`;
}

function FindingCard({ f, demo, onStatus }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const change = async e => {
    const label = e.target.value;
    setBusy(true);
    try {
      await updateInsightStatus(f.id, label);
      onStatus(f.id, label);
    } catch (err) {
      console.error('[insights] status update failed', err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`border border-line rounded-xl bg-card ${f.status === 'Dismissed' || f.status === 'Done' ? 'opacity-60' : ''}`}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full text-left px-4 py-3 flex items-start gap-3 cursor-pointer bg-transparent border-0"
        aria-expanded={open}
      >
        <span className={`text-[10.5px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full flex-shrink-0 mt-0.5 ${SEVERITY[f.severity] || SEVERITY.Info}`}>
          {f.severity}
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-[13.5px] font-semibold text-ink leading-snug">{f.headline}</span>
          <span className="block text-[11.5px] text-muted mt-0.5">
            {[f.scope, f.confidence ? `${f.confidence} confidence` : null].filter(Boolean).join(' · ')}
          </span>
        </span>
        {f.impact != null && (
          <span className="text-[13px] font-semibold text-ink flex-shrink-0" title="Estimated value at stake">{fmtUSD(f.impact)}</span>
        )}
        <span className="text-muted text-[12px] flex-shrink-0 mt-0.5">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 pt-1 border-t border-line text-[12.5px] text-body space-y-3">
          {f.evidence && (
            <div>
              <div className="text-[10.5px] font-semibold uppercase tracking-wide text-muted mb-1">Evidence</div>
              <p className="whitespace-pre-line leading-relaxed">{f.evidence}</p>
            </div>
          )}
          {f.action && (
            <div>
              <div className="text-[10.5px] font-semibold uppercase tracking-wide text-muted mb-1">Recommended action</div>
              <p className="whitespace-pre-line leading-relaxed">{f.action}</p>
            </div>
          )}
          {!demo && (
            <label className="flex items-center gap-2 text-[12px]">
              <span className="text-muted">Status</span>
              <select
                value={f.status}
                onChange={change}
                disabled={busy}
                className="border border-line rounded-full px-3 py-1 bg-card text-ink text-[12px] cursor-pointer"
              >
                {ACTION_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
          )}
        </div>
      )}
    </div>
  );
}

// sections: which finding sections this panel shows, e.g. ['Leakage', 'Pipeline health'].
export default function InsightsPanel({ title = 'AI scan', sections, insights, demo, loading, error }) {
  const [statusOverride, setStatusOverride] = useState({});
  const onStatus = (id, label) => setStatusOverride(s => ({ ...s, [id]: label }));

  const findings = (insights?.findings ?? [])
    .filter(f => sections.includes(f.section))
    .map(f => ({ ...f, status: statusOverride[f.id] ?? f.status }));

  const age = insights && !insights.empty && !demo ? ageLabel(insights.scanRun) : null;

  return (
    <div className="bg-card border border-line rounded-2xl p-5">
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-purple" />
          <div className="font-heading font-bold text-[14px]">{title}</div>
          {demo && <span className="text-[10.5px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-amber-soft text-amber-ink">Sample</span>}
        </div>
        <div className="text-[11.5px] text-muted">
          {loading ? 'Loading latest scan…'
            : demo ? 'Sample findings, not a real scan'
            : insights?.empty ? 'No scan has run yet'
            : age ? `Last scan ${insights.scanRun} (${age})` : ''}
        </div>
      </div>

      {error && <p className="text-[12.5px] text-red mb-2">Could not read the Revenue Insights board: {error}</p>}

      {!loading && !error && findings.length === 0 && (
        <p className="text-muted text-[13px]">
          {insights?.empty
            ? 'The scheduled Claude scan has not written any findings yet. It runs at 06:00 and 12:00 UK time, Sunday to Friday.'
            : 'The latest scan raised nothing in this area.'}
        </p>
      )}

      <div className="space-y-2">
        {findings.map(f => <FindingCard key={f.id} f={f} demo={demo} onStatus={onStatus} />)}
      </div>

      <p className="text-[11px] text-muted mt-3">
        Findings are estimates written by Claude from the Opportunities board. Check the evidence before acting.
      </p>
    </div>
  );
}
