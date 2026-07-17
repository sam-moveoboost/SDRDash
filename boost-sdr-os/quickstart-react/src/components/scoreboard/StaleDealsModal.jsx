import React, { useState, useEffect } from 'react';
import { fetchBoardColumns, fetchItemNames, updateOpportunityColumn, BOARDS } from '../../api/monday';

// ── Helpers ───────────────────────────────────────────────────────

function daysSince(d) {
  if (!d) return 0;
  return Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
}

function dotColor(days) {
  if (days >= 30) return 'bg-red';
  if (days >= 21) return 'bg-amber';
  return 'bg-mint-deep';
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function parsePersonIds(val) {
  try { return (JSON.parse(val ?? '{}').personsAndTeams ?? []).map(p => String(p.id)); }
  catch { return []; }
}

// Parse available labels from a status column's settings_str JSON
function parseStatusLabels(column) {
  if (!column?.settings_str) return [];
  try {
    const s = JSON.parse(column.settings_str);
    return Object.values(s.labels ?? {}).filter(l => l && l.trim());
  } catch { return []; }
}

// Column type sets
const PEOPLE_TYPES  = new Set(['multiple-person', 'person']);
const DATE_TYPES    = new Set(['date']);
const NUM_TYPES     = new Set(['numeric']);
const STATUS_TYPES  = new Set(['color', 'status', 'dropdown']);
const CONNECT_TYPES = new Set(['board_relation', 'connect_boards']);

// ── Field definitions ────────────────────────────────────────────
// preferType: if multiple columns match the keywords, prefer this type
const FIELD_DEFS = [
  { key: 'stage',     label: 'Stage',                     keywords: ['stage'],                                preferType: 'color',   editable: true  },
  { key: 'closeDate', label: 'Expected close date',        keywords: ['close date', 'expected close', 'close'], preferType: 'date',    editable: true  },
  { key: 'bizdev',    label: 'BizDev',                    keywords: ['bizdev', 'biz dev', 'business dev'],     preferType: null,      editable: true  },
  { key: 'sdr',       label: 'SDR',                       keywords: ['sdr'],                                   preferType: null,      editable: true  },
  { key: 'account',   label: 'Account',                   keywords: ['account'],                               preferType: 'board_relation', editable: false },
  { key: 'dealType',  label: 'Type of deal',              keywords: ['type of deal', 'deal type'],             preferType: 'color',   editable: true  },
  { key: 'total',     label: 'Total price (after disc.)',  keywords: ['total price', 'total after discount'],   preferType: 'numeric', editable: true  },
  { key: 'psPrice',   label: 'PS price (after disc.)',    keywords: ['ps price', 'ps after', 'ps discount'],   preferType: 'numeric', editable: true  },
  // 'added arr' required — prevents partial match on other columns containing "arr"
  { key: 'arr',       label: 'Added ARR',                 keywords: ['added arr'],                             preferType: 'numeric', editable: true  },
];

function matchColumns(columns) {
  const result = {};
  for (const def of FIELD_DEFS) {
    const matches = columns.filter(c =>
      def.keywords.some(kw => c.title.toLowerCase().includes(kw))
    );
    // Prefer the right type if multiple columns match
    result[def.key] = (
      def.preferType ? (matches.find(c => c.type === def.preferType) ?? matches[0]) : matches[0]
    ) ?? null;
  }
  return result;
}

function colText(deal, colId) {
  return deal.column_values?.find(c => c.id === colId)?.text ?? '';
}

function colRawValue(deal, colId) {
  return deal.column_values?.find(c => c.id === colId)?.value ?? null;
}

// ── Shared input styles ───────────────────────────────────────────

function inputCls(dirty) {
  return `w-full border rounded-lg px-3 py-[7px] text-[13.5px] font-medium bg-card focus:outline-none focus:ring-1 focus:ring-teal focus:border-teal transition-colors ${
    dirty ? 'border-teal bg-mint-soft/20' : 'border-line'
  }`;
}

// ── FieldRow ──────────────────────────────────────────────────────

function FieldRow({ def, column, deal, edits, onChange, users, displayOverride }) {
  if (!column) return null;

  const rawVal     = colRawValue(deal, column.id);
  // displayOverride used for board_relation columns whose text field is always empty from Monday API
  const displayTxt = displayOverride !== undefined ? displayOverride : colText(deal, column.id);
  const editVal    = edits[column.id];
  const isDirty    = editVal !== undefined;

  // ── People field — check users[] first, before any column-type logic.
  // BizDev/SDR fields pass a users list; column.type strings vary across Monday API versions
  // ('multiple-person', 'person', 'people', etc.) so we don't rely on type matching here.
  if (users && users.length > 0) {
    const currentId = parsePersonIds(rawVal)[0] ?? '';
    const selected  = editVal ?? currentId;
    const dirty     = editVal !== undefined && editVal !== currentId;
    return (
      <div>
        <div className="text-[10.5px] font-semibold text-muted uppercase tracking-wider mb-1.5">{def.label}</div>
        <select
          value={selected}
          onChange={e => onChange(column.id, e.target.value)}
          className={inputCls(dirty)}
        >
          <option value="">—</option>
          {users.map(u => (
            <option key={u.id} value={String(u.id)}>{u.name}</option>
          ))}
        </select>
      </div>
    );
  }

  // ── Connect column — read-only, show text ──
  if (CONNECT_TYPES.has(column.type) || !def.editable) {
    return (
      <div>
        <div className="text-[10.5px] font-semibold text-muted uppercase tracking-wider mb-1.5">{def.label}</div>
        <div className="text-[13.5px] text-ink font-medium min-h-[36px] flex items-center border border-transparent px-0 py-1">
          {displayTxt || <span className="text-muted italic">—</span>}
        </div>
      </div>
    );
  }

  // ── Status / dropdown column ──
  if (STATUS_TYPES.has(column.type)) {
    const labels  = parseStatusLabels(column);
    const current = editVal ?? displayTxt;
    return (
      <div>
        <div className="text-[10.5px] font-semibold text-muted uppercase tracking-wider mb-1.5">{def.label}</div>
        <select
          value={current}
          onChange={e => onChange(column.id, e.target.value)}
          className={inputCls(isDirty)}
        >
          {!current && <option value="">—</option>}
          {labels.map(label => (
            <option key={label} value={label}>{label}</option>
          ))}
          {/* If current value isn't in the list (e.g. stale data), keep it selectable */}
          {current && !labels.includes(current) && (
            <option value={current}>{current}</option>
          )}
        </select>
      </div>
    );
  }

  // ── Date column ──
  if (DATE_TYPES.has(column.type)) {
    const current  = editVal ?? (displayTxt ? displayTxt.slice(0, 10) : '');
    return (
      <div>
        <div className="text-[10.5px] font-semibold text-muted uppercase tracking-wider mb-1.5">{def.label}</div>
        <input
          type="date"
          value={current}
          onChange={e => onChange(column.id, e.target.value)}
          className={inputCls(isDirty)}
        />
      </div>
    );
  }

  // ── Numeric column ──
  if (NUM_TYPES.has(column.type)) {
    const current = editVal ?? displayTxt;
    return (
      <div>
        <div className="text-[10.5px] font-semibold text-muted uppercase tracking-wider mb-1.5">{def.label}</div>
        <input
          type="number"
          value={current}
          onChange={e => onChange(column.id, e.target.value)}
          className={inputCls(isDirty)}
        />
      </div>
    );
  }

  // ── Text fallback ──
  const current = editVal ?? displayTxt;
  return (
    <div>
      <div className="text-[10.5px] font-semibold text-muted uppercase tracking-wider mb-1.5">{def.label}</div>
      <input
        type="text"
        value={current}
        onChange={e => onChange(column.id, e.target.value)}
        className={inputCls(isDirty)}
      />
    </div>
  );
}

// ── Main modal ────────────────────────────────────────────────────

export default function StaleDealsModal({ staleOpps, team = [], onClose, onDealUpdate }) {
  const [columns, setColumns]         = useState([]);
  const [fieldMap, setFieldMap]       = useState({});
  const [colsLoading, setColsLoading] = useState(true);

  // Role-filtered people options derived from the Team Register (already loaded by Scoreboard)
  const sdrOptions    = team
    .filter(m => ['SDR', 'Hybrid'].includes(m.role) && m.mondayUserId)
    .map(m => ({ id: m.mondayUserId, name: m.name }));
  const bizdevOptions = team
    .filter(m => !['SDR'].includes(m.role) && m.mondayUserId)
    .map(m => ({ id: m.mondayUserId, name: m.name }));

  const [selectedId, setSelectedId]   = useState(null);
  const [liveData, setLiveData]       = useState({});
  const [edits, setEdits]             = useState({});
  const [saving, setSaving]           = useState(false);
  const [savedMsg, setSavedMsg]       = useState('');
  const [accountName, setAccountName] = useState(null); // null = not yet fetched

  useEffect(() => {
    fetchBoardColumns(BOARDS.OPPORTUNITIES)
      .then(cols => {
        console.log('[StaleDealsModal] columns:', cols.map(c => `${c.title} → ${c.type}`));
        setColumns(cols);
        setFieldMap(matchColumns(cols));
      })
      .catch(e => console.error('[StaleDealsModal] columns', e))
      .finally(() => setColsLoading(false));
  }, []);

  useEffect(() => { setEdits({}); setSavedMsg(''); setAccountName(null); }, [selectedId]);

  // board_relation columns never populate `text` in Monday API — resolve linked item names separately
  useEffect(() => {
    const accountCol = fieldMap.account;
    if (!selected || !accountCol) return;

    const raw = colRawValue(selected, accountCol.id);
    if (!raw) { setAccountName(''); return; }

    let ids = [];
    try {
      const parsed = JSON.parse(raw);
      // Monday stores linked IDs as either [{linkedPulseId: n}] or [n] depending on API version
      ids = (parsed.linkedPulseIds ?? []).map(p =>
        typeof p === 'object' ? p.linkedPulseId : p
      ).filter(Boolean);
    } catch { /* malformed value */ }

    if (ids.length === 0) { setAccountName(''); return; }

    fetchItemNames(ids)
      .then(items => setAccountName(items.map(i => i.name).join(', ')))
      .catch(() => setAccountName(''));
  }, [selectedId, fieldMap.account?.id]);

  const sorted = [...staleOpps].sort((a, b) => daysSince(b.updated_at) - daysSince(a.updated_at));
  const selected = selectedId
    ? { ...(staleOpps.find(o => o.id === selectedId) ?? {}), ...(liveData[selectedId] ?? {}) }
    : null;

  function handleChange(colId, val) {
    setEdits(prev => ({ ...prev, [colId]: val }));
  }

  async function handleSave() {
    if (!selected || !Object.keys(edits).length) return;
    setSaving(true);
    setSavedMsg('');
    try {
      for (const [colId, val] of Object.entries(edits)) {
        const col = columns.find(c => c.id === colId);
        const matchedDef = FIELD_DEFS.find(d => fieldMap[d.key]?.id === colId);
        await updateOpportunityColumn(selected.id, colId, val, matchedDef?.key, col?.type);
      }

      // Update local display — resolve user name for people fields
      const allUsers = [...sdrOptions, ...bizdevOptions];
      const updatedCvs = (selected.column_values ?? []).map(cv => {
        if (edits[cv.id] === undefined) return cv;
        const def = FIELD_DEFS.find(d => fieldMap[d.key]?.id === cv.id);
        let newText = edits[cv.id];
        let newValue = cv.value;
        if (def?.key === 'sdr' || def?.key === 'bizdev') {
          const uid = parseInt(edits[cv.id], 10);
          newText = allUsers.find(u => String(u.id) === String(edits[cv.id]))?.name ?? String(uid);
          // Update value so parsePersonIds() can re-read the correct person ID after edits are cleared
          newValue = JSON.stringify({ personsAndTeams: [{ id: uid, kind: 'person' }] });
        }
        return { ...cv, text: newText, value: newValue };
      });

      setLiveData(prev => ({
        ...prev,
        [selected.id]: { ...(prev[selected.id] ?? {}), column_values: updatedCvs },
      }));
      // Propagate to parent so staleOpps stays fresh across modal close/reopen
      onDealUpdate?.(selected.id, updatedCvs);
      setEdits({});
      setSavedMsg('Saved ✓');
      setTimeout(() => setSavedMsg(''), 3000);
    } catch (e) {
      setSavedMsg('Error: ' + e.message);
    } finally {
      setSaving(false);
    }
  }

  const hasDirty = Object.keys(edits).length > 0;

  return (
    <>
      <div className="fixed inset-0 bg-ink/40 z-50 backdrop-blur-[2px]" onClick={onClose} />

      <div className="fixed inset-0 z-50 flex items-center justify-center p-6 pointer-events-none">
        <div className="bg-card rounded-2xl shadow-2xl border border-line w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden pointer-events-auto">

          {/* Header */}
          <div className="flex items-center gap-3 px-6 py-4 border-b border-line bg-gradient-to-b from-[#F0EBE2] to-card flex-shrink-0">
            <div>
              <h2 className="font-display font-bold text-[18px]">Stale Deals</h2>
              <p className="text-[12px] text-muted">No activity in 14+ days</p>
            </div>
            <span className="px-2.5 py-0.5 rounded-full bg-red-soft text-red text-[12px] font-semibold">
              {sorted.length} flagged
            </span>
            <button
              onClick={onClose}
              className="ml-auto w-8 h-8 rounded-lg bg-canvas hover:bg-line flex items-center justify-center text-muted hover:text-ink transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>

          {/* Body */}
          <div className="flex flex-1 overflow-hidden">

            {/* Left: deal list */}
            <div className="w-64 flex-shrink-0 border-r border-line overflow-y-auto bg-[#FAF8F5]">
              {sorted.map(opp => {
                const idle = daysSince(opp.updated_at);
                const isActive = selectedId === opp.id;
                return (
                  <button
                    key={opp.id}
                    onClick={() => setSelectedId(opp.id)}
                    className={`w-full flex items-center gap-3 px-4 py-3.5 border-b border-line text-left transition-colors border-l-2 ${
                      isActive
                        ? 'bg-teal/[0.06] border-l-teal pl-[14px]'
                        : 'border-l-transparent hover:bg-white pl-[14px]'
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full flex-none mt-0.5 ${dotColor(idle)}`} />
                    <div className="flex-1 min-w-0">
                      <div className={`text-[13px] truncate ${isActive ? 'font-semibold' : 'font-medium'}`}>
                        {opp.name}
                      </div>
                      <div className="text-muted text-[11px] mt-0.5">{idle} days idle</div>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Right: deal detail */}
            <div className="flex-1 overflow-y-auto">
              {!selected ? (
                <div className="h-full flex flex-col items-center justify-center gap-3 text-muted">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="opacity-30">
                    <rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>
                  </svg>
                  <span className="text-[13.5px]">Select a deal to view and edit details</span>
                </div>
              ) : (
                <div className="p-6 pb-10">

                  {/* Deal header */}
                  <div className="flex items-start gap-4 mb-7">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-display font-bold text-[22px] leading-tight">{selected.name}</h3>
                      <p className="text-muted text-[12.5px] mt-1">
                        Last updated {daysSince(selected.updated_at)} days ago
                        {selected.created_at && ` · Created ${fmtDate(selected.created_at)}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2.5 flex-shrink-0 pt-1">
                      {savedMsg && (
                        <span className={`text-[12.5px] font-semibold ${savedMsg.startsWith('Error') ? 'text-red' : 'text-mint-deep'}`}>
                          {savedMsg}
                        </span>
                      )}
                      {hasDirty && (
                        <button
                          onClick={handleSave}
                          disabled={saving}
                          className="px-4 py-2 bg-teal text-white text-[13px] font-semibold rounded-xl hover:bg-teal-mid transition-colors disabled:opacity-60"
                        >
                          {saving ? 'Saving…' : 'Save changes'}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Fields */}
                  {colsLoading ? (
                    <div className="grid grid-cols-2 gap-5">
                      {[1,2,3,4,5,6].map(i => (
                        <div key={i} className="h-16 bg-line rounded-xl animate-pulse" />
                      ))}
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-x-8 gap-y-5">
                        {FIELD_DEFS.map(def => (
                          <FieldRow
                            key={def.key}
                            def={def}
                            column={fieldMap[def.key]}
                            deal={selected}
                            edits={edits}
                            onChange={handleChange}
                            users={
                              def.key === 'sdr'    ? sdrOptions    :
                              def.key === 'bizdev' ? bizdevOptions :
                              []
                            }
                            displayOverride={
                              def.key === 'account'
                                ? (accountName === null ? 'Loading…' : accountName)
                                : undefined
                            }
                          />
                        ))}
                        {/* Deal created — always read-only, it's an item field not a column */}
                        <div>
                          <div className="text-[10.5px] font-semibold text-muted uppercase tracking-wider mb-1.5">Deal created</div>
                          <div className="text-[13.5px] text-ink font-medium min-h-[36px] flex items-center">
                            {selected.created_at ? fmtDate(selected.created_at) : <span className="text-muted italic">—</span>}
                          </div>
                        </div>
                      </div>

                      {/* Notes */}
                      <div className="mt-6 pt-5 border-t border-line space-y-1.5">
                        {fieldMap.account && CONNECT_TYPES.has(fieldMap.account.type) && (
                          <p className="text-muted text-[11.5px] italic">
                            Account is a connected column — it can only be changed in Monday.
                          </p>
                        )}
                        {FIELD_DEFS.every(def => !fieldMap[def.key]) && (
                          <p className="text-amber text-[12px]">
                            Column auto-matching found no matches — column titles in Monday may differ from expected names. Let the dev know the exact titles.
                          </p>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
