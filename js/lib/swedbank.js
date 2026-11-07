// Reading Swedbank account statements (CSV), from Swedbank Estonia and Swedbank Sweden.
// Pure functions: no DOM, no storage, so they can be tested on their own.
//
// Estonia (internet bank → Konto väljavõte → CSV), semicolon-separated:
//   "Kliendi konto";"Reatüüp";"Kuupäev";"Saaja/Maksja";"Selgitus";"Summa";"Valuuta";"Deebet/Kreedit";
//   "Arhiveerimistunnus";"Tehingu tüüp";"Viitenumber";"Dokumendi number"
//   Row type 10 = opening balance, 20 = transaction, 82 = turnover, 86 = closing balance.
//   Amounts are positive with "D" (money out) or "K" (money in); dates 31.10.2026; comma decimals.
//   The English internet bank writes the same columns in English ("Client account", "Row type", …).
//
// Sweden (internet bank → Transaktioner → Exportera), comma-separated, usually with a title line first:
//   Radnummer,Clearingnummer,Kontonummer,Produkt,Valuta,Bokföringsdag,Transaktionsdag,Valutadag,
//   Referens,Beskrivning,Belopp,Bokfört saldo
//   Amounts are signed (−150.00 = money out); dates 2026-10-31.
//
// Column names are matched loosely (either language, any order), so small layout
// changes don't break the import.

import { parseCsv, parseDateTime, parseAmount, transactionKey } from './revolut.js';

/**
 * Turn the file's bytes into text. Swedbank's files are UTF-8, or the old
 * Windows encodings (1257 for Estonian letters like š ž, 1252 for Swedish).
 */
export function decodeStatement(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    const western = new TextDecoder('windows-1252').decode(bytes);
    return /Kliendi konto|Reat/i.test(western) ? new TextDecoder('windows-1257').decode(bytes) : western;
  }
}

const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');

// Column aliases, written the way norm() sees them (lowercase letters only, no accents).
const EE = {
  account: ['kliendikonto', 'clientaccount', 'klientskijschet'],
  rowType: ['reatuup', 'rowtype'],
  date: ['kuupaev', 'date'],
  party: ['saajamaksja', 'beneficiarypayer', 'payerbeneficiary'],
  details: ['selgitus', 'details', 'description'],
  amount: ['summa', 'amount'],
  currency: ['valuuta', 'currency'],
  dc: ['deebetkreedit', 'debitcredit'],
  archive: ['arhiveerimistunnus', 'archiveid', 'archivingcode'],
  ref: ['viitenumber', 'referencenumber'],
};
const SE = {
  row: ['radnummer', 'rownumber'],
  clearing: ['clearingnummer', 'clearingnumber'],
  account: ['kontonummer', 'accountnumber'],
  product: ['produkt', 'product'],
  currency: ['valuta', 'currency'],
  booked: ['bokforingsdag', 'bookingday', 'bookingdate'],
  date: ['transaktionsdag', 'transactionday', 'transactiondate'],
  ref: ['referens', 'reference'],
  details: ['beskrivning', 'description'],
  amount: ['belopp', 'amount'],
  balance: ['bokfortsaldo', 'bookedbalance'],
};

/** Positions of the columns in a header row: { name: index }, or null if a needed one is missing. */
function columns(header, aliases, needed) {
  const names = header.map(norm);
  const pos = {};
  for (const [key, list] of Object.entries(aliases)) {
    const i = names.findIndex((n) => list.includes(n));
    if (i !== -1) pos[key] = i;
  }
  return needed.every((k) => pos[k] !== undefined) ? pos : null;
}

/**
 * Read a Swedbank statement.
 * Returns { bank: 'ee'|'se', account, currency, transactions, balance, skipped } where
 *   transactions: [{ key, date, amount (cents, − = out), currency, party, details, ref }]
 *   balance: { amount, date } (closing balance shown in the statement) or null
 * Throws an Error with a readable message when the file isn't a Swedbank statement.
 */
export function parseSwedbank(text) {
  const rows = parseCsv(text);
  for (let h = 0; h < Math.min(rows.length, 10); h++) {
    const ee = columns(rows[h], EE, ['rowType', 'date', 'amount', 'dc']);
    if (ee) return readEstonia(rows.slice(h + 1), ee);
    const se = columns(rows[h], SE, ['booked', 'amount', 'details']);
    if (se) return readSweden(rows.slice(h + 1), se);
  }
  throw new Error('This doesn\'t look like a Swedbank statement (CSV). In the internet bank, export the account statement as CSV.');
}

const cell = (row, i) => (i === undefined ? '' : (row[i] || '').trim());

function readEstonia(rows, c) {
  const transactions = [];
  let balance = null;
  let account = '';
  let currency = '';
  let skipped = 0;
  for (const row of rows) {
    const type = cell(row, c.rowType);
    const d = parseDateTime(cell(row, c.date));
    const raw = parseAmount(cell(row, c.amount));
    if (!account) account = cell(row, c.account);
    const cur = cell(row, c.currency) || 'EUR';
    if (!currency && cur) currency = cur;
    if (!d || raw === null) {
      if (type) skipped++;
      continue;
    }
    const sign = cell(row, c.dc).toUpperCase().startsWith('D') ? -1 : 1;
    const amount = Math.abs(raw) * sign;
    if (type === '86') {
      balance = { amount, date: d.date }; // closing balance ("Lõppsaldo")
    } else if (type === '20') {
      const archive = cell(row, c.archive);
      transactions.push({
        key: archive ? `ee:${archive}` : `ee:${transactionKey([account, d.date, String(amount), cell(row, c.party), cell(row, c.details)])}`,
        date: d.date, amount, currency: cur,
        party: cell(row, c.party), details: cell(row, c.details), ref: cell(row, c.ref),
      });
    }
  }
  return { bank: 'ee', account, currency: currency || 'EUR', transactions, balance, skipped };
}

function readSweden(rows, c) {
  const transactions = [];
  let latest = null; // row with the newest booking day → its booked balance is the current balance
  let account = '';
  let currency = '';
  let skipped = 0;
  for (const row of rows) {
    const booked = parseDateTime(cell(row, c.booked));
    const amount = parseAmount(cell(row, c.amount));
    if (!booked || amount === null) {
      skipped++;
      continue;
    }
    const date = (parseDateTime(cell(row, c.date)) || booked).date;
    if (!account) account = [cell(row, c.clearing), cell(row, c.account)].filter(Boolean).join('-');
    const cur = cell(row, c.currency) || 'SEK';
    if (!currency) currency = cur;
    const saldo = c.balance === undefined ? null : parseAmount(cell(row, c.balance));
    const rowNo = Number(cell(row, c.row)) || 0;
    // Newest booking day wins; on the same day the lowest row number (Swedbank lists newest first).
    if (saldo !== null && (!latest || booked.date > latest.date || (booked.date === latest.date && rowNo < latest.rowNo))) {
      latest = { date: booked.date, amount: saldo, rowNo };
    }
    transactions.push({
      key: `se:${transactionKey([account, booked.date, date, String(amount), cell(row, c.details), cell(row, c.ref), String(saldo)])}`,
      date, amount, currency: cur,
      party: cell(row, c.details), details: cell(row, c.ref), ref: '',
    });
  }
  return {
    bank: 'se', account, currency: currency || 'SEK', transactions,
    balance: latest ? { amount: latest.amount, date: latest.date } : null, skipped,
  };
}
