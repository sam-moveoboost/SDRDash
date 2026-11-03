import React, { useEffect, useState } from 'react';
import { searchBookingProjects } from '../../api/billing';
import { useBilling } from '../../billing/BillingContext';

// Find a project on the Booking board (the same projects finance groups by client) and add a later
// invoice to it, such as additional expenses or a further payment.
export default function ProjectFinder() {
  const { openProject } = useBilling();
  const [term, setTerm] = useState('');
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (term.trim().length < 2) { setResults(null); setError(null); return; }
    let live = true;
    setBusy(true);
    const t = setTimeout(() => {
      searchBookingProjects(term)
        .then(r => { if (live) { setResults(r); setError(null); } })
        .catch(e => live && setError(e.message))
        .finally(() => live && setBusy(false));
    }, 350);
    return () => { live = false; clearTimeout(t); };
  }, [term]);

  return (
    <section className="mb-7">
      <h2 className="font-heading font-bold text-[15px] text-ink mb-2.5">Add an invoice to an existing project</h2>
      <div className="bg-white border border-line rounded-2xl p-4">
        <input
          value={term} onChange={e => setTerm(e.target.value)}
          placeholder="Search the Booking board by project or client, e.g. Innocent"
          className="w-full border border-line rounded-xl px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-navy focus:border-navy"
        />
        <p className="text-[11.5px] text-muted mt-1.5">Projects come from the Booking board, with their outstanding invoices. Use this for anything that comes up after the original billing, such as additional expenses or a further payment.</p>
        {error && <p className="text-[12.5px] text-red mt-2">{error}</p>}
        {busy && <p className="text-[12.5px] text-muted mt-2">Searching the Booking board…</p>}
        {results && !busy && results.length === 0 && <p className="text-[12.5px] text-muted mt-2">No projects on the Booking board match "{term}".</p>}
        {results?.length > 0 && (
          <div className="mt-3 flex flex-col divide-y divide-line border border-line rounded-xl overflow-hidden">
            {results.map(g => (
              <div key={g.key} className="flex items-center gap-3 px-3.5 py-2.5">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-[13px] text-ink truncate">{g.name}</div>
                  <div className="text-[11.5px] text-muted">
                    {g.invoices.length} invoice{g.invoices.length === 1 ? '' : 's'}
                    {g.latest?.bd ? ` · BD ${g.latest.bd}` : ''}
                    {g.latest?.entity ? ` · ${g.latest.entity}` : ''}
                  </div>
                </div>
                {g.overdue > 0 && <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-red text-white">{g.overdue} overdue</span>}
                {g.outstanding > 0 && <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-pale text-navy">{g.outstanding} outstanding</span>}
                <button
                  onClick={() => openProject(g)}
                  className="px-3.5 py-1.5 rounded-full text-[12px] font-semibold text-white bg-navy hover:bg-navy-700 border-0 cursor-pointer"
                >+ Add invoice</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
