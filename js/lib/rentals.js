// Rental accounts: categories and calculations. Pure functions, no DOM or storage.
//
// A rental transaction ("rtx") is one line from a Swedbank statement (or typed in):
//   { date, amount (cents, − = money out), currency: 'EUR'|'SEK', apartment, category }
// apartment: 'a' | 'b' | 'both' (split evenly) | 'none' (not rental: transfers, private) | null (not sorted yet)

/**
 * Categories. `de` is the usual German word, to help when filling in the German
 * tax return; which costs count, and how, is for you and your tax advisor to decide.
 * kind: income | cost | tax (shown separately) | other (shown separately, not in the result)
 */
export const CATEGORIES = [
  { id: 'rent', label: 'Rent', de: 'Mieteinnahmen', kind: 'income' },
  { id: 'utilities-in', label: 'Utilities paid by tenant', de: 'Umlagen', kind: 'income' },
  { id: 'income-other', label: 'Other income (refunds, deposits kept)', de: 'sonstige Einnahmen', kind: 'income' },
  { id: 'management', label: 'Management fee', de: 'Verwaltungskosten', kind: 'cost' },
  { id: 'association', label: 'Building association fee', de: 'Hausgeld', kind: 'cost' },
  { id: 'utilities', label: 'Utilities (heating, water, electricity)', de: 'Nebenkosten', kind: 'cost' },
  { id: 'repairs', label: 'Repairs & maintenance', de: 'Erhaltungsaufwand', kind: 'cost' },
  { id: 'insurance', label: 'Insurance', de: 'Versicherungen', kind: 'cost' },
  { id: 'landtax', label: 'Land tax', de: 'Grundsteuer', kind: 'cost' },
  { id: 'interest', label: 'Loan interest', de: 'Schuldzinsen', kind: 'cost' },
  { id: 'fees', label: 'Bank fees', de: 'Kontoführungsgebühren', kind: 'cost' },
  { id: 'furnishing', label: 'Furnishing & appliances', de: 'Anschaffungen', kind: 'cost' },
  { id: 'cost-other', label: 'Other cost', de: 'sonstige Werbungskosten', kind: 'cost' },
  { id: 'tax-ee', label: 'Estonian income tax', de: 'ausländische Steuer', kind: 'tax' },
  { id: 'principal', label: 'Loan repayment (principal)', de: 'Tilgung', kind: 'other' },
];

export const categoryById = (id) => CATEGORIES.find((c) => c.id === id) || null;

/**
 * The parts of a transaction: [{ category, amount }]. Normally one part; a split line
 * (e.g. rent + utilities in one payment) has t.parts, which add up to t.amount.
 */
export function partsOf(t) {
  if (Array.isArray(t.parts) && t.parts.length > 1 && t.parts.reduce((sum, p) => sum + p.amount, 0) === t.amount) {
    return t.parts;
  }
  return [{ category: t.category, amount: t.amount }];
}

/**
 * Split an amount in two: the first part as given (positive, e.g. the rent), the rest to category2.
 * Returns the parts with the sign of the total, or null when the first part isn't smaller than the total.
 */
export function makeParts(total, firstCategory, firstAmount, category2) {
  const abs = Math.abs(total);
  if (!(firstAmount > 0) || firstAmount >= abs) return null;
  const sign = total < 0 ? -1 : 1;
  return [
    { category: firstCategory, amount: sign * firstAmount },
    { category: category2, amount: sign * (abs - firstAmount) },
  ];
}

/** Default category for an amount: money in → rent, money out → other cost. */
export const defaultCategory = (amount) => (amount >= 0 ? 'rent' : 'cost-other');

/**
 * Amount in euro cents. SEK is converted with the year's rate (SEK per 1 EUR),
 * e.g. rates = { 2026: 11.2 }. Returns null when the rate for that year is missing.
 */
export function toEur(amount, currency, year, rates = {}) {
  if (currency === 'EUR' || !currency) return amount;
  const rate = Number(rates[year]);
  if (!(rate > 0)) return null;
  return Math.round(amount / rate);
}

/** Split an amount between the apartments: { a, b }. 'both' gives each half (a gets the odd cent). */
export function split(amount, apartment) {
  if (apartment === 'a') return { a: amount, b: 0 };
  if (apartment === 'b') return { a: 0, b: amount };
  if (apartment === 'both') {
    const half = Math.trunc(amount / 2);
    return { a: amount - half, b: half };
  }
  return { a: 0, b: 0 };
}

const isRental = (t) => t.apartment === 'a' || t.apartment === 'b' || t.apartment === 'both';

/**
 * Totals for one year, per apartment, in euro cents.
 * Returns {
 *   a: { byCategory: { id: cents }, income, costs, tax, other, result }, b: {…}, total: {…},
 *   unconverted: number of SEK transactions without a rate for that year
 * }
 * Costs are negative numbers, as in the bank (result = income + costs).
 */
export function yearSummary(txs, year, rates = {}) {
  const empty = () => ({ byCategory: {}, income: 0, costs: 0, tax: 0, other: 0, result: 0 });
  const out = { a: empty(), b: empty(), total: empty(), unconverted: 0 };
  for (const t of txs) {
    if (!isRental(t) || !t.date.startsWith(String(year))) continue;
    if (toEur(t.amount, t.currency, year, rates) === null) {
      out.unconverted++;
      continue;
    }
    for (const part of partsOf(t)) {
      const eur = toEur(part.amount, t.currency, year, rates);
      const cat = categoryById(part.category) || categoryById(defaultCategory(part.amount));
      const shares = split(eur, t.apartment);
      for (const key of ['a', 'b']) {
        const v = shares[key];
        if (!v) continue;
        for (const s of [out[key], out.total]) {
          s.byCategory[cat.id] = (s.byCategory[cat.id] || 0) + v;
          if (cat.kind === 'income') s.income += v;
          else if (cat.kind === 'cost') s.costs += v;
          else if (cat.kind === 'tax') s.tax += v;
          else s.other += v;
        }
      }
    }
  }
  for (const s of [out.a, out.b, out.total]) s.result = s.income + s.costs;
  return out;
}

/**
 * Month by month for one year: [{ month: 'YYYY-MM', a: { rent, costs }, b: { rent, costs } }] × 12,
 * in euro cents. rent = rent received; costs = all costs (negative). SEK without a rate is left out.
 */
export function monthGrid(txs, year, rates = {}) {
  const months = Array.from({ length: 12 }, (_, i) => ({
    month: `${year}-${String(i + 1).padStart(2, '0')}`,
    a: { rent: 0, costs: 0 },
    b: { rent: 0, costs: 0 },
  }));
  for (const t of txs) {
    if (!isRental(t) || !t.date.startsWith(String(year))) continue;
    if (toEur(t.amount, t.currency, year, rates) === null) continue;
    const m = months[Number(t.date.slice(5, 7)) - 1];
    for (const part of partsOf(t)) {
      const cat = categoryById(part.category) || categoryById(defaultCategory(part.amount));
      const shares = split(toEur(part.amount, t.currency, year, rates), t.apartment);
      for (const key of ['a', 'b']) {
        if (cat.id === 'rent') m[key].rent += shares[key];
        else if (cat.kind === 'cost') m[key].costs += shares[key];
      }
    }
  }
  return months;
}

// ---------- recurring payments ("bills") ----------
//
// bill: { name, apartment, category, amount (expected, cents, positive), currency,
//         everyMonths: 1 | 3 | 6 | 12, firstDue: 'YYYY-MM-DD', match: optional text in the payee }

/** 'YYYY-MM-DD' plus n months, keeping the day (clamped to the month's last day). */
export function addMonthsToDate(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

const dayNumber = (date) => Math.round(Date.parse(`${date}T00:00:00Z`) / 86400000);

/** Due dates of a bill between `from` and `to` (inclusive, 'YYYY-MM-DD'). */
export function dueDates(bill, from, to) {
  const out = [];
  const step = Math.max(1, Number(bill.everyMonths) || 1);
  let k = 0;
  let due = bill.firstDue;
  // Jump close to `from` first, so old bills don't loop through years of dates.
  if (due < from) {
    const monthsBehind = (Number(from.slice(0, 4)) - Number(due.slice(0, 4))) * 12 + Number(from.slice(5, 7)) - Number(due.slice(5, 7));
    k = Math.max(0, Math.floor(monthsBehind / step) - 1);
    due = addMonthsToDate(bill.firstDue, k * step);
  }
  while (due <= to && out.length < 400) {
    if (due >= from) out.push(due);
    k++;
    due = addMonthsToDate(bill.firstDue, k * step);
  }
  return out;
}

/**
 * The transaction that paid the bill's payment due on `due`, or null.
 * A match is money out, sorted to the bill's category and apartment (or "both"),
 * within half a period of the due date (±15 days for monthly bills),
 * and containing the bill's `match` text in the payee or details if one is set.
 */
export function paymentFor(bill, due, txs) {
  const half = Math.max(10, Math.round((Number(bill.everyMonths) || 1) * 30 / 2));
  const dDue = dayNumber(due);
  const text = (bill.match || '').trim().toLowerCase();
  let best = null;
  for (const t of txs) {
    if (t.amount >= 0 || !partsOf(t).some((p) => p.category === bill.category)) continue;
    if (!(t.apartment === bill.apartment || t.apartment === 'both' || bill.apartment === 'both')) continue;
    if (bill.currency && t.currency !== bill.currency) continue;
    if (text && !`${t.party} ${t.details}`.toLowerCase().includes(text)) continue;
    const diff = Math.abs(dayNumber(t.date) - dDue);
    if (diff > half) continue;
    if (!best || diff < best.diff) best = { t, diff };
  }
  return best ? best.t : null;
}

/**
 * What to show in "Upcoming payments", sorted by date:
 * every unpaid payment from the last `lookbackDays` (overdue) plus each bill's next payment.
 * paidMarks: Set of "billId|YYYY-MM-DD" marked as paid by hand (paid from another account).
 * since: first day with imported transactions; earlier payments can't be checked, so they're left out.
 * Returns [{ bill, due, status: 'overdue' | 'due-soon' | 'upcoming' | 'paid', paidBy }].
 */
export function upcomingPayments(bills, txs, paidMarks, today, { lookbackDays = 75, soonDays = 10, since = '' } = {}) {
  let from = new Date((dayNumber(today) - lookbackDays) * 86400000).toISOString().slice(0, 10);
  if (since > from) from = since;
  const out = [];
  for (const bill of bills) {
    if (!bill.firstDue) continue;
    const step = Math.max(1, Number(bill.everyMonths) || 1);
    const dates = dueDates(bill, from, addMonthsToDate(today, step));
    let nextShown = false;
    for (const due of dates) {
      const tx = paymentFor(bill, due, txs);
      const marked = paidMarks.has(`${bill.id}|${due}`);
      const paid = Boolean(tx) || marked;
      if (due < today) {
        if (!paid) out.push({ bill, due, status: 'overdue', paidBy: null });
        continue;
      }
      if (nextShown) break;
      nextShown = true;
      const soon = dayNumber(due) - dayNumber(today) <= soonDays;
      out.push({ bill, due, status: paid ? 'paid' : soon ? 'due-soon' : 'upcoming', paidBy: tx || (marked ? 'mark' : null) });
    }
  }
  return out.sort((x, y) => (x.due < y.due ? -1 : x.due > y.due ? 1 : 0));
}

/**
 * Key for remembering the choice for a payee + description, digits kept:
 * "Kogunenud intress: 14-017712-EL" stays the same every month and tells two loans apart.
 */
export function detailsKey(party, details) {
  const clean = (t) => (t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const d = clean(details);
  return d ? `${clean(party)}|${d}` : '';
}

/** Text for matching rules: lowercase, no accents, words and numbers separated by single spaces. */
export function matchText(text) {
  return (text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * The rule that fits a transaction: its text is found in payee, description or reference number.
 * Longer (more specific) rule texts win. rules: [{ text, apartment, category }].
 */
export function ruleFor(tx, rules) {
  const hay = ` ${matchText(`${tx.party || ''} ${tx.details || ''} ${tx.ref || ''}`)} `;
  let best = null;
  for (const r of rules) {
    const needle = matchText(r.text);
    if (!needle || !hay.includes(needle)) continue;
    if (!best || needle.length > matchText(best.text).length) best = r;
  }
  return best;
}

/** Key for remembering the choice for a payee: lowercase letters only, digits dropped (invoice numbers). */
export function payeeKey(party) {
  return (party || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]+/g, ' ').trim();
}
