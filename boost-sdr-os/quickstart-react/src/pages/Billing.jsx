import React, { useEffect, useMemo, useState } from 'react';
import { useBilling } from '../billing/BillingContext';
import { fetchBookingMeta, fetchBookingInvoices, peekBookingInvoices, setInvoiceStatus } from '../api/billing';
import { fetchWorkspaceUsers } from '../api/monday';
import InvoiceBuilder from '../components/billing/InvoiceBuilder';
import ProjectFinder from '../components/billing/ProjectFinder';
import { formatAmount, daysOverdue, INVOICE_ORDER, todayISO, groupInvoicesByProject, projectKey, REP_STATUSES, STATUS_COLOR, classifyInvoice } from '../utils/billing';
import { sortAlpha } from '../utils/sortOptions';

const KIND_META = {
  overdue:     { label: 'Overdue' },
  awaiting:    { label: 'To invoice' },
  issue:       { label: 'Issue invoice' },
  outstanding: { label: 'Awaiting payment' },
  other:       { label: 'On hold' },
  paid:        { label: 'Paid' },
  cancelled:   { label: 'Cancelled' },
};
const KIND_ORDER = ['overdue', 'awaiting', 'issue', 'outstanding', 'other', 'paid', 'cancelled'];

function totalsByCurrency(list) {
  const t = {};
  for (const i of list) if (i.amount != null) t[i.currency || '?'] = (t[i.currency || '?'] ?? 0) + i.amount;
  const parts = Object.entries(t).map(([c, v]) => formatAmount(v, c));
  return parts.length ? parts.join(' · ') : '–';
}

export default function Billing({ user }) {
  const { pending, invoices, loading, error, target, clearTarget, openBilling, openProject, patchInvoice, reload, markHandled, billedCountFor } = useBilling();
  const [meta, setMeta] = useState(null);
  const [metaError, setMetaError] = useState(null);
  const [users, setUsers] = useState([]);
  const [rep, setRep] = useState('me'); // 'me' | 'all' | user id
  const [otherInvoices, setOtherInvoices] = useState(null);
  const [kinds, setKinds] = useState(['overdue', 'awaiting', 'issue', 'outstanding']); // paid, cancelled and on hold are hidden by default
  const [saving, setSaving] = useState({}); // invoice id -> true while its status is being written
  const [saveError, setSaveError] = useState(null);

  useEffect(() => { reload(); fetchBookingMeta().then(setMeta).catch(e => setMetaError(e.message)); fetchWorkspaceUsers().then(setUsers).catch(() => {}); }, [reload]);

  useEffect(() => {
    if (rep === 'me') { setOtherInvoices(null); return; }
    let live = true;
    setOtherInvoices(null);
    const userId = rep === 'all' ? null : rep;
    peekBookingInvoices({ userId }).then(c => { if (live && c?.items) setOtherInvoices(c.items); });
    fetchBookingInvoices({ userId }).then(r => live && setOtherInvoices(r)).catch(() => live && setOtherInvoices(prev => prev ?? []));
    return () => { live = false; };
  }, [rep]);

  const all = rep === 'me' ? invoices : otherInvoices;
  const today = todayISO();
  const list = useMemo(() => (all ?? [])
    .filter(i => kinds.includes(i.kind))
    .sort((a, b) => (INVOICE_ORDER[a.kind] - INVOICE_ORDER[b.kind])
      || (a.dueDate || '9999').localeCompare(b.dueDate || '9999')), [all, kinds]);

  const projects = useMemo(() => new Map(groupInvoicesByProject(all ?? []).map(g => [g.key, g])), [all]);
  const overdue = (all ?? []).filter(i => i.kind === 'overdue');
  const toInvoice = (all ?? []).filter(i => i.kind === 'awaiting' || i.kind === 'issue');
  const outstanding = (all ?? []).filter(i => i.kind === 'outstanding');

  async function changeStatus(inv, label) {
    if (label === inv.status) return;
    setSaving(p => ({ ...p, [inv.id]: true })); setSaveError(null);
    try {
      await setInvoiceStatus(inv.id, label);
      const patch = { status: label, kind: classifyInvoice({ status: label, dueDate: inv.dueDate }) };
      patchInvoice(inv.id, patch);
      setOtherInvoices(prev => (prev ? prev.map(i => (i.id === inv.id ? { ...i, ...patch } : i)) : prev));
    } catch (e) {
      setSaveError(`Could not update "${inv.name}": ${String(e.message).slice(0, 120)}`);
    } finally {
      setSaving(p => { const n = { ...p }; delete n[inv.id]; return n; });
    }
  }

  function toggle(k) { setKinds(prev => (prev.includes(k) ? prev.filter(x => x !== k) : [...prev, k])); }

  // Invoices already on the board, used to spot a clash with what's being drafted.
  const existingForBuilder = invoices;

  return (
    <div className="max-w-[1180px] mx-auto px-8 py-7">
      <div className="flex items-center gap-3 mb-1">
        <h1 className="font-heading font-bold text-[24px] text-ink">Billing</h1>
        <span className="text-[10.5px] font-bold uppercase tracking-wider bg-amber-soft text-amber-ink rounded-full px-2.5 py-1">Alpha</span>
      </div>
      <p className="text-[13.5px] text-muted mb-5">
        Draft the invoices for a won deal and send them to the finance Booking board, then track what is paid and what is late.
      </p>

      {metaError && <p className="text-[13px] text-red mb-4">Could not read the Booking board options: {metaError}</p>}

      {/* Builder */}
      {target && meta && (
        <InvoiceBuilder
          key={`${target.oppId ?? target.project?.key}-${target.mode}`}
          oppId={target.oppId}
          project={target.project}
          mode={target.mode}
          user={user}
          meta={meta}
          billedCountFor={billedCountFor}
          existingInvoices={existingForBuilder}
          onClose={clearTarget}
          onCreated={src => { if (src.id) markHandled(src.id); reload({ force: true }); }}
        />
      )}

      {/* Awaiting billing */}
      <section className="mb-7">
        <div className="flex items-center gap-2 mb-2.5">
          <h2 className="font-heading font-bold text-[15px] text-ink">Won PS deals awaiting billing</h2>
          {pending.length > 0 && <span className="text-[11px] font-bold bg-amber text-white rounded-full px-2 py-0.5">{pending.length}</span>}
        </div>
        {pending.length === 0 ? (
          <p className="text-[13px] text-muted bg-white border border-line rounded-xl px-4 py-3">
            {loading ? 'Checking your won deals…' : 'Nothing waiting. PS deals you win without invoices on the board will appear here.'}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {pending.map(p => (
              <div key={p.id} className="flex items-center gap-3 bg-amber-soft border border-amber/40 rounded-xl px-4 py-2.5">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-[13.5px] text-ink truncate">{p.name}</div>
                  <div className="text-[12px] text-muted">Won {p.closedDate || 'recently'}{p.region ? ` · ${p.region}` : ''}</div>
                </div>
                <button
                  onClick={() => markHandled(p.id)}
                  title="Hide this reminder, for example if the invoices were raised another way"
                  className="text-[12px] font-semibold text-muted hover:text-ink bg-transparent border-0 cursor-pointer"
                >Already billed</button>
                <button
                  onClick={() => openBilling(p.id, 'new')}
                  className="px-4 py-1.5 rounded-full text-[12.5px] font-semibold text-white bg-navy hover:bg-navy-700 border-0 cursor-pointer"
                >Set up billing</button>
              </div>
            ))}
          </div>
        )}
      </section>

      <ProjectFinder />

      {/* Tracker */}
      <section>
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <h2 className="font-heading font-bold text-[15px] text-ink">My invoices</h2>
          <select
            value={rep} onChange={e => setRep(e.target.value)}
            className="border border-line rounded-full px-3 py-1.5 text-[12.5px] bg-white cursor-pointer"
          >
            <option value="me">Where I am the BD</option>
            <option value="all">All reps</option>
            {sortAlpha(users, u => u.name).map(u => <option key={u.id} value={String(u.id)}>{u.name}</option>)}
          </select>
          <div className="flex gap-1.5 ml-auto flex-wrap">
            {KIND_ORDER.map(k => (
              <button
                key={k} onClick={() => toggle(k)}
                className={`px-3 py-1.5 rounded-full text-[12px] font-semibold border cursor-pointer ${
                  kinds.includes(k) ? 'bg-navy text-white border-navy' : 'bg-white text-muted border-line hover:text-ink'
                }`}
              >{KIND_META[k].label}</button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-3 max-[800px]:grid-cols-1">
          <Stat label="Overdue" value={overdue.length} sub={totalsByCurrency(overdue)} tone="red" />
          <Stat label="To invoice" value={toInvoice.length} sub={totalsByCurrency(toInvoice)} tone="amber" />
          <Stat label="Awaiting payment" value={outstanding.length} sub={totalsByCurrency(outstanding)} />
        </div>

        {error && <p className="text-[13px] text-red mb-2">{error}</p>}
        {saveError && <p className="text-[13px] text-red mb-2">{saveError}</p>}
        <div className="bg-white border border-line rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-left text-[10.5px] uppercase tracking-wider text-muted border-b border-line bg-canvas">
                  <th className="px-4 py-2.5 font-bold">Invoice</th>
                  <th className="px-3 py-2.5 font-bold">Operation</th>
                  <th className="px-3 py-2.5 font-bold">Work month</th>
                  <th className="px-3 py-2.5 font-bold text-right">Amount</th>
                  <th className="px-3 py-2.5 font-bold">Due</th>
                  <th className="px-3 py-2.5 font-bold">Payment status</th>
                  {rep !== 'me' && <th className="px-3 py-2.5 font-bold">BD</th>}
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {all === null || (loading && rep === 'me' && !invoices.length) ? (
                  <tr><td colSpan={9} className="px-4 py-6 text-muted">Loading invoices…</td></tr>
                ) : list.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-6 text-muted">No invoices match the filters.</td></tr>
                ) : list.map(i => {
                  const late = daysOverdue(i.dueDate, today);
                  const proj = projects.get(projectKey(i));
                  return (
                    <tr key={i.id} className={`border-b border-line last:border-0 hover:bg-canvas/60 ${i.kind === 'overdue' ? 'bg-red-soft/40' : ''}`}>
                      <td className="px-4 py-2.5">
                        <a href={i.url} target="_blank" rel="noreferrer" className="font-semibold text-navy hover:underline">{i.name}</a>
                        {i.description && <div className="text-[11.5px] text-muted truncate max-w-[320px]">{i.description}</div>}
                      </td>
                      <td className="px-3 py-2.5">{i.operation || '–'}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">{i.month} {i.year}</td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap font-semibold">{formatAmount(i.amount, i.currency)}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {i.dueDate || '–'}
                        {i.kind === 'overdue' && late > 0 && <div className="text-[11px] text-red font-semibold">{late} day{late === 1 ? '' : 's'} late</div>}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <StatusCell inv={i} busy={!!saving[i.id]} onChange={label => changeStatus(i, label)} />
                      </td>
                      {rep !== 'me' && <td className="px-3 py-2.5 whitespace-nowrap">{i.bd || '–'}</td>}
                      <td className="px-3 py-2.5 text-right whitespace-nowrap">
                        {proj && (
                          <button
                            onClick={() => openProject(proj)}
                            title="Add a later invoice for this deal"
                            className="text-[11.5px] font-semibold text-navy bg-transparent border border-line rounded-full px-2.5 py-1 cursor-pointer hover:bg-canvas"
                          >+ Invoice</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <p className="text-[11.5px] text-muted mt-2">
          New! and Awaiting Invoice are waiting for you to decide; set a line to Issue invoice when finance should raise it. Awaiting Payment, Late! and Paid! are set by finance. Overdue means finance marked it Late!, or it is Awaiting Payment and past its due date (the default expected date is used when there is no due date).
        </p>
      </section>
    </div>
  );
}

// Reps can move a line between the pre-invoice statuses; once finance has taken it over the
// status is shown read-only, in the board's colour.
function StatusCell({ inv, busy, onChange }) {
  const color = STATUS_COLOR[String(inv.status).trim().toLowerCase()] ?? '#757c77';
  const editable = REP_STATUSES.some(s => s.toLowerCase() === String(inv.status).trim().toLowerCase()) || !inv.status;
  if (!editable) {
    return <span className="inline-block text-[11.5px] font-bold text-white px-2.5 py-1 rounded-md" style={{ background: color }}>{inv.status}</span>;
  }
  const current = REP_STATUSES.find(s => s.toLowerCase() === String(inv.status).trim().toLowerCase()) ?? '';
  return (
    <div className="flex items-center gap-1.5">
      <select
        value={current} disabled={busy} onChange={e => onChange(e.target.value)}
        className="text-[11.5px] font-bold text-white px-2 py-1 rounded-md border-0 cursor-pointer disabled:opacity-60 appearance-auto"
        style={{ background: color }}
      >
        {!current && <option value="">Choose…</option>}
        {REP_STATUSES.map(s => <option key={s} value={s} className="text-ink bg-white">{s}</option>)}
      </select>
      {(inv.kind === 'awaiting') && !busy && (
        <button
          onClick={() => onChange('Issue invoice')}
          className="text-[11px] font-semibold text-navy bg-white border border-line rounded-full px-2.5 py-1 cursor-pointer hover:bg-canvas whitespace-nowrap"
        >Issue invoice</button>
      )}
      {busy && <span className="text-[11px] text-muted">Saving…</span>}
    </div>
  );
}

function Stat({ label, value, sub, tone }) {
  return (
    <div className="bg-white border border-line rounded-xl px-4 py-3">
      <div className="text-[10.5px] font-bold uppercase tracking-wider text-muted">{label}</div>
      <div className={`font-heading font-bold text-[22px] ${tone === 'red' && value > 0 ? 'text-red' : tone === 'amber' && value > 0 ? 'text-amber-ink' : 'text-ink'}`}>{value}</div>
      <div className="text-[12px] text-muted truncate">{sub}</div>
    </div>
  );
}
