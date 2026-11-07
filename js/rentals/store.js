// Rentals data: Tõnis's own accounts (Swedbank Estonia and Sweden) and the
// rental apartments' income and costs. The only place that changes this data.
//
// Kept apart from the household data on purpose: its own records in this
// browser ("hr.*" keys) and its own private Google Sheet, so none of it ever
// goes into the shared household Sheet.
//
// Records (all have id, type, updatedAt, deleted):
//   rsettings  id 'rsettings': { apartments: { a, b }, share (your %), rates: { year: SEK per EUR } }
//   racct      a bank account: { bank: 'ee'|'se', number, name, currency, balance, balanceDate }
//   rtx        one transaction: { accountId, date, amount, currency, party, details, apartment, category, source }
//              apartment null = not sorted yet (see lib/rentals.js)
//   rpayee     remembered choice for a payee: { apartment, category }
//   rbill      a recurring payment (see lib/rentals.js)
//   rpaid      a bill's payment marked as paid by hand: { billId, due }

import { mergeRecords } from '../lib/merge.js';
import { payeeKey, defaultCategory } from '../lib/rentals.js';
import { transactionKey } from '../lib/revolut.js';

const KEYS = {
  records: 'hr.records',
  dirty: 'hr.dirty',
  cursor: 'hr.cursor',
  lastSync: 'hr.lastSync',
  device: 'hr.device', // { syncUrl, syncKey } of the private Sheet: this device only
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.error('Could not save rentals data on this device', err);
  }
}

let records = read(KEYS.records, {});
let dirty = new Set(read(KEYS.dirty, []));
let device = { syncUrl: '', syncKey: '', ...read(KEYS.device, {}) };
const listeners = new Set();
const undoStack = [];
const redoStack = [];

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  for (const fn of listeners) fn();
}

function save() {
  write(KEYS.records, records);
  write(KEYS.dirty, [...dirty]);
}

let lastStamp = '';
function stamp() {
  let now = new Date().toISOString();
  if (now <= lastStamp) now = new Date(Date.parse(lastStamp) + 1).toISOString();
  lastStamp = now;
  return now;
}

export const newId = (prefix) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

// ---------- device settings (private Sheet) ----------

export const getDevice = () => device;
export function setDevice(changes) {
  device = { ...device, ...changes };
  write(KEYS.device, device);
  notify();
}
export const loadCursor = () => read(KEYS.cursor, '');
export const saveCursor = (c) => write(KEYS.cursor, c);
export const loadLastSync = () => read(KEYS.lastSync, '');
export const saveLastSync = (iso) => write(KEYS.lastSync, iso);

// ---------- changing data ----------

function commit(list, { recordUndo = true } = {}) {
  if (!list.length) return [];
  const before = list.map((r) => records[r.id] || null);
  const after = list.map((rec) => {
    const full = { ...rec, updatedAt: stamp(), by: 't' };
    records[full.id] = full;
    dirty.add(full.id);
    return full;
  });
  if (recordUndo) {
    undoStack.push({ before, after });
    if (undoStack.length > 50) undoStack.shift();
    redoStack.length = 0;
  }
  save();
  notify();
  return after;
}

/** Create or update records (merged into what is there). One call = one undo step. */
export function put(...changes) {
  return commit(changes.map((c) => ({ ...(records[c.id] || {}), ...c, deleted: false })));
}

export function remove(...ids) {
  return commit(ids.filter((id) => records[id]).map((id) => ({ ...records[id], deleted: true })));
}

export function undo() {
  const step = undoStack.pop();
  if (!step) return false;
  commit(step.before.map((old, i) => (old ? { ...old } : { ...step.after[i], deleted: true })), { recordUndo: false });
  redoStack.push(step);
  return true;
}

export function redo() {
  const step = redoStack.pop();
  if (!step) return false;
  commit(step.after.map((r) => ({ ...r })), { recordUndo: false });
  undoStack.push(step);
  return true;
}

// ---------- sync support ----------

export const getDirtyRecords = () => [...dirty].map((id) => records[id]).filter(Boolean);
export const pendingCount = () => dirty.size;

/** Merge records from the private Sheet; changes made here since sending stay waiting. */
export function applyRemote(incoming, sent) {
  const sentStamp = new Map(sent.map((r) => [r.id, r.updatedAt]));
  for (const id of [...dirty]) {
    if (sentStamp.has(id) && records[id] && records[id].updatedAt === sentStamp.get(id)) dirty.delete(id);
  }
  const merged = mergeRecords(records, incoming);
  records = merged.records;
  save();
  if (merged.changedIds.length || sent.length) notify();
}

/** Remove the rentals data from this device (the private Sheet keeps it). */
export function clearDevice() {
  for (const key of Object.values(KEYS)) localStorage.removeItem(key);
  records = {};
  dirty = new Set();
  device = { syncUrl: '', syncKey: '' };
  notify();
}

// ---------- reading ----------

const live = (type) => Object.values(records).filter((r) => r.type === type && !r.deleted);
export const get = (id) => (records[id] && !records[id].deleted ? records[id] : null);
export const hasData = () => Object.values(records).some((r) => !r.deleted && r.type !== 'rsettings');

export function getSettings() {
  const s = get('rsettings') || {};
  return {
    apartments: { a: 'Apartment 1', b: 'Apartment 2', ...(s.apartments || {}) },
    share: s.share ?? 50,
    rates: s.rates || {},
  };
}

export const saveSettings = (changes) => put({ id: 'rsettings', type: 'rsettings', ...getSettings(), ...changes });

export const getAccounts = () => live('racct').sort((a, b) => (a.bank + a.name).localeCompare(b.bank + b.name));

/** All transactions, newest first. */
export const getTransactions = () => live('rtx').sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
/** Date of the oldest transaction ('' when none): payments before it can't be checked. */
export const firstDate = () => getTransactions().reduce((min, t) => (!min || t.date < min ? t.date : min), '');
export const getUnsorted = () => getTransactions().filter((t) => !t.apartment);
export const getSorted = () => getTransactions().filter((t) => t.apartment);

export const getBills = () => live('rbill').sort((a, b) => a.name.localeCompare(b.name));
export const getPaidMarks = () => new Set(live('rpaid').map((r) => `${r.billId}|${r.due}`));

/** Remembered choice for this payee: { apartment, category } or null. */
export function suggestionFor(tx) {
  const key = payeeKey(tx.party);
  if (!key) return null;
  const r = get(`rpayee:${key}`);
  if (!r) return null;
  // A remembered "rent" for money going out makes no sense: fall back to a cost.
  const category = r.apartment === 'none' ? null
    : (tx.amount < 0 && r.category === 'rent') ? defaultCategory(tx.amount) : r.category;
  return { apartment: r.apartment, category };
}

// ---------- importing and sorting ----------

const accountId = (bank, number) => `racct:${bank}:${transactionKey([number || 'unknown'])}`;

/**
 * Add a parsed Swedbank statement (lib/swedbank.js). Transactions already here are skipped.
 * The account's balance is updated when the statement's closing balance is newer.
 * Returns { added, duplicates, account }.
 */
export function importStatement(st) {
  const id = accountId(st.bank, st.account);
  const old = get(id);
  const changes = [];
  const acct = {
    id, type: 'racct', bank: st.bank, number: st.account, currency: st.currency,
    name: old?.name || (st.bank === 'ee' ? 'Swedbank Estonia' : 'Swedbank Sweden'),
    balance: old?.balance ?? null, balanceDate: old?.balanceDate ?? '',
  };
  if (st.balance && (!old || !old.balanceDate || st.balance.date >= old.balanceDate)) {
    acct.balance = st.balance.amount;
    acct.balanceDate = st.balance.date;
  }
  changes.push(acct);
  let added = 0;
  let duplicates = 0;
  for (const t of st.transactions) {
    const txId = `rtx:${t.key}`;
    if (records[txId]) { // also when deleted: don't bring back a line removed on purpose
      duplicates++;
      continue;
    }
    changes.push({
      id: txId, type: 'rtx', month: t.date.slice(0, 7), accountId: id, date: t.date, amount: t.amount,
      currency: t.currency || st.currency, party: t.party, details: t.details,
      apartment: null, category: null, source: 'import',
    });
    added++;
  }
  put(...changes);
  return { added, duplicates, account: acct };
}

/** Sort one transaction; remember the choice for its payee (unless remember is false). */
export function sortTx(id, apartment, category, { remember = true } = {}) {
  const tx = get(id);
  if (!tx) return;
  const changes = [{ id, apartment, category: apartment === 'none' ? null : category }];
  const key = payeeKey(tx.party);
  if (remember && key) changes.push({ id: `rpayee:${key}`, type: 'rpayee', apartment, category: apartment === 'none' ? null : category });
  put(...changes);
}

/** Sort every unsorted line that has a remembered choice. Returns how many. */
export function acceptSuggestions() {
  const changes = [];
  for (const tx of getUnsorted()) {
    const s = suggestionFor(tx);
    if (s) changes.push({ id: tx.id, apartment: s.apartment, category: s.category });
  }
  if (changes.length) put(...changes);
  return changes.length;
}

/** A transaction typed in by hand (cash, or an account without CSV export). */
export function addManual({ accountId: acct, date, amount, currency, party, apartment, category }) {
  return put({
    id: newId('rtx'), type: 'rtx', month: date.slice(0, 7), accountId: acct || null, date, amount, currency,
    party, details: '', apartment, category: apartment === 'none' ? null : category, source: 'manual',
  })[0];
}

/** Mark a bill's payment as paid (from somewhere else), or take the mark back. */
export function markPaid(billId, due, paid) {
  const id = `rpaid:${billId}|${due}`;
  if (paid) put({ id, type: 'rpaid', billId, due });
  else remove(id);
}
