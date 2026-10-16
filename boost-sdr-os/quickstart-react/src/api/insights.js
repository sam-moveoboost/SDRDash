import { gql } from './monday';

// The Revenue Insights board is written by the scheduled Claude scan (06:00 and
// 12:00 UK, Sunday to Friday). This module only reads the latest scan and lets
// a person triage a finding; it never calls an AI model itself, so no API key
// is needed in the browser.
export const INSIGHTS_BOARD = '5106188232';

const COLS = ['section', 'severity', 'confidence', 'action_status', 'impact_usd', 'evidence', 'recommended_action', 'scan_run', 'scope', 'metrics_json'];

export const ACTION_STATUSES = ['New', 'Acknowledged', 'In progress', 'Done', 'Dismissed'];

function parseItem(item) {
  const t = id => item.column_values?.find(c => c.id === id)?.text ?? '';
  const impact = parseFloat(t('impact_usd').replace(/,/g, ''));
  return {
    id: item.id,
    headline: item.name,
    section: t('section'),
    severity: t('severity') || 'Info',
    confidence: t('confidence'),
    status: t('action_status') || 'New',
    impact: Number.isFinite(impact) ? impact : null,
    evidence: t('evidence'),
    action: t('recommended_action'),
    scope: t('scope'),
    scanRun: t('scan_run'),
    metricsRaw: t('metrics_json'),
  };
}

// Returns { scanRun, summary, findings } for the newest scan, or { empty: true }.
export async function fetchLatestInsights() {
  const data = await gql(`
    query {
      boards(ids: ["${INSIGHTS_BOARD}"]) {
        items_page(limit: 300, query_params: { order_by: [{ column_id: "__creation_log__", direction: desc }] }) {
          items {
            id name
            column_values(ids: [${COLS.map(c => `"${c}"`).join(', ')}]) { id text }
          }
        }
      }
    }
  `);
  const items = (data.boards?.[0]?.items_page?.items ?? []).map(parseItem).filter(i => i.scanRun);
  if (!items.length) return { empty: true };

  // scan_run is "YYYY-MM-DD HH:mm", so a plain string compare finds the newest.
  const scanRun = items.reduce((max, i) => (i.scanRun > max ? i.scanRun : max), '');
  const latest = items.filter(i => i.scanRun === scanRun);
  const summaryItem = latest.find(i => i.section === 'Run summary');
  let metrics = null;
  try { metrics = summaryItem?.metricsRaw ? JSON.parse(summaryItem.metricsRaw) : null; } catch { /* free-text, ignore */ }

  return {
    scanRun,
    summary: summaryItem ? { narrative: summaryItem.evidence, metrics } : null,
    findings: latest
      .filter(i => i.section !== 'Run summary')
      .sort((a, b) => (b.impact ?? -1) - (a.impact ?? -1)),
  };
}

export async function updateInsightStatus(itemId, label) {
  const value = JSON.stringify(JSON.stringify({ label }));
  await gql(`
    mutation {
      change_column_value(
        board_id: ${INSIGHTS_BOARD},
        item_id: ${itemId},
        column_id: "action_status",
        value: ${value}
      ) { id }
    }
  `);
}

// "2026-10-17 06:00" (UK time) -> a Date, treated as local. Good enough to say
// how old a scan is; it is not used for any calculation.
export function scanDate(scanRun) {
  const d = new Date(String(scanRun).replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d;
}
