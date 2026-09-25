import React, { useEffect, useMemo, useState } from 'react';
import {
  fetchCurrentUser,
  fetchWorkspaceUsers,
  fetchMissingDataCandidates,
  fetchBoardColumns,
  updateItemColumns,
  buildColumnValue,
  BOARDS,
} from '../api/monday';
import ProgressBar from '../components/shared/ProgressBar';
import {
  MISSING_BOARDS,
  missingFields,
  inScope,
  STATUS_COLUMN,
  buildMissingList,
  statusOptions,
  mergeSavedColumns,
} from '../utils/missingData';

const BOARD_CFG = {
  [MISSING_BOARDS.PROSPECT]: {
    label: 'Prospects',
    boardId: BOARDS.PROSPECTS,
    accentColor: '#1a385e',
    pillClass: 'bg-navy/10 text-navy',
    subtitle: item => [colText(item, 'text_mkw7ezh6'), colText(item, 'status')].filter(Boolean).join(' · '),
  },
  [MISSING_BOARDS.OPP]: {
    label: 'Opportunities',
    boardId: BOARDS.OPPORTUNITIES,
    accentColor: '#027361',
    pillClass: 'bg-pale text-emerald',
    subtitle: item => colText(item, 'color_mkz28c27') || 'No stage',
  },
  [MISSING_BOARDS.LEAD]: {
    label: 'Leads',
    boardId: BOARDS.LEADS,
    accentColor: '#cf9a2b',
    pillClass: 'bg-amber-soft text-amber-ink',
    subtitle: item => [colText(item, 'lead_company'), colText(item, 'lead_status')].filter(Boolean).join(' · '),
  },
};

function colText(item, id) {
  const cv = item.column_values?.find(c => c.id === id);
  return cv?.text || cv?.display_value || '';
}

function inputCls(dirty) {
  return `w-full border rounded-xl px-3 py-2 text-[13px] bg-white focus:outline-none focus:ring-1 focus:ring-navy focus:border-navy transition-colors ${
    dirty ? 'border-navy bg-pale/30' : 'border-line'
  }`;
}

// ── List card ─────────────────────────────────────────────────────
function MissingCard({ entry, selected, onClick }) {
  const cfg = BOARD_CFG[entry.board];
  const shown = entry.missing.slice(0, 3);
  const more = entry.missing.length - shown.length;
  return (
    <div
      onClick={onClick}
      className={`px-4 py-2.5 rounded-xl cursor-pointer transition-all border ${
        selected ? 'bg-navy/5 border-navy/30 shadow-sm' : 'bg-white border-transparent hover:bg-canvas hover:shadow-sm hover:border-line'
      }`}
      style={{ borderLeft: `3px solid ${selected ? cfg.accentColor : 'transparent'}` }}
    >
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-[13px] text-ink truncate">{entry.item.name}</p>
          <p className="text-[11px] text-muted truncate">{cfg.subtitle(entry.item)}</p>
        </div>
        <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-red-soft text-red tabular-nums flex-shrink-0">
          {entry.missing.length} missing
        </span>
      </div>
      <div className="flex flex-wrap gap-1 mt-1.5">
        {shown.map(f => (
          <span key={f.id} className="text-[10.5px] font-semibold px-1.5 py-0.5 rounded bg-canvas text-muted border border-line">{f.label}</span>
        ))}
        {more > 0 && <span className="text-[10.5px] font-semibold px-1.5 py-0.5 text-muted">+{more} more</span>}
      </div>
    </div>
  );
}

// ── Field editor ──────────────────────────────────────────────────
function FieldInput({ field, value, onChange, options, users }) {
  const dirty = value !== undefined && value !== '';
  if (field.type === 'status') {
    return (
      <select value={value ?? ''} onChange={e => onChange(e.target.value)} className={inputCls(dirty)}>
        <option value="">Choose…</option>
        {options.map(o => <option key={o.index} value={String(o.index)}>{o.label}</option>)}
      </select>
    );
  }
  if (field.type === 'multiple-person') {
    return (
      <select value={value ?? ''} onChange={e => onChange(e.target.value)} className={inputCls(dirty)}>
        <option value="">Choose…</option>
        {users.map(u => <option key={u.id} value={String(u.id)}>{u.name}</option>)}
      </select>
    );
  }
  const type = field.type === 'date' ? 'date' : field.type === 'numbers' ? 'number' : field.type === 'email' ? 'email' : 'text';
  return (
    <input
      type={type}
      value={value ?? ''}
      placeholder={field.hint ?? ''}
      min={field.id === 'numeric_mm5pgbax' ? 0 : undefined}
      max={field.id === 'numeric_mm5pgbax' ? 100 : undefined}
      onChange={e => onChange(e.target.value)}
      className={inputCls(dirty)}
    />
  );
}

// ── Sidebar ───────────────────────────────────────────────────────
function FixPanel({ entry, boardCols, users, accountSlug, onClose, onSaved }) {
  const cfg = BOARD_CFG[entry.board];
  const [values, setValues] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  const cols = boardCols[cfg.boardId] ?? [];
  const optionsFor = id => statusOptions(cols.find(c => c.id === id));

  // Status / Stage is always editable, pre-filled with the current value
  const statusCol = STATUS_COLUMN[entry.board];
  const currentStatusIndex = (() => {
    try { return String(JSON.parse(entry.item.column_values?.find(c => c.id === statusCol.id)?.value ?? '{}').index ?? ''); }
    catch { return ''; }
  })();
  const statusValue = values[statusCol.id] ?? currentStatusIndex;
  const statusChanged = values[statusCol.id] !== undefined && values[statusCol.id] !== currentStatusIndex;
  const filledCount = Object.entries(values)
    .filter(([id, v]) => id !== statusCol.id && v !== undefined && String(v).trim() !== '').length
    + (statusChanged ? 1 : 0);

  async function handleSave() {
    const cv = {};
    entry.missing.forEach(f => {
      const v = values[f.id];
      if (v === undefined || String(v).trim() === '') return;
      // Status columns are saved by index (see statusOptions)
      cv[f.id] = f.type === 'status' ? { index: Number(v) } : buildColumnValue(f.type, v);
    });
    if (statusChanged) cv[statusCol.id] = { index: Number(values[statusCol.id]) };
    if (!Object.keys(cv).length) return;
    if (values.numeric_mm5pgbax !== undefined) {
      const n = Number(values.numeric_mm5pgbax);
      if (!(n >= 0 && n <= 100)) { setError('Win Probability must be between 0 and 100'); return; }
    }
    setSaving(true);
    setError('');
    try {
      const updated = await updateItemColumns(cfg.boardId, entry.item.id, cv);
      onSaved(entry, mergeSavedColumns(entry.item.column_values, updated.column_values));
      setValues({});
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="h-full flex flex-col">
      <div
        className="flex items-start justify-between px-5 pt-5 pb-4 border-b border-line flex-shrink-0"
        style={{ background: `linear-gradient(to bottom, ${cfg.accentColor}12, transparent)` }}
      >
        <div className="min-w-0 flex-1 pr-3">
          <span className={`inline-flex items-center text-[10px] font-bold uppercase tracking-wider mb-2 px-2 py-0.5 rounded-full ${cfg.pillClass}`}>
            {cfg.label}
          </span>
          <h2 className="font-heading text-[18px] font-bold tracking-tight leading-snug break-words">{entry.item.name}</h2>
          <p className="text-muted text-[13px] mt-0.5">{cfg.subtitle(entry.item)}</p>
          {accountSlug && (
            <a
              href={`https://${accountSlug}.monday.com/boards/${cfg.boardId}/pulses/${entry.item.id}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 mt-2 text-[11.5px] font-semibold text-navy hover:text-navy-700"
            >
              Open in Monday ↗
            </a>
          )}
        </div>
        <button onClick={onClose} className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg hover:bg-line text-muted hover:text-ink">
          <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none"><path d="M12 4L4 12M4 4L12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        <div className="pb-2 mb-1 border-b border-line">
          <label className="text-[10.5px] font-bold uppercase tracking-wider text-muted block mb-1">{statusCol.label}</label>
          <select
            value={statusValue}
            onChange={e => setValues(prev => ({ ...prev, [statusCol.id]: e.target.value }))}
            className={`w-full border rounded-xl px-3 py-2 text-[13px] bg-white focus:outline-none focus:ring-1 focus:ring-navy focus:border-navy transition-colors ${
              statusChanged ? 'border-navy bg-pale/30' : 'border-line'
            }`}
          >
            <option value="">—</option>
            {optionsFor(statusCol.id).map(o => <option key={o.index} value={String(o.index)}>{o.label}</option>)}
          </select>
        </div>
        <p className="text-[10.5px] font-bold uppercase tracking-wider text-muted">
          Missing · {entry.missing.length} field{entry.missing.length !== 1 ? 's' : ''}
        </p>
        {entry.missing.map(f => (
          <div key={f.id}>
            <label className="text-[10.5px] font-bold uppercase tracking-wider text-muted block mb-1">{f.label}</label>
            <FieldInput
              field={f}
              value={values[f.id]}
              onChange={v => setValues(prev => ({ ...prev, [f.id]: v }))}
              options={f.type === 'status' ? optionsFor(f.id) : []}
              users={users}
            />
          </div>
        ))}
        <p className="text-[11.5px] text-muted pt-1">You can save some fields now and come back for the rest. The record leaves this list once everything is filled in.</p>
      </div>

      <div className="px-5 py-4 border-t border-line flex-shrink-0">
        {error && <p className="text-[12px] font-semibold mb-2 text-red">Error: {error}</p>}
        <button
          disabled={saving || filledCount === 0}
          onClick={handleSave}
          className="w-full font-heading font-semibold text-[14px] py-2.5 rounded-full transition-all disabled:opacity-40"
          style={{ background: filledCount > 0 ? cfg.accentColor : '#e4e6e4', color: filledCount > 0 ? 'white' : '#757c77' }}
        >
          {saving ? 'Saving…' : filledCount > 0 ? `Save ${filledCount} field${filledCount > 1 ? 's' : ''}` : 'Fill in a field to save'}
        </button>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────
export default function MissingData({ user: userProp }) {
  const [me, setMe]           = useState(userProp ?? null);
  const [users, setUsers]     = useState([]);
  const [data, setData]       = useState(null);
  const [boardCols, setBoardCols] = useState({});
  const [error, setError]     = useState(null);
  const [personId, setPersonId] = useState(null); // null until "me" is known; 'all' = everyone
  const [selected, setSelected] = useState(null); // { id, board }
  const [toast, setToast]     = useState('');

  useEffect(() => {
    (async () => {
      try {
        const current = userProp ?? await fetchCurrentUser();
        setMe(current);
        setPersonId(prev => prev ?? String(current.id));
      } catch (e) { setError(e.message); }
    })();
    fetchWorkspaceUsers().then(setUsers).catch(() => {});
    fetchMissingDataCandidates().then(setData).catch(e => setError(e.message));
    Promise.all([fetchBoardColumns(BOARDS.LEADS), fetchBoardColumns(BOARDS.OPPORTUNITIES)])
      .then(([l, o]) => setBoardCols({ [BOARDS.LEADS]: l, [BOARDS.OPPORTUNITIES]: o }))
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const all = useMemo(() => (data ? buildMissingList(data) : []), [data]);

  // People who own at least one record with gaps — for the person switcher
  const owners = useMemo(() => {
    const counts = {};
    all.forEach(e => e.owners.forEach(id => { counts[id] = (counts[id] ?? 0) + 1; }));
    return Object.entries(counts)
      .map(([id, n]) => ({ id, n, name: users.find(u => String(u.id) === id)?.name ?? `User ${id}` }))
      .sort((a, b) => b.n - a.n);
  }, [all, users]);

  const visible = useMemo(() => {
    if (!personId || personId === 'all') return all;
    return all.filter(e => e.owners.includes(personId));
  }, [all, personId]);

  const byBoard = board => visible
    .filter(e => e.board === board)
    .sort((a, b) => b.missing.length - a.missing.length);
  const prospects = byBoard(MISSING_BOARDS.PROSPECT);
  const opps      = byBoard(MISSING_BOARDS.OPP);
  const leads     = byBoard(MISSING_BOARDS.LEAD);
  const fieldTotal = visible.reduce((n, e) => n + e.missing.length, 0);

  const selectedEntry = selected
    ? visible.find(e => e.item.id === selected.id && e.board === selected.board) ?? null
    : null;

  function handleSaved(entry, columnValues) {
    const key = { [MISSING_BOARDS.PROSPECT]: 'prospects', [MISSING_BOARDS.OPP]: 'opportunities', [MISSING_BOARDS.LEAD]: 'leads' }[entry.board];
    const updatedItem = { ...entry.item, column_values: columnValues };
    setData(prev => ({ ...prev, [key]: prev[key].map(i => (i.id === entry.item.id ? updatedItem : i)) }));
    const stillMissing = missingFields(updatedItem, entry.board);
    const outOfScope = !inScope(updatedItem, entry.board);
    if (stillMissing.length === 0 || outOfScope) {
      // Complete: move on to the next record in the same list
      const list = { [MISSING_BOARDS.PROSPECT]: prospects, [MISSING_BOARDS.OPP]: opps, [MISSING_BOARDS.LEAD]: leads }[entry.board];
      const idx = list.findIndex(e => e.item.id === entry.item.id);
      const next = list[idx + 1] ?? list[idx - 1] ?? null;
      setSelected(next ? { id: next.item.id, board: next.board } : null);
      setToast(outOfScope
        ? `${entry.item.name} saved and removed from the list (${STATUS_COLUMN[entry.board].label.toLowerCase()} changed) ✓`
        : `${entry.item.name} is complete ✓`);
    } else {
      setToast(`Saved · ${stillMissing.length} still to fill in`);
    }
    setTimeout(() => setToast(''), 3000);
  }

  const loading = !data && !error;
  const accountSlug = me?.account?.slug ?? '';
  const isMe = personId && me && personId === String(me.id);

  function Section({ board, entries }) {
    const cfg = BOARD_CFG[board];
    return (
      <div>
        <div className="flex items-center gap-3 px-4 py-2.5 bg-canvas rounded-xl border border-line mb-2">
          <span className="w-2 h-2 rounded-full" style={{ background: cfg.accentColor }} />
          <span className="font-heading font-bold text-[14px] flex-1" style={{ color: cfg.accentColor }}>{cfg.label}</span>
          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full text-white tabular-nums" style={{ background: cfg.accentColor }}>{entries.length}</span>
        </div>
        {loading ? (
          <div className="space-y-1">{[1, 2, 3].map(i => <div key={i} className="h-[62px] bg-canvas rounded-xl animate-pulse" />)}</div>
        ) : entries.length === 0 ? (
          <div className="flex items-center justify-center py-6 bg-canvas rounded-xl">
            <p className="text-[13px] text-muted">Nothing missing on {cfg.label.toLowerCase()} ✓</p>
          </div>
        ) : (
          <div className="space-y-1">
            {entries.map(e => (
              <MissingCard
                key={`${e.board}-${e.item.id}`}
                entry={e}
                selected={selected?.id === e.item.id && selected?.board === e.board}
                onClick={() => setSelected({ id: e.item.id, board: e.board })}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <ProgressBar loading={loading} />
      <div className="flex overflow-hidden" style={{ height: 'calc(100vh - 60px)' }}>

        {/* List pane */}
        <div className={`flex flex-col flex-1 min-w-0 ${selectedEntry ? 'hidden sm:flex' : 'flex'}`}>
          <div className="px-6 pt-5 pb-4 flex-shrink-0 border-b border-line">
            <p className="text-[12px] font-semibold tracking-[.08em] uppercase text-emerald mb-0.5">Data Health · UK</p>
            <div className="flex items-end justify-between gap-4">
              <div>
                <h1 className="font-display text-[28px] leading-[1.15] font-semibold tracking-tight">My Missing Data</h1>
                <p className="text-muted text-[13px] mt-1">
                  {loading ? 'Checking your records…'
                    : visible.length === 0 ? 'Everything is filled in. Nice work.'
                    : `${visible.length} record${visible.length !== 1 ? 's' : ''} · ${fieldTotal} field${fieldTotal !== 1 ? 's' : ''} to fill in`}
                </p>
              </div>
              <select
                value={personId ?? ''}
                onChange={e => { setPersonId(e.target.value); setSelected(null); }}
                className="px-2.5 py-1.5 bg-canvas border border-line rounded-lg text-[12px] font-medium focus:outline-none focus:border-navy"
              >
                {me && <option value={String(me.id)}>Me ({me.name?.split(' ')[0]})</option>}
                <option value="all">Everyone ({all.length})</option>
                {owners.filter(o => !me || o.id !== String(me.id)).map(o => (
                  <option key={o.id} value={o.id}>{o.name} ({o.n})</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
            {error && <div className="text-red text-[13px] bg-red-soft px-4 py-3 rounded-xl">Failed to load: {error}</div>}
            {toast && <div className="text-emerald text-[13px] font-semibold bg-pale px-4 py-2.5 rounded-xl">{toast}</div>}
            <Section board={MISSING_BOARDS.PROSPECT} entries={prospects} />
            <Section board={MISSING_BOARDS.LEAD} entries={leads} />
            <Section board={MISSING_BOARDS.OPP} entries={opps} />
            {!isMe && personId && (
              <p className="text-[11.5px] text-muted text-center">Showing {personId === 'all' ? 'everyone’s' : `${owners.find(o => o.id === personId)?.name ?? 'this person'}’s`} records.</p>
            )}
          </div>
        </div>

        {/* Mobile back button */}
        {selectedEntry && (
          <div className="sm:hidden fixed top-[68px] left-3 z-10">
            <button onClick={() => setSelected(null)} className="px-3 py-1.5 bg-white border border-line rounded-full shadow text-[12px] font-semibold text-navy">← Back</button>
          </div>
        )}

        {/* Sidebar */}
        <div className={`flex-col flex-shrink-0 border-l border-line bg-white overflow-hidden ${
          selectedEntry ? 'flex w-full sm:w-[400px] lg:w-[440px]' : 'hidden sm:flex sm:w-[380px] lg:w-[420px]'
        }`}>
          {selectedEntry ? (
            <FixPanel
              key={`${selectedEntry.board}-${selectedEntry.item.id}`}
              entry={selectedEntry}
              boardCols={boardCols}
              users={users}
              accountSlug={accountSlug}
              onClose={() => setSelected(null)}
              onSaved={handleSaved}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-center px-8">
              <div>
                <p className="font-semibold text-[14px] text-ink">Select a record</p>
                <p className="text-muted text-[13px] mt-1 max-w-[220px] mx-auto">Click any prospect, lead or opportunity to fill in what's missing. It disappears from the list once it's complete.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
