import React, { useEffect, useMemo, useState } from 'react';
import { BOARDS, updateItemColumnValue } from '../../api/monday';
import {
  MEETING_COLS, LEAD_STATUS_OPTIONS, meetingCol, isQualifyingMeeting, repMeetings,
} from '../../utils/meetingAttribution';

// ── Helpers ───────────────────────────────────────────────────────

function fmtDate(d) {
  if (!d) return null;
  const date = new Date(`${d.slice(0, 10)}T00:00:00`);
  if (isNaN(date)) return d;
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function daysBetween(a, b) {
  if (!a || !b) return 0;
  return Math.round((new Date(`${b.slice(0, 10)}T00:00:00`) - new Date(`${a.slice(0, 10)}T00:00:00`)) / 86400000);
}

function createdDate(m) {
  return meetingCol(m, MEETING_COLS.CREATED) || m.created_at?.slice(0, 10) || '';
}

function firstName(rep) {
  return rep.name.split(' ')[0];
}

// ── Sub-components ────────────────────────────────────────────────

function FilterChip({ active, onClick, label, count, tone }) {
  const toneClass = tone === 'warn' && !active ? 'text-red border-red/30' : '';
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 rounded-lg text-[12px] font-semibold transition-all whitespace-nowrap ${
        active ? 'bg-teal text-white' : `bg-transparent text-muted hover:text-ink border border-line ${toneClass}`
      }`}
    >
      {label} <span className={active ? 'text-white/70' : 'opacity-70'}>{count}</span>
    </button>
  );
}

function Field({ label, children }) {
  return (
    <div className="min-w-0">
      <div className="text-[10.5px] uppercase tracking-wide font-semibold text-muted">{label}</div>
      <div className="text-[12.5px] text-ink mt-0.5 truncate">{children}</div>
    </div>
  );
}

function AttributionBadge({ attribution }) {
  const { reps, via } = attribution;
  if (via === 'sdr') {
    return (
      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-mint-soft text-teal">
        Credited to {reps.map(firstName).join(', ')}
      </span>
    );
  }
  if (via === 'bizdev') {
    return (
      <span
        className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-soft text-amber"
        title="SDR column is blank, so credit goes to the SDR/Hybrid rep in the Bizdev column. Set the SDR to confirm."
      >
        Credited to {reps.map(firstName).join(', ')} via Bizdev
      </span>
    );
  }
  return (
    <span
      className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-red-soft text-red"
      title="Counted in the team total but not credited to anyone on the leaderboard. Assign an SDR or change the status."
    >
      Not credited · no SDR
    </span>
  );
}

function MeetingRow({ meeting, reps, accountSlug, onUpdate }) {
  const [saving, setSaving] = useState(null);
  const [error, setError] = useState(null);

  const status    = meetingCol(meeting, MEETING_COLS.STATUS);
  const sdrIds    = (() => {
    try { return (JSON.parse(meeting.column_values?.find(c => c.id === MEETING_COLS.SDR)?.value ?? 'null')?.personsAndTeams ?? []).map(p => String(p.id)); }
    catch { return []; }
  })();
  const sdrText   = meetingCol(meeting, MEETING_COLS.SDR);
  const created   = createdDate(meeting);
  const qualified = meetingCol(meeting, MEETING_COLS.QUALIFIED);
  const meetingOn = meetingCol(meeting, MEETING_COLS.MEETING_DATE);
  const firstMtg  = meetingCol(meeting, MEETING_COLS.FIRST_MEETING);
  const company   = meetingCol(meeting, MEETING_COLS.COMPANY);
  const lag       = daysBetween(created, qualified);
  const counted   = isQualifyingMeeting(meeting);
  // Only offer reps for the SDR picker; keep the current value selectable even if it's someone else.
  const sdrValue  = sdrIds.length === 1 ? sdrIds[0] : '';

  async function save(field, columnId, value, type, patch) {
    setSaving(field);
    setError(null);
    try {
      await updateItemColumnValue(BOARDS.LEADS, meeting.id, columnId, value, type);
      onUpdate(meeting.id, patch);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(null);
    }
  }

  function onStatusChange(label) {
    save('status', MEETING_COLS.STATUS, label, 'status', { id: MEETING_COLS.STATUS, text: label, value: null });
  }

  function onSdrChange(userId) {
    const rep = reps.find(r => r.mondayUserId === userId);
    save('sdr', MEETING_COLS.SDR, userId, 'multiple-person', {
      id: MEETING_COLS.SDR,
      text: rep?.name ?? '',
      value: userId ? JSON.stringify({ personsAndTeams: [{ id: Number(userId), kind: 'person' }] }) : null,
    });
  }

  return (
    <div className={`border border-line rounded-xl p-4 bg-canvas ${counted ? '' : 'opacity-60'}`}>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="font-display font-bold text-[14.5px] truncate">{meeting.name}</div>
          <div className="text-[12px] text-muted truncate">{company || 'No company'}</div>
        </div>
        {accountSlug && (
          <a
            href={`https://${accountSlug}.monday.com/boards/${BOARDS.LEADS}/pulses/${meeting.id}`}
            target="_blank"
            rel="noreferrer"
            className="text-[11.5px] font-semibold text-teal hover:text-teal-mid flex-shrink-0"
          >
            Open ↗
          </a>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 mt-2">
        <AttributionBadge attribution={meeting.attribution} />
        {!counted && (
          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#E8E3DA] text-muted">No longer counted</span>
        )}
        {lag > 60 && (
          <span
            className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#E8E3DA] text-muted"
            title="Lead was created long before its Qualified Date. Check the date is right."
          >
            Created {lag} days before qualifying
          </span>
        )}
      </div>

      <div className="grid grid-cols-4 gap-3 mt-3">
        <Field label="Created">{fmtDate(created) ?? '—'}</Field>
        <Field label="Meeting on">{fmtDate(meetingOn) ?? <span className="text-muted italic">Not set</span>}</Field>
        <Field label="First mtg">{fmtDate(firstMtg) ?? '—'}</Field>
        <Field label="Qualified">{fmtDate(qualified) ?? '—'}</Field>
      </div>

      <div className="grid grid-cols-3 gap-3 mt-3">
        <Field label="Bizdev">{meetingCol(meeting, MEETING_COLS.BIZDEV) || '—'}</Field>
        <Field label="Channel">{meetingCol(meeting, MEETING_COLS.CHANNEL) || '—'}</Field>
        <Field label="Region">
          {meetingCol(meeting, MEETING_COLS.REGION) || (
            meeting.attribution.region
              ? <span title="Region column is blank; using the credited rep's region">{meeting.attribution.region} <span className="text-muted">(rep)</span></span>
              : <span className="text-muted italic">Not set</span>
          )}
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3 mt-3">
        <label className="block">
          <span className="text-[10.5px] uppercase tracking-wide font-semibold text-muted">SDR</span>
          <select
            value={sdrValue}
            disabled={saving === 'sdr'}
            onChange={e => onSdrChange(e.target.value)}
            className={`mt-0.5 w-full bg-card border rounded-lg px-2 py-1 text-[12.5px] outline-none focus:border-teal ${sdrIds.length ? 'border-line' : 'border-red/40'}`}
          >
            <option value="">{sdrIds.length > 1 ? sdrText : 'Unassigned'}</option>
            {sdrValue && !reps.some(r => r.mondayUserId === sdrValue) && <option value={sdrValue}>{sdrText}</option>}
            {reps.map(r => <option key={r.id} value={r.mondayUserId}>{r.name} · {r.role}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-[10.5px] uppercase tracking-wide font-semibold text-muted">Status</span>
          <select
            value={status}
            disabled={saving === 'status'}
            onChange={e => onStatusChange(e.target.value)}
            className="mt-0.5 w-full bg-card border border-line rounded-lg px-2 py-1 text-[12.5px] outline-none focus:border-teal"
          >
            {!LEAD_STATUS_OPTIONS.includes(status) && <option value={status}>{status || '—'}</option>}
            {LEAD_STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      </div>

      {saving && <div className="text-[11.5px] text-muted mt-2">Saving to monday…</div>}
      {error && <div className="text-[11.5px] text-red mt-2 break-words">Save failed: {error}</div>}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────
// filter: 'all' | 'unattributed' | <team register item id>

export default function MeetingsPanel({ meetings, reps, month, regionLabel, initialFilter = 'all', accountSlug, onClose, onMeetingUpdate }) {
  const [filter, setFilter] = useState(initialFilter);
  const [query, setQuery] = useState('');

  useEffect(() => { setFilter(initialFilter); }, [initialFilter]);

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const unattributed = meetings.filter(m => !m.attribution.via);
  const counted = meetings.filter(isQualifyingMeeting);
  const uncreditedCount = counted.filter(m => !m.attribution.via).length;

  const visible = useMemo(() => {
    let list = meetings;
    if (filter === 'unattributed') list = unattributed;
    else if (filter !== 'all') {
      const rep = reps.find(r => r.id === filter);
      list = rep ? repMeetings(rep, meetings) : [];
    }
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(m =>
        [m.name, meetingCol(m, MEETING_COLS.COMPANY), meetingCol(m, MEETING_COLS.BIZDEV), meetingCol(m, MEETING_COLS.SDR)]
          .some(v => v?.toLowerCase().includes(q))
      );
    }
    return [...list].sort((a, b) =>
      meetingCol(b, MEETING_COLS.QUALIFIED).localeCompare(meetingCol(a, MEETING_COLS.QUALIFIED))
    );
  }, [meetings, filter, query, reps]);

  const selectedRep = reps.find(r => r.id === filter);

  return (
    <>
      <div className="fixed inset-0 bg-ink/20 z-40 backdrop-blur-[1px]" onClick={onClose} />

      <div className="fixed inset-y-0 right-0 w-[560px] max-w-full bg-card border-l border-line shadow-2xl z-50 flex flex-col overflow-hidden">

        {/* Header */}
        <div className="px-5 py-4 border-b border-line bg-gradient-to-b from-[#F0EBE2] to-card flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="font-display font-bold text-[16px]">
                {selectedRep ? `${selectedRep.name}'s qualified meetings` : 'Qualified meetings'}
              </div>
              <div className="text-[11.5px] text-muted">
                {month} · {regionLabel} · {counted.length} counted
                {uncreditedCount > 0 && <span className="text-red"> · {uncreditedCount} not credited to a rep</span>}
              </div>
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

          <div className="flex flex-wrap gap-1.5 mt-3">
            <FilterChip active={filter === 'all'} onClick={() => setFilter('all')} label="All" count={meetings.length} />
            {reps.map(r => (
              <FilterChip
                key={r.id}
                active={filter === r.id}
                onClick={() => setFilter(r.id)}
                label={firstName(r)}
                count={repMeetings(r, meetings).length}
              />
            ))}
            <FilterChip
              active={filter === 'unattributed'}
              onClick={() => setFilter('unattributed')}
              label="Needs SDR"
              count={unattributed.length}
              tone="warn"
            />
          </div>

          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search name, company, Bizdev or SDR"
            className="mt-3 w-full bg-card border border-line rounded-lg px-3 py-1.5 text-[12.5px] outline-none focus:border-teal"
          />
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-3">
          {visible.length === 0 ? (
            <div className="text-[13px] text-muted text-center py-10">No meetings match this filter.</div>
          ) : (
            visible.map(m => (
              <MeetingRow key={m.id} meeting={m} reps={reps} accountSlug={accountSlug} onUpdate={onMeetingUpdate} />
            ))
          )}
        </div>

        <div className="px-5 py-3 border-t border-line bg-[#FAF8F5] text-[11.5px] text-muted flex-shrink-0">
          Credit goes to the SDR column. If it's blank, credit goes to the Bizdev when they're an SDR or Hybrid rep.
          Edits save straight to the Leads board.
        </div>
      </div>
    </>
  );
}
