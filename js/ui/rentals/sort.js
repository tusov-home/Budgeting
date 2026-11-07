// Rentals → Sort: import Swedbank statements and sort each line to an apartment and category.

import * as store from '../../rentals/store.js';
import { parseSwedbank, decodeStatement } from '../../lib/swedbank.js';
import { defaultCategory } from '../../lib/rentals.js';
import { dateKeyOf } from '../../lib/months.js';
import { esc, toast } from '../dom.js';
import { openForm } from '../form.js';
import { aptLabel, aptOptions, categoryOptions, catLabel, amountHtml, bankTag, dayLabel } from './common.js';

export function html(todayKey) {
  const unsorted = store.getUnsorted();
  const suggested = unsorted.filter((t) => store.suggestionFor(t)).length;
  const recent = store.getSorted().slice(0, 25);
  return `
    <section class="card">
      <div class="card-head">
        <h2>To sort <span class="muted" data-testid="rent-unsorted">${unsorted.length}</span></h2>
      </div>
      <div class="btn-row" style="margin-bottom:10px">
        <button class="btn primary" data-rent="import" title="Import Swedbank statement (I)">Import Swedbank CSV</button>
        <button class="btn" data-rent="manual" title="Add by hand (N)">Add by hand</button>
        ${suggested ? `<button class="btn" data-rent="accept" data-testid="rent-accept">Accept ${suggested} suggestion${suggested === 1 ? '' : 's'}</button>` : ''}
      </div>
      <input type="file" id="rent-file" accept=".csv,text/csv,text/comma-separated-values,application/vnd.ms-excel,text/plain" multiple hidden>
      ${unsorted.length ? `<ul class="list rent-list">${unsorted.map((t) => row(t, todayKey, true)).join('')}</ul>`
        : '<p class="muted" style="margin:0">Nothing to sort. Import the latest statements from Swedbank Estonia and Sweden (CSV).</p>'}
    </section>
    ${recent.length ? `<section class="card">
      <h2>Recently sorted</h2>
      <ul class="list rent-list">${recent.map((t) => row(t, todayKey, false)).join('')}</ul>
      <p class="muted small" style="margin:8px 0 0">Tap a line to change or delete it.</p>
    </section>` : ''}`;
}

function row(t, todayKey, unsorted) {
  const s = unsorted ? store.suggestionFor(t) : null;
  const tag = unsorted
    ? (s ? `<span class="tag suggested">→ ${esc(aptLabel(s.apartment))}${s.category ? ` · ${esc(catLabel(s.category))}` : ''}</span>` : '')
    : `<span class="tag">${esc(aptLabel(t.apartment))}${t.category ? ` · ${esc(catLabel(t.category))}` : ''}</span>`;
  return `<li class="rent-row" data-testid="rent-row">
    <button class="row-btn" data-tx="${esc(t.id)}">
      <span class="rent-main">
        <span class="rent-party">${bankTag(t.accountId)} ${esc(t.party || t.details || '(no name)')}</span>
        <span class="muted small">${esc(dayLabel(t.date, todayKey))}${t.details && t.party ? ` · ${esc(t.details)}` : ''}</span>
        ${tag}
      </span>
      ${amountHtml(t.amount, t.currency)}
    </button>
    ${unsorted && s ? `<button class="chip-btn" data-accept="${esc(t.id)}" aria-label="Accept suggestion for ${esc(t.party)}">✓</button>` : ''}
  </li>`;
}

export function bind(main) {
  const file = main.querySelector('#rent-file');
  main.querySelector('[data-rent="import"]')?.addEventListener('click', () => file.click());
  file?.addEventListener('change', async () => {
    for (const f of file.files) await importFile(f);
    file.value = '';
  });
  main.querySelector('[data-rent="manual"]')?.addEventListener('click', addManual);
  main.querySelector('[data-rent="accept"]')?.addEventListener('click', () => {
    const n = store.acceptSuggestions();
    toast(`${n} sorted`, { label: 'Undo', run: store.undo });
  });
  main.querySelectorAll('[data-accept]').forEach((b) => b.addEventListener('click', () => {
    const t = store.get(b.dataset.accept);
    const s = t && store.suggestionFor(t);
    if (!s) return;
    store.sortTx(t.id, s.apartment, s.category, { remember: false });
    toast(`${t.party}: ${aptLabel(s.apartment)}`, { label: 'Undo', run: store.undo });
  }));
  main.querySelectorAll('[data-tx]').forEach((b) => b.addEventListener('click', () => sortForm(store.get(b.dataset.tx))));
}

/** Open the file picker (used by the I shortcut). */
export function pickFile(main) {
  main.querySelector('#rent-file')?.click();
}

/** Read one statement file and add its new lines. */
export async function importFile(f) {
  try {
    const st = parseSwedbank(decodeStatement(new Uint8Array(await f.arrayBuffer())));
    importParsed(st);
  } catch (err) {
    toast(err.message, undefined, 'sticky');
  }
}

export function importParsed(st) {
  const { added, duplicates, account } = store.importStatement(st);
  const bal = st.balance ? ' Balance updated.' : '';
  toast(`${account.name}: ${added} new line${added === 1 ? '' : 's'}${duplicates ? `, ${duplicates} already here` : ''}.${bal}`);
}

async function sortForm(t) {
  if (!t) return;
  const s = store.suggestionFor(t);
  const apartment = t.apartment || s?.apartment || 'a';
  const category = t.category || s?.category || defaultCategory(t.amount);
  const values = await openForm({
    title: t.party || 'Transaction',
    introHtml: `<p class="muted" style="margin-top:0" data-testid="rent-sort-info">${esc(dayLabel(t.date, dateKeyOf(new Date())))} · ${amountHtml(t.amount, t.currency)}
      ${t.details ? `<br>${esc(t.details)}` : ''}</p>`,
    fields: [
      { name: 'apartment', label: 'Apartment', type: 'choice', value: apartment, options: aptOptions(true) },
      { name: 'category', label: 'Category', type: 'select', value: category, options: categoryOptions(t.amount),
        hint: 'Not needed for "Not rental".' },
      { name: 'remember', label: `Remember for "${t.party || 'this payee'}"`, type: 'checkbox', value: true },
    ],
    submitLabel: 'Save',
    deleteLabel: t.source === 'manual' || t.apartment ? 'Delete' : null,
  });
  if (!values) return;
  if (values.__delete) {
    store.remove(t.id);
    toast('Deleted', { label: 'Undo', run: store.undo });
    return;
  }
  store.sortTx(t.id, values.apartment, values.category, { remember: values.remember });
  toast(`${t.party || 'Line'}: ${aptLabel(values.apartment)}${values.apartment === 'none' ? '' : ` · ${catLabel(values.category)}`}`,
    { label: 'Undo', run: store.undo });
}

/** Income or cost typed in by hand. */
export async function addManual() {
  const accounts = store.getAccounts();
  const values = await openForm({
    title: 'Add by hand',
    fields: [
      { name: 'date', label: 'Date', type: 'date', value: dateKeyOf(new Date()), required: true },
      { name: 'party', label: 'Paid to / received from', type: 'text', required: true, autofocus: true },
      { name: 'dir', label: 'Money', type: 'choice', value: 'out', options: [{ value: 'out', label: 'Paid (cost)' }, { value: 'in', label: 'Received' }] },
      { name: 'amount', label: 'Amount', type: 'money', required: true },
      { name: 'currency', label: 'Currency', type: 'choice', value: 'EUR', options: [{ value: 'EUR', label: 'EUR' }, { value: 'SEK', label: 'SEK' }] },
      { name: 'account', label: 'From account', type: 'select', value: '',
        options: [{ value: '', label: 'Cash / other' }, ...accounts.map((a) => ({ value: a.id, label: a.name }))] },
      { name: 'apartment', label: 'Apartment', type: 'choice', value: 'a', options: aptOptions(false) },
      { name: 'category', label: 'Category', type: 'select', value: 'repairs', options: categoryOptions(-1) },
    ],
    submitLabel: 'Add',
  });
  if (!values) return;
  if (!(values.amount > 0)) {
    toast('Please enter an amount above 0');
    return;
  }
  const amount = values.dir === 'in' ? values.amount : -values.amount;
  store.addManual({
    accountId: values.account || null, date: values.date, amount, currency: values.currency,
    party: values.party, apartment: values.apartment, category: values.category,
  });
  toast('Added', { label: 'Undo', run: store.undo });
}
