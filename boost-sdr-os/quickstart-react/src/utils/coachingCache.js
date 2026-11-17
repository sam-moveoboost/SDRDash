// Remembers the last Coaching data in this browser tab, so reopening the tab shows it at once
// while the newest is fetched behind it. Kept in sessionStorage: it stays on this device and is
// cleared when the tab is closed. Every call is wrapped, because storage can be blocked or full.

const key = (who, sdr, days) => `coaching:v1:${who}:${sdr}:${days}`;

export function readCoachingCache(who, sdr, days) {
  try {
    const raw = window.sessionStorage.getItem(key(who, sdr, days));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function writeCoachingCache(who, sdr, days, data) {
  try {
    window.sessionStorage.setItem(key(who, sdr, days), JSON.stringify({ ...data, savedAt: Date.now() }));
  } catch {
    /* too big or blocked: the page simply loads normally next time */
  }
}
