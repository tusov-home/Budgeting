// Rentals → Bills: recurring payments (management fee, building association, insurance…).

import * as store from '../../rentals/store.js';
import { upcomingPayments } from '../../lib/rentals.js';
import { dateKeyOf } from '../../lib/months.js';
import { esc, toast } from '../dom.js';
import { openForm } from '../form.js';
import { aptLabel, aptOptions, categoryOptions, catLabel, amountHtml, dayLabel } from './common.js';

const EVERY = [
  { value: 1, label: 'Monthly' }, { value: 3, label: 'Quarterly' },
  { value: 6, label: 'Half-yearly' }, { value: 12, label: 'Yearly' },
];

export function html(todayKey) {
  const bills = store.getBills();
  const next = new Map(upcomingPayments(bills, store.getSorted(), store.getPaidMarks(), todayKey, { lookbackDays: 0 })
    .map((u) => [u.bill.id, u]));
  return `<section class="card">
    <div class="card-head"><h2>Recurring payments</h2>
      <button class="btn primary" data-rent="new-bill" title="Add a recurring payment (N)">Add</button></div>
    ${bills.length ? `<ul class="list">${bills.map((b) => {
      const n = next.get(b.id);
      return `<li><button class="row-btn" data-bill="${esc(b.id)}" data-testid="bill-row">
        <span><b>${esc(b.name)}</b><br><span class="muted small">${esc(aptLabel(b.apartment))} · ${esc(catLabel(b.category))} ·
          ${esc(EVERY.find((e) => e.value === Number(b.everyMonths))?.label || '')}${n ? ` · next ${esc(dayLabel(n.due, todayKey))}` : ''}</span></span>
        ${amountHtml(-b.amount, b.currency)}
      </button></li>`;
    }).join('')}</ul>` : `<p class="muted" style="margin:0">Add the payments that come back regularly. The Overview then shows
      what's due, and ticks a payment off when a sorted transaction with the same category and apartment arrives near its date.</p>`}
  </section>`;
}

export function bind(main) {
  main.querySelector('[data-rent="new-bill"]')?.addEventListener('click', () => editBill(null));
  main.querySelectorAll('[data-bill]').forEach((b) => b.addEventListener('click', () => editBill(store.get(b.dataset.bill))));
}

export async function editBill(bill) {
  const values = await openForm({
    title: bill ? 'Recurring payment' : 'New recurring payment',
    fields: [
      { name: 'name', label: 'Name', type: 'text', value: bill?.name, required: true, autofocus: !bill, placeholder: 'e.g. Management fee' },
      { name: 'apartment', label: 'Apartment', type: 'choice', value: bill?.apartment || 'a', options: aptOptions(false) },
      { name: 'category', label: 'Category', type: 'select', value: bill?.category || 'management', options: categoryOptions(-1) },
      { name: 'amount', label: 'Usual amount', type: 'money', value: bill?.amount ?? null, required: true },
      { name: 'currency', label: 'Currency', type: 'choice', value: bill?.currency || 'EUR', options: [{ value: 'EUR', label: 'EUR' }, { value: 'SEK', label: 'SEK' }] },
      { name: 'everyMonths', label: 'How often', type: 'choice', value: Number(bill?.everyMonths || 1), options: EVERY },
      { name: 'firstDue', label: 'A due date (any past or next one)', type: 'date', value: bill?.firstDue || dateKeyOf(new Date()), required: true },
      { name: 'match', label: 'Payee contains (optional)', type: 'text', value: bill?.match || '',
        hint: 'Only needed if two payments share a category and apartment.' },
    ],
    submitLabel: bill ? 'Save' : 'Add',
    deleteLabel: bill ? 'Delete' : null,
  });
  if (!values) return;
  if (values.__delete) {
    store.remove(bill.id);
    toast('Recurring payment deleted', { label: 'Undo', run: store.undo });
    return;
  }
  store.put({ id: bill?.id || store.newId('rbill'), type: 'rbill', ...values });
  toast(bill ? 'Saved' : 'Added', { label: 'Undo', run: store.undo });
}
