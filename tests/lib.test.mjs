// Unit tests for the pure logic in js/lib.
// Run with:  node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseCents, formatCents, centsToInput } from '../js/lib/money.js';
import { addMonths, monthsBetween, daysInMonth, daysElapsed } from '../js/lib/months.js';
import { spreadSharesForMonth, monthPlan, spentSoFar, walletPace, walletStartBalance, lastBalance } from '../js/lib/budget.js';
import { mergeRecords } from '../js/lib/merge.js';
import { parseCsv, parseRevolut, merchantKey, parseDateTime, parseAmount, repairEncoding } from '../js/lib/revolut.js';
import { readFileSync } from 'node:fs';
import { walletSpent, budgetFingerprint, lockDecision } from '../js/lib/budget.js';

test('parseCents understands German and English number styles', () => {
  assert.equal(parseCents('12,30'), 1230);
  assert.equal(parseCents('12.30'), 1230);
  assert.equal(parseCents('1.234,56'), 123456);
  assert.equal(parseCents('1,234.56'), 123456);
  assert.equal(parseCents('950'), 95000);
  assert.equal(parseCents(' 7,5 € '), 750);
  assert.equal(parseCents('-5'), -500);
  assert.equal(parseCents('abc'), null);
  assert.equal(parseCents(''), null);
});

test('formatting', () => {
  assert.equal(formatCents(123456).replace(/\s/g, ' '), '1.234,56 €');
  assert.equal(centsToInput(1230), '12,30');
});

test('month helpers', () => {
  assert.equal(addMonths('2026-10', 3), '2027-01');
  assert.equal(addMonths('2026-01', -1), '2025-12');
  assert.equal(monthsBetween('2026-10', '2027-01'), 3);
  assert.equal(daysInMonth('2026-02'), 28);
  assert.equal(daysInMonth('2028-02'), 29);
  assert.equal(daysElapsed('2026-10', '2026-10-31'), 31);
  assert.equal(daysElapsed('2026-10', '2026-10-03'), 3);
  assert.equal(daysElapsed('2026-09', '2026-10-03'), 30);
  assert.equal(daysElapsed('2026-11', '2026-10-03'), 0);
});

test('one-off big cost is spread exactly, remainder in last month', () => {
  const spreads = [{ id: 'a', name: 'Washer', kind: 'oneoff', amount: 10000, months: 3, start: '2026-10', payer: 't' }];
  const shares = ['2026-09', '2026-10', '2026-11', '2026-12', '2027-01']
    .map((m) => spreadSharesForMonth(spreads, m));
  assert.equal(shares[0].length, 0);
  assert.deepEqual(shares.slice(1, 4).map((s) => s[0].amount), [3333, 3333, 3334]);
  assert.equal(shares[4].length, 0);
});

test('periodic bill sets aside amount / period every month', () => {
  const spreads = [{ id: 'b', name: 'Insurance', kind: 'periodic', amount: 36000, period: 12, start: '2026-01', payer: 'k' }];
  assert.equal(spreadSharesForMonth(spreads, '2026-10')[0].amount, 3000);
  assert.equal(spreadSharesForMonth(spreads, '2025-12').length, 0);
  const ended = [{ ...spreads[0], end: '2026-06' }];
  assert.equal(spreadSharesForMonth(ended, '2026-07').length, 0);
});

test('month plan: leftover of both salaries is split evenly, deposits fill the wallet', () => {
  const plan = monthPlan({
    fixed: [
      { amount: 100000, payer: 'k' }, // rent, Kristiina pays
      { amount: 5000, payer: 't' },   // Tõnis pays
    ],
    spreadShares: [{ amount: 3000, payer: 't' }],
    walletBudget: 80000,
    incomes: { t: 300000, k: 250000 },
  });
  assert.equal(plan.householdTotal, 188000);
  assert.equal(plan.leftover, 362000);              // 5500 − 1880
  assert.deepEqual(plan.privateMoney, { t: 181000, k: 181000 });
  // Tõnis: 3000 − 80 own costs − 1810 private = 1110 into the wallet
  // Kristiina: 2500 − 1000 rent − 1810 private = −310 → gets 310 back
  assert.deepEqual(plan.deposit, { t: 111000, k: -31000 });
  assert.equal(plan.walletIn, 80000);
  assert.ok(plan.hasIncomes);
});

test('month plan: costs paid from the wallet raise the deposits', () => {
  const plan = monthPlan({ fixed: [{ amount: 2000, payer: 'wallet' }], spreadShares: [], walletBudget: 10000, incomes: { t: 50000, k: 50000 } });
  assert.equal(plan.walletIn, 12000);
  assert.equal(plan.deposit.t + plan.deposit.k, 12000);
});

test('odd cents: private halves add up exactly', () => {
  const plan = monthPlan({ fixed: [], spreadShares: [], walletBudget: 0, incomes: { t: 10001, k: 0 } });
  assert.equal(plan.privateMoney.t + plan.privateMoney.k, 10001);
  assert.equal(plan.hasIncomes, false);
});

test('balance check-ins: spent = start − balance; a second check-in replaces the first', () => {
  const checkins = [
    { date: '2026-10-07', createdAt: 'a', balance: 70000 },
    { date: '2026-10-14', createdAt: 'b', balance: 52000 },
  ];
  assert.equal(spentSoFar(checkins, 93000).spent, 41000);
  assert.equal(spentSoFar([], 93000).spent, 0);
});

test('top-ups raise the balance without counting as negative spending', () => {
  const checkins = [{ date: '2026-10-20', createdAt: 'b', balance: 30000 }];
  const topups = [
    { date: '2026-10-15', createdAt: 'x', amount: 10000 }, // before the check-in → counted
    { date: '2026-10-25', createdAt: 'y', amount: 5000 },  // after → only for later check-ins
  ];
  // start 93000 + 10000 added − 30000 balance = 73000 spent
  assert.equal(spentSoFar(checkins, 93000, topups).spent, 73000);
});

test('carry-over source: balance of the last check-in', () => {
  assert.deepEqual(lastBalance([
    { date: '2026-09-30', createdAt: 'b', balance: 4200 },
    { date: '2026-09-23', createdAt: 'a', balance: 20000 },
    { date: '2026-09-10', createdAt: 'c', spent: 100 },
  ]), { balance: 4200, date: '2026-09-30' });
  assert.equal(lastBalance([]), null);
});

test('wallet start: deposits + carry-over − paid wallet costs', () => {
  const fixed = [{ amount: 2000, payer: 'wallet', paid: true }, { amount: 500, payer: 'wallet', paid: false }];
  const plan = monthPlan({ fixed, spreadShares: [], walletBudget: 10000, incomes: { t: 50000, k: 50000 } });
  assert.equal(plan.walletIn, 12500);
  assert.equal(walletStartBalance({ plan, carryOver: 3000, fixed }), 12500 + 3000 - 2000);
});

test('wallet pace matches the sheet logic', () => {
  const p = walletPace({ budget: 93000, spent: 87039, monthKey: '2026-10', todayKey: '2026-10-31' });
  assert.equal(p.dailyBudget, 3000);
  assert.equal(p.weeklyBudget, 21000);
  assert.equal(Math.round(p.pace * 10000) / 100, 93.59);
  assert.equal(p.aheadBy, 5961);
});

test('merge: newer wins, older ignored', () => {
  const local = { a: { id: 'a', updatedAt: '2026-10-02', v: 1 } };
  const { records, changedIds } = mergeRecords(local, [
    { id: 'a', updatedAt: '2026-10-01', v: 0 },
    { id: 'b', updatedAt: '2026-10-01', v: 5 },
  ]);
  assert.equal(records.a.v, 1);
  assert.equal(records.b.v, 5);
  assert.deepEqual(changedIds, ['b']);
});

// ---------- Revolut import (made-up data) ----------

const REVOLUT_CSV = [
  'Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance',
  'CARD_PAYMENT,Current,2026-10-26 09:12:01,2026-10-27 10:00:00,Lidl 4521 Berlin,-23.45,0.00,EUR,COMPLETED,812.10',
  'CARD_PAYMENT,Current,2026-10-26 18:40:00,2026-10-27 10:00:00,"Bäckerei Schmidt, Mitte",-4.80,0.00,EUR,COMPLETED,807.30',
  'TOPUP,Current,2026-10-27 08:00:00,2026-10-27 08:00:01,Salary,2500.00,0.00,EUR,COMPLETED,3307.30',
  'EXCHANGE,Current,2026-10-27 09:00:00,2026-10-27 09:00:01,Exchanged to SEK,-50.00,0.00,EUR,COMPLETED,3257.30',
  'CARD_PAYMENT,Current,2026-10-28 12:00:00,,Rewe Markt GmbH,-31.20,0.00,EUR,PENDING,',
  'TRANSFER,Savings,2026-10-28 13:00:00,2026-10-28 13:00:01,To pocket Common,-100.00,0.00,EUR,COMPLETED,0',
  'CARD_PAYMENT,Current,2026-10-29 19:05:00,2026-10-30 10:00:00,Foreign shop,-10.00,0.35,EUR,COMPLETED,3247.30',
].join('\n');

test('Revolut CSV: keeps finished outgoing payments of the main account only', () => {
  const r = parseRevolut(REVOLUT_CSV);
  assert.equal(r.error, null);
  assert.deepEqual(r.transactions.map((t) => t.description), ['Lidl 4521 Berlin', 'Bäckerei Schmidt, Mitte', 'Foreign shop']);
  assert.deepEqual(r.transactions.map((t) => t.amount), [2345, 480, 1035]); // fee included
  assert.equal(r.transactions[0].date, '2026-10-26');
  assert.equal(r.skipped, 4);
});

test('Revolut CSV: the same transaction always gets the same key (no double import)', () => {
  const a = parseRevolut(REVOLUT_CSV).transactions.map((t) => t.key);
  const b = parseRevolut(REVOLUT_CSV).transactions.map((t) => t.key);
  assert.deepEqual(a, b);
  assert.equal(new Set(a).size, a.length);
});

test('Revolut CSV: German headers and semicolons work too', () => {
  const de = 'Typ;Produkt;Startdatum;Abschlussdatum;Beschreibung;Betrag;Gebühr;Währung;Status;Saldo\n'
    + 'CARD_PAYMENT;Aktuell;28.10.2026 10:00;28.10.2026 11:00;Edeka;-12,30;0,00;EUR;ABGESCHLOSSEN;100,00';
  const r = parseRevolut(de);
  assert.equal(r.error, null);
  assert.equal(r.transactions[0].amount, 1230);
  assert.equal(r.transactions[0].date, '2026-10-28');
});

test('Revolut CSV: a wrong file gives a clear error', () => {
  assert.match(parseRevolut('name,age\nTom,3').error, /No transaction list found/);
});

test('Custom statement from the app: finds the EUR section after a long introduction', () => {
  const text = readFileSync(new URL('./fixtures/revolut-custom-statement.csv', import.meta.url), 'utf8');
  const r = parseRevolut(text);
  assert.equal(r.error, null);
  assert.deepEqual(r.transactions.map((t) => t.description), ['Lidl 4521 Berlin', 'Bäckerei Schmidt, Mitte', 'Bio Hofladen Erde']);
  assert.deepEqual(r.transactions.map((t) => t.amount), [2345, 480, 1035]);
  assert.equal(r.transactions[0].date, '2026-10-26');
  assert.equal(r.transactions[0].category, 'Groceries');
  assert.deepEqual(r.otherCurrency, { SEK: 2 }); // SEK payments left out and reported
});

test('dates and amounts in the forms Revolut uses', () => {
  for (const [text, date] of [['Oct 28, 2026', '2026-10-28'], ['28 Oct 2026', '2026-10-28'], ['28 Okt. 2026', '2026-10-28'],
    ['28/10/2026', '2026-10-28'], ['2026-10-28 14:00:00', '2026-10-28'], ['Mai 3, 2026', '2026-05-03']]) {
    assert.equal(parseDateTime(text).date, date, text);
  }
  assert.equal(parseDateTime('Total'), null);
  assert.equal(parseAmount('-€23.45'), -2345);
  assert.equal(parseAmount('−23,45 €'), -2345);
  assert.equal(parseAmount('SEK -1,234.00'), -123400);
  assert.equal(parseAmount('(10.00)'), -1000);
  assert.equal(parseAmount('+2,500.00'), 250000);
  assert.equal(parseAmount(''), null);
});

test('the same purchase gets the same key in both export formats', () => {
  const plain = parseRevolut(readFileSync(new URL('./fixtures/revolut-week1.csv', import.meta.url), 'utf8')).transactions.map((t) => t.key);
  const custom = parseRevolut(readFileSync(new URL('./fixtures/revolut-custom-statement.csv', import.meta.url), 'utf8')).transactions.map((t) => t.key);
  assert.deepEqual(custom, plain);
});

test('two identical purchases on one day are both kept', () => {
  const text = 'Date,Description,Money in/out\n"Oct 28, 2026",Coffee,-3.00\n"Oct 28, 2026",Coffee,-3.00';
  const keys = parseRevolut(text).transactions.map((t) => t.key);
  assert.equal(keys.length, 2);
  assert.notEqual(keys[0], keys[1]);
});

test('Custom statement with semicolons and German decimals', () => {
  const text = 'Kontoauszug\nKonto;EUR\nTransaction statement\nDate;Description;Category;Money in/out;Balance;Fees\n'
    + '28.10.2026;Edeka;Groceries;-12,30 €;100,00;0,00';
  const r = parseRevolut(text);
  assert.equal(r.error, null);
  assert.equal(r.transactions[0].amount, 1230);
});

test('CSV parsing handles quotes', () => {
  assert.deepEqual(parseCsv('a,b\n"x, y","say ""hi"""'), [['a', 'b'], ['x, y', 'say "hi"']]);
  assert.deepEqual(parseDateTime('2026-10-28 14:23:11'), { date: '2026-10-28', time: '14:23:11' });
});

test('merchant key ignores store numbers and city noise', () => {
  assert.equal(merchantKey('LIDL 4521 Berlin'), 'lidl berlin');
  assert.equal(merchantKey('Lidl 1100 Berlin'), 'lidl berlin');
  assert.equal(merchantKey('Rewe Markt GmbH*123'), 'rewe markt gmbh');
});

// ---------- spending with common purchases ----------

const ck = (date, createdAt, balance) => ({ date, createdAt, balance });

test('common purchases count as spent before they are withdrawn', () => {
  const r = walletSpent({
    checkins: [ck('2026-10-20', '2026-10-20T10:00:00Z', 70000)], startBalance: 93000, monthKey: '2026-10',
    expenses: [{ id: 'e1', month: '2026-10', amount: 5000, settlementId: null }],
  });
  assert.equal(r.spent, 23000 + 5000);
  assert.equal(r.pending, 5000);
});

test('a withdrawal before the check-in is already in the balance (no double count)', () => {
  const settlements = [{ id: 's1', month: '2026-10', date: '2026-10-21', createdAt: '2026-10-21T09:00:00Z', parts: { '2026-10': 5000 } }];
  const expenses = [{ id: 'e1', month: '2026-10', amount: 5000, settlementId: 's1' }];
  // Balance dropped by the 50 € withdrawal: 70000 → 65000
  const r = walletSpent({ checkins: [ck('2026-10-22', '2026-10-22T10:00:00Z', 65000)], startBalance: 93000, expenses, settlements, monthKey: '2026-10' });
  assert.equal(r.spent, 28000);
  assert.equal(r.pending, 0);
});

test('a withdrawal after the check-in still counts the purchase', () => {
  const settlements = [{ id: 's1', month: '2026-10', date: '2026-10-25', createdAt: '2026-10-25T09:00:00Z', parts: { '2026-10': 5000 } }];
  const expenses = [{ id: 'e1', month: '2026-10', amount: 5000, settlementId: 's1' }];
  const r = walletSpent({ checkins: [ck('2026-10-22', '2026-10-22T10:00:00Z', 70000)], startBalance: 93000, expenses, settlements, monthKey: '2026-10' });
  assert.equal(r.spent, 28000);
});

test('withdrawing in November for October purchases does not count as November spending', () => {
  const settlements = [{ id: 's1', month: '2026-11', date: '2026-11-02', createdAt: '2026-11-02T09:00:00Z', parts: { '2026-10': 5000 } }];
  const expenses = [{ id: 'e1', month: '2026-10', amount: 5000, settlementId: 's1' }];
  // October: last check-in 31 Oct before the withdrawal → purchase counted in October
  const oct = walletSpent({ checkins: [ck('2026-10-31', '2026-10-31T20:00:00Z', 20000)], startBalance: 93000, expenses, settlements, monthKey: '2026-10' });
  assert.equal(oct.spent, 73000 + 5000);
  // November starts with the carried 200 €; balance after withdrawal and 100 € spending: 93000 + 20000 − 5000 − 10000
  const nov = walletSpent({ checkins: [ck('2026-11-05', '2026-11-05T10:00:00Z', 98000)], startBalance: 113000, expenses, settlements, monthKey: '2026-11' });
  assert.equal(nov.spent, 10000);
});

// ---------- garbled characters (as in a real Revolut custom statement) ----------

const REAL_LAYOUT = 'Transaction statement\nDate,Description,Category,Money in/out,Balance,Tax withheld,Other taxes,Fees,,,,,\n'
  + '"Oct 1, 2026",REWE.de,Merchant,-€33.94,"€3,841.75",€0.00,€0.00,€0.00,,,,,\n'
  + '"Oct 1, 2026",Bäckerei Zenvital,Merchant,-€4.00,"€3,837.75",€0.00,€0.00,€0.00,,,,,\n';

test('the real Revolut row layout imports (correct encoding)', () => {
  const r = parseRevolut(REAL_LAYOUT);
  assert.deepEqual(r.transactions.map((t) => [t.description, t.amount, t.date]),
    [['REWE.de', 3394, '2026-10-01'], ['Bäckerei Zenvital', 400, '2026-10-01']]);
});

test('garbled euro signs and umlauts are repaired (Latin-1 and Windows-1252 variants)', () => {
  const bytes = Buffer.from(REAL_LAYOUT, 'utf8');
  const latin1 = bytes.toString('latin1');                               // "-â\u0082¬33.94"
  const cp1252 = new TextDecoder('windows-1252').decode(bytes);          // "-â‚¬33.94"
  for (const garbled of [latin1, cp1252]) {
    assert.notEqual(garbled, REAL_LAYOUT);
    const r = parseRevolut(garbled);
    assert.deepEqual(r.transactions.map((t) => [t.description, t.amount]), [['REWE.de', 3394], ['Bäckerei Zenvital', 400]]);
  }
  assert.equal(repairEncoding('Lidl Berlin, -12.00'), 'Lidl Berlin, -12.00'); // fine text untouched
  assert.equal(repairEncoding('Café ŽŠ'), 'Café ŽŠ');                       // real accents untouched
});

test('a file mixing garbled and correct lines is repaired line by line', () => {
  const garbledLine = Buffer.from('"Oct 2, 2026",Café,Merchant,-€2.50,"€10.00",€0.00,€0.00,€0.00', 'utf8').toString('latin1');
  const text = 'Date,Description,Category,Money in/out,Balance,Tax withheld,Other taxes,Fees\n'
    + garbledLine + '\n"Oct 3, 2026",Žabka,Merchant,-€1.00,"€9.00",€0.00,€0.00,€0.00';
  assert.deepEqual(parseRevolut(text).transactions.map((t) => t.description), ['Café', 'Žabka']);
});

test('amounts with stray symbols still read', () => {
  assert.equal(parseAmount('-â¬33.94'), -3394);
  assert.equal(parseAmount('â¬3,841.75'), 384175);
});

// ---------- locking together ----------

const plan = { fixed: [{ name: 'Rent', amount: 100000, payer: 'k', paid: false }], incomes: { t: 300000, k: 250000 }, walletBudget: 90000, carryOver: 0, spreadShares: [] };

test('fingerprint changes with the agreed numbers, not with paid ticks', () => {
  const a = budgetFingerprint(plan);
  assert.equal(budgetFingerprint({ ...plan, fixed: [{ ...plan.fixed[0], paid: true }] }), a);
  assert.notEqual(budgetFingerprint({ ...plan, walletBudget: 95000 }), a);
  assert.notEqual(budgetFingerprint({ ...plan, incomes: { t: 300000, k: 260000 } }), a);
  assert.notEqual(budgetFingerprint({ ...plan, fixed: [...plan.fixed, { name: 'Phone', amount: 5000, payer: 't' }] }), a);
});

test('locks only when both approved the same, current numbers', () => {
  const fp = budgetFingerprint(plan);
  assert.equal(lockDecision({ locked: false, votes: { t: { want: 'lock', fp }, k: null }, currentFp: fp }).action, null);
  assert.equal(lockDecision({ locked: false, votes: { t: { want: 'lock', fp }, k: { want: 'lock', fp } }, currentFp: fp }).action, 'lock');
  const stale = lockDecision({ locked: false, votes: { t: { want: 'lock', fp: 'old' }, k: { want: 'lock', fp } }, currentFp: fp });
  assert.equal(stale.action, null);
  assert.equal(stale.status.t, 'stale');
});

test('unlocks only when both asked to unlock', () => {
  const fp = 'x';
  assert.equal(lockDecision({ locked: true, votes: { t: { want: 'unlock' }, k: { want: 'lock', fp } }, currentFp: fp }).action, null);
  assert.equal(lockDecision({ locked: true, votes: { t: { want: 'unlock' }, k: { want: 'unlock' } }, currentFp: fp }).action, 'unlock');
  assert.equal(lockDecision({ locked: true, votes: { t: null, k: null }, currentFp: fp }).status.t, 'waiting');
});

test('custom statement: a payment without a balance yet (pending) is left out until it completes', () => {
  const head = 'Date,Description,Category,Money out,Money in,Balance\n';
  const pending = parseRevolut(head + '"Oct 31, 2026",Testmarkt,Groceries,€12.00,,\n"Oct 30, 2026",Musterladen,Groceries,€5.00,,"€100.00"\n');
  assert.equal(pending.transactions.length, 1);
  assert.equal(pending.reasons.unfinished, 1);
  // A week later the same payment has gone through and carries a balance: it is imported, dated 31 Oct.
  const done = parseRevolut(head + '"Oct 31, 2026",Testmarkt,Groceries,€12.00,,"€88.00"\n');
  assert.equal(done.transactions.length, 1);
  assert.equal(done.transactions[0].date, '2026-10-31');
});

// ---------- closing down a month ----------
import { closeDecision, closeFingerprint } from '../js/lib/budget.js';

test('closing down needs both, with the same final result', () => {
  const fp = closeFingerprint({ finalBalance: 12000, finalDate: '2026-10-31', spent: 81000 });
  const v = (want, f = fp) => ({ want, fp: f });
  assert.equal(closeDecision({ closed: false, votes: { t: v('close'), k: null }, currentFp: fp }).action, null);
  assert.deepEqual(closeDecision({ closed: false, votes: { t: v('close'), k: null }, currentFp: fp }).status, { t: 'approved', k: 'waiting' });
  assert.equal(closeDecision({ closed: false, votes: { t: v('close'), k: v('close') }, currentFp: fp }).action, 'close');
  // One closed down with another balance → needs to confirm again, nothing happens.
  const other = closeFingerprint({ finalBalance: 11000, finalDate: '2026-10-31', spent: 82000 });
  const stale = closeDecision({ closed: false, votes: { t: v('close', other), k: v('close') }, currentFp: fp });
  assert.equal(stale.action, null);
  assert.equal(stale.status.t, 'stale');
  // No final balance yet: nobody's close-down counts.
  assert.equal(closeDecision({ closed: false, votes: { t: v('close', null), k: v('close', null) }, currentFp: null }).action, null);
});

test('reopening a closed month needs both', () => {
  const r = { want: 'reopen', fp: null };
  assert.equal(closeDecision({ closed: true, votes: { t: r, k: null }, currentFp: 'x' }).action, null);
  assert.deepEqual(closeDecision({ closed: true, votes: { t: r, k: null }, currentFp: 'x' }).status, { t: 'reopen', k: 'waiting' });
  assert.equal(closeDecision({ closed: true, votes: { t: r, k: r }, currentFp: 'x' }).action, 'reopen');
  // After reopening, the old "reopen" votes don't close it again.
  assert.equal(closeDecision({ closed: false, votes: { t: r, k: r }, currentFp: 'x' }).action, null);
});

test('close fingerprint changes when the result changes', () => {
  const a = closeFingerprint({ finalBalance: 12000, finalDate: '2026-10-31', spent: 81000 });
  assert.equal(a, closeFingerprint({ finalBalance: 12000, finalDate: '2026-10-31', spent: 81000 }));
  assert.notEqual(a, closeFingerprint({ finalBalance: 12000, finalDate: '2026-10-31', spent: 81500 }));
  assert.notEqual(a, closeFingerprint({ finalBalance: 12100, finalDate: '2026-10-31', spent: 81000 }));
});

// ---------- rentals: Swedbank statements and calculations ----------
import { parseSwedbank, decodeStatement } from '../js/lib/swedbank.js';
import {
  yearSummary, monthGrid, toEur, split, dueDates, paymentFor, upcomingPayments, addMonthsToDate, payeeKey, detailsKey,
  ruleFor, matchText, partsOf, makeParts,
} from '../js/lib/rentals.js';

test('Swedbank Estonia: transactions with D/K signs and the closing balance', () => {
  const s = parseSwedbank(readFileSync(new URL('./fixtures/swedbank-ee.csv', import.meta.url), 'utf8'));
  assert.equal(s.bank, 'ee');
  assert.equal(s.currency, 'EUR');
  assert.equal(s.account, 'EE001234567890123456');
  assert.equal(s.transactions.length, 6); // opening/turnover/closing rows are not transactions
  const rent = s.transactions[0];
  assert.deepEqual([rent.date, rent.amount, rent.party], ['2026-10-03', 65000, 'Mari Maasikas']);
  assert.equal(s.transactions[1].amount, -5500);
  assert.equal(s.transactions[4].party, 'Šokolaadi Remont OÜ');
  assert.ok(s.transactions[0].key.startsWith('ee:'));
  assert.equal(new Set(s.transactions.map((t) => t.key)).size, 6);
  assert.deepEqual(s.balance, { amount: 258033, date: '2026-10-31' });
});

test('Swedbank Estonia in Windows-1257 encoding keeps š and õ', () => {
  const text = readFileSync(new URL('./fixtures/swedbank-ee.csv', import.meta.url), 'utf8');
  const map = { 'š': 0xf0, 'Š': 0xd0, 'õ': 0xf5, 'ä': 0xe4, 'ü': 0xfc, 'Ü': 0xdc, 'ö': 0xf6, 'Õ': 0xd5, 'Ä': 0xc4 };
  const bytes = Uint8Array.from([...text].map((ch) => map[ch] ?? ch.charCodeAt(0)));
  const s = parseSwedbank(decodeStatement(bytes));
  assert.equal(s.transactions[4].party, 'Šokolaadi Remont OÜ');
  assert.equal(s.transactions.length, 6);
});

test('Swedbank Sweden: signed SEK amounts, title line, newest booked balance', () => {
  const s = parseSwedbank(readFileSync(new URL('./fixtures/swedbank-se.csv', import.meta.url), 'utf8'));
  assert.equal(s.bank, 'se');
  assert.equal(s.currency, 'SEK');
  assert.equal(s.account, '8327-9-123 456 789-0');
  assert.equal(s.transactions.length, 3);
  assert.deepEqual([s.transactions[0].amount, s.transactions[0].party, s.transactions[0].details], [-41200, 'Exempel Försäkring AB', 'Hemförsäkring']);
  assert.equal(s.transactions[2].date, '2026-10-01'); // transaction day, not booking day
  assert.deepEqual(s.balance, { amount: 818800, date: '2026-10-28' });
  // Same file twice → same keys (no double import)
  const again = parseSwedbank(readFileSync(new URL('./fixtures/swedbank-se.csv', import.meta.url), 'utf8'));
  assert.deepEqual(again.transactions.map((t) => t.key), s.transactions.map((t) => t.key));
});

test('Swedbank Estonia in English: shared transfer references and identical lines stay separate', () => {
  const text = readFileSync(new URL('./fixtures/swedbank-ee-en-oct.csv', import.meta.url), 'utf8');
  const s = parseSwedbank(text);
  assert.equal(s.bank, 'ee');
  assert.equal(s.transactions.length, 9);
  // payment + fee share a reference; loan principal + interest share one; two identical fee lines on one day
  assert.equal(new Set(s.transactions.map((t) => t.key)).size, 9);
  assert.deepEqual(s.balance, { amount: 105968, date: '2026-10-31' });
  // Same file again → the same keys, so nothing is imported twice
  assert.deepEqual(parseSwedbank(text).transactions.map((t) => t.key), s.transactions.map((t) => t.key));
  assert.equal(detailsKey('', 'Kogunenud intress: 11-000001-EL'), '|kogunenud intress 11 000001 el');
  assert.notEqual(detailsKey('OMANIK', 'Laenu põhiosa: 11-000001-EL'), detailsKey('OMANIK', 'Laenu põhiosa: 22-000002-EL'));
});

test('a Revolut file is not taken for a Swedbank statement', () => {
  assert.throws(() => parseSwedbank('Type,Product,Started Date,Description,Amount\nCARD_PAYMENT,Current,2026-10-01,Shop,-1.00\n'), /Swedbank/);
});

test('rentals: SEK converted with the year rate, split for both apartments', () => {
  assert.equal(toEur(112000, 'SEK', 2026, { 2026: 11.2 }), 10000);
  assert.equal(toEur(112000, 'SEK', 2025, { 2026: 11.2 }), null);
  assert.equal(toEur(5000, 'EUR', 2026, {}), 5000);
  assert.deepEqual(split(-101, 'both'), { a: -51, b: -50 });
  assert.deepEqual(split(500, 'none'), { a: 0, b: 0 });
});

test('rentals: year summary per apartment', () => {
  const txs = [
    { date: '2026-01-03', amount: 65000, currency: 'EUR', apartment: 'a', category: 'rent' },
    { date: '2026-01-05', amount: -5500, currency: 'EUR', apartment: 'a', category: 'management' },
    { date: '2026-01-10', amount: 72000, currency: 'EUR', apartment: 'b', category: 'rent' },
    { date: '2026-02-01', amount: -2000, currency: 'EUR', apartment: 'both', category: 'fees' },
    { date: '2026-03-01', amount: -112000, currency: 'SEK', apartment: 'b', category: 'insurance' },
    { date: '2026-03-02', amount: -13000, currency: 'EUR', apartment: 'a', category: 'tax-ee' },
    { date: '2026-03-03', amount: 99999, currency: 'EUR', apartment: 'none', category: null },
    { date: '2025-12-31', amount: 65000, currency: 'EUR', apartment: 'a', category: 'rent' },
  ];
  const s = yearSummary(txs, 2026, { 2026: 11.2 });
  assert.equal(s.a.income, 65000);
  assert.equal(s.a.costs, -5500 - 1000);
  assert.equal(s.a.tax, -13000);
  assert.equal(s.a.result, 65000 - 6500); // tax is shown separately, not in the result
  assert.equal(s.b.costs, -1000 - 10000);
  assert.equal(s.total.byCategory.rent, 137000);
  assert.equal(s.unconverted, 0);
  assert.equal(yearSummary(txs, 2026, {}).unconverted, 1);
  const grid = monthGrid(txs, 2026, { 2026: 11.2 });
  assert.equal(grid[0].a.rent, 65000);
  assert.equal(grid[0].b.rent, 72000);
  assert.equal(grid[1].a.costs, -1000);
  assert.equal(grid[2].b.costs, -10000);
});

test('rentals: due dates and matching payments', () => {
  assert.equal(addMonthsToDate('2026-01-31', 1), '2026-02-28');
  const bill = { id: 'b1', name: 'Management', apartment: 'a', category: 'management', amount: 5500, currency: 'EUR', everyMonths: 1, firstDue: '2026-01-05' };
  assert.deepEqual(dueDates(bill, '2026-09-01', '2026-11-30'), ['2026-09-05', '2026-10-05', '2026-11-05']);
  const quarterly = { ...bill, everyMonths: 3, firstDue: '2025-03-20' };
  assert.deepEqual(dueDates(quarterly, '2026-01-01', '2026-12-31'), ['2026-03-20', '2026-06-20', '2026-09-20', '2026-12-20']);
  const txs = [
    { date: '2026-10-06', amount: -5500, currency: 'EUR', apartment: 'a', category: 'management', party: 'Haldus OÜ', details: '' },
    { date: '2026-09-04', amount: -5500, currency: 'EUR', apartment: 'b', category: 'management', party: 'Haldus OÜ', details: '' },
  ];
  assert.equal(paymentFor(bill, '2026-10-05', txs), txs[0]);
  assert.equal(paymentFor(bill, '2026-09-05', txs), null); // other apartment
  assert.equal(paymentFor({ ...bill, match: 'other company' }, '2026-10-05', txs), null);
  const up = upcomingPayments([bill], txs, new Set(), '2026-11-02');
  assert.deepEqual(up.map((u) => [u.due, u.status]), [['2026-09-05', 'overdue'], ['2026-11-05', 'due-soon']]);
  const marked = upcomingPayments([bill], txs, new Set(['b1|2026-09-05']), '2026-11-02');
  assert.deepEqual(marked.map((u) => u.status), ['due-soon']);
  // Before the first imported transaction, payments can't be checked: not shown as overdue.
  assert.deepEqual(upcomingPayments([bill], txs, new Set(), '2026-11-02', { since: '2026-10-01' }).map((u) => u.status), ['due-soon']);
  assert.equal(payeeKey('Näidis Haldus OÜ arve 4412'), 'naidis haldus ou arve');
});

test('rentals: rules match text in payee, description or reference; the longest wins', () => {
  const rules = [
    { text: 'Vabriku', apartment: 'a', category: 'association' },
    { text: '90000222', apartment: 'b', category: 'insurance' },
    { text: 'Arve', apartment: 'a', category: 'insurance' }, // short, general rule
  ];
  assert.equal(ruleFor({ party: 'TALLINN, LINDA TN 2 // VABRIKU TN 8A KÜ', details: 'Arve M089401514' }, rules).apartment, 'a');
  // Both "Arve" and "90000222" fit: the longer (more specific) text wins.
  assert.equal(ruleFor({ party: 'KINDLUSTUS AS', details: 'Arve 1', ref: '90000222' }, rules).apartment, 'b');
  assert.equal(ruleFor({ party: 'KINDLUSTUS AS', details: 'Arve 1', ref: '90000111' }, rules).apartment, 'a');
  assert.equal(ruleFor({ party: 'Elisa', details: 'Bill 9000022', ref: '' }, rules), null);
  assert.equal(matchText('Kungla tn 12A KÜ'), 'kungla tn 12a ku');
});

test('rentals: one payment split into rent + utilities', () => {
  assert.deepEqual(makeParts(57981, 'rent', 45000, 'utilities-in'), [
    { category: 'rent', amount: 45000 }, { category: 'utilities-in', amount: 12981 },
  ]);
  assert.deepEqual(makeParts(-10000, 'repairs', 2500, 'cost-other'), [
    { category: 'repairs', amount: -2500 }, { category: 'cost-other', amount: -7500 },
  ]);
  assert.equal(makeParts(40000, 'rent', 45000, 'utilities-in'), null); // rent part bigger than the payment
  const t = { date: '2026-10-05', amount: 57981, currency: 'EUR', apartment: 'b', category: 'rent',
    parts: makeParts(57981, 'rent', 45000, 'utilities-in') };
  assert.equal(partsOf(t).length, 2);
  assert.equal(partsOf({ ...t, parts: [{ category: 'rent', amount: 1 }, { category: 'x', amount: 1 }] }).length, 1); // doesn't add up → ignored
  const y = yearSummary([t], 2026, {});
  assert.equal(y.b.byCategory.rent, 45000);
  assert.equal(y.b.byCategory['utilities-in'], 12981);
  assert.equal(y.b.income, 57981);
  assert.equal(monthGrid([t], 2026, {})[9].b.rent, 45000); // the month grid shows the rent part only
});
