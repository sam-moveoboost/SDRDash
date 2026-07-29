import React, { useEffect, useState, useMemo } from 'react';
import {
  fetchOpportunities, fetchBoardColumns, fetchWorkspaceUsers, updateItemColumnValue, BOARDS,
} from '../api/monday';
import ProgressBar from '../components/shared/ProgressBar';
import { formatByCurrency } from '../utils/opportunityMetrics';

// ── Helpers ──────────────────────────────────────────────────────────

function colText(item, id) {
  return item.column_values?.find(c => c.id === id)?.text ?? '';
}
function colValue(item, id) {
  return item.column_values?.find(c => c.id === id)?.value ?? null;
}
function parsePersonIds(value) {
  try { return (JSON.parse(value ?? '{}').personsAndTeams ?? []).map(p => String(p.id)); }
  catch { return []; }
}
function parseSelectableLabels(column) {
  if (!column?.settings_str) return [];
  try {
    const s = JSON.parse(column.settings_str);
    return Object.values(s.labels ?? {})
      .map(l => (typeof l === 'string' ? l : l?.label ?? l?.name))
      .filter(l => l && String(l).trim());
  } catch { return []; }
}
function daysUntil(dateStr) {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000);
}
function fmtDate(dateStr) {
  if (!dateStr) return null;
  return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ── Pipeline stage config ───────────────────────────────────────────

const ACTIVE_STAGES = [
  'New (Qualified)', 'Demo (Evaluation)', 'Proposal (Validation)',
  'Contract sent (Buying process)', 'Negotiation & Legal', 'On hold', 'Ghosting',
];
const STAGE_COLOR = {
  'New (Qualified)': '#579bfc',
  'Demo (Evaluation)': '#9d50dd',
  'Proposal (Validation)': '#E29A2E',
  'Contract sent (Buying process)': '#00c875',
  'Negotiation & Legal': '#192D3F',
  'On hold': '#a0a0a0',
  'Ghosting': '#df2f4a',
  'Won': '#00c875',
  'Lost': '#df2f4a',
};

const FORECAST_COLOR = { 'Commit': '#00c875', 'Best Case': '#E29A2E', 'Pipeline': '#579bfc' };

// ── Column ids (verified against the live board) ────────────────────

const COL = {
  STAGE: 'color_mkz28c27',
  WIN_PROB: 'numeric_mm5pgbax',
  FORECAST: 'color_mm5phjr9',
  EXPECTED_CLOSE: 'deal_expected_close_date',
  ACTUAL_CLOSE: 'deal_close_date',
  NEXT_STEP: 'text_mkz2m8qz',
  NEXT_STEP_DATE: 'date_mkz2b26d',
  DISCOVERY_STATUS: 'color_mm3hgc8e',
  TYPE_OF_DEAL: 'color_mkz2atw5',
  ARR_SOURCE_TYPE: 'color_mkz2wqw4',
  REGION: 'color_mkxerb02',
  SOURCE: 'color_mkzaet62',
  INDUSTRY: 'dropdown_mkz4ve72',
  CONVERSION_ACTIVITY: 'color_mkza93q9',
  BIZDEV: 'deal_owner',
  SDR: 'multiple_person_mm4xadea',
  IC_CSM: 'multiple_person_mm1cxqfr',
  ARR: 'numeric_mm4x1a5e',
  NET_ADDED_ARR: 'numeric_mm1j3hkq',
  ARR_LENGTH: 'color_mkz4dtzp',
  TOTAL_ARR_ACCOUNT: 'numeric_mm5pbjqj',
  TRANSACTION_CURRENCY: 'color_mm4xexb2',
  TOTAL_AMOUNT: 'numeric_mkz3h4rp',
  HOURS_ACQUIRED: 'numeric_mm4xe0qv',
  HOURLY_RATE: 'formula_mm5pp5kk',
  PS_VALUE_USD: 'numeric_mm5p132c',
  CALCULATE_TRIGGER: 'color_mm59ttnd',
  ACCOUNT: 'connect_boards31',
  COMPANY: 'text8',
  PAYMENT_TERMS: 'color_mm4x2xm1',
};

// ── Small building blocks ────────────────────────────────────────────

function Chip({ label, color, empty }) {
  if (!label) return empty ? <span className="text-[11px] text-muted italic">{empty}</span> : null;
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-semibold leading-none text-white flex-shrink-0"
      style={{ background: color ?? '#888' }}
    >
      {label}
    </span>
  );
}

function inputCls(dirty) {
  return `w-full border rounded-lg px-3 py-2 text-[13px] bg-white focus:outline-none focus:ring-1 focus:ring-teal focus:border-teal transition-colors ${
    dirty ? 'border-teal bg-mint-soft/30' : 'border-line'
  }`;
}

function FieldRow({ label, children }) {
  return (
    <div>
      <label className="text-[10.5px] font-bold uppercase tracking-wider text-muted block mb-1">{label}</label>
      {children}
    </div>
  );
}

function StatusField({ label, value, options, dirty, onChange }) {
  return (
    <FieldRow label={label}>
      <select value={value ?? ''} onChange={e => onChange(e.target.value)} className={inputCls(dirty)}>
        <option value="">—</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </FieldRow>
  );
}

function TextField({ label, value, dirty, onChange, placeholder }) {
  return (
    <FieldRow label={label}>
      <input type="text" value={value ?? ''} placeholder={placeholder} onChange={e => onChange(e.target.value)} className={inputCls(dirty)} />
    </FieldRow>
  );
}

function NumberField({ label, value, dirty, onChange, prefix }) {
  return (
    <FieldRow label={label}>
      <div className="relative">
        {prefix && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-[13px]">{prefix}</span>}
        <input
          type="number" value={value ?? ''} onChange={e => onChange(e.target.value)}
          className={`${inputCls(dirty)} ${prefix ? 'pl-6' : ''}`}
        />
      </div>
    </FieldRow>
  );
}

function DateField({ label, value, dirty, onChange }) {
  return (
    <FieldRow label={label}>
      <input type="date" value={value ?? ''} onChange={e => onChange(e.target.value)} className={inputCls(dirty)} />
    </FieldRow>
  );
}

function PersonField({ label, value, wsUsers, dirty, onChange }) {
  return (
    <FieldRow label={label}>
      <select value={value ?? ''} onChange={e => onChange(e.target.value)} className={inputCls(dirty)}>
        <option value="">—</option>
        {wsUsers.map(u => <option key={u.id} value={String(u.id)}>{u.name}</option>)}
      </select>
    </FieldRow>
  );
}

function ReadOnlyField({ label, value }) {
  return (
    <FieldRow label={label}>
      <p className="text-[13px] text-ink px-3 py-2 bg-canvas rounded-lg min-h-[36px]">{value || '—'}</p>
    </FieldRow>
  );
}

function SectionLabel({ children }) {
  return <p className="text-[10.5px] font-bold uppercase tracking-wider text-muted mb-2.5 mt-1">{children}</p>;
}

// ── Opportunity list row ────────────────────────────────────────────

function OppRow({ item, selected, onClick }) {
  const stage    = colText(item, COL.STAGE);
  const forecast = colText(item, COL.FORECAST);
  const winProb  = colText(item, COL.WIN_PROB);
  const value    = colText(item, COL.TOTAL_AMOUNT) || colText(item, COL.ARR);
  const currency = colText(item, COL.TRANSACTION_CURRENCY) || 'USD';
  const company  = colText(item, COL.COMPANY);
  const nextStepDate = colText(item, COL.NEXT_STEP_DATE);
  const dUntil = daysUntil(nextStepDate);

  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-3 px-4 py-2.5 rounded-xl cursor-pointer transition-all border group ${
        selected ? 'bg-teal/5 border-teal/30 shadow-sm' : 'bg-white border-transparent hover:bg-canvas hover:shadow-sm hover:border-line'
      }`}
      style={{ borderLeft: `3px solid ${selected ? (STAGE_COLOR[stage] ?? '#888') : 'transparent'}` }}
    >
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-[13px] text-ink truncate leading-snug">{item.name}</p>
        {company && <p className="text-[11px] text-muted truncate">{company}</p>}
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {winProb && <span className="text-[11px] font-bold text-teal tabular-nums">{winProb}%</span>}
        {forecast && <Chip label={forecast} color={FORECAST_COLOR[forecast]} />}
        {value && <span className="text-[12px] font-semibold text-ink tabular-nums whitespace-nowrap">{value ? Number(value).toLocaleString() : ''} {currency}</span>}
        {dUntil !== null && (
          <span className={`text-[10.5px] font-semibold whitespace-nowrap ${dUntil < 0 ? 'text-red' : dUntil <= 3 ? 'text-amber' : 'text-muted'}`}>
            {dUntil < 0 ? `${Math.abs(dUntil)}d overdue` : dUntil === 0 ? 'Due today' : `${dUntil}d`}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Stage section ───────────────────────────────────────────────────

function StageSection({ stage, items, collapsed, onToggle, selectedId, onSelect }) {
  const totalByCurrency = useMemo(() => {
    const out = {};
    items.forEach(item => {
      const amt = parseFloat(colText(item, COL.TOTAL_AMOUNT) || colText(item, COL.ARR) || '0');
      const currency = colText(item, COL.TRANSACTION_CURRENCY) || 'USD';
      if (amt) out[currency] = (out[currency] || 0) + amt;
    });
    return out;
  }, [items]);

  return (
    <div className="mb-1">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-2.5 bg-canvas rounded-xl border border-line hover:border-[rgba(0,0,0,.12)] hover:bg-white transition-all group mb-2"
      >
        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: STAGE_COLOR[stage] ?? '#888' }} />
        <span className="font-display font-bold text-[13.5px] flex-1 text-left" style={{ color: STAGE_COLOR[stage] ?? '#888' }}>
          {stage}
        </span>
        <span className="text-[11px] text-muted whitespace-nowrap">{formatByCurrency(totalByCurrency)}</span>
        <span
          className="text-[11px] font-bold px-2 py-0.5 rounded-full text-white tabular-nums flex-shrink-0"
          style={{ background: STAGE_COLOR[stage] ?? '#888' }}
        >
          {items.length}
        </span>
        <svg className={`w-3.5 h-3.5 text-muted transition-transform duration-200 flex-shrink-0 ${collapsed ? '' : 'rotate-180'}`} viewBox="0 0 12 12" fill="none">
          <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
      {!collapsed && (
        <div className="space-y-1 mb-3">
          {items.length === 0
            ? <div className="px-4 py-3 text-[12.5px] text-muted italic">No opportunities at this stage.</div>
            : items.map(item => (
                <OppRow key={item.id} item={item} selected={selectedId === item.id} onClick={() => onSelect(item.id)} />
              ))
          }
        </div>
      )}
    </div>
  );
}

// ── Detail / edit panel ──────────────────────────────────────────────

function DetailPanel({ item, boardCols, wsUsers, accountSlug, onClose, onUpdate }) {
  const [edits, setEdits]       = useState({});
  const [saving, setSaving]     = useState(false);
  const [savedMsg, setSavedMsg] = useState('');

  const colOf = id => boardCols?.find(c => c.id === id);
  const labelsOf = id => parseSelectableLabels(colOf(id));

  function set(id, value) {
    setEdits(prev => ({ ...prev, [id]: value }));
  }
  function currentText(id) { return colText(item, id); }
  function currentDate(id) { return currentText(id)?.split(' ')[0] ?? ''; }
  function currentPerson(id) { return parsePersonIds(colValue(item, id))[0] ?? ''; }
  function val(id, fallback) { return edits[id] !== undefined ? edits[id] : fallback; }
  function dirty(id) { return edits[id] !== undefined; }

  async function handleSave() {
    const changed = Object.keys(edits);
    if (!changed.length) return;
    setSaving(true);
    setSavedMsg('');
    try {
      for (const colId of changed) {
        const col = colOf(colId);
        const type = col?.type
          ?? (colId === COL.BIZDEV || colId === COL.SDR || colId === COL.IC_CSM ? 'person' : 'text');
        await updateItemColumnValue(BOARDS.OPPORTUNITIES, item.id, colId, edits[colId], type);
      }
      const updatedCvs = (item.column_values ?? []).map(cv => {
        if (edits[cv.id] === undefined) return cv;
        const isPeople = [COL.BIZDEV, COL.SDR, COL.IC_CSM].includes(cv.id);
        let newText = edits[cv.id];
        let newValue = cv.value;
        if (isPeople) {
          const uid = parseInt(edits[cv.id], 10);
          newText = wsUsers.find(u => String(u.id) === String(edits[cv.id]))?.name ?? String(uid);
          newValue = JSON.stringify({ personsAndTeams: [{ id: uid, kind: 'person' }] });
        }
        return { ...cv, text: newText, value: newValue };
      });
      onUpdate(item.id, updatedCvs);
      setEdits({});
      setSavedMsg('Saved ✓');
      setTimeout(() => setSavedMsg(''), 3000);
    } catch (e) {
      setSavedMsg(`Error: ${e.message.slice(0, 100)}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleCalculate() {
    setSaving(true);
    setSavedMsg('');
    try {
      await updateItemColumnValue(BOARDS.OPPORTUNITIES, item.id, COL.CALCULATE_TRIGGER, 'Calculate', 'status');
      setSavedMsg('Calculate triggered ✓');
      setTimeout(() => setSavedMsg(''), 3000);
    } catch (e) {
      setSavedMsg(`Error: ${e.message.slice(0, 100)}`);
    } finally {
      setSaving(false);
    }
  }

  const stage      = currentText(COL.STAGE);
  const company    = currentText(COL.COMPANY);
  const accountLinked = currentText(COL.ACCOUNT);
  const dirtyCount = Object.keys(edits).length;
  const isPS = currentText(COL.TYPE_OF_DEAL) === 'PS';

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div
        className="flex items-start justify-between px-5 pt-5 pb-4 border-b border-line flex-shrink-0"
        style={{ background: `linear-gradient(to bottom, ${STAGE_COLOR[stage] ?? '#888'}12, transparent)` }}
      >
        <div className="min-w-0 flex-1 pr-3">
          <span className="inline-flex items-center text-[10px] font-bold uppercase tracking-wider mb-2 px-2 py-0.5 rounded-full bg-mint-soft text-mint-deep">
            Opportunity
          </span>
          <h2 className="font-display text-[18px] font-bold tracking-tight leading-snug break-words">{item.name}</h2>
          {company && <p className="text-muted text-[13px] mt-0.5">{company}</p>}
          {accountLinked && <p className="text-muted text-[12px] mt-0.5">Account: {accountLinked}</p>}
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {stage && <Chip label={stage} color={STAGE_COLOR[stage]} />}
          </div>
          {accountSlug && (
            <a
              href={`https://${accountSlug}.monday.com/boards/${BOARDS.OPPORTUNITIES}/pulses/${item.id}`}
              target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1.5 mt-2 text-[11.5px] font-semibold text-teal hover:text-teal-mid transition-colors"
            >
              Open in Monday ↗
            </a>
          )}
        </div>
        <button onClick={onClose} className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg hover:bg-line text-muted hover:text-ink transition-colors mt-0.5">
          <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none">
            <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

        {/* Pipeline & forecast */}
        <div>
          <SectionLabel>Pipeline &amp; Forecast</SectionLabel>
          <div className="grid grid-cols-2 gap-3">
            <StatusField label="Stage" value={val(COL.STAGE, stage)} options={labelsOf(COL.STAGE)} dirty={dirty(COL.STAGE)} onChange={v => set(COL.STAGE, v)} />
            <NumberField label="Win Probability" prefix={null} value={val(COL.WIN_PROB, currentText(COL.WIN_PROB))} dirty={dirty(COL.WIN_PROB)} onChange={v => set(COL.WIN_PROB, v)} />
            <StatusField label="Forecast Category" value={val(COL.FORECAST, currentText(COL.FORECAST))} options={labelsOf(COL.FORECAST)} dirty={dirty(COL.FORECAST)} onChange={v => set(COL.FORECAST, v)} />
            <div />
            <DateField label="Expected Close" value={val(COL.EXPECTED_CLOSE, currentDate(COL.EXPECTED_CLOSE))} dirty={dirty(COL.EXPECTED_CLOSE)} onChange={v => set(COL.EXPECTED_CLOSE, v)} />
            <DateField label="Actual Close" value={val(COL.ACTUAL_CLOSE, currentDate(COL.ACTUAL_CLOSE))} dirty={dirty(COL.ACTUAL_CLOSE)} onChange={v => set(COL.ACTUAL_CLOSE, v)} />
          </div>
        </div>

        {/* Next step & qualification (MEDDPICC) */}
        <div>
          <SectionLabel>Next Step &amp; Qualification</SectionLabel>
          <div className="space-y-3">
            <FieldRow label="Next Strategic Step (incl. MEDDPICC notes)">
              <textarea
                value={val(COL.NEXT_STEP, currentText(COL.NEXT_STEP))}
                onChange={e => set(COL.NEXT_STEP, e.target.value)}
                rows={4}
                className={inputCls(dirty(COL.NEXT_STEP))}
              />
            </FieldRow>
            <div className="grid grid-cols-2 gap-3">
              <DateField label="Next Step Date" value={val(COL.NEXT_STEP_DATE, currentDate(COL.NEXT_STEP_DATE))} dirty={dirty(COL.NEXT_STEP_DATE)} onChange={v => set(COL.NEXT_STEP_DATE, v)} />
              <ReadOnlyField label="Discovery Status (auto, Boost AI)" value={currentText(COL.DISCOVERY_STATUS)} />
            </div>
          </div>
        </div>

        {/* Deal classification */}
        <div>
          <SectionLabel>Deal Classification</SectionLabel>
          <div className="grid grid-cols-2 gap-3">
            <StatusField label="Type of Deal (PS / ARR+CS)" value={val(COL.TYPE_OF_DEAL, currentText(COL.TYPE_OF_DEAL))} options={labelsOf(COL.TYPE_OF_DEAL)} dirty={dirty(COL.TYPE_OF_DEAL)} onChange={v => set(COL.TYPE_OF_DEAL, v)} />
            <StatusField label="ARR Source Type" value={val(COL.ARR_SOURCE_TYPE, currentText(COL.ARR_SOURCE_TYPE))} options={labelsOf(COL.ARR_SOURCE_TYPE)} dirty={dirty(COL.ARR_SOURCE_TYPE)} onChange={v => set(COL.ARR_SOURCE_TYPE, v)} />
            <StatusField label="Region" value={val(COL.REGION, currentText(COL.REGION))} options={labelsOf(COL.REGION)} dirty={dirty(COL.REGION)} onChange={v => set(COL.REGION, v)} />
            <StatusField label="Source" value={val(COL.SOURCE, currentText(COL.SOURCE))} options={labelsOf(COL.SOURCE)} dirty={dirty(COL.SOURCE)} onChange={v => set(COL.SOURCE, v)} />
            <StatusField label="Industry" value={val(COL.INDUSTRY, currentText(COL.INDUSTRY))} options={labelsOf(COL.INDUSTRY)} dirty={dirty(COL.INDUSTRY)} onChange={v => set(COL.INDUSTRY, v)} />
            <StatusField label="Conversion Activity" value={val(COL.CONVERSION_ACTIVITY, currentText(COL.CONVERSION_ACTIVITY))} options={labelsOf(COL.CONVERSION_ACTIVITY)} dirty={dirty(COL.CONVERSION_ACTIVITY)} onChange={v => set(COL.CONVERSION_ACTIVITY, v)} />
          </div>
          <div className="grid grid-cols-3 gap-3 mt-3">
            <PersonField label="BizDev" value={val(COL.BIZDEV, currentPerson(COL.BIZDEV))} wsUsers={wsUsers} dirty={dirty(COL.BIZDEV)} onChange={v => set(COL.BIZDEV, v)} />
            <PersonField label="SDR" value={val(COL.SDR, currentPerson(COL.SDR))} wsUsers={wsUsers} dirty={dirty(COL.SDR)} onChange={v => set(COL.SDR, v)} />
            <PersonField label="IC/CSM" value={val(COL.IC_CSM, currentPerson(COL.IC_CSM))} wsUsers={wsUsers} dirty={dirty(COL.IC_CSM)} onChange={v => set(COL.IC_CSM, v)} />
          </div>
        </div>

        {/* ARR + CS (functional currency = USD) */}
        {!isPS && (
          <div>
            <SectionLabel>ARR + CS (USD)</SectionLabel>
            <div className="grid grid-cols-2 gap-3">
              <NumberField label="ARR" prefix="$" value={val(COL.ARR, currentText(COL.ARR))} dirty={dirty(COL.ARR)} onChange={v => set(COL.ARR, v)} />
              <NumberField label="Net Added ARR" prefix="$" value={val(COL.NET_ADDED_ARR, currentText(COL.NET_ADDED_ARR))} dirty={dirty(COL.NET_ADDED_ARR)} onChange={v => set(COL.NET_ADDED_ARR, v)} />
              <StatusField label="ARR Length" value={val(COL.ARR_LENGTH, currentText(COL.ARR_LENGTH))} options={labelsOf(COL.ARR_LENGTH)} dirty={dirty(COL.ARR_LENGTH)} onChange={v => set(COL.ARR_LENGTH, v)} />
              <NumberField label="Total ARR on Account (manual)" prefix="$" value={val(COL.TOTAL_ARR_ACCOUNT, currentText(COL.TOTAL_ARR_ACCOUNT))} dirty={dirty(COL.TOTAL_ARR_ACCOUNT)} onChange={v => set(COL.TOTAL_ARR_ACCOUNT, v)} />
            </div>
          </div>
        )}

        {/* PS (transaction currency) */}
        {isPS && (
          <div>
            <SectionLabel>Professional Services</SectionLabel>
            <div className="grid grid-cols-2 gap-3">
              <StatusField label="Transaction Currency" value={val(COL.TRANSACTION_CURRENCY, currentText(COL.TRANSACTION_CURRENCY))} options={labelsOf(COL.TRANSACTION_CURRENCY)} dirty={dirty(COL.TRANSACTION_CURRENCY)} onChange={v => set(COL.TRANSACTION_CURRENCY, v)} />
              <NumberField label="Total Amount (transaction ccy)" value={val(COL.TOTAL_AMOUNT, currentText(COL.TOTAL_AMOUNT))} dirty={dirty(COL.TOTAL_AMOUNT)} onChange={v => set(COL.TOTAL_AMOUNT, v)} />
              <NumberField label="Hours Acquired" value={val(COL.HOURS_ACQUIRED, currentText(COL.HOURS_ACQUIRED))} dirty={dirty(COL.HOURS_ACQUIRED)} onChange={v => set(COL.HOURS_ACQUIRED, v)} />
              <ReadOnlyField label="Hourly Rate (calculated)" value={currentText(COL.HOURLY_RATE)} />
              <NumberField label="PS Value (USD)" prefix="$" value={val(COL.PS_VALUE_USD, currentText(COL.PS_VALUE_USD))} dirty={dirty(COL.PS_VALUE_USD)} onChange={v => set(COL.PS_VALUE_USD, v)} />
              <NumberField label="Total ARR on Account (manual)" prefix="$" value={val(COL.TOTAL_ARR_ACCOUNT, currentText(COL.TOTAL_ARR_ACCOUNT))} dirty={dirty(COL.TOTAL_ARR_ACCOUNT)} onChange={v => set(COL.TOTAL_ARR_ACCOUNT, v)} />
            </div>
            <button
              onClick={handleCalculate}
              disabled={saving}
              className="mt-3 w-full font-display font-semibold text-[13px] py-2 rounded-xl border border-teal text-teal hover:bg-teal hover:text-white transition-colors disabled:opacity-40"
            >
              Calculate → Convert to USD
            </button>
          </div>
        )}
      </div>

      {/* Footer: save */}
      <div className="px-5 py-4 border-t border-line flex-shrink-0">
        {savedMsg && (
          <p className={`text-[12px] font-semibold mb-2 ${savedMsg.startsWith('Error') ? 'text-red' : 'text-mint-deep'}`}>{savedMsg}</p>
        )}
        <button
          disabled={saving || dirtyCount === 0}
          onClick={handleSave}
          className="w-full font-display font-semibold text-[14px] py-2.5 rounded-xl transition-all disabled:opacity-40"
          style={{ background: dirtyCount > 0 ? '#192D3F' : '#E8E3DA', color: dirtyCount > 0 ? 'white' : '#999' }}
        >
          {saving ? 'Saving…' : dirtyCount > 0 ? `Save ${dirtyCount} change${dirtyCount > 1 ? 's' : ''}` : 'No changes'}
        </button>
      </div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────

export default function OpportunityBoard({ region, user }) {
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [opps, setOpps]           = useState([]);
  const [wsUsers, setWsUsers]     = useState([]);
  const [boardCols, setBoardCols] = useState(null);
  const [searchQ, setSearchQ]     = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [collapsed, setCollapsed] = useState({ Won: true, Lost: true });

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([fetchOpportunities({ region }), fetchWorkspaceUsers(), fetchBoardColumns(BOARDS.OPPORTUNITIES)])
      .then(([o, u, cols]) => { setOpps(o); setWsUsers(u); setBoardCols(cols); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [region]);

  const accountSlug = user?.account?.slug ?? '';

  const filtered = useMemo(() => {
    if (!searchQ.trim()) return opps;
    const q = searchQ.toLowerCase();
    return opps.filter(o =>
      o.name.toLowerCase().includes(q) || colText(o, COL.COMPANY).toLowerCase().includes(q)
    );
  }, [opps, searchQ]);

  const byStage = useMemo(() => {
    const map = {};
    [...ACTIVE_STAGES, 'Won', 'Lost'].forEach(s => { map[s] = []; });
    filtered.forEach(item => {
      const stage = colText(item, COL.STAGE) || 'New (Qualified)';
      (map[stage] ??= []).push(item);
    });
    Object.keys(map).forEach(s => {
      map[s].sort((a, b) => {
        const av = parseFloat(colText(a, COL.TOTAL_AMOUNT) || colText(a, COL.ARR) || '0');
        const bv = parseFloat(colText(b, COL.TOTAL_AMOUNT) || colText(b, COL.ARR) || '0');
        return bv - av;
      });
    });
    return map;
  }, [filtered]);

  const selectedItem = selectedId ? opps.find(o => o.id === selectedId) : null;

  function handleUpdate(itemId, updatedCvs) {
    setOpps(prev => prev.map(o => (o.id === itemId ? { ...o, column_values: updatedCvs } : o)));
  }

  function toggleStage(stage) {
    setCollapsed(prev => ({ ...prev, [stage]: !prev[stage] }));
  }

  const activeCount = ACTIVE_STAGES.reduce((sum, s) => sum + (byStage[s]?.length ?? 0), 0);

  if (error) return (
    <div className="max-w-6xl mx-auto px-7 py-10 text-red">Failed to load opportunities: {error}</div>
  );

  return (
    <div className="max-w-6xl mx-auto px-7 pb-20">
      <ProgressBar loading={loading} />

      <div className="flex items-center justify-between mb-3 pt-1">
        <div>
          <p className="font-display text-[11px] font-semibold tracking-[.14em] uppercase text-mint-deep mb-0.5">
            Manage Opportunities
          </p>
          <h2 className="font-display text-[20px] font-bold tracking-tight">Pipeline Board</h2>
        </div>
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-mint-soft text-mint-deep text-[12px] font-semibold rounded-full">
          {loading ? '…' : activeCount} active opportunities
        </span>
      </div>

      <div className="bg-card border border-line rounded-2xl shadow-sm overflow-hidden flex" style={{ height: '720px' }}>

        {/* List pane */}
        <div className={`flex flex-col flex-1 min-w-0 ${selectedItem ? 'hidden sm:flex' : 'flex'}`}>
          <div className="px-5 pt-4 pb-3 flex-shrink-0 border-b border-line">
            <div className="relative max-w-[280px]">
              <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted pointer-events-none" viewBox="0 0 16 16" fill="none">
                <circle cx="6.5" cy="6.5" r="4" stroke="currentColor" strokeWidth="1.3"/>
                <path d="M11 11L14 14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
              <input
                type="text" value={searchQ} onChange={e => setSearchQ(e.target.value)}
                placeholder="Search name, company…"
                className="w-full pl-7 pr-3 py-1.5 text-[12px] bg-canvas border border-line rounded-lg focus:outline-none focus:border-teal"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3">
            {ACTIVE_STAGES.map(stage => (
              <StageSection
                key={stage} stage={stage} items={byStage[stage] ?? []}
                collapsed={!!collapsed[stage]} onToggle={() => toggleStage(stage)}
                selectedId={selectedId} onSelect={setSelectedId}
              />
            ))}
            <div className="mt-4 pt-3 border-t border-line">
              <p className="text-[10.5px] font-bold uppercase tracking-wider text-muted mb-2 px-1">Closed</p>
              {['Won', 'Lost'].map(stage => (
                <StageSection
                  key={stage} stage={stage} items={byStage[stage] ?? []}
                  collapsed={!!collapsed[stage]} onToggle={() => toggleStage(stage)}
                  selectedId={selectedId} onSelect={setSelectedId}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Detail pane */}
        {selectedItem && (
          <div className="w-full sm:w-[440px] flex-shrink-0 border-l border-line bg-white overflow-hidden">
            <DetailPanel
              item={selectedItem}
              boardCols={boardCols}
              wsUsers={wsUsers}
              accountSlug={accountSlug}
              onClose={() => setSelectedId(null)}
              onUpdate={handleUpdate}
            />
          </div>
        )}
      </div>
    </div>
  );
}
