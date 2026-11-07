// Rentals → Year: income, costs and result per apartment for one year (for the tax return).

import * as store from '../../rentals/store.js';
import { yearSummary, CATEGORIES } from '../../lib/rentals.js';
import { centsToInput } from '../../lib/money.js';

// Plain numbers in the table ("1.041,31"); the header says EUR. Keeps the columns narrow on a phone.
const plain = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (cents) => plain.format((cents || 0) / 100);
import { esc, toast } from '../dom.js';

export function html(year, yearNav = '') {
  const st = store.getSettings();
  const s = yearSummary(store.getSorted(), year, st.rates);
  const names = st.apartments;
  const used = (kind) => CATEGORIES.filter((c) => c.kind === kind && ['a', 'b'].some((k) => s[k].byCategory[c.id]));
  const line = (label, get, cls = '') => `<tr class="${cls}"><th scope="row">${label}</th>${['a', 'b', 'total']
    .map((k) => `<td class="num">${esc(num(get(s[k])))}</td>`).join('')}</tr>`;
  const catLine = (c) => line(`${esc(c.label)} <span class="muted small">${esc(c.de)}</span>`, (x) => x.byCategory[c.id] || 0);
  const share = st.share / 100;
  return `<section class="card" data-testid="rent-year">
    <div class="card-head"><h2>Year</h2>${yearNav}</div>
    ${s.unconverted ? `<p class="notice" data-testid="rent-unconverted">${s.unconverted} SEK transaction${s.unconverted === 1 ? '' : 's'} left out:
      add the SEK rate for ${esc(String(year))} in Setup.</p>` : ''}
    <div class="table-wrap"><table class="grid-table year-table">
      <thead><tr><th>EUR</th><th>${esc(names.a)}</th><th>${esc(names.b)}</th><th>Total</th></tr></thead>
      <tbody>
        <tr class="group"><th colspan="4">Income</th></tr>
        ${used('income').map(catLine).join('') || '<tr><td colspan="4" class="muted">none</td></tr>'}
        ${line('Income', (x) => x.income, 'sum')}
        <tr class="group"><th colspan="4">Costs</th></tr>
        ${used('cost').map(catLine).join('') || '<tr><td colspan="4" class="muted">none</td></tr>'}
        ${line('Costs', (x) => x.costs, 'sum')}
        ${line('Result', (x) => x.result, 'result')}
        ${line(`Your share (${esc(String(st.share))} %)`, (x) => Math.round(x.result * share), 'share')}
        ${used('tax').length ? `<tr class="group"><th colspan="4">Shown separately</th></tr>${used('tax').map(catLine).join('')}` : ''}
        ${used('other').length ? `${used('tax').length ? '' : '<tr class="group"><th colspan="4">Shown separately</th></tr>'}${used('other').map(catLine).join('')}` : ''}
      </tbody>
    </table></div>
    <div class="btn-row" style="margin-top:10px">
      <button class="btn small-btn" data-rent="copy-year" title="Copy as a table (paste into a sheet or e-mail)">Copy table</button></div>
    <p class="muted small" style="margin:8px 0 0">Costs are negative. Transactions sorted to "Both" are split evenly.
      SEK is converted with the yearly rate in Setup. The German words are only there to help find the right line;
      what counts, and how, is for you and your tax advisor to decide.</p>
  </section>`;
}

/** Tab-separated table: pastes neatly into Google Sheets, Excel or an e-mail. */
export function tableText(year) {
  const st = store.getSettings();
  const s = yearSummary(store.getSorted(), year, st.rates);
  const n = (c) => centsToInput(c);
  const rows = [['', st.apartments.a, st.apartments.b, 'Total']];
  for (const c of CATEGORIES) {
    if (!['a', 'b'].some((k) => s[k].byCategory[c.id])) continue;
    rows.push([`${c.label} (${c.de})`, n(s.a.byCategory[c.id] || 0), n(s.b.byCategory[c.id] || 0), n(s.total.byCategory[c.id] || 0)]);
  }
  rows.push(['Income', n(s.a.income), n(s.b.income), n(s.total.income)]);
  rows.push(['Costs', n(s.a.costs), n(s.b.costs), n(s.total.costs)]);
  rows.push(['Result', n(s.a.result), n(s.b.result), n(s.total.result)]);
  rows.push([`Your share (${st.share} %)`, ...['a', 'b', 'total'].map((k) => n(Math.round(s[k].result * st.share / 100)))]);
  return `Rentals ${year} (EUR)\n${rows.map((r) => r.join('\t')).join('\n')}\n`;
}

export function bind(main, year) {
  main.querySelector('[data-rent="copy-year"]')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(tableText(year));
      toast('Table copied: paste it into a sheet or e-mail');
    } catch {
      toast('Copying isn\'t allowed here');
    }
  });
}
