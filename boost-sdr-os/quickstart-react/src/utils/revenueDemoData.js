// Sample data for the Revenue tab. Shown when the toggle is on or when the live
// Opportunities board cannot be read (for example when the app runs outside
// monday). All names and figures are made up. Same shape as parseOpportunity.

const DAY = 86400000;

function rng(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SDRS = [
  { name: 'Alex Rivera', win: 0.34, stale: 0.1 },
  { name: 'Jamie Chen', win: 0.14, stale: 0.55 },
  { name: 'Priya Nair', win: 0.4, stale: 0.08 },
  { name: 'Noah Bennett', win: 0.27, stale: 0.2 },
];
const BIZDEVS = ['Morgan Blake', 'Riley Shaw', 'Casey Doyle'];
const SOURCES = [
  ['monday.com', 0.26], ['Outreach', 0.2], ['Boost Events', 0.14], ['Website', 0.1], ['Go-to Partners', 0.1],
  ['Recommendation', 0.07], ['Events/Conferences', 0.06], ['Paid Content', 0.04], ['Webinars', 0.03],
];
const REGIONS = [['UK', 0.5], ['US', 0.22], ['IL', 0.2], ['UAE', 0.08]];
const TYPES = [['New Business', 0.42], ['Expansion', 0.2], ['PS', 0.2], ['Renewal', 0.1], ['Flat Renewal', 0.08]];
const INDUSTRIES = ['Professional services', 'Construction', 'Retail', 'Technology', 'Charity', 'Manufacturing', 'Education'];
const LOST_REASONS = [['No-fit', 0.28], ['Budget', 0.22], ['Timeline is to long', 0.14], ['Ghosting', 0.16], ['Wrong POC', 0.06], ['Lost to competition', 0.1]];
const OPEN_STAGES = [['New (Qualified)', 0.26], ['Demo (Evaluation)', 0.22], ['Proposal (Validation)', 0.18], ['Negotiation & Legal', 0.1], ['Contract sent (Buying process)', 0.06], ['Ghosting', 0.1], ['On hold', 0.08]];

function pick(r, weighted) {
  let x = r();
  for (const [v, w] of weighted) { x -= w; if (x <= 0) return v; }
  return weighted[weighted.length - 1][0];
}

export function makeDemoOpportunities(now = new Date()) {
  const r = rng(20261016);
  const out = [];
  for (let i = 0; i < 460; i++) {
    const sdr = SDRS[Math.floor(r() * SDRS.length)];
    const bizDev = BIZDEVS[Math.floor(r() * BIZDEVS.length)];
    const typeOfDeal = pick(r, TYPES);
    const isPS = typeOfDeal === 'PS';
    const source = pick(r, SOURCES);
    const region = pick(r, REGIONS);
    const base = isPS ? 6000 + r() * 50000 : 12000 + Math.exp(r() * 2.2) * 9000;
    const valueUSD = Math.round(base / 500) * 500;
    const ageDays = Math.floor(r() * 520);
    const created = new Date(now.getTime() - ageDays * DAY);

    const closed = ageDays > 40 && r() < 0.78;
    // Source quality differs so the win-rate chart has something to say.
    const sourceBoost = { 'Boost Events': 0.08, 'Go-to Partners': 0.06, Recommendation: 0.12, Outreach: -0.06, Webinars: -0.1, 'Paid Content': -0.08 }[source] || 0;
    const won = closed && r() < Math.min(0.9, Math.max(0.05, sdr.win + sourceBoost + 0.15));
    const cycle = Math.round(18 + r() * 70 + (sdr.name === 'Noah Bennett' ? 25 : 0));
    const actualClose = closed ? new Date(Math.min(now.getTime() - DAY, created.getTime() + cycle * DAY)) : null;
    const stage = closed ? (won ? 'Won' : 'Lost') : pick(r, OPEN_STAGES);
    const isOpen = !closed;
    const winProbability = isOpen && r() > (sdr.name === 'Jamie Chen' ? 0.5 : 0.12)
      ? { 'New (Qualified)': 10, 'Demo (Evaluation)': 25, 'Proposal (Validation)': 50, 'Negotiation & Legal': 70, 'Contract sent (Buying process)': 85, Ghosting: 10, 'On hold': 10 }[stage]
      : 0;
    const isStale = isOpen && r() < sdr.stale;
    const updatedAt = new Date(now.getTime() - (isStale ? 31 + r() * 90 : r() * 25) * DAY).toISOString();
    const expectedClose = isOpen && r() > 0.1 ? new Date(now.getTime() + (r() * 120 - 25) * DAY) : null;
    const value = isPS && isOpen && r() < 0.06 ? 0 : valueUSD;
    const hasNext = r() > (sdr.name === 'Jamie Chen' ? 0.6 : 0.25);
    const missingFields = [];
    if (!value) missingFields.push('PS Value');
    if (!winProbability) missingFields.push('Win Probability');

    out.push({
      id: `demo-${i}`,
      name: `Sample Co ${String(i + 1).padStart(3, '0')}`,
      updatedAt,
      stage, isWon: stage === 'Won', isLost: stage === 'Lost', isOpen,
      typeOfDeal, isPS, region,
      valueUSD: value,
      weightedValueUSD: value * (winProbability / 100),
      winProbability,
      forecastCategory: 'Pipeline',
      source,
      reasonLost: stage === 'Lost' && r() > 0.12 ? pick(r, LOST_REASONS) : '',
      industry: INDUSTRIES[Math.floor(r() * INDUSTRIES.length)],
      expectedClose, actualClose, created,
      bizDev, sdr: sdr.name,
      nextStep: hasNext ? 'Follow up call' : '',
      missingFields, missingEssentials: missingFields.length > 0,
    });
  }
  return out;
}

export function makeDemoInsights() {
  return {
    scanRun: 'Sample data',
    summary: {
      narrative: 'This is sample text, not a real scan. A real scan summarises where revenue came from over the last 12 months and names the biggest leak, with the numbers it was calculated from.',
      metrics: null,
    },
    findings: [
      { id: 'd1', section: 'Leakage', severity: 'High', confidence: 'Medium', impact: 126000, status: 'New', scope: 'All regions',
        headline: 'Sample: $126k of open pipeline untouched for 30+ days',
        evidence: 'Sample evidence. A real finding shows the count of deals, the value, how it was calculated and up to five example deals with links.',
        action: 'Sample action. A real finding names one concrete next step and who should do it.' },
      { id: 'd2', section: 'Leakage', severity: 'Medium', confidence: 'High', impact: 41000, status: 'New', scope: 'All regions',
        headline: 'Sample: Budget and timeline losses could be re-engaged',
        evidence: 'Sample evidence.', action: 'Sample action.' },
      { id: 'd3', section: 'Revenue sources', severity: 'Info', confidence: 'High', impact: null, status: 'New', scope: 'All regions',
        headline: 'Sample: Recommendation and partner sources convert best',
        evidence: 'Sample evidence.', action: 'Sample action.' },
      { id: 'd4', section: 'Pipeline health', severity: 'Medium', confidence: 'High', impact: 28000, status: 'New', scope: 'UK',
        headline: 'Sample: deals with no next step recorded',
        evidence: 'Sample evidence.', action: 'Sample action.' },
      { id: 'd5', section: 'Coaching', severity: 'Medium', confidence: 'Medium', impact: null, status: 'New', scope: 'Sample rep',
        headline: 'Sample: one rep wins far fewer deals than the team',
        evidence: 'Sample evidence.', action: 'Sample action.' },
    ],
  };
}
