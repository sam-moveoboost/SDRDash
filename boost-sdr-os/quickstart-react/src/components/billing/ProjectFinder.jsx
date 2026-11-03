import React, { useEffect, useState } from 'react';
import { searchBillingProjects } from '../../api/billing';
import { useBilling } from '../../billing/BillingContext';

// Find any opportunity by name and add a later invoice to it (extra expenses, a top-up payment and so on).
export default function ProjectFinder() {
  const { openBilling, billedCountFor } = useBilling();
  const [term, setTerm] = useState('');
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (term.trim().length < 2) { setResults(null); setError(null); return; }
    let live = true;
    setBusy(true);
    const t = setTimeout(() => {
      searchBillingProjects(term)
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
          placeholder="Search by project or client name, e.g. Innocent"
          className="w-full border border-line rounded-xl px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-navy focus:border-navy"
        />
        <p className="text-[11.5px] text-muted mt-1.5">For anything that comes up after the original billing, such as additional expenses or a further payment.</p>
        {error && <p className="text-[12.5px] text-red mt-2">{error}</p>}
        {busy && <p className="text-[12.5px] text-muted mt-2">Searching…</p>}
        {results && !busy && results.length === 0 && <p className="text-[12.5px] text-muted mt-2">No opportunities match "{term}".</p>}
        {results?.length > 0 && (
          <div className="mt-3 flex flex-col divide-y divide-line border border-line rounded-xl overflow-hidden">
            {results.map(r => {
              const n = billedCountFor(r.name);
              return (
                <div key={r.id} className="flex items-center gap-3 px-3.5 py-2.5">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-[13px] text-ink truncate">{r.name}</div>
                    <div className="text-[11.5px] text-muted">{[r.stage, r.region, n ? `${n} of your invoices on the board` : null].filter(Boolean).join(' · ')}</div>
                  </div>
                  <button
                    onClick={() => openBilling(r.id, 'extra')}
                    className="px-3.5 py-1.5 rounded-full text-[12px] font-semibold text-white bg-navy hover:bg-navy-700 border-0 cursor-pointer"
                  >+ Add invoice</button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
