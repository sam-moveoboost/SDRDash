import React, { useState, useEffect } from 'react';
import mondaySdk from 'monday-sdk-js';
import { fetchCurrentUser } from './api/monday';
import Scoreboard from './pages/Scoreboard';
import Workflow from './pages/Workflow';
import './App.css';

const monday = mondaySdk();

const REGIONS = ['All', 'UK', 'US', 'IL', 'UAE'];

function getMonthOptions() {
  const options = [];
  const now = new Date();
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    options.push({
      value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: d.toLocaleString('en-GB', { month: 'long', year: 'numeric' }),
    });
  }
  return options;
}

export default function App() {
  const [tab, setTab] = useState('scoreboard');
  const [region, setRegion] = useState('UK');
  const [month, setMonth] = useState(getMonthOptions()[0].value);
  const [user, setUser] = useState(null);

  useEffect(() => {
    monday.execute('valueCreatedForUser');
    fetchCurrentUser().then(setUser).catch(() => {});
  }, []);

  const monthOptions = getMonthOptions();

  return (
    <div className="min-h-screen bg-canvas font-body">
      {/* Top bar */}
      <header className="sticky top-0 z-50 bg-teal text-white flex items-center gap-7 px-7 h-[60px] shadow-[0_2px_16px_rgba(9,56,53,.18)]">
        <div className="flex items-center gap-2.5 whitespace-nowrap">
          {/* Boost logo mark: rounded rect + diagonal slash */}
          <span className="w-[30px] h-[30px] rounded-lg bg-mint flex items-center justify-center flex-shrink-0">
            <svg width="18" height="16" viewBox="0 0 18 16" fill="none" stroke="#192D3F" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="1" y="1" width="16" height="14" rx="3.5"/>
              <line x1="14.5" y1="1" x2="3.5" y2="15"/>
            </svg>
          </span>
          <div className="flex items-baseline gap-1.5">
            <span className="font-display font-bold text-[18px] tracking-tight italic">boost</span>
            <span className="text-white/40 text-[13px] font-medium">SDR OS</span>
          </div>
        </div>

        <nav className="flex gap-1 ml-2">
          {[
            { id: 'scoreboard', label: 'Scoreboard' },
            { id: 'workflow',   label: 'My Work' },
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-150 cursor-pointer border-0 outline-none ${
                tab === t.id
                  ? 'bg-mint text-teal-deep'
                  : 'bg-transparent text-white/60 hover:text-white hover:bg-white/10'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2.5">
          {/* Region filter */}
          <div className="flex items-center gap-1.5 bg-white/10 border border-white/15 text-white text-sm font-medium px-3 py-1.5 rounded-lg">
            <span className="w-1.5 h-1.5 rounded-full bg-mint" />
            <select
              value={region}
              onChange={e => setRegion(e.target.value)}
              className="bg-transparent border-0 text-white text-sm font-medium cursor-pointer outline-none"
            >
              {REGIONS.map(r => <option key={r} value={r} className="text-ink">{r}</option>)}
            </select>
          </div>

          {/* Month filter (scoreboard only) */}
          {tab === 'scoreboard' && (
            <div className="flex items-center gap-1.5 bg-white/10 border border-white/15 text-white text-sm font-medium px-3 py-1.5 rounded-lg">
              <select
                value={month}
                onChange={e => setMonth(e.target.value)}
                className="bg-transparent border-0 text-white text-sm font-medium cursor-pointer outline-none"
              >
                {monthOptions.map(o => (
                  <option key={o.value} value={o.value} className="text-ink">{o.label}</option>
                ))}
              </select>
            </div>
          )}

          {/* User avatar */}
          {user && (
            <div
              title={user.name}
              className="w-8 h-8 rounded-full bg-mint-soft text-teal-deep grid place-items-center font-display font-bold text-sm overflow-hidden"
            >
              {user.photo_thumb
                ? <img src={user.photo_thumb} alt={user.name} className="w-full h-full object-cover" />
                : user.name.split(' ').map(n => n[0]).slice(0, 2).join('')}
            </div>
          )}
        </div>
      </header>

      {/* Page content */}
      <main>
        {tab === 'scoreboard' && <Scoreboard region={region} month={month} />}
        {tab === 'workflow'   && <Workflow   region={region} user={user} />}
      </main>
    </div>
  );
}
