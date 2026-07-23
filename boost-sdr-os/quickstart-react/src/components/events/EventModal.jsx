import React, { useState, useEffect, useRef } from 'react';
import { createEvent, updateEvent } from '../../api/monday';

const ATTEND_HOST_OPTIONS  = ['Rec: Attend', 'Rec: Host', 'Decided: Attending', 'Decided: Hosting', 'Not Going'];
const EVENT_TYPE_OPTIONS   = ['All Day Conference', 'Short Conference', 'In Person Networking', 'Online Networking', 'Other'];
const BOOKING_STATUS_OPTIONS = ['To Review', 'Enquiry Sent', 'Booked', 'Skipping'];
const SCALE_OPTIONS        = ['National', 'Local'];
const SECTOR_OPTIONS       = [
  'General Business', 'Construction', 'Retrofit', 'Events Organisers',
  'Real Estate', 'Manufacturing/Engineering', 'Technology', 'Packaging',
  'Renewable Energy', 'Facilities Management',
];

function field(form, key) { return form[key] ?? ''; }
function set(setForm, key) { return e => setForm(f => ({ ...f, [key]: e.target.value })); }

function Label({ children }) {
  return <label className="block text-[11.5px] font-semibold text-muted uppercase tracking-wide mb-1">{children}</label>;
}
function Input({ value, onChange, placeholder, type = 'text' }) {
  return (
    <input
      type={type}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      className="w-full px-3 py-2 bg-canvas border border-line rounded-lg text-[13.5px] outline-none focus:border-teal transition-colors"
    />
  );
}
function Select({ value, onChange, options, placeholder = '— select —' }) {
  return (
    <select
      value={value}
      onChange={onChange}
      className="w-full px-3 py-2 bg-canvas border border-line rounded-lg text-[13.5px] outline-none focus:border-teal transition-colors cursor-pointer"
    >
      <option value="">{placeholder}</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
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
      {/* Current attendees as chips */}
      {attendeeIds.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {attendeeIds.map(id => {
            const u = userMap[id];
            const name = u?.name ?? `User ${id}`;
            return (
              <span
                key={id}
                className="flex items-center gap-1.5 px-2.5 py-1 bg-teal/10 border border-teal/20 rounded-full text-[12px] font-semibold text-teal-deep"
              >
                {u?.photo_thumb
                  ? <img src={u.photo_thumb} alt={name} className="w-4 h-4 rounded-full object-cover" />
                  : <span className="w-4 h-4 rounded-full bg-teal text-white flex items-center justify-center text-[8px] font-bold">{name.split(' ').map(n=>n[0]).slice(0,2).join('')}</span>
                }
                {name.split(' ')[0]}
                <button onClick={() => remove(id)} className="ml-0.5 text-muted hover:text-red transition-colors leading-none">&times;</button>
              </span>
            );
          })}
        </div>
      )}

      {/* Search input */}
      <div className="relative" ref={dropRef}>
        <input
          ref={inputRef}
          type="text"
          value={search}
          onFocus={() => setOpen(true)}
          onChange={e => { setSearch(e.target.value); setOpen(true); }}
          placeholder="Search and add people…"
          className="w-full px-3 py-2 bg-canvas border border-line rounded-lg text-[13.5px] outline-none focus:border-teal transition-colors"
        />

        {open && available.length > 0 && (
          <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-card border border-line rounded-xl shadow-lg max-h-48 overflow-y-auto">
            {available.map(u => (
              <button
                key={u.id}
                onMouseDown={e => { e.preventDefault(); add(u.id); }}
                className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-[#F0EBE2] text-left transition-colors"
              >
                {u.photo_thumb
                  ? <img src={u.photo_thumb} alt={u.name} className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
                  : <div className="w-7 h-7 rounded-full bg-gradient-to-br from-teal to-teal-mid text-white grid place-items-center font-bold text-[10px] flex-shrink-0">
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

// ── Main modal ───────────────────────────────────────────────────
export default function EventModal({ event, users, onSave, onClose }) {
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
    website:       event?.website        ?? '',
    attendeeIds:   event?.attendeeIds    ?? [],
  });

  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState(null);

  async function handleSave() {
    if (!form.name.trim()) { setError('Event name is required.'); return; }
    setSaving(true);
    setError(null);
    try {
      let saved;
      if (isEdit) {
        saved = await updateEvent(event.id, form);
      } else {
        saved = await createEvent(form);
      }
      onSave(saved);
    } catch (err) {
      setError(err.message || 'Save failed. Please try again.');
      setSaving(false);
    }
  }

  // Close on backdrop click
  function handleBackdrop(e) { if (e.target === e.currentTarget) onClose(); }

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center p-4"
      onMouseDown={handleBackdrop}
    >
      <div className="bg-card w-full max-w-2xl rounded-2xl shadow-2xl border border-line flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-line flex-shrink-0">
          <h2 className="font-display font-bold text-[18px]">
            {isEdit ? `Edit: ${event.name}` : 'New Event'}
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-[#F0EBE2] flex items-center justify-center text-muted text-[20px] transition-colors"
          >
            &times;
          </button>
        </div>

        {/* Scrollable form body */}
        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-4">

          {/* Event name */}
          <div>
            <Label>Event Name *</Label>
            <Input value={form.name} onChange={set(setForm, 'name')} placeholder="e.g. Manchester Tech Summit" />
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Start Date</Label>
              <Input type="date" value={form.startDate} onChange={set(setForm, 'startDate')} />
            </div>
            <div>
              <Label>End Date</Label>
              <Input type="date" value={form.endDate} onChange={set(setForm, 'endDate')} />
            </div>
          </div>

          {/* Location + Scale */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Location</Label>
              <Input value={form.location} onChange={set(setForm, 'location')} placeholder="e.g. Manchester" />
            </div>
            <div>
              <Label>Scale</Label>
              <Select value={form.scale} onChange={set(setForm, 'scale')} options={SCALE_OPTIONS} />
            </div>
          </div>

          {/* Event Type + Attend or Host */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Event Type</Label>
              <Select value={form.eventType} onChange={set(setForm, 'eventType')} options={EVENT_TYPE_OPTIONS} />
            </div>
            <div>
              <Label>Attend or Host</Label>
              <Select value={form.attendOrHost} onChange={set(setForm, 'attendOrHost')} options={ATTEND_HOST_OPTIONS} />
            </div>
          </div>

          {/* Booking Status + Sector */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Booking Status</Label>
              <Select value={form.bookingStatus} onChange={set(setForm, 'bookingStatus')} options={BOOKING_STATUS_OPTIONS} />
            </div>
            <div>
              <Label>Sector</Label>
              <Select value={form.sector} onChange={set(setForm, 'sector')} options={SECTOR_OPTIONS} />
            </div>
          </div>

          {/* Visitor Cost + Stand Cost */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Visitor Cost</Label>
              <Input value={form.visitorCost} onChange={set(setForm, 'visitorCost')} placeholder="e.g. £50 per person" />
            </div>
            <div>
              <Label>Stand Cost</Label>
              <Input value={form.standCost} onChange={set(setForm, 'standCost')} placeholder="e.g. £1,500" />
            </div>
          </div>

          {/* Website */}
          <div>
            <Label>Website</Label>
            <Input value={form.website} onChange={set(setForm, 'website')} placeholder="https://…" />
          </div>

          {/* Attendees */}
          <div>
            <Label>Attendees</Label>
            <PeoplePicker
              attendeeIds={form.attendeeIds}
              onChange={ids => setForm(f => ({ ...f, attendeeIds: ids }))}
              users={users}
            />
          </div>

          {error && (
            <div className="px-4 py-3 bg-red/10 border border-red/20 rounded-lg text-[13px] text-red">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-line flex-shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-[13.5px] font-semibold text-muted hover:text-ink border border-line hover:bg-[#F0EBE2] transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 rounded-lg text-[13.5px] font-semibold bg-teal text-white hover:bg-teal-mid disabled:opacity-60 transition-all"
          >
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Event'}
          </button>
        </div>
      </div>
    </div>
  );
}
