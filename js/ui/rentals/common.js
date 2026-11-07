// Small helpers shared by the Rentals screen's sections.

import * as store from '../../rentals/store.js';
import { CATEGORIES, categoryById } from '../../lib/rentals.js';
import { formatMoney } from '../../lib/money.js';
import { esc } from '../dom.js';

/** 'a' → "Apartment 1" (your name for it), 'both' → "Both", 'none' → "Not rental". */
export function aptLabel(apartment) {
  const names = store.getSettings().apartments;
  if (apartment === 'a' || apartment === 'b') return names[apartment];
  if (apartment === 'both') return 'Both';
  if (apartment === 'none') return 'Not rental';
  return 'Not sorted';
}

export const aptOptions = (withNone = true) => {
  const names = store.getSettings().apartments;
  const opts = [{ value: 'a', label: names.a }, { value: 'b', label: names.b }, { value: 'both', label: 'Both' }];
  return withNone ? [...opts, { value: 'none', label: 'Not rental' }] : opts;
};

/** Category choices; money in shows income first, money out shows costs first. */
export function categoryOptions(amount = -1) {
  const order = amount >= 0 ? ['income', 'cost', 'tax', 'other'] : ['cost', 'tax', 'other', 'income'];
  return order.flatMap((kind) => CATEGORIES.filter((c) => c.kind === kind))
    .map((c) => ({ value: c.id, label: `${c.label} (${c.de})` }));
}

export const catLabel = (id) => categoryById(id)?.label || '';

/** Amount with its currency and colour: green for money in. */
export const amountHtml = (cents, currency) =>
  `<span class="num ${cents >= 0 ? 'positive' : ''}">${esc(formatMoney(cents, currency))}</span>`;

/** "…3456" for an account number (never show the whole number on screen). */
export const masked = (number) => (number ? `…${String(number).replace(/\s/g, '').slice(-4)}` : '');

/** Flag-like short label for the bank: "EE" / "SE". */
export function bankTag(accountId) {
  const acct = accountId ? store.get(accountId) : null;
  if (!acct) return '<span class="bank-tag">Cash</span>';
  return `<span class="bank-tag ${acct.bank}" title="${esc(acct.name)}">${acct.bank === 'se' ? 'SE' : 'EE'}</span>`;
}

const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const DAY_YEAR = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
/** '2026-10-31' → "31 Oct" (this year) or "31 Oct 2025". */
export function dayLabel(date, todayKey) {
  if (!date) return '';
  const d = new Date(`${date}T12:00:00`);
  return (date.slice(0, 4) === todayKey.slice(0, 4) ? DAY : DAY_YEAR).format(d);
}
