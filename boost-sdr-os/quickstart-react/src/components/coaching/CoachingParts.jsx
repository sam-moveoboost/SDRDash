import React, { useState } from 'react';
import { coachingApi } from '../../api/coaching';

export const MEDDPICC_ORDER = [
  ['metrics', 'Metrics'], ['economic_buyer', 'Economic buyer'], ['decision_criteria', 'Decision criteria'], ['decision_process', 'Decision process'],
  ['paper_process', 'Paper process'], ['identify_pain', 'Identify pain'], ['champion', 'Champion'], ['competition', 'Competition'],
];
export const CRAFT_ORDER = [
  ['opening', 'Opening'], ['discovery', 'Discovery'], ['objection_handling', 'Objection handling'],
  ['next_step_ask', 'Asking for the next step'], ['tone_and_control', 'Tone and call control'],
];

export const CALL_TYPE_LABELS = {
  conversation: 'Conversation', early_hangup: 'Early hang-up', gatekeeper: 'Gatekeeper', voicemail: 'Voicemail',
  automated_menu: 'Phone menu', wrong_person: 'Wrong person', other: 'Other',
};
const OPENER_RESULT_LABELS = {
  stayed_engaged: 'Prospect stayed', brushed_off: 'Brushed off', hung_up: 'Prospect hung up', blocked_by_gatekeeper: 'Blocked by gatekeeper', unclear: 'Unclear',
};
const openerTone = (r) => (r === 'stayed_engaged' ? 'good' : r === 'hung_up' || r === 'brushed_off' ? 'bad' : 'muted');

export const pct = (v, dp = 0) => (v == null ? 'n/a' : `${(v * 100).toFixed(dp)}%`);
export const num = (v, dp = 1) => (v == null ? 'n/a' : Number(v).toFixed(dp));

export function fmtWhen(s) {
  const d = new Date(String(s).includes('T') ? s : `${String(s).replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return String(s);
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })} ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })}`;
}

export function Section({ title, sub, children, right }) {
  return (
    <section className="mb-10">
      <div className="mb-4 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-display text-[24px] font-semibold text-ink leading-tight">{title}</h2>
          {sub && <p className="text-muted text-[13px] mt-1 max-w-3xl">{sub}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Card({ title, note, children, className = '' }) {
  return (
    <div className={`bg-card border border-line rounded-2xl p-5 ${className}`}>
      {(title || note) && (
        <div className="flex items-baseline justify-between gap-3 mb-4">
          <div className="font-heading font-bold text-[14px]">{title}</div>
          {note && <div className="text-[11.5px] text-muted text-right">{note}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

export function Chip({ tone = 'muted', children }) {
  const cls = { warn: 'bg-amber-soft text-amber-ink', good: 'bg-pale text-green-deep', bad: 'bg-red-soft text-red', info: 'bg-info-soft text-info', muted: 'bg-sunken text-body' }[tone];
  return <span className={`inline-block text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${cls}`}>{children}</span>;
}

export function Bar({ value, tone = 'navy' }) {
  const w = value == null ? 0 : Math.max(0, Math.min(1, value)) * 100;
  const cls = { navy: 'bg-navy', good: 'bg-emerald', warn: 'bg-amber', bad: 'bg-red' }[tone];
  return (
    <div className="h-2 rounded-full bg-sunken overflow-hidden">
      <div className={`h-full rounded-full ${cls}`} style={{ width: `${w}%` }} />
    </div>
  );
}

export function Empty({ children }) {
  return <div className="text-[13px] text-muted py-4">{children}</div>;
}

export function WeekBars({ weekly }) {
  if (!weekly?.length) return <Empty>No calls in this period.</Empty>;
  const max = Math.max(...weekly.map((w) => w.calls), 1);
  return (
    <div className="flex items-end gap-3">
      {weekly.map((w) => (
        <div key={w.week} className="flex-1 min-w-0 flex flex-col items-center gap-1.5">
          {/* Fixed height so the percentage heights below have something to measure against. */}
          <div className="w-full h-32 flex items-end justify-center gap-1">
            <div className="w-1/3 bg-line-warm rounded-t" style={{ height: `${(w.calls / max) * 100}%` }} title={`${w.calls} calls`} />
            <div className="w-1/3 bg-navy rounded-t" style={{ height: `${(w.conversations / max) * 100}%` }} title={`${w.conversations} conversations`} />
            <div className="w-1/3 bg-emerald rounded-t" style={{ height: `${(w.booked / max) * 100}%` }} title={`${w.booked} meetings booked`} />
          </div>
          <div className="text-[10.5px] text-muted whitespace-nowrap">{new Date(`${w.week}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}</div>
          <div className="text-[11px] text-body font-medium">{w.calls} / {w.conversations} / {w.booked}</div>
        </div>
      ))}
    </div>
  );
}

export function TeamTable({ team, onPick }) {
  if (!team?.length) return <Empty>No calls in this period.</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-left text-muted text-[11.5px]">
            {['SDR', 'Calls', 'Connected', 'Connect rate', 'Conversations', 'Meetings booked', 'Booked per conversation', 'Avg conversation'].map((h) => (
              <th key={h} className="font-medium pb-2 pr-4 whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {team.map((r) => (
            <tr
              key={r.id || r.name}
              onClick={() => r.id && onPick(r.id)}
              className={`border-t border-line ${r.id ? 'cursor-pointer hover:bg-sunken' : ''}`}
            >
              <td className="py-2.5 pr-4 font-medium text-ink">{r.name}</td>
              <td className="py-2.5 pr-4">{r.calls}</td>
              <td className="py-2.5 pr-4">{r.connected}</td>
              <td className="py-2.5 pr-4">{pct(r.connectRate)}</td>
              <td className="py-2.5 pr-4">{r.conversations} ({pct(r.conversationRate)})</td>
              <td className="py-2.5 pr-4">{r.meetingsBooked}</td>
              <td className="py-2.5 pr-4">{pct(r.bookingRate)}</td>
              <td className="py-2.5 pr-4">{r.avgConversationMin == null ? 'n/a' : `${num(r.avgConversationMin)} min`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="text-[11.5px] text-muted mt-2">Select a row to coach that SDR.</div>
    </div>
  );
}

export function CoverageTable({ coverage }) {
  if (!coverage?.length) return <Empty>No answered calls in this period.</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead><tr className="text-left text-muted text-[11.5px]">{['SDR', 'Answered calls', 'With a transcript', 'Coverage'].map((h) => <th key={h} className="font-medium pb-2 pr-4 whitespace-nowrap">{h}</th>)}</tr></thead>
        <tbody>
          {coverage.map((c) => {
            const share = c.answered ? c.withTranscript / c.answered : null;
            return (
              <tr key={c.sdrId || c.sdrName} className="border-t border-line">
                <td className="py-2.5 pr-4 font-medium text-ink">{c.sdrName}</td>
                <td className="py-2.5 pr-4">{c.answered}</td>
                <td className="py-2.5 pr-4">{c.withTranscript}</td>
                <td className="py-2.5 pr-4 w-[240px]"><div className="flex items-center gap-3"><div className="flex-1"><Bar value={share} tone={share == null ? 'navy' : share >= 0.5 ? 'good' : share > 0 ? 'warn' : 'bad'} /></div><span className="text-muted w-10 text-right">{pct(share)}</span></div></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function FocusPanel({ coaching, who }) {
  if (!coaching || coaching.analysedCalls === 0) {
    return <Empty>No calls have been analysed yet. Use the Analyse calls panel at the top of the page to start.</Empty>;
  }
  const tone = (v) => (v >= 0.66 ? 'good' : v >= 0.4 ? 'warn' : 'bad');
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card title="Where to focus" note={`${coaching.analysedCalls} analysed calls`}>
        {coaching.enoughForFocus ? (
          <ul className="space-y-3">
            {coaching.focus.map((f) => (
              <li key={f.key}>
                <div className="flex justify-between text-[13px] mb-1"><span className="font-medium text-ink">{f.label}</span><span className="text-muted">{pct(f.value)}</span></div>
                <Bar value={f.value} tone={tone(f.value)} />
              </li>
            ))}
          </ul>
        ) : (
          <Empty>Early days for {who}. Focus areas appear once {coaching.minCallsForFocus} calls are analysed.</Empty>
        )}
        {coaching.enoughForFocus && coaching.strengths.length > 0 && (
          <div className="mt-4 pt-3 border-t border-line text-[12.5px] text-body">
            <span className="text-muted">Working well: </span>{coaching.strengths.map((s) => s.label).join(' and ')}
          </div>
        )}
      </Card>
      <Card title="MEDDPICC coverage" note="share of calls where it came up">
        <ul className="space-y-2.5">
          {MEDDPICC_ORDER.map(([k, label]) => {
            const m = coaching.meddpicc?.[k];
            return (
              <li key={k}>
                <div className="flex justify-between text-[12.5px] mb-1"><span className="text-body">{label}</span><span className="text-muted">{pct(m?.touchedShare)}</span></div>
                <Bar value={m?.touchedShare} />
              </li>
            );
          })}
        </ul>
        <div className="text-[11.5px] text-muted mt-3">Cold calls rarely reach paper process or decision criteria, so low numbers there are normal.</div>
      </Card>
      <Card title="Call craft" note="average, out of 5">
        <ul className="space-y-2.5">
          {CRAFT_ORDER.map(([k, label]) => {
            const c = coaching.craft?.[k];
            return (
              <li key={k}>
                <div className="flex justify-between text-[12.5px] mb-1"><span className="text-body">{label}</span><span className="text-muted">{num(c?.avg)}</span></div>
                <Bar value={c?.avg == null ? null : (c.avg - 1) / 4} tone={c?.avg == null ? 'navy' : tone((c.avg - 1) / 4)} />
              </li>
            );
          })}
        </ul>
        <div className="text-[12.5px] text-body mt-3">Next step secured on <span className="font-medium text-ink">{pct(coaching.nextStepRate)}</span> of analysed calls.</div>
      </Card>
    </div>
  );
}

function Quote({ children }) {
  return <blockquote className="border-l-2 border-line-warm pl-3 text-[13px] text-body italic">{children}</blockquote>;
}

// A quote in English. When the call was in another language the original is shown beneath it.
function Said({ en, original, label }) {
  const text = en || original;
  if (!text) return null;
  const translated = original && en && original.trim() !== en.trim();
  return (
    <div>
      <Quote>{label}"{text}"</Quote>
      {translated && <div dir="auto" className="text-[11.5px] text-muted mt-0.5 pl-3">Original: {original}</div>}
    </div>
  );
}

export function CallDetail({ call, demo }) {
  const a = call.analysis;
  const [transcript, setTranscript] = useState({ state: 'idle', turns: [], error: null });

  const loadTranscript = async () => {
    if (demo) { setTranscript({ state: 'error', turns: [], error: 'Transcripts are not shown in the sample data.' }); return; }
    setTranscript({ state: 'loading', turns: [], error: null });
    try {
      const res = await coachingApi.transcript(call.id);
      setTranscript({ state: 'ready', turns: res.turns, error: null });
    } catch (e) {
      setTranscript({ state: 'error', turns: [], error: e.message });
    }
  };

  if (!a) {
    return <div className="text-[13px] text-muted">Not analysed yet. {call.transcript?.available ? 'Use the Analyse calls panel at the top of the page to analyse it.' : 'There is no transcript on this call yet.'}</div>;
  }
  return (
    <div className="space-y-5">
      {call.priority && (
        <div className="flex items-center gap-2 flex-wrap text-[12.5px]">
          <span className="font-heading font-bold">Review priority {call.priority.score}/10 ({call.priority.level})</span>
          {call.priority.reasons.map((r) => <Chip key={r}>{r}</Chip>)}
        </div>
      )}
      {call.refresh === 'english' && (
        <div className="rounded-xl bg-amber-soft text-amber-ink text-[12.5px] px-3 py-2">
          This analysis was made before findings were written in English, so some wording may still be in the call's own language. It will be redone the next time you press an Analyse button.
        </div>
      )}
      <p className="text-[13.5px] text-ink">{a.summary}</p>
      <div className="flex gap-1.5 flex-wrap">
        <Chip>{CALL_TYPE_LABELS[a.callType] || a.callType}</Chip>
        {a.language && a.language.toLowerCase() !== 'english' && <Chip tone="info">Translated from {a.language}</Chip>}
        {a.openerResult && <Chip tone={openerTone(a.openerResult)}>{OPENER_RESULT_LABELS[a.openerResult] || a.openerResult}</Chip>}
        {a.endedBy && a.endedBy !== 'unclear' && <Chip>Ended by the {a.endedBy === 'sdr' ? 'SDR' : 'prospect'}</Chip>}
        {a.opener?.style && <Chip tone="info">Opener: {a.opener.style.replace(/_/g, ' ')}</Chip>}
      </div>
      {a.opener?.quote && (
        <div>
          <div className="font-heading font-bold text-[12.5px] mb-1.5">How the call opened</div>
          <Said en={a.opener.quoteEn} original={a.opener.quote} />
          {a.opener.note && <div className="text-[12px] text-muted mt-1.5">{a.opener.note}</div>}
        </div>
      )}

      {a.coachable ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <div>
            <div className="font-heading font-bold text-[12.5px] mb-2">MEDDPICC</div>
            <div className="grid grid-cols-2 gap-2">
              {MEDDPICC_ORDER.map(([k, label]) => {
                const m = a.meddpicc?.[k];
                const sc = m?.score ?? 0;
                return (
                  <div key={k} className="rounded-xl border border-line p-2.5" title={m?.evidenceEn || m?.evidence || ''}>
                    <div className="flex items-center justify-between text-[12px]">
                      <span className="text-body">{label}</span>
                      <span className="flex gap-0.5">{[0, 1].map((i) => <span key={i} className={`w-2 h-2 rounded-full ${sc > i ? 'bg-emerald' : 'bg-sunken'}`} />)}</span>
                    </div>
                    {(m?.evidenceEn || m?.evidence) && <div className="text-[11px] text-muted mt-1 italic line-clamp-2">"{m.evidenceEn || m.evidence}"</div>}
                  </div>
                );
              })}
            </div>
          </div>
          <div>
            <div className="font-heading font-bold text-[12.5px] mb-2">Call craft</div>
            <ul className="space-y-2">
              {CRAFT_ORDER.map(([k, label]) => {
                const c = a.craft?.[k];
                return (
                  <li key={k}>
                    <div className="flex justify-between text-[12.5px]"><span className="text-body">{label}</span><span className="text-muted">{c?.score == null ? 'did not come up' : `${c.score}/5`}</span></div>
                    {c?.score != null && <Bar value={(c.score - 1) / 4} tone={c.score >= 4 ? 'good' : c.score >= 3 ? 'warn' : 'bad'} />}
                    {c?.note && <div className="text-[11.5px] text-muted mt-0.5">{c.note}</div>}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      ) : (
        <div className="text-[12.5px] text-muted">This call was too short or one-sided to score on MEDDPICC, so it does not count against anyone. It still feeds the opener and objection trends.</div>
      )}

      {a.objections?.length > 0 && (
        <div>
          <div className="font-heading font-bold text-[12.5px] mb-2">Objections and how they were handled</div>
          <div className="space-y-3">
            {a.objections.map((o, i) => (
              <div key={i} className="rounded-xl border border-line p-3">
                <div className="flex items-center gap-2 mb-2"><Chip tone="info">{o.category.replace(/_/g, ' ')}</Chip>{o.stage && <Chip>{o.stage === 'opener' ? 'in the opener' : o.stage === 'close' ? 'at the close' : 'mid-call'}</Chip>}<Chip tone={o.handled === 'well' ? 'good' : o.handled === 'poorly' ? 'bad' : 'warn'}>handled {o.handled}</Chip></div>
                <Said label="Prospect: " en={o.quoteEn} original={o.quote} />
                {o.responseQuote && <div className="mt-1.5"><Said label="SDR: " en={o.responseQuoteEn} original={o.responseQuote} /></div>}
                {o.why && <div className="text-[12px] text-muted mt-1.5">{o.why}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {a.bestMoment && (
          <div className="rounded-xl bg-pale/40 p-3">
            <div className="font-heading font-bold text-[12.5px] mb-1.5">Best moment</div>
            <Said en={a.bestMoment.quoteEn} original={a.bestMoment.quote} />
            <div className="text-[12px] text-body mt-1.5">{a.bestMoment.why}</div>
          </div>
        )}
        {a.missedMoment && (
          <div className="rounded-xl bg-amber-soft p-3">
            <div className="font-heading font-bold text-[12.5px] mb-1.5">A moment to learn from</div>
            <Said en={a.missedMoment.quoteEn} original={a.missedMoment.quote} />
            <div className="text-[12px] text-body mt-1.5">{a.missedMoment.better}</div>
          </div>
        )}
      </div>

      {a.tryNextTime?.length > 0 && (
        <div>
          <div className="font-heading font-bold text-[12.5px] mb-1.5">Try this on the next call</div>
          <ul className="list-disc pl-5 space-y-1 text-[13px] text-body">{a.tryNextTime.map((t, i) => <li key={i}>{t}</li>)}</ul>
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap text-[12.5px]">
        {call.recordingUrl && <a className="text-info underline" href={call.recordingUrl} target="_blank" rel="noreferrer">Listen to the recording</a>}
        <button type="button" onClick={loadTranscript} className="text-info underline cursor-pointer bg-transparent border-0 p-0">
          {transcript.state === 'ready' ? 'Reload transcript' : 'Read the transcript'}
        </button>
      </div>
      {transcript.state === 'loading' && <div className="text-[12.5px] text-muted">Loading the transcript...</div>}
      {transcript.state === 'error' && <div className="text-[12.5px] text-red">{transcript.error}</div>}
      {transcript.state === 'ready' && (
        <div className="max-h-80 overflow-y-auto rounded-xl border border-line p-3 space-y-1.5 text-[12.5px]">
          {transcript.turns.map((t, i) => (
            <div key={i}><span className={`font-medium ${t.who === 'sdr' ? 'text-emerald' : 'text-muted'}`}>{t.who === 'sdr' ? 'SDR' : 'Prospect'}: </span><span className="text-body">{t.text}</span></div>
          ))}
        </div>
      )}
    </div>
  );
}

export function TrendsPanel({ data }) {
  const t = data?.trends;
  if (!t || t.analysedCalls === 0) {
    return <Empty>Trends appear once calls have been analysed. Use the Analyse calls panel at the top of the page to start.</Empty>;
  }
  const maxCount = Math.max(...t.topObjections.map((o) => o.count), 1);
  return (
    <div className="space-y-4">
      <div className="text-[12.5px] text-muted">
        Based on {t.analysedCalls} analysed calls ({t.coachableCalls} full conversations, {t.hangups.count} early hang-ups), {t.bookedCalls} of which booked a meeting, and {t.objectionCount} objections.
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="How calls open" note="who stays and who hangs up">
          {t.openers.length === 0 ? <Empty>No openers recorded yet.</Empty> : (
            <ul className="space-y-4">
              {t.openers.map((o) => (
                <li key={o.style}>
                  <div className="flex justify-between text-[13px] mb-1.5"><span className="font-medium text-ink">{o.label}</span><span className="text-muted">{o.calls} call{o.calls === 1 ? "" : "s"}, {o.booked} booked</span></div>
                  <div className="flex items-center gap-2 text-[11.5px] text-muted mb-1"><span className="w-[72px]">Stayed</span><div className="flex-1"><Bar value={o.stayedRate} tone="good" /></div><span className="w-9 text-right">{pct(o.stayedRate)}</span></div>
                  <div className="flex items-center gap-2 text-[11.5px] text-muted"><span className="w-[72px]">Hung up</span><div className="flex-1"><Bar value={o.hungUpRate} tone="bad" /></div><span className="w-9 text-right">{pct(o.hungUpRate)}</span></div>
                  {o.stayExamples[0] && <div className="text-[12px] text-body italic mt-1.5">Kept them on: "{o.stayExamples[0].quote}" ({o.stayExamples[0].sdrName})</div>}
                  {o.hangUpExamples[0] && <div className="text-[12px] text-body italic mt-1">Lost them: "{o.hangUpExamples[0].quote}" ({o.hangUpExamples[0].sdrName})</div>}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Early hang-ups" note={`${t.hangups.count} calls, ${pct(t.hangups.share)} of analysed`}>
          {t.hangups.count === 0 ? <Empty>No early hang-ups in the analysed calls.</Empty> : (
            <ul className="space-y-3">
              {t.hangups.reasons.map((r) => (
                <li key={r.category}>
                  <div className="flex justify-between text-[13px] mb-1"><span className="font-medium text-ink">{r.label}</span><span className="text-muted">{r.count}</span></div>
                  <Bar value={r.count / t.hangups.count} tone="bad" />
                  {r.examples[0] && <div className="text-[12px] text-body italic mt-1">"{r.examples[0].quote}" ({r.examples[0].sdrName})</div>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Getting past objections in the first few seconds" note="their words, the reply that worked">
        {t.earlyObjections.length === 0 ? <Empty>No early objections recorded yet.</Empty> : (
          <div className="grid gap-4 lg:grid-cols-2">
            {t.earlyObjections.map((o) => (
              <div key={o.category} className="rounded-xl border border-line p-3">
                <div className="flex justify-between text-[13px] mb-1"><span className="font-medium text-ink">{o.label}</span><span className="text-muted">{o.count} times</span></div>
                <div className="text-[11.5px] text-muted mb-2 flex gap-3 flex-wrap"><span>{o.stayedAfter} stayed on the line</span><span>{o.hungUpAfter} hung up</span><span>{o.handledWell} handled well</span></div>
                {o.examples.length === 0 ? <div className="text-[12px] text-muted">No well-handled example yet.</div> : o.examples.map((e, i) => (
                  <div key={i} className="mb-2 space-y-1">
                    <Quote>Prospect: "{e.quote}"</Quote>
                    <Quote>{e.sdrName}: "{e.response}"</Quote>
                    <div className="text-[11.5px] text-muted flex gap-2 items-center flex-wrap">{e.stayed && <Chip tone="good">they stayed</Chip>}{e.booked && <Chip tone="good">meeting booked</Chip>}<span>{e.why}</span></div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Top objections, whenever they came up" note="how often, and how well they were handled">
          {t.topObjections.length === 0 ? <Empty>No objections recorded yet.</Empty> : (
            <ul className="space-y-3">
              {t.topObjections.map((o) => (
                <li key={o.category}>
                  <div className="flex justify-between text-[13px] mb-1"><span className="font-medium text-ink">{o.label}</span><span className="text-muted">{o.count} ({pct(o.share)})</span></div>
                  <Bar value={o.count / maxCount} />
                  <div className="text-[11.5px] text-muted mt-1 flex gap-3 flex-wrap"><span>{o.handledWell} handled well</span><span>{o.handledPoorly} handled poorly</span><span>{o.bookedAfter} still booked</span></div>
                  {o.examples[0] && <div className="text-[12px] text-body italic mt-1">"{o.examples[0].quote}"</div>}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Best way objections were handled" note="their words, the SDR's reply">
          {t.bestHandling.length === 0 ? <Empty>No well-handled objections yet.</Empty> : (
            <ul className="space-y-4">
              {t.bestHandling.map((b) => (
                <li key={b.category}>
                  <div className="text-[12px] font-heading font-bold mb-1.5">{b.label}</div>
                  {b.examples.map((e, i) => (
                    <div key={i} className="mb-2 rounded-xl border border-line p-2.5 space-y-1">
                      <Quote>Prospect: "{e.quote}"</Quote>
                      <Quote>{e.sdrName}: "{e.response}"</Quote>
                      <div className="text-[11.5px] text-muted flex gap-2 items-center flex-wrap">{e.booked && <Chip tone="good">meeting booked</Chip>}{e.stayed && !e.booked && <Chip tone="good">they stayed</Chip>}<span>{e.why}</span></div>
                    </div>
                  ))}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <GroupCard title="Who books, by seniority" rows={t.profile.bySeniority} />
        <GroupCard title="Who books, by industry" rows={t.profile.byIndustry} empty="Industry is only recorded when it comes up on the call." />
        <Card title="Roles that booked">
          {t.profile.bookedRoles.length === 0 ? <Empty>No roles recorded on booked calls yet.</Empty> : (
            <div className="flex flex-wrap gap-2">{t.profile.bookedRoles.map((r) => <Chip key={r.label} tone="good">{r.label} ({r.count})</Chip>)}</div>
          )}
        </Card>
      </div>

      <Card title="How booked calls sound different" note="booked versus not booked">
        <table className="w-full text-[12.5px]">
          <thead><tr className="text-left text-muted text-[11.5px]"><th className="font-medium pb-2" /><th className="font-medium pb-2">Booked</th><th className="font-medium pb-2">Not booked</th></tr></thead>
          <tbody>
            {[
              ['Calls', (x) => x.calls],
              ['SDR share of the talking', (x) => pct(x.avgSdrShare)],
              ['Questions asked', (x) => num(x.avgQuestions)],
              ['Longest SDR monologue (words)', (x) => num(x.avgLongestSdrTurnWords, 0)],
              ['Call length (min)', (x) => num(x.avgDurationMin)],
            ].map(([label, fn]) => (
              <tr key={label} className="border-t border-line"><td className="py-2 text-body">{label}</td><td className="py-2 font-medium text-ink">{fn(t.talk.booked)}</td><td className="py-2">{fn(t.talk.notBooked)}</td></tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="SDR comparison" note="analysed calls only">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead><tr className="text-left text-muted text-[11.5px]">{['SDR', 'Analysed', 'Booked', 'Prospect stayed', 'Next step secured', 'Objections handled well', 'Average craft'].map((h) => <th key={h} className="font-medium pb-2 pr-4 whitespace-nowrap">{h}</th>)}</tr></thead>
            <tbody>
              {t.sdrs.map((r) => (
                <tr key={r.id || r.name} className="border-t border-line">
                  <td className="py-2.5 pr-4 font-medium text-ink">{r.name}</td><td className="py-2.5 pr-4">{r.analysedCalls}</td><td className="py-2.5 pr-4">{r.booked}</td>
                  <td className="py-2.5 pr-4">{pct(r.stayedRate)}</td><td className="py-2.5 pr-4">{pct(r.nextStepRate)}</td><td className="py-2.5 pr-4">{pct(r.objectionsHandledWellRate)}</td><td className="py-2.5 pr-4">{r.avgCraft == null ? 'n/a' : `${num(r.avgCraft)}/5`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function GroupCard({ title, rows, empty = 'Nothing recorded yet.' }) {
  return (
    <Card title={title} note="booked / calls">
      {!rows?.length ? <Empty>{empty}</Empty> : (
        <ul className="space-y-2.5">
          {rows.map((r) => (
            <li key={r.label}>
              <div className="flex justify-between text-[12.5px] mb-1"><span className="text-body first-letter:uppercase">{r.label}</span><span className="text-muted">{r.booked} / {r.calls} ({pct(r.bookedRate)})</span></div>
              <Bar value={r.bookedRate} tone="good" />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
