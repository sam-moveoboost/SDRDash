import React, { useEffect, useState } from 'react';
import {
  fetchCurrentUser,
  fetchWorkspaceUsers,
  fetchProspects,
  fetchAllLeads,
  fetchOpportunities,
  fetchBoardColumns,
  updateItemColumnValue,
  BOARDS,
} from '../api/monday';
import ProgressBar from '../components/shared/ProgressBar';

// ── Helpers ────────────────────────────────────────────────────────

function colText(item, id) {
  return item.column_values?.find(c => c.id === id)?.text ?? '';
}

function colValue(item, id) {
  return item.column_values?.find(c => c.id === id)?.value ?? null;
}

function daysSince(dateStr) {
  if (!dateStr) return null;
  const d = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  return d >= 0 ? d : null;
}

function touchLabel(days) {
  if (days === null) return 'No contact';
  if (days === 0)    return 'Today';
  if (days === 1)    return 'Yesterday';
  if (days < 7)     return `${days}d ago`;
  if (days < 30)    return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function parsePersonIds(val) {
  try { return (JSON.parse(val ?? '{}').personsAndTeams ?? []).map(p => String(p.id)); }
  catch { return []; }
}

function isAssignedToUser(item, userId) {
  if (!userId) return true;
  const uid = String(userId);
  return (item.column_values ?? []).some(cv => {
    if (!cv.value) return false;
    try {
      const parsed = JSON.parse(cv.value);
      if (Array.isArray(parsed?.personsAndTeams)) {
        return parsed.personsAndTeams.some(p => String(p.id) === uid);
      }
    } catch {}
    return false;
  });
}

function parseStatusLabels(column) {
  if (!column?.settings_str) return [];
  try {
    const s = JSON.parse(column.settings_str);
    return Object.values(s.labels ?? {}).filter(l => l && l.trim());
  } catch { return []; }
}

function prospectName(item) {
  const first = colText(item, 'text_mm4hbfhh');
  const last  = colText(item, 'text_mm441v8n');
  return (first || last) ? `${first} ${last}`.trim() : item.name;
}

// Heuristic: find the most likely stage label on an opportunity card
const STAGE_HINTS = ['Proposal', 'Negotiation', 'Discovery', 'Closed', 'Lost', 'Won', 'Qualified'];
function oppStageText(item) {
  const cv = (item.column_values ?? []).find(c =>
    c.text && STAGE_HINTS.some(h => c.text.includes(h))
  );
  return cv?.text ?? null;
}

// ── Section config ─────────────────────────────────────────────────

const SECTION_CFG = {
  prospect: {
    label: 'Prospects',
    boardId: BOARDS.PROSPECTS,
    accentColor: '#0A7B6F',
    pillClass: 'bg-teal/10 text-teal',
    getName:      item => prospectName(item),
    getCompany:   item => colText(item, 'text_mkw7ezh6'),
    getStatus:    item => colText(item, 'status'),
    getRegion:    item => colText(item, 'color_mm4fna6'),
    getLastTouch: item => {
      const email = daysSince(colText(item, 'date4'));
      const call  = daysSince(colText(item, 'date_mkwr8xcd'));
      const vals  = [email, call].filter(v => v !== null);
      return vals.length ? Math.min(...vals) : null;
    },
    getEmail:      item => colText(item, 'email_mm14rb30'),
    getLinkedIn:   item => colText(item, 'text_mm09kzh1'),
    getEmailCount: item => colText(item, 'numeric_mkwrtyh6'),
    getCallCount:  item => colText(item, 'numeric_mkwr3x6d'),
    hardcodedFields: [
      {
        id: 'status', label: 'Status', type: 'color', isPeople: false,
        statusLabels: ['New Prospect', 'Exploratory', 'Follow up', 'Lead', 'Not Relevant'],
      },
      { id: 'person', label: 'Owner', type: 'person', isPeople: true, statusLabels: null },
    ],
  },
  lead: {
    label: 'Leads',
    boardId: BOARDS.LEADS,
    accentColor: '#D97706',
    pillClass: 'bg-amber-soft text-[#92400E]',
    getName:      item => item.name,
    getCompany:   () => '',
    getStatus:    item => colText(item, 'lead_status'),
    getRegion:    item => colText(item, 'color_mkz4y1yv'),
    getLastTouch: item => daysSince(item.updated_at),
    hardcodedFields: [
      { id: 'lead_status', label: 'Status', type: 'color', isPeople: false, statusLabels: null },
      { id: 'multiple_person_mm2bjm2z', label: 'SDR', type: 'multiple-person', isPeople: true, statusLabels: null },
    ],
  },
  opportunity: {
    label: 'Opportunities',
    boardId: BOARDS.OPPORTUNITIES,
    accentColor: '#059669',
    pillClass: 'bg-mint-soft text-mint-deep',
    getName:      item => item.name,
    getCompany:   () => '',
    getStatus:    item => oppStageText(item),
    getRegion:    item => colText(item, 'color_mkxerb02'),
    getLastTouch: item => daysSince(item.updated_at),
    hardcodedFields: null, // discovered dynamically via OPP_FIELD_DEFS
  },
};

// ── Opportunity field discovery (mirrors StaleDealsModal) ──────────

const OPP_FIELD_DEFS = [
  { key: 'stage',     label: 'Stage',        keywords: ['stage'],                                  preferType: 'color',   editable: true,  isPeople: false },
  { key: 'closeDate', label: 'Close date',   keywords: ['close date', 'expected close', 'close'], preferType: 'date',    editable: true,  isPeople: false },
  { key: 'sdr',       label: 'SDR',          keywords: ['sdr'],                                   preferType: null,      editable: true,  isPeople: true  },
  { key: 'bizdev',    label: 'BizDev',       keywords: ['bizdev', 'biz dev', 'business dev'],     preferType: null,      editable: true,  isPeople: true  },
  { key: 'dealType',  label: 'Deal type',    keywords: ['type of deal', 'deal type'],             preferType: 'color',   editable: true,  isPeople: false },
  { key: 'total',     label: 'Total value',  keywords: ['total price', 'total after discount'],   preferType: 'numeric', editable: false, isPeople: false },
];

function matchOppColumns(columns) {
  const result = {};
  for (const def of OPP_FIELD_DEFS) {
    const matches = columns.filter(c =>
      def.keywords.some(kw => c.title.toLowerCase().includes(kw))
    );
    result[def.key] = (
      def.preferType ? (matches.find(c => c.type === def.preferType) ?? matches[0]) : matches[0]
    ) ?? null;
  }
  return result;
}

// ── Status colors ──────────────────────────────────────────────────

const STATUS_META = {
  'New Prospect': { bg: 'bg-[#EEF2FF]', text: 'text-[#4F46E5]' },
  'Exploratory':  { bg: 'bg-amber-soft', text: 'text-[#92400E]' },
  'Follow up':    { bg: 'bg-[#ECFDF5]', text: 'text-teal-mid' },
  'Lead':         { bg: 'bg-mint-soft', text: 'text-mint-deep' },
  'Not Relevant': { bg: 'bg-red-soft', text: 'text-red' },
};

// ── Micro-components ───────────────────────────────────────────────

function StatusBadge({ label }) {
  if (!label) return null;
  const meta = STATUS_META[label] ?? { bg: 'bg-line', text: 'text-muted' };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold leading-none ${meta.bg} ${meta.text}`}>
      {label}
    </span>
  );
}

function RegionBadge({ label }) {
  if (!label) return null;
  const uk = label === 'UK';
  return (
    <span className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide leading-none ${uk ? 'bg-[#EEF2FF] text-[#4F46E5]' : 'bg-[#FEF3C7] text-[#92400E]'}`}>
      {label}
    </span>
  );
}

function TouchBadge({ days }) {
  const label = touchLabel(days);
  const colorCls = days === null ? 'text-muted italic'
    : days <= 1 ? 'text-mint-deep'
    : days <= 7 ? 'text-amber'
    : 'text-red';
  return <span className={`text-[11px] font-semibold whitespace-nowrap ${colorCls}`}>{label}</span>;
}

function UserAvatar({ name, photo }) {
  const initials = (name ?? '?').split(' ').map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
  return photo
    ? <img src={photo} alt={name} className="w-10 h-10 rounded-full object-cover flex-shrink-0" />
    : (
      <div className="w-10 h-10 rounded-full bg-teal/10 text-teal font-display font-bold text-[14px] flex items-center justify-center flex-shrink-0">
        {initials}
      </div>
    );
}

// ── Section header ─────────────────────────────────────────────────

function SectionHeader({ cfg, count, collapsed, onToggle }) {
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center gap-3 px-4 py-2.5 bg-canvas rounded-xl border border-line hover:border-[rgba(0,0,0,.12)] hover:bg-white transition-all group mb-2"
    >
      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: cfg.accentColor }} />
      <span className="font-display font-bold text-[14px] flex-1 text-left" style={{ color: cfg.accentColor }}>
        {cfg.label}
      </span>
      {count > 0 && (
        <span
          className="text-[11px] font-bold px-2 py-0.5 rounded-full text-white tabular-nums"
          style={{ background: cfg.accentColor }}
        >
          {count}
        </span>
      )}
      <svg
        className={`w-3.5 h-3.5 text-muted transition-transform duration-200 ${collapsed ? '' : 'rotate-180'}`}
        viewBox="0 0 12 12" fill="none"
      >
        <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </button>
  );
}

// ── Item card ──────────────────────────────────────────────────────

function ItemCard({ item, boardType, selected, onClick }) {
  const cfg     = SECTION_CFG[boardType];
  const name    = cfg.getName(item);
  const company = cfg.getCompany(item);
  const status  = cfg.getStatus(item);
  const region  = cfg.getRegion(item);
  const touch   = cfg.getLastTouch(item);
  const initials = name.split(' ').map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?';

  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-3 px-4 py-2.5 rounded-xl cursor-pointer transition-all border group ${
        selected
          ? 'bg-teal/5 border-teal/30 shadow-sm'
          : 'bg-white border-transparent hover:bg-canvas hover:shadow-sm hover:border-line'
      }`}
      style={{ borderLeft: `3px solid ${selected ? cfg.accentColor : 'transparent'}` }}
    >
      <div
        className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center font-display font-bold text-[11px]"
        style={{ background: `${cfg.accentColor}1a`, color: cfg.accentColor }}
      >
        {initials}
      </div>

      <div className="flex-1 min-w-0">
        <p className="font-semibold text-[13px] text-ink truncate leading-snug">{name}</p>
        {company && <p className="text-[11px] text-muted truncate">{company}</p>}
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        <TouchBadge days={touch} />
        {status && <StatusBadge label={status} />}
        <RegionBadge label={region} />
        <svg className="w-3.5 h-3.5 text-muted opacity-0 group-hover:opacity-60 transition-opacity ml-0.5" viewBox="0 0 12 12" fill="none">
          <path d="M4.5 3L7.5 6L4.5 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
    </div>
  );
}

// ── Detail / edit panel ────────────────────────────────────────────

function inputCls(dirty) {
  return `w-full border rounded-lg px-3 py-2 text-[13px] bg-white focus:outline-none focus:ring-1 focus:ring-teal focus:border-teal transition-colors ${
    dirty ? 'border-teal bg-mint-soft/30' : 'border-line'
  }`;
}

function DetailPanel({ item, boardType, boardCols, wsUsers, accountSlug, onClose, onUpdate }) {
  const cfg = SECTION_CFG[boardType];
  const [edits, setEdits]       = useState({});
  const [saving, setSaving]     = useState(false);
  const [savedMsg, setSavedMsg] = useState('');

  const name    = cfg.getName(item);
  const company = cfg.getCompany(item);
  const status  = cfg.getStatus(item);
  const region  = cfg.getRegion(item);
  const touch   = cfg.getLastTouch(item);

  // Build editable field list
  let editFields = cfg.hardcodedFields ?? [];

  if (boardType === 'lead' && boardCols) {
    editFields = editFields.map(f => {
      if (f.id === 'lead_status') {
        const col = boardCols.find(c => c.id === 'lead_status');
        return { ...f, statusLabels: col ? parseStatusLabels(col) : [] };
      }
      return f;
    });
  }

  if (boardType === 'opportunity' && boardCols) {
    const colMap = matchOppColumns(boardCols);
    editFields = OPP_FIELD_DEFS.filter(d => colMap[d.key] && d.editable).map(d => ({
      id: colMap[d.key].id,
      label: d.label,
      type: colMap[d.key].type,
      isPeople: d.isPeople,
      statusLabels: (colMap[d.key].type === 'color' || colMap[d.key].type === 'status')
        ? parseStatusLabels(colMap[d.key])
        : null,
    }));
  }

  async function handleSave() {
    const changed = Object.keys(edits);
    if (!changed.length) return;
    setSaving(true);
    setSavedMsg('');
    try {
      for (const colId of changed) {
        const field = editFields.find(f => f.id === colId);
        await updateItemColumnValue(cfg.boardId, item.id, colId, edits[colId], field?.type ?? 'text');
      }
      const updatedCvs = (item.column_values ?? []).map(cv => {
        if (edits[cv.id] === undefined) return cv;
        const field = editFields.find(f => f.id === cv.id);
        let newText  = edits[cv.id];
        let newValue = cv.value;
        if (field?.isPeople) {
          const uid = parseInt(edits[cv.id], 10);
          newText  = wsUsers.find(u => String(u.id) === String(edits[cv.id]))?.name ?? String(uid);
          newValue = JSON.stringify({ personsAndTeams: [{ id: uid, kind: 'person' }] });
        }
        return { ...cv, text: newText, value: newValue };
      });
      onUpdate(item.id, boardType, updatedCvs);
      setEdits({});
      setSavedMsg('Saved ✓');
      setTimeout(() => setSavedMsg(''), 3000);
    } catch (e) {
      setSavedMsg(`Error: ${e.message.slice(0, 80)}`);
    } finally {
      setSaving(false);
    }
  }

  const dirtyCount = Object.keys(edits).length;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div
        className="flex items-start justify-between px-5 pt-5 pb-4 border-b border-line flex-shrink-0"
        style={{ background: `linear-gradient(to bottom, ${cfg.accentColor}12, transparent)` }}
      >
        <div className="min-w-0 flex-1 pr-3">
          <span className={`inline-flex items-center text-[10px] font-bold uppercase tracking-wider mb-2 px-2 py-0.5 rounded-full ${cfg.pillClass}`}>
            {cfg.label}
          </span>
          <h2 className="font-display text-[18px] font-bold tracking-tight leading-snug break-words">{name}</h2>
          {company && <p className="text-muted text-[13px] mt-0.5">{company}</p>}
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {status && <StatusBadge label={status} />}
            <RegionBadge label={region} />
          </div>
          {accountSlug && (
            <a
              href={`https://${accountSlug}.monday.com/boards/${cfg.boardId}/pulses/${item.id}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 mt-2 text-[11.5px] font-semibold text-teal hover:text-teal-mid transition-colors"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                <polyline points="15,3 21,3 21,9"/>
                <line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
              Open in Monday ↗
            </a>
          )}
        </div>
        <button
          onClick={onClose}
          className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg hover:bg-line text-muted hover:text-ink transition-colors mt-0.5"
        >
          <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none">
            <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

        {/* Last touch callout */}
        {touch !== null && (
          <div className={`rounded-xl px-4 py-3 ${touch > 7 ? 'bg-red-soft' : touch > 3 ? 'bg-amber-soft' : 'bg-mint-soft'}`}>
            <p className={`text-[13px] font-semibold ${touch > 7 ? 'text-red' : touch > 3 ? 'text-[#92400E]' : 'text-mint-deep'}`}>
              Last touchpoint: {touchLabel(touch)}
            </p>
            {touch > 7 && (
              <p className="text-[12px] text-red/80 mt-0.5">No contact in over a week — consider reaching out.</p>
            )}
          </div>
        )}

        {/* Prospect contact + activity info */}
        {boardType === 'prospect' && (() => {
          const email    = cfg.getEmail(item);
          const linkedin = cfg.getLinkedIn(item);
          const emails   = cfg.getEmailCount(item);
          const calls    = cfg.getCallCount(item);
          const lastEmail = colText(item, 'date4');
          const lastCall  = colText(item, 'date_mkwr8xcd');
          return (
            <>
              {(email || linkedin) && (
                <div>
                  <p className="text-[10.5px] font-bold uppercase tracking-wider text-muted mb-2">Contact</p>
                  <div className="space-y-2">
                    {email && (
                      <a href={`mailto:${email}`} className="flex items-center gap-2 text-[13px] text-ink hover:text-teal transition-colors">
                        <svg className="w-3.5 h-3.5 text-muted flex-shrink-0" viewBox="0 0 16 16" fill="none">
                          <rect x="1.5" y="3.5" width="13" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.2"/>
                          <path d="M1.5 5.5L8 9.5L14.5 5.5" stroke="currentColor" strokeWidth="1.2"/>
                        </svg>
                        {email}
                      </a>
                    )}
                    {linkedin && (
                      <a href={linkedin.startsWith('http') ? linkedin : `https://${linkedin}`} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-[13px] text-[#0A66C2] hover:underline">
                        <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 16 16" fill="currentColor">
                          <path d="M2.2 16H0V5.3h2.2V16zM1.1 3.9C.5 3.9 0 3.4 0 2.7 0 2 .5 1.5 1.1 1.5s1.1.5 1.1 1.2c0 .7-.5 1.2-1.1 1.2zM16 16h-2.2v-5.2c0-.8 0-1.9-1.2-1.9s-1.3.9-1.3 1.8V16H9.1V5.3h2.1v1.5h.1c.3-.6 1-1.2 2-1.2 2.2 0 2.6 1.4 2.6 3.2V16z"/>
                        </svg>
                        LinkedIn profile
                      </a>
                    )}
                  </div>
                </div>
              )}
              <div>
                <p className="text-[10.5px] font-bold uppercase tracking-wider text-muted mb-2">Activity</p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-canvas rounded-xl p-3 text-center">
                    <p className="font-display font-bold text-[22px] leading-none">{emails || 0}</p>
                    <p className="text-[11px] text-muted mt-1">Emails sent</p>
                    {lastEmail && <p className="text-[10px] text-muted opacity-70 mt-0.5">Last: {lastEmail}</p>}
                  </div>
                  <div className="bg-canvas rounded-xl p-3 text-center">
                    <p className="font-display font-bold text-[22px] leading-none">{calls || 0}</p>
                    <p className="text-[11px] text-muted mt-1">Calls made</p>
                    {lastCall && <p className="text-[10px] text-muted opacity-70 mt-0.5">Last: {lastCall}</p>}
                  </div>
                </div>
              </div>
            </>
          );
        })()}

        {/* Opportunity: show last updated date */}
        {boardType === 'opportunity' && item.updated_at && (
          <div>
            <p className="text-[10.5px] font-bold uppercase tracking-wider text-muted mb-1">Last updated on board</p>
            <p className="text-[13px] text-muted">
              {new Date(item.updated_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
            </p>
          </div>
        )}

        {/* Edit fields */}
        {(boardType !== 'opportunity' || boardCols) && editFields.length > 0 && (
          <div>
            <p className="text-[10.5px] font-bold uppercase tracking-wider text-muted mb-2.5">Edit</p>
            <div className="space-y-3">
              {editFields.map(field => {
                const rawVal     = colValue(item, field.id);
                const currentTxt = colText(item, field.id);
                const editVal    = edits[field.id];

                if (field.isPeople) {
                  const currentId = parsePersonIds(rawVal)[0] ?? '';
                  const sel       = editVal ?? currentId;
                  const dirty     = editVal !== undefined && editVal !== currentId;
                  return (
                    <div key={field.id}>
                      <label className="text-[10.5px] font-bold uppercase tracking-wider text-muted block mb-1">{field.label}</label>
                      <select
                        value={sel}
                        onChange={e => setEdits(prev => ({ ...prev, [field.id]: e.target.value }))}
                        className={inputCls(dirty)}
                      >
                        <option value="">—</option>
                        {wsUsers.map(u => (
                          <option key={u.id} value={String(u.id)}>{u.name}</option>
                        ))}
                      </select>
                    </div>
                  );
                }

                if (field.statusLabels && field.statusLabels.length > 0) {
                  const sel   = editVal ?? currentTxt;
                  const dirty = editVal !== undefined && editVal !== currentTxt;
                  return (
                    <div key={field.id}>
                      <label className="text-[10.5px] font-bold uppercase tracking-wider text-muted block mb-1">{field.label}</label>
                      <select
                        value={sel}
                        onChange={e => setEdits(prev => ({ ...prev, [field.id]: e.target.value }))}
                        className={inputCls(dirty)}
                      >
                        <option value="">—</option>
                        {field.statusLabels.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                  );
                }

                if (field.type === 'date') {
                  const currentDate = currentTxt?.split(' ')[0] ?? '';
                  const sel         = editVal ?? currentDate;
                  return (
                    <div key={field.id}>
                      <label className="text-[10.5px] font-bold uppercase tracking-wider text-muted block mb-1">{field.label}</label>
                      <input
                        type="date"
                        value={sel}
                        onChange={e => setEdits(prev => ({ ...prev, [field.id]: e.target.value }))}
                        className={inputCls(editVal !== undefined)}
                      />
                    </div>
                  );
                }

                // Read-only display for numeric etc.
                return (
                  <div key={field.id}>
                    <label className="text-[10.5px] font-bold uppercase tracking-wider text-muted block mb-1">{field.label}</label>
                    <p className="text-[13px] text-ink px-3 py-2 bg-canvas rounded-lg">{currentTxt || '—'}</p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Notes — any long_text column matching "notes" keywords */}
        {boardCols && (() => {
          const notesCol = boardCols.find(c =>
            ['notes', 'note', 'comment'].some(kw => c.title.toLowerCase().includes(kw))
          );
          if (!notesCol) return null;
          const notesText = colText(item, notesCol.id);
          if (!notesText) return null;
          return (
            <div>
              <p className="text-[10.5px] font-bold uppercase tracking-wider text-muted mb-1.5">Notes</p>
              <div className="bg-canvas rounded-xl px-3 py-2.5 text-[13px] text-ink leading-relaxed whitespace-pre-wrap max-h-40 overflow-y-auto">
                {notesText}
              </div>
            </div>
          );
        })()}

        {/* Loading skeleton while board columns fetch */}
        {boardType === 'opportunity' && !boardCols && (
          <div className="space-y-2.5">
            <div className="text-[10.5px] font-bold uppercase tracking-wider text-muted mb-2">Edit</div>
            {[1, 2, 3].map(i => (
              <div key={i} className="h-[58px] bg-canvas rounded-xl animate-pulse" />
            ))}
          </div>
        )}
      </div>

      {/* Footer: save */}
      <div className="px-5 py-4 border-t border-line flex-shrink-0">
        {savedMsg && (
          <p className={`text-[12px] font-semibold mb-2 ${savedMsg.startsWith('Error') ? 'text-red' : 'text-mint-deep'}`}>
            {savedMsg}
          </p>
        )}
        <button
          disabled={saving || dirtyCount === 0}
          onClick={handleSave}
          className="w-full font-display font-semibold text-[14px] py-2.5 rounded-xl transition-all disabled:opacity-40 flex items-center justify-center gap-2"
          style={{
            background: dirtyCount > 0 ? cfg.accentColor : '#E8E3DA',
            color: dirtyCount > 0 ? 'white' : '#999',
          }}
        >
          {saving
            ? 'Saving…'
            : dirtyCount > 0
              ? `Save ${dirtyCount} change${dirtyCount > 1 ? 's' : ''}`
              : 'No changes'}
        </button>
      </div>
    </div>
  );
}

// ── Section skeleton (loading state) ──────────────────────────────

function SectionSkeleton() {
  return (
    <div className="space-y-1">
      {[1, 2, 3].map(i => (
        <div key={i} className="h-[52px] bg-canvas rounded-xl animate-pulse" style={{ opacity: 1 - (i - 1) * 0.28 }} />
      ))}
    </div>
  );
}

// ── Section empty state ────────────────────────────────────────────

function SectionEmpty({ boardType }) {
  return (
    <div className="flex items-center justify-center py-6 bg-canvas rounded-xl mb-1">
      <p className="text-[13px] text-muted">
        No {SECTION_CFG[boardType].label.toLowerCase()} assigned to you
      </p>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────

export default function Workflow({ region, user: userProp }) {
  const [me, setMe]           = useState(userProp ?? null);
  const [wsUsers, setWsUsers] = useState([]);
  const [prospects, setProspects] = useState([]);
  const [leads, setLeads]         = useState([]);
  const [opps, setOpps]           = useState([]);
  const [loadingProspects, setLoadingProspects] = useState(true);
  const [loadingLeads, setLoadingLeads]         = useState(true);
  const [loadingOpps, setLoadingOpps]           = useState(true);
  const [error, setError]                       = useState(null);

  const [selected, setSelected]   = useState(null); // { id, boardType }
  const [boardCols, setBoardCols] = useState({});   // { boardId: columns[] }

  const [searchQ, setSearchQ] = useState('');
  const [sortBy, setSortBy]   = useState('touch');
  const [collapsed, setCollapsed] = useState({ prospect: false, lead: false, opportunity: false });

  // ── Load all data progressively ────────────────────────────────
  useEffect(() => {
    async function init() {
      setLoadingProspects(true);
      setLoadingLeads(true);
      setLoadingOpps(true);
      setError(null);

      let currentUser = userProp;
      try {
        if (!currentUser) {
          currentUser = await fetchCurrentUser();
          setMe(currentUser);
        }
      } catch (e) {
        setError(e.message);
        setLoadingProspects(false);
        setLoadingLeads(false);
        setLoadingOpps(false);
        return;
      }

      const uid = currentUser?.id;

      // Workspace users — needed for detail panel people pickers
      fetchWorkspaceUsers().then(setWsUsers).catch(() => {});

      // Fire all three sections independently so each renders as its data arrives
      fetchProspects({ userId: uid, cursor: null })
        .then(res => setProspects(res.items ?? []))
        .catch(e => setError(e.message))
        .finally(() => setLoadingProspects(false));

      fetchAllLeads()
        .then(all => setLeads(all.filter(item => isAssignedToUser(item, uid))))
        .catch(e => setError(e.message))
        .finally(() => setLoadingLeads(false));

      fetchOpportunities({ region: null })
        .then(all => setOpps(all.filter(item => isAssignedToUser(item, uid))))
        .catch(e => setError(e.message))
        .finally(() => setLoadingOpps(false));
    }
    init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Lazy board column fetch ────────────────────────────────────
  useEffect(() => {
    if (!selected) return;
    const boardId = SECTION_CFG[selected.boardType].boardId;
    if (boardCols[boardId]) return;
    fetchBoardColumns(boardId).then(cols => {
      setBoardCols(prev => ({ ...prev, [boardId]: cols }));
    }).catch(() => {});
  }, [selected]);

  // ── Filter + sort ──────────────────────────────────────────────
  function filterAndSort(items, boardType) {
    const cfg = SECTION_CFG[boardType];
    let list = items;
    if (searchQ.trim()) {
      const q = searchQ.toLowerCase();
      list = list.filter(item =>
        cfg.getName(item).toLowerCase().includes(q) ||
        cfg.getCompany(item).toLowerCase().includes(q) ||
        item.name.toLowerCase().includes(q)
      );
    }
    if (region && region !== 'All') {
      list = list.filter(item => {
        const r = cfg.getRegion(item);
        return !r || r === region;
      });
    }
    return [...list].sort((a, b) => {
      if (sortBy === 'name') return cfg.getName(a).localeCompare(cfg.getName(b));
      // most overdue (highest days) first
      const ta = cfg.getLastTouch(a) ?? -1;
      const tb = cfg.getLastTouch(b) ?? -1;
      return tb - ta;
    });
  }

  const filteredProspects = filterAndSort(prospects, 'prospect');
  const filteredLeads     = filterAndSort(leads,     'lead');
  const filteredOpps      = filterAndSort(opps,      'opportunity');

  const selectedItem = selected
    ? (selected.boardType === 'prospect' ? prospects
       : selected.boardType === 'lead' ? leads
       : opps
      ).find(item => item.id === selected.id)
    : null;

  const selectedBoardCols = selected
    ? boardCols[SECTION_CFG[selected.boardType].boardId] ?? null
    : null;

  const accountSlug = me?.account?.slug ?? '';

  function handleUpdate(itemId, boardType, updatedCvs) {
    const setter = boardType === 'prospect' ? setProspects
      : boardType === 'lead' ? setLeads
      : setOpps;
    setter(prev => prev.map(item =>
      item.id === itemId ? { ...item, column_values: updatedCvs } : item
    ));
  }

  function toggleCollapsed(key) {
    setCollapsed(prev => ({ ...prev, [key]: !prev[key] }));
  }

  return (
    <>
      <ProgressBar loading={loadingProspects || loadingLeads || loadingOpps} />

      <div className="flex overflow-hidden" style={{ height: 'calc(100vh - 60px)' }}>

        {/* ── List pane ──────────────────────────────────── */}
        <div className={`flex flex-col flex-1 min-w-0 ${selectedItem ? 'hidden sm:flex' : 'flex'}`}>

          {/* Page header */}
          <div className="px-6 pt-5 pb-4 flex-shrink-0 border-b border-line">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="font-display text-[11px] font-semibold tracking-[.14em] uppercase text-mint-deep mb-0.5">
                  My Work
                </p>
                <h1 className="font-display text-[22px] font-bold tracking-tight">
                  {me?.name ? `${me.name.split(' ')[0]}'s Pipeline` : 'My Pipeline'}
                </h1>
              </div>
              {me && <UserAvatar name={me.name} photo={me.photo_thumb} />}
            </div>

            {/* Count pills */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-teal/10 text-teal text-[12px] font-semibold rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-teal" />
                {loadingProspects ? '…' : filteredProspects.length} prospects
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-amber-soft text-[#92400E] text-[12px] font-semibold rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-amber" />
                {loadingLeads ? '…' : filteredLeads.length} leads
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-mint-soft text-mint-deep text-[12px] font-semibold rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-mint-deep" />
                {loadingOpps ? '…' : filteredOpps.length} opportunities
              </span>
            </div>
          </div>

          {/* Filter bar */}
          <div className="flex items-center gap-2 px-5 py-2.5 flex-shrink-0 border-b border-line bg-white">
            <div className="relative flex-1 max-w-[240px]">
              <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted pointer-events-none" viewBox="0 0 16 16" fill="none">
                <circle cx="6.5" cy="6.5" r="4" stroke="currentColor" strokeWidth="1.3"/>
                <path d="M11 11L14 14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
              <input
                type="text"
                value={searchQ}
                onChange={e => setSearchQ(e.target.value)}
                placeholder="Search name, company…"
                className="w-full pl-7 pr-3 py-1.5 text-[12px] bg-canvas border border-line rounded-lg focus:outline-none focus:border-teal"
              />
            </div>
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value)}
              className="ml-auto px-2.5 py-1.5 bg-canvas border border-line rounded-lg text-[12px] font-medium focus:outline-none focus:border-teal hover:border-teal transition-colors"
            >
              <option value="touch">Sort: Most overdue</option>
              <option value="name">Sort: Name A–Z</option>
            </select>
          </div>

          {/* Scrollable sections */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

            {error && (
              <div className="text-red text-[13px] bg-red-soft px-4 py-3 rounded-xl">
                Failed to load: {error}
              </div>
            )}

            {/* PROSPECTS */}
            <div>
              <SectionHeader
                cfg={SECTION_CFG.prospect}
                count={filteredProspects.length}
                collapsed={collapsed.prospect}
                onToggle={() => toggleCollapsed('prospect')}
              />
              {!collapsed.prospect && (
                loadingProspects
                  ? <SectionSkeleton />
                  : <div className="space-y-1 max-h-72 overflow-y-auto pr-0.5">
                      {filteredProspects.length === 0 && <SectionEmpty boardType="prospect" />}
                      {filteredProspects.map(item => (
                        <ItemCard
                          key={item.id}
                          item={item}
                          boardType="prospect"
                          selected={selected?.boardType === 'prospect' && selected?.id === item.id}
                          onClick={() => setSelected({ id: item.id, boardType: 'prospect' })}
                        />
                      ))}
                    </div>
              )}
            </div>

            {/* LEADS */}
            <div>
              <SectionHeader
                cfg={SECTION_CFG.lead}
                count={filteredLeads.length}
                collapsed={collapsed.lead}
                onToggle={() => toggleCollapsed('lead')}
              />
              {!collapsed.lead && (
                loadingLeads
                  ? <SectionSkeleton />
                  : <div className="space-y-1 max-h-72 overflow-y-auto pr-0.5">
                      {filteredLeads.length === 0 && <SectionEmpty boardType="lead" />}
                      {filteredLeads.map(item => (
                        <ItemCard
                          key={item.id}
                          item={item}
                          boardType="lead"
                          selected={selected?.boardType === 'lead' && selected?.id === item.id}
                          onClick={() => setSelected({ id: item.id, boardType: 'lead' })}
                        />
                      ))}
                    </div>
              )}
            </div>

            {/* OPPORTUNITIES */}
            <div>
              <SectionHeader
                cfg={SECTION_CFG.opportunity}
                count={filteredOpps.length}
                collapsed={collapsed.opportunity}
                onToggle={() => toggleCollapsed('opportunity')}
              />
              {!collapsed.opportunity && (
                loadingOpps
                  ? <SectionSkeleton />
                  : <div className="space-y-1 max-h-72 overflow-y-auto pr-0.5">
                      {filteredOpps.length === 0 && <SectionEmpty boardType="opportunity" />}
                      {filteredOpps.map(item => (
                        <ItemCard
                          key={item.id}
                          item={item}
                          boardType="opportunity"
                          selected={selected?.boardType === 'opportunity' && selected?.id === item.id}
                          onClick={() => setSelected({ id: item.id, boardType: 'opportunity' })}
                        />
                      ))}
                    </div>
              )}
            </div>
          </div>
        </div>

        {/* Mobile back button */}
        {selectedItem && (
          <div className="sm:hidden fixed top-[68px] left-3 z-10">
            <button
              onClick={() => setSelected(null)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-line rounded-full shadow text-[12px] font-semibold text-teal"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 14 14" fill="none">
                <path d="M9 2L4 7L9 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Back
            </button>
          </div>
        )}

        {/* ── Detail panel ───────────────────────────────── */}
        <div className={`flex-col flex-shrink-0 border-l border-line bg-white overflow-hidden ${
          selectedItem
            ? 'flex w-full sm:w-[400px] lg:w-[440px]'
            : 'hidden sm:flex sm:w-[380px] lg:w-[420px]'
        }`}>
          {selectedItem ? (
            <DetailPanel
              key={`${selected.boardType}-${selectedItem.id}`}
              item={selectedItem}
              boardType={selected.boardType}
              boardCols={selectedBoardCols}
              wsUsers={wsUsers}
              accountSlug={accountSlug}
              onClose={() => setSelected(null)}
              onUpdate={handleUpdate}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-center px-8">
              <div>
                <div className="w-12 h-12 rounded-2xl bg-canvas border border-line flex items-center justify-center mx-auto mb-3">
                  <svg className="w-6 h-6 text-muted" viewBox="0 0 24 24" fill="none">
                    <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <p className="font-semibold text-[14px] text-ink">Select an item</p>
                <p className="text-muted text-[13px] mt-1 max-w-[200px] mx-auto">
                  Click any prospect, lead or opportunity to view details and edit key fields
                </p>
              </div>
            </div>
          )}
        </div>

      </div>
    </>
  );
}
