import React, { useState, useEffect } from 'react';
import mondaySdk from 'monday-sdk-js';
import { fetchCurrentUser } from './api/monday';
import Scoreboard from './pages/Scoreboard';
import Workflow from './pages/Workflow';
import Events from './pages/Events';
import OpportunityScoreboard from './pages/OpportunityScoreboard';
import boostLockup from './assets/brand/boost-lockup-white.png';
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
    <div className="min-h-screen bg-canvas font-body text-ink">
      {/* Top bar */}
      <header className="sticky top-0 z-50 bg-navy text-white flex items-center gap-8 px-8 h-16 shadow-md">
        <div className="flex items-center gap-3 whitespace-nowrap">
          <img src={boostLockup} alt="boost" className="h-[26px] w-auto block" />
          <span className="h-5 w-px bg-white/20" />
          <span className="font-heading text-on-dark/70 text-[13px] font-medium tracking-wide">SDR OS</span>
        </div>

        <nav className="flex gap-1 ml-2">
          {[
            { id: 'scoreboard',    label: 'Scoreboard' },
            { id: 'opportunities', label: 'Pipeline' },
            { id: 'events',        label: 'Events' },
            { id: 'workflow',      label: 'My Work' },
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-colors duration-150 cursor-pointer border-0 outline-none ${
                tab === t.id
                  ? 'bg-pale text-navy'
                  : 'bg-transparent text-on-dark/70 hover:text-white hover:bg-white/10'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2.5">
          {/* Region filter */}
          <div className="flex items-center gap-1.5 bg-white/10 border border-white/15 text-white text-sm font-medium pl-3.5 pr-2.5 py-1.5 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-pale" />
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
            <div className="flex items-center gap-1.5 bg-white/10 border border-white/15 text-white text-sm font-medium pl-3.5 pr-2.5 py-1.5 rounded-full">
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
              className="w-8 h-8 rounded-full bg-pale text-navy grid place-items-center font-heading font-semibold text-sm overflow-hidden ring-2 ring-white/20"
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
        {tab === 'scoreboard'    && <Scoreboard region={region} month={month} />}
        {tab === 'workflow'      && <Workflow   region={region} user={user} />}
        {tab === 'opportunities' && (
          <OpportunityScoreboard region={region} user={user} />
        )}
        {tab === 'events'        && <Events />}
      </main>
    </div>
  );
}
