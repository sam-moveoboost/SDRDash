import React, { useEffect, useRef, useState } from 'react';
import { coachingApi } from '../../api/coaching';

// Managers only. Runs the real analysis on a few calls of different lengths and shows exactly what came back,
// how long each took and whether every required part is there. Nothing is saved and the board is not touched.
const LABEL = (s) => String(s || '').replace(/_/g, ' ');

export default function TrialPanel() {
  const [state, setState] = useState({ busy: false, data: null, error: null });
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const poll = async () => {
    try {
      const data = await coachingApi.trialStatus();
      const finished = data.total > 0 && data.done >= data.total;
      setState({ busy: !finished, data, error: null });
      if (!finished) timer.current = setTimeout(poll, 3000);
    } catch (err) {
      setState({ busy: false, data: null, error: err.message || 'The trial could not be read.' });
    }
  };

  const start = async () => {
    setState({ busy: true, data: null, error: null });
    try {
      await coachingApi.trialStart();
      timer.current = setTimeout(poll, 2000);
    } catch (err) {
      setState({ busy: false, data: null, error: err.message || 'The trial could not start.' });
    }
  };

  const d = state.data;
  const results = d?.results || [];
  const complete = results.filter((r) => r.complete).length;
  const times = results.filter((r) => !r.error).map((r) => r.seconds);
  const avg = times.length ? Math.round((times.reduce((a, b) => a + b, 0) / times.length) * 10) / 10 : null;

  return (
    <div>
      <div className="flex items-center gap-3 flex-wrap">
        <button type="button" disabled={state.busy} onClick={start} className="rounded-full bg-navy text-white text-[13px] font-medium px-4 py-2 border-0 cursor-pointer disabled:opacity-60">
          {state.busy ? `Running the trial${d?.total ? ` (${d.done} of ${d.total})` : ''}...` : 'Trial the analysis on 6 calls'}
        </button>
        <span className="text-[12.5px] text-muted">Analyses six real calls of different lengths and shows exactly what came back. Saves nothing and changes nothing on the board.</span>
      </div>
      {state.error && <div className="text-[13px] text-red-700 mt-3">{state.error}</div>}
      {results.length > 0 && (
        <div className="mt-4">
          <div className="text-[13.5px] text-ink font-medium mb-2">
            {complete} of {results.length} complete{avg != null ? `, about ${avg} seconds a call` : ''}.
          </div>
          <div className="grid gap-3">
            {results.map((r) => (
              <div key={r.id} className="border border-line rounded-xl p-3">
                <div className="flex items-baseline justify-between gap-3 flex-wrap">
                  <span className="text-[13px] font-medium text-ink">{r.sdrName} · {r.startedAt}{r.durationMin != null ? ` · ${Math.round(r.durationMin * 10) / 10} min` : ''}</span>
                  <span className={`text-[12px] font-semibold px-2 py-0.5 rounded-full ${r.complete ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                    {r.complete ? 'Complete' : 'Incomplete'} · {r.seconds}s
                  </span>
                </div>
                {r.error ? (
                  <div className="text-[12.5px] text-red-700 mt-1">{r.error}</div>
                ) : (
                  <div className="text-[12.5px] text-body mt-1 grid gap-1">
                    <div><b>Call type:</b> {LABEL(r.callType)} · <b>outcome:</b> {LABEL(r.openerResult)} · <b>craft scored:</b> {r.craftScored} of 5 · <b>key exchanges:</b> {r.keyExchanges}</div>
                    <div><b>How we opened:</b> {r.opener ? `${LABEL(r.opener.style)}${r.opener.quote ? ` - "${r.opener.quote}"` : ''}` : 'missing'}</div>
                    <div><b>What we said we are:</b> {r.positioning ? `${LABEL(r.positioning.lead)}${r.positioning.quote ? ` - "${r.positioning.quote}"` : ''}` : 'missing'}</div>
                    <div><b>Objections:</b> {r.objections.length === 0 ? 'none found' : ''}</div>
                    {r.objections.map((o, i) => (
                      <div key={i} className="pl-3">{LABEL(o.category)} ({LABEL(o.stage)}, handled {o.handled}): "{o.quote}"{o.reply ? ` - reply: "${o.reply}"` : ''}</div>
                    ))}
                    {r.summary && <div className="text-muted">{r.summary}</div>}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
