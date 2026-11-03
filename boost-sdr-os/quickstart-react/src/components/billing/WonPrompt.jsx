import React from 'react';
import { useBilling } from '../../billing/BillingContext';

// Shown the moment a rep marks an opportunity Won, wherever in the app that happens.
export default function WonPrompt() {
  const { wonPrompt, dismissWonPrompt, openBilling } = useBilling();
  if (!wonPrompt) return null;
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={dismissWonPrompt} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-[440px] p-6">
        <div className="w-11 h-11 rounded-full bg-mint grid place-items-center text-[22px] mb-3">🎉</div>
        <h2 className="font-heading font-bold text-[18px] text-ink leading-snug">Deal won. Set up the billing?</h2>
        <p className="text-[13.5px] text-body mt-2">
          <span className="font-semibold text-ink">{wonPrompt.name}</span> is now Won. We can draft its invoices for the
          finance board from the opportunity and the SOW. You choose how many payments and edit anything before they are created.
        </p>
        <div className="flex gap-2.5 mt-5 justify-end">
          <button onClick={dismissWonPrompt} className="px-4 py-2 rounded-full text-[13px] font-semibold text-navy border border-line bg-white hover:bg-canvas cursor-pointer">
            Later
          </button>
          <button
            onClick={() => { const id = wonPrompt.id; dismissWonPrompt(); openBilling(id, 'new'); }}
            className="px-4 py-2 rounded-full text-[13px] font-semibold text-white bg-navy hover:bg-navy-700 cursor-pointer border-0"
          >
            Set up billing
          </button>
        </div>
        <p className="text-[11.5px] text-muted mt-3">Choosing Later keeps it flagged on the Billing tab.</p>
      </div>
    </div>
  );
}
