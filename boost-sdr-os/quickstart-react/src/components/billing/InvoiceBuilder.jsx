import React, { useEffect, useMemo, useState } from 'react';
import { fetchOpportunityBillingSource, fetchProjectInvoices, createBookingInvoices } from '../../api/billing';
import {
  buildDraft, defaultPaymentPlan, validateRow, findDuplicates, parseNum, round2, deriveValue,
  formatAmount, applyExtraDefaults, sourceFromProject, groupInvoicesByProject, deriveClient, EXTRA_KINDS, MAX_PAYMENTS, FIELD_LABEL, NEW_STATUS,
} from '../../utils/billing';
import { sortAlpha } from '../../utils/sortOptions';

const MONTH_ORDER = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function cls(invalid, dirty) {
  return `w-full border rounded-lg px-2.5 py-1.5 text-[13px] bg-white focus:outline-none focus:ring-1 focus:ring-navy focus:border-navy transition-colors ${
    invalid ? 'border-red bg-red-soft' : dirty ? 'border-navy' : 'border-line'
  }`;
}

function Field({ label, required, children, className = '' }) {
  return (
    <div className={className}>
      <label className="text-[10px] font-bold uppercase tracking-wider text-muted block mb-1">
        {label}{required && <span className="text-red"> *</span>}
      </label>
      {children}
    </div>
  );
}

function Select({ value, options, onChange, invalid, sort = true }) {
  const opts = sort ? sortAlpha(options) : options;
  return (
    <select value={value ?? ''} onChange={e => onChange(e.target.value)} className={cls(invalid)}>
      <option value="">Choose…</option>
      {opts.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

export default function InvoiceBuilder({ oppId, project, mode, user, meta, billedCountFor, existingInvoices, onClose, onCreated }) {
  const [source, setSource] = useState(null);
  const [error, setError] = useState(null);
  const [count, setCount] = useState(1);
  const [rows, setRows] = useState([]);
  const [attempted, setAttempted] = useState(false);
  const [creating, setCreating] = useState(false);
  const [results, setResults] = useState(null);
  const [kind, setKind] = useState('expenses'); // extra mode only
  const [client, setClient] = useState('');      // Client dropdown label, shared by every row

  // Existing lines on the board: for a board project this is the project's full invoice list (every rep).
  const [projectInvoices, setProjectInvoices] = useState(project?.invoices ?? null);
  const dupePool = projectInvoices ?? existingInvoices;
  const existingCount = source ? (source.existingCount ?? billedCountFor(source.name)) : 0;
  const startNumber = mode === 'extra' ? existingCount + 1 : 1;

  // Load the source and draft the first set of rows. A project picked from the Booking board needs no
  // opportunity at all; a won deal is read fresh from the Opportunities board.
  useEffect(() => {
    let live = true;
    setSource(null); setError(null); setResults(null); setAttempted(false);
    const load = project
      ? fetchProjectInvoices(project.name)
          .then(all => {
            const g = groupInvoicesByProject(all.length ? all : project.invoices)[0] ?? project;
            if (live) setProjectInvoices(g.invoices);
            return sourceFromProject(g);
          })
          .catch(() => sourceFromProject(project))
      : fetchOpportunityBillingSource(oppId);
    load
      .then(src => {
        if (!live) return;
        setSource(src);
        setClient(src.client || deriveClient(src, meta.clientOptions));
        const plan = defaultPaymentPlan(src);
        const c = mode === 'extra' ? 1 : plan.count;
        setCount(c);
        const n = src.existingCount ?? billedCountFor(src.name);
        const sn = mode === 'extra' ? n + 1 : 1;
        const draft = buildDraft(src, meta, { count: c, startNumber: sn, existingCount: mode === 'extra' ? n : 0 });
        setRows(mode === 'extra' ? extraRows(draft, src, kind, sn) : draft);
      })
      .catch(e => live && setError(e.message));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oppId, project?.key, mode]);

  // Latest invoice already on the board for this project, used to copy operation, entity and currency.
  function latestFor(src) {
    if (src.latestInvoice) return src.latestInvoice;
    const mine = (projectInvoices ?? existingInvoices).filter(i => i.project.trim().toLowerCase() === src.name.trim().toLowerCase());
    return [...mine].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
  }
  function extraRows(draft, src, k, sn) {
    return applyExtraDefaults(draft, { kind: k, base: src.name, startNumber: sn, latest: latestFor(src) });
  }

  function changeKind(k) {
    setKind(k);
    setRows(prev => prev.map((r, i) => (r.createdId ? r : { ...r, name: extraRows([r], source, k, startNumber + i)[0].name })));
  }

  function changeCount(n) {
    if (!source) return;
    setCount(n);
    let fresh = buildDraft(source, meta, { count: n, startNumber, existingCount: mode === 'extra' ? existingCount : 0 });
    if (mode === 'extra') fresh = extraRows(fresh, source, kind, startNumber);
    // Keep descriptions the rep has already written.
    setRows(fresh.map((r, i) => ({ ...r, description: rows[i]?.description ?? '' })));
  }

  function setRow(id, patch) {
    setRows(prev => prev.map(r => (r.id === id ? { ...r, ...patch } : r)));
  }

  const { value: dealValue, currency: dealCurrency, basis } = useMemo(() => (source ? deriveValue(source) : {}), [source]);
  const dupes = useMemo(
    () => findDuplicates(rows, dupePool, source?.name ?? ''),
    [rows, dupePool, source],
  );
  const total = rows.reduce((s, r) => s + (parseNum(r.amount) ?? 0), 0);
  const totalMismatch = mode === 'new' && dealValue && Math.abs(total - dealValue) > 0.01;
  const invalidCount = rows.reduce((n, r) => n + validateRow(r).length, 0);
  const sameCurrency = rows.every(r => r.currency === rows[0]?.currency);
  const bdIds = source?.ownerIds?.length ? source.ownerIds : (user?.id ? [String(user.id)] : []);
  const bdFallback = source && !source.ownerIds.length;

  async function handleCreate() {
    setAttempted(true);
    if (invalidCount > 0) return;
    setCreating(true);
    try {
      const res = await createBookingInvoices({
        rows, bdUserIds: bdIds, project: source.name, email: source.email, client: client.trim(),
        accountIds: source.accountIds, contractAssets: source.contract.assets,
      });
      setResults(res);
      setRows(prev => prev.map(r => {
        const hit = res.find(x => x.rowId === r.id && x.ok && x.itemId);
        return hit ? { ...r, createdId: hit.itemId } : r;
      }));
      if (res.every(r => r.ok)) onCreated?.(source);
    } finally {
      setCreating(false);
    }
  }

  if (error) {
    return (
      <Shell onClose={onClose} title="Billing">
        <p className="text-[13px] text-red">Could not load the opportunity: {error}</p>
      </Shell>
    );
  }
  if (!source) {
    return <Shell onClose={onClose} title="Billing"><p className="text-[13px] text-muted">Loading the opportunity and its SOW…</p></Shell>;
  }

  const allDone = results && results.every(r => r.ok);
  const failed = results?.filter(r => !r.ok) ?? [];

  return (
    <Shell onClose={onClose} title={mode === 'extra' ? `Add invoice · ${source.name}` : `Billing for ${source.name}`}>
      {/* What we know */}
      {source.fromBoard ? (
        <div className="grid grid-cols-4 gap-3 max-[900px]:grid-cols-2 mb-4 text-[12.5px]">
          <Info label="Project" value={source.name} sub="from the Booking board" />
          <Info label="On the board" value={`${existingCount} invoice${existingCount === 1 ? '' : 's'}`} sub={`${(projectInvoices ?? []).filter(i => i.kind === 'overdue').length} overdue · ${(projectInvoices ?? []).filter(i => i.kind === 'awaiting' || i.kind === 'issue').length} to invoice · ${(projectInvoices ?? []).filter(i => i.kind === 'outstanding').length} awaiting payment`} />
          <Info label="BD" value={(projectInvoices ?? [])[0]?.bd || '–'} />
          <Info label="Latest invoice" value={(projectInvoices ?? [])[0]?.name || '–'} sub={(projectInvoices ?? [])[0] ? `${(projectInvoices ?? [])[0].month} ${(projectInvoices ?? [])[0].year}` : ''} />
        </div>
      ) : (
      <div className="grid grid-cols-4 gap-3 max-[900px]:grid-cols-2 mb-4 text-[12.5px]">
        <Info label="Deal value" value={dealValue ? formatAmount(dealValue, dealCurrency) : 'Not on the opportunity'} sub={basis} warn={!dealValue} />
        <Info label="Region / entity" value={`${source.region || '–'} → ${rows[0]?.entity || 'choose below'}`} />
        <Info label="Type of deal" value={source.typeOfDeal || '–'} sub={source.arrLength} />
        <Info
          label="SOW / contract"
          value={source.contract.assets.length ? source.contract.assets.map(a => a.name).join(', ') : 'No contract found'}
          sub={source.contract.assets.length ? `from "${source.contract.label}", attached to every invoice` : 'Add it on the opportunity, or attach on the board'}
          warn={!source.contract.assets.length}
        />
      </div>
      )}

      {bdFallback && <Warn>This project has no BD owner, so the invoices will be assigned to you.</Warn>}
      {source.currency && !rows[0]?.currency && <Warn>The opportunity currency ({source.currency}) is not an option on the Booking board. Choose one on each invoice.</Warn>}

      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <label className="text-[12.5px] font-semibold text-ink">Client</label>
        <input
          list="billing-client-options" value={client} onChange={e => setClient(e.target.value)}
          placeholder="Client on the Booking board"
          disabled={!!results}
          className={`${cls(false)} max-w-[260px]`}
        />
        <datalist id="billing-client-options">{sortAlpha(meta.clientOptions).map(o => <option key={o} value={o} />)}</datalist>
        {client.trim() && !meta.clientOptions.some(o => o.toLowerCase() === client.trim().toLowerCase())
          ? <span className="text-[12px] text-amber-ink">Not an existing client, a new one will be added to the board.</span>
          : !client.trim() && <span className="text-[12px] text-muted">Optional, but it groups the invoices by client on the board.</span>}
      </div>

      {/* Payments */}
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <span className="text-[12.5px] font-semibold text-ink">{mode === 'extra' ? 'Add to this project' : 'How many payments?'}</span>
        <div className="flex gap-1.5">
          {Array.from({ length: MAX_PAYMENTS }, (_, i) => i + 1).map(n => (
            <button
              key={n}
              onClick={() => changeCount(n)}
              disabled={!!results}
              className={`w-9 h-9 rounded-full text-[13px] font-bold border cursor-pointer disabled:cursor-not-allowed ${
                count === n ? 'bg-navy text-white border-navy' : 'bg-white text-navy border-line hover:bg-canvas'
              }`}
            >{n}</button>
          ))}
        </div>
        {mode === 'extra' && (
          <select value={kind} onChange={e => changeKind(e.target.value)} disabled={!!results} className="border border-line rounded-full px-3 py-1.5 text-[12.5px] bg-white cursor-pointer">
            {EXTRA_KINDS.map(k => <option key={k.id} value={k.id}>{k.label}</option>)}
          </select>
        )}
        {mode === 'extra' && <span className="text-[12px] text-muted">Amount starts blank.</span>}
        <span className="text-[12px] text-muted ml-auto">Status on every invoice starts as <span className="font-semibold text-ink">{NEW_STATUS}</span></span>
      </div>

      {/* Rows */}
      <div className="flex flex-col gap-3">
        {rows.map((r, i) => {
          const errs = attempted ? validateRow(r) : [];
          const bad = f => errs.includes(f);
          const res = results?.find(x => x.rowId === r.id);
          return (
            <div key={r.id} className={`border rounded-xl p-3.5 bg-white ${dupes.has(r.id) ? 'border-amber' : 'border-line'}`}>
              <div className="flex items-center gap-2 mb-2.5">
                <span className="w-6 h-6 rounded-full bg-pale text-navy grid place-items-center text-[11px] font-bold">{i + 1}</span>
                <input
                  value={r.name} onChange={e => setRow(r.id, { name: e.target.value })}
                  disabled={!!r.createdId}
                  className={`${cls(bad('name'))} font-semibold`}
                />
                {res?.ok && <span className="text-[11px] font-bold text-emerald whitespace-nowrap">Created ✓</span>}
                {res && !res.ok && <span className="text-[11px] font-bold text-red whitespace-nowrap">Failed</span>}
              </div>

              {dupes.has(r.id) && (
                <div className="mb-2.5 text-[12px] text-amber-ink bg-amber-soft rounded-lg px-2.5 py-1.5">
                  {dupes.get(r.id) === 'draft'
                    ? 'Another invoice in this set is identical to this one (same month, amount and description). Check this is not a mistake.'
                    : 'An invoice with the same project, operation, month and amount is already on the finance board.'}
                </div>
              )}

              <div className="grid grid-cols-12 gap-2.5">
                <Field label="Operation" required className="col-span-3 max-[900px]:col-span-6">
                  <Select value={r.operation} options={meta.operationOptions} onChange={v => setRow(r.id, { operation: v })} invalid={bad('operation')} />
                </Field>
                <Field label="Month of work" required className="col-span-2 max-[900px]:col-span-3">
                  <Select value={r.month} options={meta.monthOptions.length ? [...meta.monthOptions].sort((a, b) => MONTH_ORDER.indexOf(a) - MONTH_ORDER.indexOf(b)) : MONTH_ORDER} sort={false} onChange={v => setRow(r.id, { month: v })} invalid={bad('month')} />
                </Field>
                <Field label="Year" required className="col-span-1 max-[900px]:col-span-3">
                  <Select value={r.year} options={meta.yearOptions} onChange={v => setRow(r.id, { year: v })} invalid={bad('year')} />
                </Field>
                <Field label="Payment terms" className="col-span-2 max-[900px]:col-span-4">
                  <Select value={r.terms} options={meta.termsOptions} onChange={v => setRow(r.id, { terms: v })} />
                </Field>
                <Field label="Entity" required className="col-span-2 max-[900px]:col-span-4">
                  <Select value={r.entity} options={meta.entityOptions} onChange={v => setRow(r.id, { entity: v })} invalid={bad('entity')} />
                </Field>
                <Field label="Currency" required className="col-span-2 max-[900px]:col-span-4">
                  <Select value={r.currency} options={meta.currencyOptions} onChange={v => setRow(r.id, { currency: v })} invalid={bad('currency')} />
                </Field>

                {rows.length > 1 && mode === 'new' && (
                  <Field label="Share %" className="col-span-2 max-[900px]:col-span-4">
                    <input
                      type="number" min="0" max="100" value={r.percent}
                      onChange={e => {
                        const pct = e.target.value;
                        setRow(r.id, { percent: pct, ...(dealValue && pct !== '' ? { amount: round2((dealValue * parseFloat(pct)) / 100) } : {}) });
                      }}
                      className={cls(false)}
                    />
                  </Field>
                )}
                <Field label={`Amount (${r.currency || 'currency'})`} required className="col-span-3 max-[900px]:col-span-4">
                  <input type="number" value={r.amount} onChange={e => setRow(r.id, { amount: e.target.value })} className={cls(bad('amount'))} />
                </Field>
                <Field label="Invoice description" required className={rows.length > 1 && mode === 'new' ? 'col-span-7 max-[900px]:col-span-12' : 'col-span-9 max-[900px]:col-span-12'}>
                  <textarea
                    rows={2} value={r.description}
                    placeholder="Wording that will appear on the invoice"
                    onChange={e => setRow(r.id, { description: e.target.value })}
                    className={`${cls(bad('description'))} resize-y`}
                  />
                </Field>
              </div>
              {res && !res.ok && <p className="text-[12px] text-red mt-2">{res.error}</p>}
              {res?.notes?.length > 0 && <p className="text-[12px] text-amber-ink mt-2">{res.notes.join(' · ')}</p>}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="flex items-center gap-3 mt-4 flex-wrap">
        {rows.length > 1 && rows[0]?.description && (
          <button
            onClick={() => setRows(prev => prev.map((r, i) => (i === 0 || r.description ? r : { ...r, description: prev[0].description })))}
            className="text-[12px] font-semibold text-navy underline bg-transparent border-0 cursor-pointer p-0"
          >Copy first description to empty rows</button>
        )}
        <div className="ml-auto text-[12.5px] text-body text-right">
          {sameCurrency && <>Total <span className="font-bold text-ink">{formatAmount(round2(total), rows[0]?.currency)}</span></>}
          {totalMismatch && sameCurrency && rows[0]?.currency === dealCurrency && (
            <span className="block text-amber-ink">Differs from the deal value of {formatAmount(dealValue, dealCurrency)}</span>
          )}
        </div>
      </div>

      {attempted && invalidCount > 0 && (
        <p className="text-[12.5px] text-red mt-2">
          {invalidCount} required field{invalidCount === 1 ? '' : 's'} still to fill: {[...new Set(rows.flatMap(validateRow))].map(f => FIELD_LABEL[f]).join(', ')}.
        </p>
      )}

      <div className="flex items-center gap-3 mt-4 pt-4 border-t border-line">
        <p className="text-[12px] text-muted flex-1">
          {`This creates ${rows.filter(r => !r.createdId).length} item${rows.length === 1 ? '' : 's'} on the Booking board for finance to review.`}
        </p>
        {allDone ? (
          <button onClick={onClose} className="px-5 py-2.5 rounded-full text-[13px] font-semibold text-white bg-emerald border-0 cursor-pointer">Done</button>
        ) : (
          <button
            onClick={handleCreate} disabled={creating}
            className="px-5 py-2.5 rounded-full text-[13px] font-semibold text-white bg-navy hover:bg-navy-700 border-0 cursor-pointer disabled:opacity-60"
          >
            {creating ? 'Creating…' : failed.length ? `Retry ${failed.length} failed` : `Create ${rows.length} invoice${rows.length === 1 ? '' : 's'}`}
          </button>
        )}
      </div>

      {allDone && (
        <p className="text-[12.5px] text-emerald font-semibold mt-3">
          {results.length} invoice{results.length === 1 ? '' : 's'} created. They will show under My Invoices below.
        </p>
      )}
    </Shell>
  );
}

function Shell({ title, onClose, children }) {
  return (
    <section className="bg-white border border-line rounded-2xl shadow-sm p-5 mb-6">
      <div className="flex items-center gap-3 mb-4">
        <h2 className="font-heading font-bold text-[16px] text-ink flex-1 truncate">{title}</h2>
        <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-line text-muted hover:text-ink bg-transparent border-0 cursor-pointer text-[18px] leading-none">×</button>
      </div>
      {children}
    </section>
  );
}

function Info({ label, value, sub, warn }) {
  return (
    <div className={`rounded-xl px-3 py-2 ${warn ? 'bg-amber-soft' : 'bg-canvas'}`}>
      <div className="text-[10px] font-bold uppercase tracking-wider text-muted">{label}</div>
      <div className={`font-semibold mt-0.5 break-words ${warn ? 'text-amber-ink' : 'text-ink'}`}>{value}</div>
      {sub && <div className="text-[11px] text-muted mt-0.5">{sub}</div>}
    </div>
  );
}

function Warn({ children }) {
  return <div className="mb-3 text-[12.5px] text-amber-ink bg-amber-soft rounded-lg px-3 py-2">{children}</div>;
}
