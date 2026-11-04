// Purchases screen: import the Revolut statement, sort each purchase into
// common or personal, then withdraw the common total from the shared pocket.

import * as state from '../state.js';
import * as purchases from '../purchases.js';
import { formatCents } from '../lib/money.js';
import { dateKeyOf, shortDateLabel, monthLabel, daysInMonth } from '../lib/months.js';
import { esc, toast, REVOLUT_APP, isAndroid } from './dom.js';
import { openForm } from './form.js';

// The month chosen at the top (and how to change it), for imports started from this screen.
let view = { month: null, setMonth: null };

export function render(main, ctx) {
  view = ctx;
  const month = ctx.month;
  const s = state.getSettings();
  const me = state.getDevice().me;
  const other = me === 't' ? 'k' : 't';
  const mine = state.pendingExpenses(me);
  const theirs = state.pendingExpenses(other);
  const myTotal = sum(mine);
  const queue = purchases.toSort(month);
  const elsewhere = Object.entries(purchases.toSortElsewhere(month)).sort(([a], [b]) => a.localeCompare(b));
  const suggested = queue.filter((tx) => purchases.suggestionFor(tx)).length;
  const settlements = state.getSettlements().slice(0, 8);
  // A closed month's purchases can only be personal or already settled (its result is agreed).
  const closed = state.isClosed(month);

  const sorting = purchases.sortStatus();
  const lastSortedText = sorting.at
    ? `Last sorted ${purchases.daysAgoLabel(sorting.daysAgo)} (${shortDateLabel(sorting.at.slice(0, 10))}).`
    : 'Not sorted on this phone yet.';

  // Panels in the order of the steps: 1. sort, 2. withdraw.
  const sortCard = `
      <section class="card" aria-label="To sort">
        <div class="card-head">
          <h2><span class="step">1</span> To sort <span class="muted small" data-testid="sort-count">${queue.length}</span></h2>
          <button class="btn primary small-btn" data-act="import" title="Import Revolut statement (I)">Import CSV <kbd>I</kbd></button>
          <input id="csv-file" type="file" accept=".csv,text/csv,text/comma-separated-values,application/vnd.ms-excel" hidden>
        </div>
        <p class="muted small" style="margin:0 0 8px">Only ${esc(monthLabel(month))} purchases are imported and shown here.</p>
        ${elsewhere.length ? `<p class="small" style="margin:0 0 8px" data-testid="sort-elsewhere">Also to sort: ${elsewhere.map(([m, n]) =>
          `<button class="link-btn" data-goto-month="${esc(m)}">${n} in ${esc(monthLabel(m))}</button>`).join(', ')}</p>` : ''}
        ${suggested ? `<button class="btn" style="width:100%;margin-bottom:8px" data-act="accept">Accept ${suggested} suggestion${suggested > 1 ? 's' : ''}</button>` : ''}
        ${queue.length ? `<button class="btn small-btn" style="margin-bottom:8px" data-act="settle-before" title="Clear purchases that were balanced out some other way">Already settled before…</button>` : ''}
        ${queue.length ? `<ul class="list">${queue.map((tx) => sortRow(tx, closed)).join('')}</ul>` : `
          <p class="empty" data-testid="last-sorted">Everything is sorted. ${esc(lastSortedText)}</p>
          <details class="howto"><summary>How to export from Revolut</summary>
            <ol class="small">
              <li>In the Revolut app, on the home screen: <b>… More</b> → <b>Statement</b>.</li>
              <li>Choose <b>Custom</b> at the top, set the period and the format to <b>CSV</b>, then <b>Generate</b>.</li>
              <li>Open it with <b>Sheets</b>, tap <b>Share</b> there and pick <b>Budget</b>.
                The purchases land here, ready to sort.</li>
            </ol>
            <p class="small muted">Budget not in the share list? The app must be installed from <b>Chrome</b> (⋮ → Install app);
              icons added from other browsers are only shortcuts. Or save the file and tap <b>Import CSV</b>.</p>
            <p class="small muted">Overlapping periods are fine: already-imported transactions are skipped.
              Only the EUR account is imported; other currencies are left out.</p>
          </details>`}
      </section>`;

  const withdrawCard = `
      <section class="card withdraw-card" aria-label="To withdraw">
        <div class="hero-top"><span class="label"><span class="step">2</span> To withdraw from the pocket</span>
          <span class="muted small">${esc(s.names[me])}</span></div>
        <div class="big num" data-testid="withdraw-total">${formatCents(myTotal)}</div>
        <div class="muted">${mine.length ? `${mine.length} common purchase${mine.length > 1 ? 's' : ''} paid with your own money` : 'Nothing to withdraw right now'}</div>
        ${mine.length ? `
          <ul class="list" style="margin-top:10px">${mine.map((e) => expenseRow(e)).join('')}</ul>
          <button class="btn primary" style="margin-top:12px;width:100%" data-act="settle">✓ I've withdrawn ${formatCents(myTotal)}</button>` : ''}
        ${theirs.length ? `<p class="muted small" style="margin:12px 0 0" data-testid="other-pending">${esc(s.names[other])}: ${theirs.length} purchase${theirs.length > 1 ? 's' : ''}, ${formatCents(sum(theirs))} not withdrawn yet.</p>` : ''}
      </section>`;

  const closedNote = closed ? `
      <div class="notice" data-testid="closed-buys">${esc(monthLabel(month))} is closed down: its purchases can only be sorted as
        personal or already settled. Withdrawing still works.</div>` : '';
  const reminder = sorting.overdue ? `
      <div class="notice" data-testid="sort-reminder">Last sorted ${esc(purchases.daysAgoLabel(sorting.daysAgo))}.
        Import your Revolut statement and sort your purchases soon, so the wallet balance is right.</div>` : '';

  main.innerHTML = `
    <div class="stack">
${closedNote}
${reminder}
${sortCard}
${withdrawCard}

      <button class="btn" data-act="manual">+ Add common purchase by hand (cash)</button>

      ${sortedAwayCard(month)}

      <section class="card">
        <h2>Recent withdrawals</h2>
        ${settlements.length ? `<ul class="list">${settlements.map((st) => `
          <li class="row"><button class="row-btn" data-settlement="${esc(st.id)}">
            <span class="badge ${esc(st.person)}">${esc(s.initials[st.person] || '?')}</span>
            <span class="grow"><span class="title">${esc(s.names[st.person] || '?')} withdrew</span>
              <span class="sub">${esc(shortDateLabel(st.date))} · ${st.count || 0} purchase${st.count === 1 ? '' : 's'}</span></span>
            <span class="amount">${formatCents(st.amount)}</span>
          </button></li>`).join('')}</ul>` : '<p class="empty">No withdrawals yet.</p>'}
      </section>
    </div>`;

  main.querySelector('#csv-file').addEventListener('change', (e) => importFile(e.target));
  main.querySelector('[data-act="import"]').addEventListener('click', openImport);
  main.querySelector('[data-act="accept"]')?.addEventListener('click', () => {
    const n = purchases.acceptSuggestions(month);
    toast(`${n} sorted from earlier choices`);
  });
  main.querySelector('[data-act="settle"]')?.addEventListener('click', () => settle(me));
  main.querySelector('[data-act="settle-before"]')?.addEventListener('click', () => settleBefore(queue));
  main.querySelector('[data-act="manual"]').addEventListener('click', addManual);
  main.querySelectorAll('[data-goto-month]').forEach((btn) => {
    btn.addEventListener('click', () => ctx.setMonth(btn.dataset.gotoMonth));
  });
  main.querySelectorAll('[data-choose]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tx = queue.find((t) => t.key === btn.dataset.choose);
      if (!purchases.choose(btn.dataset.choose, btn.dataset.choice)) {
        toast(closed ? `${monthLabel(month)} is closed down: this purchase can only be personal or already settled.` : 'This purchase can\'t change any more.');
        return;
      }
      toast(`${tx ? tx.description : 'Purchase'}: ${btn.dataset.choice}`);
    });
  });
  main.querySelectorAll('[data-back]').forEach((btn) => {
    btn.addEventListener('click', () => {
      purchases.backToSort([btn.dataset.back]);
      toast('Back in "To sort"');
    });
  });
  main.querySelector('[data-act="back-all"]')?.addEventListener('click', () => {
    const keys = purchases.sortedAway(month).map((tx) => tx.key);
    if (!confirm(`Put all ${keys.length} back into "To sort"?`)) return;
    purchases.backToSort(keys);
    toast(`${keys.length} purchases back in "To sort"`);
  });
  main.querySelectorAll('[data-expense]').forEach((btn) => {
    btn.addEventListener('click', () => editExpense(state.allRecords()[btn.dataset.expense]));
  });
  main.querySelectorAll('[data-settlement]').forEach((btn) => {
    btn.addEventListener('click', () => showSettlement(btn.dataset.settlement));
  });
}

function sum(list) {
  return list.reduce((a, e) => a + e.amount, 0);
}

function sortRow(tx, closed = false) {
  const suggestion = purchases.suggestionFor(tx);
  const hint = suggestion ? `<span class="suggest ${suggestion}">usually ${suggestion}</span>` : '';
  return `<li class="row sort-row">
    <span class="grow"><span class="title">${esc(tx.description)}</span>
      <span class="sub">${esc([shortDateLabel(tx.date), tx.category].filter(Boolean).join(' · '))} ${hint}</span></span>
    <span class="amount">${formatCents(tx.amount)}</span>
    <span class="choice">
      <button class="chip-btn ${suggestion === 'personal' ? 'suggested' : ''}" data-choose="${esc(tx.key)}" data-choice="personal" aria-label="${esc(tx.description)}: personal">Personal</button>
      <button class="chip-btn common ${suggestion === 'common' ? 'suggested' : ''}" data-choose="${esc(tx.key)}" data-choice="common" aria-label="${esc(tx.description)}: common"
        ${closed ? 'aria-disabled="true" title="The month is closed down"' : ''}>Common</button>
    </span>
  </li>`;
}

/** Purchases sorted as personal or cleared as settled, with a way back. Collapsed by default. */
function sortedAwayCard(month) {
  const list = purchases.sortedAway(month);
  if (!list.length) return '';
  const shown = list.slice(0, 100);
  return `<details class="card sorted-away" data-testid="sorted-away">
    <summary><b>Personal & already settled</b> <span class="muted small">${list.length}</span></summary>
    <p class="muted small">Picked the wrong one? Put it back into "To sort".</p>
    <button class="btn small-btn" data-act="back-all">Put all ${list.length} back</button>
    <ul class="list" style="margin-top:8px">${shown.map((tx) => `
      <li class="row">
        <span class="grow"><span class="title">${esc(tx.description)}</span>
          <span class="sub">${esc(shortDateLabel(tx.date))} · ${purchases.statusOf(tx) === 'settled' ? 'already settled' : 'personal'}</span></span>
        <span class="amount">${formatCents(tx.amount)}</span>
        <button class="btn small-btn" data-back="${esc(tx.key)}" aria-label="${esc(tx.description)}: back to sorting">Back</button>
      </li>`).join('')}</ul>
    ${list.length > shown.length ? `<p class="muted small">Showing the newest ${shown.length}.</p>` : ''}
  </details>`;
}

function expenseRow(e) {
  return `<li class="row"><button class="row-btn" data-expense="${esc(e.id)}">
    <span class="grow"><span class="title">${esc(e.description || 'Purchase')}</span>
      <span class="sub">${esc(shortDateLabel(e.date))}${e.source === 'manual' ? ' · added by hand' : ''}</span></span>
    <span class="amount">${formatCents(e.amount)}</span>
  </button></li>`;
}


/**
 * "Import CSV": on the phone, offer to get a fresh statement from Revolut (which then
 * comes back through Share → Budget) or to pick a file already on the phone.
 * On a computer, go straight to the file picker.
 */
export async function openImport() {
  if (!isAndroid()) {
    pickFile();
    return;
  }
  const asked = openForm({
    title: 'Import Revolut statement',
    fields: [],
    submitLabel: 'Choose file',
    extraHtml: `
      <a class="btn primary import-revolut" href="${REVOLUT_APP}" data-act="open-revolut">Open Revolut</a>
      <ol class="small import-steps">
        <li><b>… More</b> → <b>Statement</b> → <b>Custom</b></li>
        <li>Period, format <b>CSV</b> → <b>Generate</b></li>
        <li>Open with <b>Sheets</b> → <b>Share</b> → <b>Budget</b></li>
      </ol>
      <p class="muted small">Already have the file on your phone? Choose it below.</p>`,
  });
  // Leaving for Revolut: close this window, so the app is tidy when the statement comes back.
  document.querySelector('#form-dialog [data-act="open-revolut"]').addEventListener('click', () => {
    setTimeout(() => document.getElementById('form-dialog').close(), 300);
  });
  if (await asked) pickFile();
}

function pickFile() {
  document.getElementById('csv-file')?.click();
}

async function importFile(input) {
  const file = input.files[0];
  input.value = '';
  if (!file) return;
  importText(await file.text(), view);
}

/**
 * Import a statement's text (from the file picker or Android's share sheet) into
 * the chosen month and say what happened. Purchases from other months are left
 * out, with a button to import the most recent of those months as well.
 */
export function importText(text, ctx) {
  const r = purchases.importCsv(text, { month: ctx.month });
  if (r.error) {
    toast(r.error, undefined, 'sticky');
    return;
  }
  const parts = [`${r.added} new purchase${r.added === 1 ? '' : 's'} in ${monthLabel(ctx.month)}`];
  if (r.known) parts.push(`${r.known} already imported`);
  const months = Object.keys(r.otherMonths || {}).sort();
  if (months.length) parts.push(`${months.map((m) => `${r.otherMonths[m]} from ${monthLabel(m)}`).join(', ')} left out`);
  const other = Object.entries(r.otherCurrency || {}).map(([cur, n]) => `${n} in ${cur}`);
  if (other.length) parts.push(`${other.join(', ')} left out (budget is in EUR)`);
  const why = r.reasons || {};
  if (why.unreadable) parts.push(`${why.unreadable} with an amount the app couldn't read`);
  if (why.unfinished) parts.push(`${why.unfinished} still pending`);
  if (r.added === 0 && !r.known && !months.length && !other.length && !why.unreadable && !why.unfinished) {
    parts.push(`no outgoing payments found (${why.incoming || 0} incoming, ${why.exchange || 0} exchanges)`);
  }
  // Offer the month next to the chosen one first (usually the end of last month).
  const next = months.length ? months.reduce((a, b) => (Math.abs(monthGap(a, ctx.month)) <= Math.abs(monthGap(b, ctx.month)) ? a : b)) : null;
  toast(parts.join(' · '), next && ctx.setMonth ? {
    label: `Import ${monthLabel(next).split(' ')[0]}`,
    run: () => {
      ctx.setMonth(next);
      importText(text, { ...ctx, month: next });
    },
  } : undefined, 'sticky');
}

/** Today, or the last day of the chosen month when looking at an earlier month. */
function defaultDate() {
  const today = dateKeyOf(new Date());
  if (!view.month || today.startsWith(view.month)) return today;
  return view.month < today ? `${view.month}-${String(daysInMonth(view.month)).padStart(2, '0')}` : `${view.month}-01`;
}

function monthGap(a, b) {
  const [ya, ma] = a.split('-').map(Number);
  const [yb, mb] = b.split('-').map(Number);
  return (ya - yb) * 12 + (ma - mb);
}

async function settle(me) {
  const total = sum(state.pendingExpenses(me));
  const values = await openForm({
    title: 'Withdrawn from the pocket?',
    fields: [],
    submitLabel: `Yes, ${formatCents(total)} withdrawn`,
    extraHtml: `<p class="muted" style="margin-top:0">Confirm once you've moved ${formatCents(total)} from the shared Revolut pocket to your own account.</p>`,
  });
  if (!values) return;
  state.settleExpenses(me);
  toast(`Withdrawal of ${formatCents(total)} recorded`, { label: 'Undo', run: state.undo });
}

/** Clear old unsorted purchases that were balanced out outside the app. */
async function settleBefore(queue) {
  const latest = queue.reduce((max, tx) => (tx.date > max ? tx.date : max), queue[0].date);
  const values = await openForm({
    title: 'Already settled before…',
    fields: [
      { name: 'date', label: 'Clear everything still unsorted up to and including', type: 'date', required: true, value: latest,
        hint: 'For purchases you balanced out some other way. They disappear from "To sort" without counting as common or personal, and the app does not learn anything about those shops. Sort the ones you want to keep first.' },
    ],
    submitLabel: 'Clear them',
  });
  if (!values) return;
  const keys = purchases.settleUpTo(values.date);
  toast(keys.length ? `${keys.length} purchase${keys.length > 1 ? 's' : ''} cleared as already settled` : 'Nothing unsorted up to that date',
    keys.length ? { label: 'Undo', run: () => purchases.unsettle(keys) } : undefined);
}

async function addManual() {
  const values = await openForm({
    title: 'Add common purchase',
    fields: [
      { name: 'amount', label: 'Amount', type: 'money', required: true, autofocus: true },
      { name: 'description', label: 'What / where', type: 'text', required: true, placeholder: 'Market, cash' },
      { name: 'date', label: 'Date', type: 'date', required: true, value: defaultDate() },
    ],
  });
  if (!values) return;
  if (values.amount <= 0) {
    toast('Please enter an amount above 0');
    return;
  }
  if (!purchases.addManual(values)) {
    toast(`${monthLabel(values.date.slice(0, 7))} is closed down: no new common purchases in it.`);
    return;
  }
  toast(`Added ${formatCents(values.amount)}`, { label: 'Undo', run: state.undo });
}

/** Tap a pending common purchase: move it back (imported) or delete it (typed in). */
async function editExpense(e) {
  if (state.isClosed(e.month)) {
    toast(`${monthLabel(e.month)} is closed down: its common purchases can't change. Withdrawing still works.`);
    return;
  }
  const imported = Boolean(purchases.inboxEntryFor(e));
  const values = await openForm({
    title: e.description || 'Purchase',
    fields: [],
    submitLabel: 'Close',
    deleteLabel: imported ? 'Not common after all' : 'Delete',
    extraHtml: `<p class="muted" style="margin-top:0">${formatCents(e.amount)} on ${esc(shortDateLabel(e.date))}.
      ${imported ? 'It goes back to the "To sort" list.' : ''}</p>`,
  });
  if (!values || !values.__delete) return;
  if (imported) purchases.choose(e.id.slice(3), 'new', { remember: false });
  else state.remove(e.id);
  toast('Removed from common purchases', { label: 'Undo', run: state.undo });
}

function showSettlement(id) {
  const st = state.allRecords()[id];
  const items = state.getExpenses().filter((e) => e.settlementId === id);
  openForm({
    title: `Withdrawal ${formatCents(st.amount)}`,
    fields: [],
    submitLabel: 'Close',
    extraHtml: `<p class="muted" style="margin-top:0">${esc(state.getSettings().names[st.person] || '')} · ${esc(shortDateLabel(st.date))}</p>
      <ul class="list">${items.map((e) => `<li class="row"><span class="grow"><span class="title">${esc(e.description)}</span>
        <span class="sub">${esc(shortDateLabel(e.date))}</span></span><span class="amount">${formatCents(e.amount)}</span></li>`).join('')}</ul>`,
  });
}
