import React, { useState, useEffect } from 'react';
import { updateItemColumnValue, createOpportunity, fetchItemColumnValues, BOARDS } from '../../api/monday';

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

export const STAGE_COLOR = {
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

// ── Column ids (verified against the live board) ────────────────────

export const COL = {
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
  // ARR-side deal value — the pre-existing "Net Added ARR" field, always USD.
  NET_ADDED_ARR: 'numeric_mm1j3hkq',
  ARR_LENGTH: 'color_mkz4dtzp',
  // Manual, account-wide context (not a deal value) — titled "Total Account ARR".
  TOTAL_ACCOUNT_ARR: 'numeric_mm4x1a5e',
  TRANSACTION_CURRENCY: 'color_mm4xexb2',
  // PS-side deal value in the deal's Transaction Currency — titled "PS Value (Transaction Currency)".
  PS_VALUE_TXN: 'numeric_mkz3h4rp',
  HOURS_ACQUIRED: 'numeric_mm4xe0qv',
  HOURLY_RATE: 'formula_mm5pp5kk',
  // Live formula — converts PS_VALUE_TXN to USD via per-currency FX rate columns. Read-only.
  PS_VALUE_USD: 'formula_mm5qaewe',
  // Titled "FX Calculator" — single "Calculate" label, triggers the FX conversion.
  CALCULATE_TRIGGER: 'color_mm59ttnd',
  ACCOUNT: 'connect_boards31',
  COMPANY: 'text8',
  PAYMENT_TERMS: 'color_mm4x2xm1',
};

// ── Small building blocks ────────────────────────────────────────────

export function Chip({ label, color, empty }) {
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

// ── Detail / edit panel ──────────────────────────────────────────────

const PEOPLE_COL_IDS = new Set([COL.BIZDEV, COL.SDR, COL.IC_CSM]);

function buildColumnValue(type, value) {
  if (type === 'multiple-person' || type === 'person') {
    return { personsAndTeams: [{ id: parseInt(value, 10), kind: 'person' }] };
  } else if (type === 'color' || type === 'status') {
    return { label: String(value) };
  } else if (type === 'dropdown') {
    return { labels: [String(value)] };
  } else if (type === 'date') {
    return { date: String(value) };
  }
  return String(value);
}

export default function OpportunityDetailPanel({ item, isNew, boardCols, wsUsers, accountSlug, onClose, onUpdate, onCreate }) {
  const [edits, setEdits]       = useState({});
  const [newName, setNewName]   = useState('');
  const [saving, setSaving]     = useState(false);
  const [savedMsg, setSavedMsg] = useState('');

  const colOf = id => boardCols?.find(c => c.id === id);
  const labelsOf = id => parseSelectableLabels(colOf(id));

  // Hourly Rate / PS Value (USD) are live formulas that can be recomputed on
  // the board (by the FX Calculator automation, or edits made elsewhere)
  // after this item was last loaded into the app's cached list — refetch
  // them whenever an item is opened so the panel shows the board's current
  // values instead of whatever was in the initial bulk fetch.
  useEffect(() => {
    if (!item.id) return; // nothing to poll yet for a not-yet-created opportunity
    fetchItemColumnValues(item.id, [COL.HOURLY_RATE, COL.PS_VALUE_USD])
      .then(fresh => {
        if (!fresh.length) return;
        const updatedCvs = (item.column_values ?? []).map(cv => {
          const match = fresh.find(f => f.id === cv.id);
          return match ? { ...cv, text: match.text, value: match.value } : cv;
        });
        onUpdate(item.id, updatedCvs);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

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

  async function handleCreate() {
    if (!newName.trim()) return;
    setSaving(true);
    setSavedMsg('');
    try {
      const cv = {};
      for (const [colId, rawValue] of Object.entries(edits)) {
        if (rawValue === undefined || rawValue === null || rawValue === '') continue;
        const type = PEOPLE_COL_IDS.has(colId) ? 'person' : (colOf(colId)?.type ?? 'text');
        cv[colId] = buildColumnValue(type, rawValue);
      }
      const created = await createOpportunity(newName.trim(), cv);
      onCreate(created);
    } catch (e) {
      setSavedMsg(`Error: ${e.message.slice(0, 100)}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleCalculate() {
    setSaving(true);
    setSavedMsg('Calculating…');
    try {
      await updateItemColumnValue(BOARDS.OPPORTUNITIES, item.id, COL.CALCULATE_TRIGGER, 'Calculate', 'status');

      // The FX conversion is computed by a board automation, not synchronously by
      // this mutation — poll for the Hourly Rate / PS Value (USD) formula columns
      // to actually change before giving up, since our local copy of the item is
      // otherwise stuck at whatever it was when the board was first loaded.
      const before = currentText(COL.PS_VALUE_USD);
      let updated = false;
      for (let attempt = 0; attempt < 6 && !updated; attempt++) {
        await new Promise(r => setTimeout(r, 1500));
        const fresh = await fetchItemColumnValues(item.id, [COL.HOURLY_RATE, COL.PS_VALUE_USD]);
        if (!fresh.length) continue;
        const updatedCvs = (item.column_values ?? []).map(cv => {
          const match = fresh.find(f => f.id === cv.id);
          return match ? { ...cv, text: match.text, value: match.value } : cv;
        });
        onUpdate(item.id, updatedCvs);
        const freshPsUsd = fresh.find(f => f.id === COL.PS_VALUE_USD)?.text ?? '';
        if (freshPsUsd && freshPsUsd !== before) updated = true;
      }
      setSavedMsg(updated ? 'Calculated ✓' : 'Triggered — still calculating, reopen shortly if it hasn\'t updated');
      setTimeout(() => setSavedMsg(''), 4000);
    } catch (e) {
      setSavedMsg(`Error: ${e.message.slice(0, 100)}`);
    } finally {
      setSaving(false);
    }
  }

  // Live values — reflect unsaved edits immediately, so the header color and the
  // Financials section switch as soon as a dropdown changes, not just after Save.
  const stage      = val(COL.STAGE, currentText(COL.STAGE));
  const company    = currentText(COL.COMPANY);
  const accountLinked = currentText(COL.ACCOUNT);
  const dirtyCount = Object.keys(edits).length;
  const isPS = val(COL.TYPE_OF_DEAL, currentText(COL.TYPE_OF_DEAL)) === 'PS';

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div
        className="flex items-start justify-between px-5 pt-5 pb-4 border-b border-line flex-shrink-0"
        style={{ background: `linear-gradient(to bottom, ${STAGE_COLOR[stage] ?? '#888'}12, transparent)` }}
      >
        <div className="min-w-0 flex-1 pr-3">
          <span className="inline-flex items-center text-[10px] font-bold uppercase tracking-wider mb-2 px-2 py-0.5 rounded-full bg-mint-soft text-mint-deep">
            {isNew ? 'New Opportunity' : 'Opportunity'}
          </span>
          {isNew ? (
            <input
              type="text"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="Opportunity name…"
              autoFocus
              className="w-full font-display text-[18px] font-bold tracking-tight bg-transparent border-b border-line focus:outline-none focus:border-teal pb-1"
            />
          ) : (
            <h2 className="font-display text-[18px] font-bold tracking-tight leading-snug break-words">{item.name}</h2>
          )}
          {company && <p className="text-muted text-[13px] mt-0.5">{company}</p>}
          {accountLinked && <p className="text-muted text-[12px] mt-0.5">Account: {accountLinked}</p>}
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {stage && <Chip label={stage} color={STAGE_COLOR[stage]} />}
          </div>
          {accountSlug && item.id && (
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
            <StatusField label="Stage" value={stage} options={labelsOf(COL.STAGE)} dirty={dirty(COL.STAGE)} onChange={v => set(COL.STAGE, v)} />
            <NumberField label="Win Probability %" prefix={null} value={val(COL.WIN_PROB, currentText(COL.WIN_PROB))} dirty={dirty(COL.WIN_PROB)} onChange={v => set(COL.WIN_PROB, v)} />
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
            <StatusField label="ARR Length" value={val(COL.ARR_LENGTH, currentText(COL.ARR_LENGTH))} options={labelsOf(COL.ARR_LENGTH)} dirty={dirty(COL.ARR_LENGTH)} onChange={v => set(COL.ARR_LENGTH, v)} />
          </div>
        </div>

        {/* Team */}
        <div>
          <SectionLabel>Team</SectionLabel>
          <div className="grid grid-cols-3 gap-3">
            <PersonField label="BizDev" value={val(COL.BIZDEV, currentPerson(COL.BIZDEV))} wsUsers={wsUsers} dirty={dirty(COL.BIZDEV)} onChange={v => set(COL.BIZDEV, v)} />
            <PersonField label="SDR" value={val(COL.SDR, currentPerson(COL.SDR))} wsUsers={wsUsers} dirty={dirty(COL.SDR)} onChange={v => set(COL.SDR, v)} />
            <PersonField label="IC/CSM" value={val(COL.IC_CSM, currentPerson(COL.IC_CSM))} wsUsers={wsUsers} dirty={dirty(COL.IC_CSM)} onChange={v => set(COL.IC_CSM, v)} />
          </div>
        </div>

        {/* Financials — which fields matter depends on Type of Deal */}
        <div>
          <SectionLabel>Financials{isPS ? ' — Professional Services' : ' — ARR + CS (USD)'}</SectionLabel>
          {!isPS && (
            <div className="grid grid-cols-2 gap-3">
              <NumberField label="Net Added ARR" prefix="$" value={val(COL.NET_ADDED_ARR, currentText(COL.NET_ADDED_ARR))} dirty={dirty(COL.NET_ADDED_ARR)} onChange={v => set(COL.NET_ADDED_ARR, v)} />
              <NumberField label="Total Account ARR (manual)" prefix="$" value={val(COL.TOTAL_ACCOUNT_ARR, currentText(COL.TOTAL_ACCOUNT_ARR))} dirty={dirty(COL.TOTAL_ACCOUNT_ARR)} onChange={v => set(COL.TOTAL_ACCOUNT_ARR, v)} />
              <NumberField label="CS Hours Included" value={val(COL.HOURS_ACQUIRED, currentText(COL.HOURS_ACQUIRED))} dirty={dirty(COL.HOURS_ACQUIRED)} onChange={v => set(COL.HOURS_ACQUIRED, v)} />
            </div>
          )}
          {isPS && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <StatusField label="Transaction Currency" value={val(COL.TRANSACTION_CURRENCY, currentText(COL.TRANSACTION_CURRENCY))} options={labelsOf(COL.TRANSACTION_CURRENCY)} dirty={dirty(COL.TRANSACTION_CURRENCY)} onChange={v => set(COL.TRANSACTION_CURRENCY, v)} />
                <NumberField label="PS Value (Transaction Currency)" value={val(COL.PS_VALUE_TXN, currentText(COL.PS_VALUE_TXN))} dirty={dirty(COL.PS_VALUE_TXN)} onChange={v => set(COL.PS_VALUE_TXN, v)} />
                <NumberField label="Hours Acquired" value={val(COL.HOURS_ACQUIRED, currentText(COL.HOURS_ACQUIRED))} dirty={dirty(COL.HOURS_ACQUIRED)} onChange={v => set(COL.HOURS_ACQUIRED, v)} />
                <ReadOnlyField label="Hourly Rate (calculated)" value={currentText(COL.HOURLY_RATE)} />
                <ReadOnlyField label="PS Value (USD) — live formula" value={currentText(COL.PS_VALUE_USD)} />
              </div>
              {!isNew && (
                <button
                  onClick={handleCalculate}
                  disabled={saving}
                  className="mt-3 w-full font-display font-semibold text-[13px] py-2 rounded-xl border border-teal text-teal hover:bg-teal hover:text-white transition-colors disabled:opacity-40"
                >
                  FX Calculator → Convert to USD
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Footer: save / create */}
      <div className="px-5 py-4 border-t border-line flex-shrink-0">
        {savedMsg && (
          <p className={`text-[12px] font-semibold mb-2 ${savedMsg.startsWith('Error') ? 'text-red' : 'text-mint-deep'}`}>{savedMsg}</p>
        )}
        <button
          disabled={saving || (isNew ? !newName.trim() : dirtyCount === 0)}
          onClick={isNew ? handleCreate : handleSave}
          className="w-full font-display font-semibold text-[14px] py-2.5 rounded-xl transition-all disabled:opacity-40"
          style={{
            background: (isNew ? newName.trim().length > 0 : dirtyCount > 0) ? '#192D3F' : '#E8E3DA',
            color: (isNew ? newName.trim().length > 0 : dirtyCount > 0) ? 'white' : '#999',
          }}
        >
          {saving
            ? (isNew ? 'Creating…' : 'Saving…')
            : isNew
              ? 'Create Opportunity'
              : dirtyCount > 0 ? `Save ${dirtyCount} change${dirtyCount > 1 ? 's' : ''}` : 'No changes'}
        </button>
      </div>
    </div>
  );
}
