import React, { useState, useEffect, useRef } from 'react';
import {
  createEvent, updateEvent, searchUKOpportunities, fetchEventColumnOptions,
  searchLeads, createEventLead, setLeadEvent, updateItemColumns, addOpportunityEvent,
  removeOpportunityEvent, LEAD_COLS, BOARDS,
} from '../../api/monday';
import { formatMoney } from '../../utils/opportunityMetrics';
import {
  EVENT_SOURCE, defaultHowMet, parseEventLead, wonValue, openValue,
} from '../../utils/eventMetrics';
import { HowMetChoice, EventTag, formatEventDate } from './EventPicker';

const ATTEND_HOST_OPTIONS = ['Rec: Attend', 'Rec: Host', 'Decided: Attending', 'Decided: Hosting', 'Not Going'];
const EVENT_TYPE_OPTIONS  = ['All Day Conference', 'Short Conference', 'In Person Networking', 'Online Networking', 'Other'];
const SCALE_OPTIONS       = ['National', 'Local'];

// ── Small helpers ─────────────────────────────────────────────────
function Label({ children }) {
  return <label className="block text-[11.5px] font-semibold text-muted uppercase tracking-wide mb-1.5">{children}</label>;
}
function set(setForm, key) {
  return e => setForm(f => ({ ...f, [key]: e.target.value }));
}
function Input({ value, onChange, placeholder, type = 'text' }) {
  return (
    <input
      type={type}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      className="w-full px-3 py-2 bg-canvas border border-line rounded-xl text-[13.5px] outline-none focus:border-navy transition-colors"
    />
  );
}
function Select({ value, onChange, options, placeholder = '— select —' }) {
  return (
    <select
      value={value}
      onChange={onChange}
      className="w-full px-3 py-2 bg-canvas border border-line rounded-xl text-[13.5px] outline-none focus:border-navy transition-colors cursor-pointer"
    >
      <option value="">{placeholder}</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}
// Free-text input with dropdown suggestions — allows values not in the list
function ComboInput({ value, onChange, options, placeholder, listId }) {
  return (
    <>
      <input
        type="text"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        list={listId}
        autoComplete="off"
        className="w-full px-3 py-2 bg-canvas border border-line rounded-xl text-[13.5px] outline-none focus:border-navy transition-colors"
      />
      <datalist id={listId}>
        {options.map(o => <option key={o} value={o} />)}
      </datalist>
    </>
  );
}

// ── People picker ────────────────────────────────────────────────
function PeoplePicker({ attendeeIds, onChange, users }) {
  const [search, setSearch] = useState('');
  const [open, setOpen]     = useState(false);
  const inputRef = useRef(null);
  const dropRef  = useRef(null);

  const userMap = Object.fromEntries(users.map(u => [String(u.id), u]));

  useEffect(() => {
    function handleClick(e) {
      if (!dropRef.current?.contains(e.target) && !inputRef.current?.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const term = search.trim().toLowerCase();
  const available = users.filter(u =>
    !attendeeIds.includes(String(u.id)) &&
    (!term || u.name.toLowerCase().includes(term))
  );

  function add(id) {
    onChange([...attendeeIds, String(id)]);
    setSearch('');
    inputRef.current?.focus();
  }
  function remove(id) { onChange(attendeeIds.filter(a => a !== id)); }

  return (
    <div>
      {attendeeIds.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {attendeeIds.map(id => {
            const u = userMap[id];
            const name = u?.name ?? `User ${id}`;
            return (
              <span
                key={id}
                className="flex items-center gap-1.5 px-2.5 py-1 bg-navy/10 border border-navy/20 rounded-full text-[12px] font-semibold text-navy"
              >
                {u?.photo_thumb
                  ? <img src={u.photo_thumb} alt={name} className="w-4 h-4 rounded-full object-cover" />
                  : <span className="w-4 h-4 rounded-full bg-navy text-white flex items-center justify-center text-[8px] font-bold">{name.split(' ').map(n=>n[0]).slice(0,2).join('')}</span>
                }
                {name.split(' ')[0]}
                <button onClick={() => remove(id)} className="ml-0.5 text-muted hover:text-red transition-colors leading-none">&times;</button>
              </span>
            );
          })}
        </div>
      )}

      <div className="relative" ref={dropRef}>
        <input
          ref={inputRef}
          type="text"
          value={search}
          onFocus={() => setOpen(true)}
          onChange={e => { setSearch(e.target.value); setOpen(true); }}
          placeholder="Search and add people…"
          className="w-full px-3 py-2 bg-canvas border border-line rounded-xl text-[13.5px] outline-none focus:border-navy transition-colors"
        />

        {open && available.length > 0 && (
          <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-card border border-line rounded-xl shadow-lg max-h-48 overflow-y-auto">
            {available.map(u => (
              <button
                key={u.id}
                onMouseDown={e => { e.preventDefault(); add(u.id); }}
                className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-sunken text-left transition-colors"
              >
                {u.photo_thumb
                  ? <img src={u.photo_thumb} alt={u.name} className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
                  : <div className="w-7 h-7 rounded-full bg-navy text-white grid place-items-center font-bold text-[10px] flex-shrink-0">
                      {u.name.split(' ').map(n=>n[0]).slice(0,2).join('')}
                    </div>
                }
                <span className="text-[13px] font-medium">{u.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Opportunity search ────────────────────────────────────────────
// Picks one UK opportunity at a time; the caller writes the link immediately.
function OppSearch({ excludeIds, onPick, disabled }) {
  const [query, setQuery]     = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen]       = useState(false);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    function handleClick(e) { if (!wrapRef.current?.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); return; }
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const items = await searchUKOpportunities(query.trim());
        setResults(items.filter(r => !excludeIds.includes(r.id)));
      } catch {}
      setLoading(false);
    }, 350);
    return () => clearTimeout(timer);
  }, [query, excludeIds]);

  return (
    <div className="relative" ref={wrapRef}>
      <input
        type="text"
        value={query}
        disabled={disabled}
        onFocus={() => query.trim().length >= 2 && setOpen(true)}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        placeholder="Search UK opportunities to link directly…"
        className="w-full px-3 py-2 bg-canvas border border-line rounded-xl text-[13.5px] outline-none focus:border-navy transition-colors disabled:opacity-60"
      />
      {open && query.trim().length >= 2 && (
        <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-card border border-line rounded-xl shadow-lg max-h-48 overflow-y-auto">
          {loading && <div className="px-3 py-2.5 text-muted text-[12.5px]">Searching…</div>}
          {!loading && results.length === 0 && <div className="px-3 py-2.5 text-muted text-[12.5px]">No UK opportunities found</div>}
          {results.map(r => (
            <button
              key={r.id}
              onMouseDown={e => { e.preventDefault(); onPick(r); setQuery(''); setOpen(false); }}
              className="w-full px-3 py-2.5 hover:bg-sunken text-left transition-colors text-[13px] font-medium text-ink"
            >
              {r.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const usd = v => formatMoney(v, 'USD') ?? '$0';
const gbp = v => formatMoney(v, 'GBP') ?? '£0';

function Tile({ label, value, sub }) {
  return (
    <div className="bg-canvas rounded-xl p-3">
      <p className="text-[10.5px] font-bold uppercase tracking-wider text-muted">{label}</p>
      <p className="font-display font-semibold text-[22px] leading-tight mt-1">{value}</p>
      {sub && <p className="text-[11px] text-muted mt-0.5">{sub}</p>}
    </div>
  );
}

function StatusPill({ lead }) {
  if (!lead.status) return null;
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10.5px] font-semibold leading-none ${
      lead.isQualified ? 'bg-pale text-emerald' : 'bg-line text-muted'
    }`}>{lead.status}</span>
  );
}

function StagePill({ opp }) {
  const cls = opp.isWon ? 'bg-pale text-emerald' : opp.isLost ? 'bg-red-soft text-red' : 'bg-info-soft text-info';
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[10.5px] font-semibold leading-none ${cls}`}>{opp.stage}</span>;
}

function oppValueText(opp) {
  return [opp.arrUSD > 0 && `${usd(opp.arrUSD)} ARR`, opp.psUSD > 0 && `${usd(opp.psUSD)} PS`].filter(Boolean).join(' · ') || 'No value yet';
}

// ── Details tab ───────────────────────────────────────────────────
function DetailsTab({ event, users, onSaved, onClose }) {
  const isEdit = Boolean(event);
  const [form, setForm] = useState({
    name:          event?.name          ?? '',
    startDate:     event?.startDate     ?? '',
    endDate:       event?.endDate       ?? '',
    location:      event?.location      ?? '',
    attendOrHost:  event?.attendOrHostText ?? '',
    eventType:     event?.eventTypeText  ?? '',
    bookingStatus: event?.bookingStatusText ?? '',
    scale:         event?.scaleText      ?? '',
    sector:        event?.sector         ?? '',
    visitorCost:   event?.visitorCost    ?? '',
    standCost:     event?.standCost      ?? '',
    actualSpend:   event?.actualSpend    ?? '',
    website:       event?.website        ?? '',
    attendeeIds:   event?.attendeeIds    ?? [],
  });
  const [sectorOptions, setSectorOptions]   = useState([]);
  const [bookingOptions, setBookingOptions] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState(null);

  useEffect(() => {
    fetchEventColumnOptions('dropdown_mm5g237s').then(setSectorOptions).catch(() => {});
    fetchEventColumnOptions('color_mm5g6xz0').then(setBookingOptions).catch(() => {});
  }, []);

  async function handleSave() {
    if (!form.name.trim()) { setError('Event name is required.'); return; }
    setSaving(true);
    setError(null);
    try {
      // Opportunity links are managed on the Opportunities tab (written
      // immediately, one at a time), so Save never replaces them wholesale.
      const saved = isEdit ? await updateEvent(event.id, form) : await createEvent(form);
      onSaved(saved);
    } catch (err) {
      setError(err.message || 'Save failed. Please try again.');
      setSaving(false);
    }
  }

  return (
    <>
      <div className="overflow-y-auto flex-1 px-6 py-5 space-y-4">
        <div>
          <Label>Event Name *</Label>
          <Input value={form.name} onChange={set(setForm, 'name')} placeholder="e.g. Manchester Tech Summit" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div><Label>Start Date</Label><Input type="date" value={form.startDate} onChange={set(setForm, 'startDate')} /></div>
          <div><Label>End Date</Label><Input type="date" value={form.endDate} onChange={set(setForm, 'endDate')} /></div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div><Label>Location</Label><Input value={form.location} onChange={set(setForm, 'location')} placeholder="e.g. Manchester" /></div>
          <div><Label>Scale</Label><Select value={form.scale} onChange={set(setForm, 'scale')} options={SCALE_OPTIONS} /></div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div><Label>Event Type</Label><Select value={form.eventType} onChange={set(setForm, 'eventType')} options={EVENT_TYPE_OPTIONS} /></div>
          <div><Label>Attend or Host</Label><Select value={form.attendOrHost} onChange={set(setForm, 'attendOrHost')} options={ATTEND_HOST_OPTIONS} /></div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div><Label>Booking Status</Label><Select value={form.bookingStatus} onChange={set(setForm, 'bookingStatus')} options={bookingOptions} /></div>
          <div>
            <Label>Sector</Label>
            <ComboInput value={form.sector} onChange={set(setForm, 'sector')} options={sectorOptions} placeholder="Select or type a sector…" listId="modal-sector-options" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div><Label>Visitor Cost (notes)</Label><Input value={form.visitorCost} onChange={set(setForm, 'visitorCost')} placeholder="e.g. £50 per person" /></div>
          <div><Label>Stand Cost (notes)</Label><Input value={form.standCost} onChange={set(setForm, 'standCost')} placeholder="e.g. £1,500" /></div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Actual Spend (£)</Label>
            <Input type="number" value={form.actualSpend} onChange={set(setForm, 'actualSpend')} placeholder="Total spent, after the event" />
            <p className="text-[11px] text-muted mt-1">Tickets, stand and travel. Drives cost per lead and ROI.</p>
          </div>
          <div><Label>Website</Label><Input value={form.website} onChange={set(setForm, 'website')} placeholder="https://…" /></div>
        </div>
        <div>
          <Label>Attendees</Label>
          <PeoplePicker attendeeIds={form.attendeeIds} onChange={ids => setForm(f => ({ ...f, attendeeIds: ids }))} users={users} />
        </div>
        {error && <div className="px-4 py-3 bg-red/10 border border-red/20 rounded-lg text-[13px] text-red">{error}</div>}
      </div>
      <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-line flex-shrink-0">
        <button onClick={onClose} className="px-4 py-2 rounded-full text-[13.5px] font-semibold text-muted hover:text-ink border border-line hover:bg-sunken transition-all">Cancel</button>
        <button onClick={handleSave} disabled={saving} className="px-5 py-2 rounded-full text-[13.5px] font-semibold bg-navy text-white hover:bg-navy-700 disabled:opacity-60 transition-all">
          {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Event'}
        </button>
      </div>
    </>
  );
}

// ── Leads tab ─────────────────────────────────────────────────────
function LeadSearch({ excludeIds, onPick, disabled }) {
  const [query, setQuery]     = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen]       = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    function handleClick(e) { if (!wrapRef.current?.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); return; }
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const items = await searchLeads(query.trim());
        setResults(items.map(parseEventLead).filter(l => !excludeIds.includes(l.id)));
      } catch {}
      setLoading(false);
    }, 350);
    return () => clearTimeout(timer);
  }, [query, excludeIds]);

  return (
    <div className="relative" ref={wrapRef}>
      <input
        type="text"
        value={query}
        disabled={disabled}
        onFocus={() => query.trim().length >= 2 && setOpen(true)}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        placeholder="Search existing leads by name or company…"
        className="w-full px-3 py-2 bg-canvas border border-line rounded-xl text-[13.5px] outline-none focus:border-navy transition-colors disabled:opacity-60"
      />
      {open && query.trim().length >= 2 && (
        <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-card border border-line rounded-xl shadow-lg max-h-56 overflow-y-auto">
          {loading && <div className="px-3 py-2.5 text-muted text-[12.5px]">Searching…</div>}
          {!loading && results.length === 0 && <div className="px-3 py-2.5 text-muted text-[12.5px]">No leads found</div>}
          {results.map(l => (
            <button
              key={l.id}
              onMouseDown={e => { e.preventDefault(); onPick(l); setQuery(''); setOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-sunken text-left transition-colors"
            >
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-ink truncate">{l.name}</p>
                {l.company && <p className="text-[11px] text-muted truncate">{l.company}</p>}
              </div>
              <StatusPill lead={l} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function LeadsTab({ event, row, events, users, me, onChanged }) {
  const [busy, setBusy]       = useState(false);
  const [msg, setMsg]         = useState('');
  const [picked, setPicked]   = useState(null);
  const [pickedHow, setPickedHow] = useState(defaultHowMet(event));
  const [showNew, setShowNew] = useState(false);
  const [newLead, setNewLead] = useState({ name: '', company: '', email: '', sdrId: me?.id ? String(me.id) : '', howMet: defaultHowMet(event) });

  const leads = row?.leads ?? [];
  const leadIds = leads.map(l => l.id);
  const eventName = id => events.find(e => e.id === id)?.name ?? 'another event';

  async function run(fn, done) {
    setBusy(true);
    setMsg('');
    try {
      await fn();
      setMsg(done);
      await onChanged();
    } catch (e) {
      setMsg(`Error: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  function addExisting() {
    const lead = picked;
    run(async () => {
      // Pre-fill only where blank — never overwrite what a rep already set
      const cv = {};
      if (!lead.source) cv[LEAD_COLS.SOURCE] = { label: EVENT_SOURCE };
      if (!lead.conversion && pickedHow) cv[LEAD_COLS.CONVERSION] = { label: pickedHow };
      if (Object.keys(cv).length) await updateItemColumns(BOARDS.LEADS, lead.id, cv);
      await setLeadEvent(lead.id, event.id, lead.oppIds);
      setPicked(null);
    }, `${lead.name} linked`);
  }

  function createNew() {
    if (!newLead.name.trim()) { setMsg('Error: Lead name is required'); return; }
    run(async () => {
      await createEventLead({
        name: newLead.name.trim(),
        company: newLead.company.trim(),
        email: newLead.email.trim(),
        sdrId: newLead.sdrId,
        source: EVENT_SOURCE,
        conversion: newLead.howMet,
      }, event.id);
      setNewLead(n => ({ ...n, name: '', company: '', email: '' }));
    }, `${newLead.name.trim()} created and linked`);
  }

  function unlink(lead) {
    run(() => setLeadEvent(lead.id, null), `${lead.name} unlinked`);
  }

  return (
    <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">
      {/* Add existing */}
      <div>
        <Label>Add an existing lead</Label>
        {!picked ? (
          <LeadSearch excludeIds={leadIds} onPick={l => { setPicked(l); setPickedHow(defaultHowMet(event)); }} disabled={busy} />
        ) : (
          <div className="border border-navy/30 bg-pale/20 rounded-xl p-3 space-y-2.5">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-semibold text-ink">{picked.name}</p>
                {picked.company && <p className="text-[12px] text-muted">{picked.company}</p>}
              </div>
              <StatusPill lead={picked} />
              <button onClick={() => setPicked(null)} className="text-muted hover:text-red text-[18px] leading-none px-1">&times;</button>
            </div>
            {picked.eventIds[0] && picked.eventIds[0] !== event.id && (
              <p className="text-[12px] text-amber-ink">Currently linked to {eventName(picked.eventIds[0])}. Adding moves it here (one event per lead).</p>
            )}
            {picked.conversion
              ? <p className="text-[12px] text-muted">Conversion Activity is already {picked.conversion}, so it won't be changed.</p>
              : (<><p className="text-[11.5px] font-semibold text-ink">How did you meet them?</p><HowMetChoice value={pickedHow} onChange={setPickedHow} /></>)}
            {picked.oppIds.length > 0 && (
              <p className="text-[11.5px] text-muted">{picked.oppIds.length} existing opportunit{picked.oppIds.length > 1 ? 'ies' : 'y'} will be linked to this event too.</p>
            )}
            <button onClick={addExisting} disabled={busy} className="px-4 py-1.5 rounded-full text-[12.5px] font-semibold bg-navy text-white hover:bg-navy-700 disabled:opacity-60">
              {busy ? 'Linking…' : 'Link to this event'}
            </button>
          </div>
        )}
      </div>

      {/* Quick add */}
      <div>
        {!showNew ? (
          <button onClick={() => setShowNew(true)} className="text-[13px] font-semibold text-navy hover:text-navy-700">+ Quick add a new lead</button>
        ) : (
          <div className="border border-line rounded-xl p-3 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[12.5px] font-bold text-ink">New lead from {event.name}</p>
              <button onClick={() => setShowNew(false)} className="text-muted hover:text-ink text-[18px] leading-none px-1">&times;</button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Name *</Label><Input value={newLead.name} onChange={set(setNewLead, 'name')} placeholder="Full name" /></div>
              <div><Label>Company</Label><Input value={newLead.company} onChange={set(setNewLead, 'company')} placeholder="Company" /></div>
              <div><Label>Email</Label><Input type="email" value={newLead.email} onChange={set(setNewLead, 'email')} placeholder="name@company.com" /></div>
              <div>
                <Label>SDR</Label>
                <select value={newLead.sdrId} onChange={set(setNewLead, 'sdrId')} className="w-full px-3 py-2 bg-canvas border border-line rounded-xl text-[13.5px] outline-none focus:border-navy cursor-pointer">
                  <option value="">—</option>
                  {users.map(u => <option key={u.id} value={String(u.id)}>{u.name}</option>)}
                </select>
              </div>
            </div>
            <div>
              <Label>How did you meet them?</Label>
              <HowMetChoice value={newLead.howMet} onChange={v => setNewLead(n => ({ ...n, howMet: v }))} />
            </div>
            <p className="text-[11px] text-muted">Created on Leads Boost with Region UK, Source {EVENT_SOURCE} and linked to this event.</p>
            <button onClick={createNew} disabled={busy} className="px-4 py-1.5 rounded-full text-[12.5px] font-semibold bg-navy text-white hover:bg-navy-700 disabled:opacity-60">
              {busy ? 'Creating…' : 'Create lead'}
            </button>
          </div>
        )}
      </div>

      {msg && <p className={`text-[12px] font-semibold ${msg.startsWith('Error') ? 'text-red' : 'text-emerald'}`}>{msg}</p>}

      {/* Linked leads */}
      <div>
        <Label>Linked leads · {leads.length}</Label>
        {leads.length === 0 ? (
          <div className="bg-canvas rounded-xl py-6 text-center text-[13px] text-muted">No leads linked to this event yet.</div>
        ) : (
          <div className="divide-y divide-line border border-line rounded-xl overflow-hidden">
            {leads.map(l => {
              const lOpps = (row?.opps ?? []).filter(({ opp }) => l.oppIds.includes(opp.id));
              return (
                <div key={l.id} className="px-3 py-2.5 flex items-center gap-3 bg-white">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold text-ink truncate">{l.name}</p>
                    <p className="text-[11px] text-muted truncate">
                      {[l.company, l.conversion, lOpps.length && `${lOpps.length} opp${lOpps.length > 1 ? 's' : ''}`].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <StatusPill lead={l} />
                  <button onClick={() => unlink(l)} disabled={busy} title="Unlink from event" className="text-muted hover:text-red text-[18px] leading-none px-1 disabled:opacity-40">&times;</button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Opportunities tab ─────────────────────────────────────────────
function OppsTab({ event, row, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg]   = useState('');
  const opps = row?.opps ?? [];

  async function run(fn, done) {
    setBusy(true);
    setMsg('');
    try { await fn(); setMsg(done); await onChanged(); }
    catch (e) { setMsg(`Error: ${e.message}`); }
    finally { setBusy(false); }
  }

  return (
    <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">
      <div>
        <Label>Link an opportunity directly</Label>
        <OppSearch
          excludeIds={opps.map(o => o.opp.id)}
          onPick={o => run(() => addOpportunityEvent(o.id, event.id), `${o.name} linked`)}
          disabled={busy}
        />
        <p className="text-[11px] text-muted mt-1">Only needed for deals that never had a lead. Opportunities converted from this event's leads appear here automatically.</p>
      </div>

      {msg && <p className={`text-[12px] font-semibold ${msg.startsWith('Error') ? 'text-red' : 'text-emerald'}`}>{msg}</p>}

      <div>
        <Label>Opportunities · {opps.length}</Label>
        {opps.length === 0 ? (
          <div className="bg-canvas rounded-xl py-6 text-center text-[13px] text-muted">No opportunities from this event yet.</div>
        ) : (
          <div className="divide-y divide-line border border-line rounded-xl overflow-hidden">
            {opps.map(({ opp, via, lead }) => (
              <div key={opp.id} className="px-3 py-2.5 flex items-center gap-3 bg-white">
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-ink truncate">{opp.name}</p>
                  <p className="text-[11px] text-muted truncate">
                    {oppValueText(opp)} · {via === 'lead' ? `via lead: ${lead.name}` : 'linked directly'}
                  </p>
                </div>
                <StagePill opp={opp} />
                {via === 'lead' ? (
                  <button
                    onClick={() => run(() => addOpportunityEvent(opp.id, event.id), `${opp.name} linked directly`)}
                    disabled={busy}
                    title="Write the event link onto the opportunity in monday"
                    className="text-[11.5px] font-semibold text-navy hover:text-navy-700 disabled:opacity-40 whitespace-nowrap"
                  >Link directly</button>
                ) : (
                  <button
                    onClick={() => run(() => removeOpportunityEvent(opp.id, event.id), `${opp.name} unlinked`)}
                    disabled={busy}
                    title="Unlink from event"
                    className="text-muted hover:text-red text-[18px] leading-none px-1 disabled:opacity-40"
                  >&times;</button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Results tab ───────────────────────────────────────────────────
function ResultsTab({ row, fx }) {
  if (!row) return null;
  const t = row.totals;
  const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');
  return (
    <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">
      <div>
        <Label>Funnel</Label>
        <div className="grid grid-cols-4 gap-2">
          <Tile label="Leads" value={t.leads} sub={`${t.inPerson} met in person · ${t.outreach} outreach`} />
          <Tile label="Qualified" value={t.qualified} sub={`${pct(t.qualified, t.leads)} of leads`} />
          <Tile label="Opportunities" value={t.opps} sub={`${t.openOpps} open · ${t.lostOpps} lost`} />
          <Tile label="Won" value={t.wonOpps} sub={`${pct(t.wonOpps, t.opps)} of opps`} />
        </div>
      </div>
      <div>
        <Label>Value (USD)</Label>
        <div className="grid grid-cols-4 gap-2">
          <Tile label="Won ARR" value={usd(t.wonARR)} />
          <Tile label="Won PS" value={usd(t.wonPS)} />
          <Tile label="Open ARR" value={usd(t.openARR)} />
          <Tile label="Open PS" value={usd(t.openPS)} />
        </div>
      </div>
      <div>
        <Label>Cost</Label>
        <div className="grid grid-cols-4 gap-2">
          <Tile label="Actual spend" value={row.spend !== null ? gbp(row.spend) : '—'} sub={row.spend === null ? 'Add it on Details' : null} />
          <Tile label="Cost per lead" value={row.costPerLead ? gbp(row.costPerLead) : '—'} />
          <Tile label="Cost per opp" value={row.costPerOpp ? gbp(row.costPerOpp) : '—'} />
          <Tile
            label="ROI"
            value={row.roi !== null ? `${row.roi.toFixed(1)}×` : '—'}
            sub={row.roi !== null ? `won value per $1 spent · £1 = $${fx.rate.toFixed(2)}` : null}
          />
        </div>
      </div>
      <p className="text-[11px] text-muted">
        Won + open value: {usd(wonValue(t) + openValue(t))}. PS value shows once the deal's FX Calculator has run.
      </p>
    </div>
  );
}

// ── Main modal ───────────────────────────────────────────────────
const TABS = [
  { id: 'details', label: 'Details' },
  { id: 'leads',   label: 'Leads' },
  { id: 'opps',    label: 'Opportunities' },
  { id: 'results', label: 'Results' },
];

export default function EventModal({ event, row, events = [], users, me, fx, onSaved, onChanged, onClose, initialTab = 'details' }) {
  const isEdit = Boolean(event);
  const [tab, setTab] = useState(isEdit ? initialTab : 'details');

  function handleBackdrop(e) { if (e.target === e.currentTarget) onClose(); }

  const count = id => id === 'leads' ? row?.totals.leads : id === 'opps' ? row?.totals.opps : null;

  return (
    <div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center p-4" onMouseDown={handleBackdrop}>
      <div className="bg-card w-full max-w-2xl rounded-2xl shadow-2xl border border-line flex flex-col h-[90vh]">
        {/* Header */}
        <div className="px-6 pt-4 border-b border-line flex-shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-heading font-bold text-[18px] truncate">{isEdit ? event.name : 'New Event'}</h2>
              {isEdit && (
                <div className="flex items-center gap-2 mt-1 text-[12px] text-muted">
                  <span>{formatEventDate(event.startDate)}{event.location ? ` · ${event.location}` : ''}</span>
                  <EventTag event={event} />
                </div>
              )}
            </div>
            <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-sunken flex items-center justify-center text-muted text-[20px] transition-colors flex-shrink-0">&times;</button>
          </div>
          {isEdit && (
            <div className="flex gap-1 mt-3 -mb-px">
              {TABS.map(t => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`px-3.5 py-2 text-[13px] font-semibold border-b-2 transition-colors ${
                    tab === t.id ? 'border-navy text-navy' : 'border-transparent text-muted hover:text-ink'
                  }`}
                >
                  {t.label}
                  {count(t.id) > 0 && <span className="ml-1.5 text-[11px] px-1.5 py-0.5 rounded-full bg-navy/10 text-navy tabular-nums">{count(t.id)}</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {tab === 'details' && <DetailsTab event={event} users={users} onSaved={onSaved} onClose={onClose} />}
        {tab === 'leads'   && <LeadsTab event={event} row={row} events={events} users={users} me={me} onChanged={onChanged} />}
        {tab === 'opps'    && <OppsTab event={event} row={row} onChanged={onChanged} />}
        {tab === 'results' && <ResultsTab row={row} fx={fx} />}
      </div>
    </div>
  );
}
