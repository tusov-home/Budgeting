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
//   rtx        one transaction: { accountId, date, amount, currency, party, details, ref, apartment, category, source,
//              parts? } — parts: [{ category, amount }] when one payment is split (e.g. rent + utilities)
//              apartment null = not sorted yet (see lib/rentals.js)
//   rpayee     remembered choice: { apartment, category }, per payee ("rpayee:<payee>") and
//              per payee + exact description ("rpayee:d:<payee>|<description>"), which wins when both exist.
//              A payee sorted to different apartments gets mixed: true and suggests nothing on its own.
//   rrule      your own rule: lines whose payee, description or reference contain `text`
//              go to { apartment, category }. Rules win over everything else.
//   Remembered choices and rules can carry split: { firstAmount, category2 }: the first part
//   (e.g. the usual rent) goes to `category`, the rest to category2.
//   rbill      a recurring payment (see lib/rentals.js)
//   rpaid      a bill's payment marked as paid by hand: { billId, due }

import { mergeRecords } from '../lib/merge.js';
import { payeeKey, detailsKey, defaultCategory, ruleFor, matchText, makeParts } from '../lib/rentals.js';
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

export const getRules = () => live('rrule').sort((a, b) => a.text.localeCompare(b.text));

/**
 * Suggested choice for this line: { apartment, category, source, rule } or null. In this order:
 *   1. your rule whose text is in the payee, description or reference ("rule")
 *   2. the same payee + exact description as before ("description"), e.g. a loan's interest line
 *   3. the payee's last choice ("payee"), unless that payee went to different apartments
 */
export function suggestionFor(tx) {
  const rule = ruleFor(tx, getRules());
  let r = rule;
  let source = 'rule';
  if (!r) {
    const dKey = detailsKey(tx.party, tx.details);
    r = dKey && get(`rpayee:d:${dKey}`);
    source = 'description';
  }
  if (!r) {
    const pKey = payeeKey(tx.party);
    const p = pKey && get(`rpayee:${pKey}`);
    r = p && !p.mixed ? p : null;
    source = 'payee';
  }
  if (!r) return null;
  // A remembered "rent" for money going out makes no sense: fall back to a cost.
  const category = r.apartment === 'none' ? null
    : (tx.amount < 0 && r.category === 'rent') ? defaultCategory(tx.amount) : r.category;
  return { apartment: r.apartment, category, source, rule: rule || null, split: r.apartment === 'none' ? null : r.split || null };
}

/** Lines of this payee were sorted to more than one apartment (so the payee alone says nothing). */
export function payeeIsMixed(tx) {
  const p = get(`rpayee:${payeeKey(tx.party)}`);
  return Boolean(p && p.mixed);
}

export const removeRule = (id) => remove(id);

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
      // Lines imported before reference numbers were kept: add it now (rules can use it).
      if (!records[txId].deleted && t.ref && !records[txId].ref) changes.push({ id: txId, ref: t.ref });
      continue;
    }
    changes.push({
      id: txId, type: 'rtx', month: t.date.slice(0, 7), accountId: id, date: t.date, amount: t.amount,
      currency: t.currency || st.currency, party: t.party, details: t.details, ref: t.ref || '',
      apartment: null, category: null, source: 'import',
    });
    added++;
  }
  put(...changes);
  return { added, duplicates, account: acct };
}

/**
 * Sort one transaction and remember the choice:
 *   remember: 'payee' (payee + exact description) | 'text' (a rule for ruleText) | false
 * The payee memory notices when one payee goes to different apartments (mixed).
 */
export function sortTx(id, apartment, category, { remember = 'payee', ruleText = '', split = null } = {}) {
  const tx = get(id);
  if (!tx) return;
  const cat = apartment === 'none' ? null : category;
  // split: { firstAmount, category2 } → two parts; remembered too, so next month suggests the same split.
  const parts = cat && split ? makeParts(tx.amount, cat, split.firstAmount, split.category2) : null;
  const keep = parts ? split : null;
  const changes = [{ id, apartment, category: cat, parts }];
  if (remember) {
    const pKey = payeeKey(tx.party);
    const dKey = detailsKey(tx.party, tx.details);
    if (pKey) {
      const old = get(`rpayee:${pKey}`);
      const mixed = Boolean(old && (old.mixed || (old.apartment !== apartment && apartment !== 'none' && old.apartment !== 'none')));
      changes.push({ id: `rpayee:${pKey}`, type: 'rpayee', apartment, category: cat, mixed, split: keep });
    }
    if (dKey) changes.push({ id: `rpayee:d:${dKey}`, type: 'rpayee', apartment, category: cat, split: keep });
  }
  const text = matchText(ruleText);
  if (remember === 'text' && text) {
    changes.push({ id: `rrule:${text}`, type: 'rrule', text: ruleText.trim(), apartment, category: cat, split: keep });
  }
  put(...changes);
}

/** Sort every unsorted line that has a remembered choice. Returns how many. */
export function acceptSuggestions() {
  const changes = [];
  for (const tx of getUnsorted()) {
    const s = suggestionFor(tx);
    if (s) changes.push(suggestedChange(tx, s));
  }
  if (changes.length) put(...changes);
  return changes.length;
}

/** The change that applies a suggestion, with its split when the amount allows it. */
function suggestedChange(tx, s) {
  const parts = s.split && s.category ? makeParts(tx.amount, s.category, s.split.firstAmount, s.split.category2) : null;
  return { id: tx.id, apartment: s.apartment, category: s.category, parts };
}

/** Accept the suggestion for one line (the ✓ button). */
export function acceptSuggestion(id) {
  const tx = get(id);
  const s = tx && suggestionFor(tx);
  if (!s) return null;
  put(suggestedChange(tx, s));
  return s;
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
