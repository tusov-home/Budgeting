// Syncing with the private Google Sheet (through the Apps Script web app
// in apps-script/Code.gs).
//
// One "sync" = send our changed records, receive everything that changed
// on the Sheet since our last sync, merge. The app always works from the
// copy on this device, so it opens instantly and also works offline.

import * as state from './state.js';
import * as storage from './storage.js';

const AUTO_INTERVAL_MS = 60_000;  // check for the other phone's changes every minute
const DEBOUNCE_MS = 2_000;        // send own changes 2 s after the last edit

let status = { kind: 'idle', message: '', at: storage.loadLastSync() };
let running = null;
let debounceTimer = null;
const listeners = new Set();

export const getStatus = () => status;

export function onStatus(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function setStatus(kind, message = '') {
  status = { ...status, kind, message };
  for (const fn of listeners) fn(status);
}

export function isConfigured() {
  const d = state.getDevice();
  return Boolean(d.syncUrl && d.syncKey);
}

/**
 * Talk to an Apps Script web app (apps-script/Code.gs). Also used by the
 * private Rentals sync, which has its own Sheet, URL and key.
 */
export async function postToSheet(url, key, body) {
  // text/plain avoids a CORS "preflight" request, which Apps Script cannot answer.
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ ...body, key }),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`The Sheet answered with HTTP ${res.status}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'The Sheet refused the request');
  return data;
}

function call(body) {
  const d = state.getDevice();
  return postToSheet(d.syncUrl, d.syncKey, body);
}

/** Sync now. Safe to call often: overlapping calls share one run. */
export function syncNow() {
  if (!isConfigured()) {
    setStatus('off');
    return Promise.resolve(false);
  }
  if (running) return running;
  running = (async () => {
    if (!navigator.onLine) {
      setStatus('offline');
      return false;
    }
    setStatus('syncing');
    try {
      const sent = state.getDirtyRecords();
      const data = await call({ action: 'sync', since: storage.loadCursor(), records: sent });
      state.applyRemote(data.records || [], sent);
      storage.saveCursor(data.serverTime);
      status.at = new Date().toISOString();
      storage.saveLastSync(status.at);
      setStatus('ok');
      return true;
    } catch (err) {
      console.warn('Sync failed', err);
      setStatus('error', err.message);
      return false;
    } finally {
      running = null;
    }
  })();
  return running;
}

/** Quick check used by the settings screens before saving the details. */
export async function testConnection(url, key) {
  await postToSheet(url, key, { action: 'ping' });
  return true;
}

/** Start background syncing: after edits, every minute, and when the app comes back. */
export function startAutoSync() {
  state.subscribe(() => {
    if (state.pendingCount() === 0 || !isConfigured()) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(syncNow, DEBOUNCE_MS);
  });
  setInterval(() => {
    if (document.visibilityState === 'visible') syncNow();
  }, AUTO_INTERVAL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncNow();
  });
  window.addEventListener('online', syncNow);
  window.addEventListener('offline', () => setStatus('offline'));
  syncNow();
}
