import React, { useState } from 'react';
import { createItem, buildColumnValue, BOARDS } from '../../api/monday';

// Create form for a new prospect or lead, shown in the My Work sidebar.
// (New opportunities use OpportunityDetailPanel's own create mode.)

const FORMS = {
  prospect: {
    label: 'Prospect',
    boardId: BOARDS.PROSPECTS,
    accentColor: '#1a385e',
    pillClass: 'bg-navy/10 text-navy',
    fields: [
      { id: 'text_mm4hbfhh',  label: 'First Name',   type: 'text', half: true },
      { id: 'text_mm441v8n',  label: 'Last Name',    type: 'text', half: true },
      { id: 'text_mkw7ezh6',  label: 'Company',      type: 'text' },
      { id: 'text_mm0wcwfm',  label: 'Title',        type: 'text' },
      { id: 'email_mm14rb30', label: 'Email',        type: 'email' },
      { id: 'text_mm4hkx37',  label: 'Mobile Phone', type: 'text' },
      { id: 'text_mm09kzh1',  label: 'LinkedIn URL', type: 'text' },
      { id: 'status',         label: 'Status',       type: 'status', default: 'New Prospect' },
      { id: 'person',         label: 'SDR',          type: 'person', defaultMe: true },
      { id: 'color_mm4fna6',  label: 'Region',       type: 'status', defaultRegion: true },
    ],
    // Prospect item names are the person's full name
    itemName: v => [v.text_mm4hbfhh, v.text_mm441v8n].map(s => (s ?? '').trim()).filter(Boolean).join(' '),
    nameHint: 'Add a first or last name',
  },
  lead: {
    label: 'Lead',
    boardId: BOARDS.LEADS,
    accentColor: '#cf9a2b',
    pillClass: 'bg-amber-soft text-amber-ink',
    fields: [
      { id: 'name',                     label: 'Name *',              type: 'text' },
      { id: 'lead_company',             label: 'Company Name',        type: 'text' },
      { id: 'lead_email',               label: 'Business Email',      type: 'email' },
      { id: 'text_mkxnm1z4',            label: 'Phone',               type: 'text' },
      { id: 'lead_status',              label: 'Status',              type: 'status', default: 'New Lead' },
      { id: 'multiple_person_mm2bjm2z', label: 'SDR',                 type: 'multiple-person', defaultMe: true },
      { id: 'lead_owner',               label: 'Bizdev',              type: 'person' },
      { id: 'color_mkwrdphn',           label: 'Source',              type: 'status' },
      { id: 'color_mkxeqbfx',           label: 'Conversion Activity', type: 'status' },
      { id: 'color_mkz4y1yv',           label: 'Region',              type: 'status', defaultRegion: true },
    ],
    itemName: v => (v.name ?? '').trim(),
    nameHint: 'Add a name',
  },
};

// Active status labels (deactivated ones removed, duplicates collapsed)
function statusLabels(column) {
  if (!column?.settings_str) return [];
  try {
    const s = JSON.parse(column.settings_str);
    const off = new Set((s.deactivated_labels ?? []).map(String));
    return [...new Set(Object.entries(s.labels ?? {})
      .filter(([idx, l]) => !off.has(idx) && l && l.trim())
      .map(([, l]) => l))];
  } catch { return []; }
}

function inputCls(filled) {
  return `w-full border rounded-xl px-3 py-2 text-[13px] bg-white focus:outline-none focus:ring-1 focus:ring-navy focus:border-navy transition-colors ${
    filled ? 'border-navy/40' : 'border-line'
  }`;
}

export default function CreateItemPanel({ boardType, boardCols, wsUsers, me, region, onClose, onCreated }) {
  const form = FORMS[boardType];
  const optionsFor = id => statusLabels(boardCols?.find(c => c.id === id));

  const [values, setValues] = useState(() => {
    const v = {};
    form.fields.forEach(f => {
      if (f.default) v[f.id] = f.default;
      if (f.defaultMe && me?.id) v[f.id] = String(me.id);
      if (f.defaultRegion) v[f.id] = region && region !== 'All' ? region : 'UK';
    });
    return v;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  const name = form.itemName(values);

  async function handleCreate() {
    if (!name) { setError(form.nameHint); return; }
    setSaving(true);
    setError('');
    try {
      const cv = {};
      form.fields.forEach(f => {
        if (f.id === 'name') return;
        const v = values[f.id];
        if (v === undefined || String(v).trim() === '') return;
        // Only send status labels that exist on the board, so a stale default
        // can never make monday reject the whole create
        if (f.type === 'status' && !optionsFor(f.id).includes(v)) return;
        cv[f.id] = buildColumnValue(f.type, v);
      });
      const created = await createItem(form.boardId, name, cv);
      onCreated(created);
    } catch (e) {
      setError(e.message.slice(0, 200));
      setSaving(false);
    }
  }

  const set = id => e => setValues(prev => ({ ...prev, [id]: e.target.value }));

  function renderField(f) {
    const v = values[f.id] ?? '';
    if (f.type === 'status') {
      const opts = optionsFor(f.id);
      return (
        <select value={opts.includes(v) ? v : ''} onChange={set(f.id)} className={inputCls(!!v)}>
          <option value="">—</option>
          {opts.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    }
    if (f.type === 'person' || f.type === 'multiple-person') {
      return (
        <select value={v} onChange={set(f.id)} className={inputCls(!!v)}>
          <option value="">—</option>
          {wsUsers.map(u => <option key={u.id} value={String(u.id)}>{u.name}</option>)}
        </select>
      );
    }
    return <input type={f.type === 'email' ? 'email' : 'text'} value={v} onChange={set(f.id)} className={inputCls(!!v)} />;
  }

  return (
    <div className="h-full flex flex-col">
      <div
        className="flex items-start justify-between px-5 pt-5 pb-4 border-b border-line flex-shrink-0"
        style={{ background: `linear-gradient(to bottom, ${form.accentColor}12, transparent)` }}
      >
        <div className="min-w-0 flex-1 pr-3">
          <span className={`inline-flex items-center text-[10px] font-bold uppercase tracking-wider mb-2 px-2 py-0.5 rounded-full ${form.pillClass}`}>
            New {form.label}
          </span>
          <h2 className="font-heading text-[18px] font-bold tracking-tight leading-snug break-words">
            {name || `New ${form.label.toLowerCase()}`}
          </h2>
        </div>
        <button onClick={onClose} className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg hover:bg-line text-muted hover:text-ink transition-colors mt-0.5">
          <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none"><path d="M12 4L4 12M4 4L12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        <div className="grid grid-cols-2 gap-3">
          {form.fields.map(f => (
            <div key={f.id} className={f.half ? '' : 'col-span-2'}>
              <label className="text-[10.5px] font-bold uppercase tracking-wider text-muted block mb-1">{f.label}</label>
              {renderField(f)}
            </div>
          ))}
        </div>
      </div>

      <div className="px-5 py-4 border-t border-line flex-shrink-0">
        {error && <p className="text-[12px] font-semibold mb-2 text-red">Error: {error}</p>}
        <button
          disabled={saving || !name}
          onClick={handleCreate}
          className="w-full font-heading font-semibold text-[14px] py-2.5 rounded-full transition-all disabled:opacity-40"
          style={{ background: name ? form.accentColor : '#e4e6e4', color: name ? 'white' : '#757c77' }}
        >
          {saving ? 'Creating…' : `Create ${form.label.toLowerCase()}`}
        </button>
      </div>
    </div>
  );
}
