// Syncing the Rentals data with Tõnis's own private Google Sheet.
// Same Apps Script as the household Sheet (apps-script/Code.gs), deployed in a
// second Sheet with its own key, so the two never mix.

import * as store from './store.js';
import { postToSheet } from '../sync.js';

let status = { kind: 'idle', message: '', at: store.loadLastSync() };
let running = null;
let timer = null;
let started = false;

export const getStatus = () => status;
export const isConfigured = () => Boolean(store.getDevice().syncUrl && store.getDevice().syncKey);

/** Sync now. Overlapping calls share one run. Returns true when it worked. */
export function syncNow() {
  if (!isConfigured()) {
    status = { ...status, kind: 'off' };
    return Promise.resolve(false);
  }
  if (running) return running;
  running = (async () => {
    if (!navigator.onLine) {
      status = { ...status, kind: 'offline' };
      return false;
    }
    try {
      const d = store.getDevice();
      const sent = store.getDirtyRecords();
      const data = await postToSheet(d.syncUrl, d.syncKey, { action: 'sync', since: store.loadCursor(), records: sent });
      store.saveCursor(data.serverTime);
      status = { kind: 'ok', message: '', at: new Date().toISOString() };
      store.saveLastSync(status.at);
      store.applyRemote(data.records || [], sent);
      return true;
    } catch (err) {
      console.warn('Rentals sync failed', err);
      status = { ...status, kind: 'error', message: err.message };
      return false;
    } finally {
      running = null;
    }
  })();
  return running;
}

/** Sync after edits (2 s later), every 2 minutes while visible, and when the app comes back. */
export function startAutoSync() {
  if (started) return;
  started = true;
  store.subscribe(() => {
    if (!store.pendingCount() || !isConfigured()) return;
    clearTimeout(timer);
    timer = setTimeout(syncNow, 2000);
  });
  setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 120_000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
  window.addEventListener('online', syncNow);
  syncNow();
}
