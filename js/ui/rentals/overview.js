// Rentals → Overview: account balances, upcoming payments, month by month.

import * as store from '../../rentals/store.js';
import { monthGrid, upcomingPayments, toEur } from '../../lib/rentals.js';
import { formatMoney, formatCentsWhole } from '../../lib/money.js';
import { esc, toast } from '../dom.js';
import { openForm } from '../form.js';
import { aptLabel, amountHtml, masked, dayLabel } from './common.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayNum = (d) => Math.round(Date.parse(`${d}T00:00:00Z`) / 86400000);

export function html(todayKey, year, yearNav) {
  return `${balancesCard(todayKey)}${upcomingCard(todayKey)}${monthsCard(todayKey, year, yearNav)}`;
}

function balancesCard(todayKey) {
  const accounts = store.getAccounts();
  const rates = store.getSettings().rates;
  const year = todayKey.slice(0, 4);
  if (!accounts.length) {
    return `<section class="card" data-testid="rent-balances">
      <h2>Accounts</h2>
      <p class="muted" style="margin:0">No accounts yet. Import a Swedbank statement (Sort → Import Swedbank CSV):
        the account and its balance are added from it.</p>
    </section>`;
  }
  return `<section class="card" data-testid="rent-balances">
    <h2>Accounts</h2>
    <ul class="list">${accounts.map((a) => {
      const old = a.balanceDate && dayNum(todayKey) - dayNum(a.balanceDate) > 35;
      const eur = a.currency !== 'EUR' && a.balance != null ? toEur(a.balance, a.currency, year, rates) : null;
      return `<li class="acct-row">
        <button class="row-btn" data-acct="${esc(a.id)}" title="Rename or set the balance">
          <span><b>${esc(a.name)}</b> <span class="muted small">${esc(masked(a.number))}</span><br>
            <span class="muted small ${old ? 'warn-text' : ''}">${a.balanceDate ? `as of ${esc(dayLabel(a.balanceDate, todayKey))}${old ? ': import a newer statement' : ''}` : 'no balance yet'}</span></span>
          <span class="acct-balance"><span class="num" data-testid="acct-balance">${a.balance == null ? '—' : esc(formatMoney(a.balance, a.currency))}</span>
            ${eur !== null ? `<br><span class="muted small num">≈ ${esc(formatCentsWhole(eur))}</span>` : ''}</span>
        </button>
      </li>`;
    }).join('')}</ul>
  </section>`;
}

function upcomingCard(todayKey) {
  const bills = store.getBills();
  if (!bills.length) {
    return `<section class="card"><h2>Upcoming payments</h2>
      <p class="muted" style="margin:0">No recurring payments yet. Add them under Bills (management fee, building association, insurance, land tax…).</p></section>`;
  }
  const items = upcomingPayments(bills, store.getSorted(), store.getPaidMarks(), todayKey, { since: store.firstDate() });
  const badge = { overdue: 'Not paid yet', 'due-soon': 'Due soon', upcoming: '', paid: '✓ Paid' };
  return `<section class="card" data-testid="rent-upcoming">
    <h2>Upcoming payments</h2>
    <ul class="list">${items.map((u) => `
      <li class="bill-row ${u.status}" data-testid="bill-${u.status}">
        <span class="bill-date">${esc(dayLabel(u.due, todayKey))}</span>
        <span class="bill-main"><b>${esc(u.bill.name)}</b><br><span class="muted small">${esc(aptLabel(u.bill.apartment))}${
          u.paidBy && u.paidBy !== 'mark' ? ` · paid ${esc(dayLabel(u.paidBy.date, todayKey))}` : u.paidBy === 'mark' ? ' · marked as paid' : ''}</span></span>
        <span class="bill-end">${amountHtml(-u.bill.amount, u.bill.currency)}
          ${badge[u.status] ? `<br><span class="tag ${u.status}">${badge[u.status]}</span>` : ''}</span>
        ${u.status === 'overdue' || u.status === 'due-soon'
          ? `<button class="chip-btn" data-paid="${esc(u.bill.id)}|${esc(u.due)}" title="Paid from another account or in cash" aria-label="Mark ${esc(u.bill.name)} as paid">Paid</button>`
          : u.paidBy === 'mark' ? `<button class="chip-btn" data-unpaid="${esc(u.bill.id)}|${esc(u.due)}">Undo</button>` : ''}
      </li>`).join('')}</ul>
    <p class="muted small" style="margin:8px 0 0">A payment counts as paid when a sorted transaction with the same
      category and apartment is near its date.</p>
  </section>`;
}

function monthsCard(todayKey, year, yearNav) {
  const rates = store.getSettings().rates;
  const grid = monthGrid(store.getSorted(), year, rates);
  const names = store.getSettings().apartments;
  const thisMonth = todayKey.slice(0, 7);
  const dataFrom = store.firstDate().slice(0, 7); // before the first statement we simply don't know
  const rentCell = (cents, month) => {
    if (cents > 0) return `<td class="num ok-cell">✓ ${esc(formatCentsWhole(cents))}</td>`;
    const missing = month < thisMonth && dataFrom && month >= dataFrom;
    return `<td class="num ${missing ? 'warn-text' : 'muted'}">${missing ? 'missing' : '—'}</td>`;
  };
  const rows = grid.filter((m) => m.month <= thisMonth || String(year) !== todayKey.slice(0, 4));
  return `<section class="card" data-testid="rent-months">
    <div class="card-head"><h2>Month by month</h2>${yearNav}</div>
    ${rows.length ? `<div class="table-wrap"><table class="grid-table">
      <thead><tr><th></th><th>Rent ${esc(names.a)}</th><th>Rent ${esc(names.b)}</th><th>Costs</th></tr></thead>
      <tbody>${rows.map((m) => `<tr>
        <th scope="row">${MONTHS[Number(m.month.slice(5)) - 1]}</th>
        ${rentCell(m.a.rent, m.month)}${rentCell(m.b.rent, m.month)}
        <td class="num">${m.a.costs + m.b.costs ? esc(formatCentsWhole(m.a.costs + m.b.costs)) : '<span class="muted">—</span>'}</td>
      </tr>`).join('')}</tbody>
    </table></div>` : '<p class="muted">Nothing yet for this year.</p>'}
    <p class="muted small" style="margin:8px 0 0">From sorted transactions, in euros${Object.keys(rates).length ? ' (SEK converted with the yearly rate in Setup)' : ''}.</p>
  </section>`;
}

/** Rename an account, or set its balance by hand (e.g. after checking the bank). */
async function editAccount(a) {
  if (!a) return;
  const values = await openForm({
    title: a.name,
    introHtml: `<p class="muted small" style="margin-top:0">${esc(a.currency)} account ${esc(masked(a.number))}</p>`,
    fields: [
      { name: 'name', label: 'Name', type: 'text', value: a.name, required: true },
      { name: 'balance', label: `Balance (${a.currency})`, type: 'money', value: a.balance, allowNegative: true },
      { name: 'balanceDate', label: 'Balance on', type: 'date', value: a.balanceDate },
    ],
    submitLabel: 'Save',
  });
  if (!values) return;
  store.put({ id: a.id, name: values.name, balance: values.balance, balanceDate: values.balanceDate || a.balanceDate });
  toast('Saved', { label: 'Undo', run: store.undo });
}

export function bind(main) {
  main.querySelectorAll('[data-acct]').forEach((b) => b.addEventListener('click', () => editAccount(store.get(b.dataset.acct))));
  main.querySelectorAll('[data-paid]').forEach((b) => b.addEventListener('click', () => {
    const [id, due] = b.dataset.paid.split('|');
    store.markPaid(id, due, true);
    toast('Marked as paid', { label: 'Undo', run: store.undo });
  }));
  main.querySelectorAll('[data-unpaid]').forEach((b) => b.addEventListener('click', () => {
    const [id, due] = b.dataset.unpaid.split('|');
    store.markPaid(id, due, false);
  }));
}
