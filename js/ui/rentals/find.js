// Rentals → Find: search and filter sorted transactions, e.g. to check a number in the Year table.
// The Year table opens this with a filter (tap a row or a cell).

import * as store from '../../rentals/store.js';
import { partsOf, split, toEur, CATEGORIES, matchText } from '../../lib/rentals.js';
import { formatCents, formatMoney } from '../../lib/money.js';
import { esc } from '../dom.js';
import { aptLabel, catLabel } from './common.js';
import { row, sortForm } from './sort.js';

const ALL = { q: '', apartment: 'all', category: 'all', year: 'all' };
let filter = { ...ALL };
let limit = 100;

/** Set the filter (from the Year table); fields left out are "all". */
export function setFilter(f) {
  filter = { ...ALL, ...f };
  limit = 100;
}

export const isFiltered = () => JSON.stringify(filter) !== JSON.stringify(ALL);

/**
 * What a line adds to the filtered total, in euro cents, the same way the Year table counts it:
 * only the parts of the chosen category, and for one apartment its share of "Both" lines.
 * null when SEK has no rate for that year.
 */
function shareOf(t, rates) {
  const year = t.date.slice(0, 4);
  let sum = 0;
  for (const p of partsOf(t)) {
    if (filter.category !== 'all' && p.category !== filter.category) continue;
    const eur = toEur(p.amount, t.currency, year, rates);
    if (eur === null) return null;
    if (filter.apartment === 'a' || filter.apartment === 'b') sum += split(eur, t.apartment)[filter.apartment];
    else sum += eur;
  }
  return sum;
}

function matches(t) {
  if (filter.year !== 'all' && !t.date.startsWith(filter.year)) return false;
  if (filter.apartment !== 'all') {
    // "Flat A" includes lines for both flats, as in the Year table.
    const ok = filter.apartment === t.apartment || ((filter.apartment === 'a' || filter.apartment === 'b') && t.apartment === 'both');
    if (!ok) return false;
  }
  if (filter.category !== 'all' && !partsOf(t).some((p) => p.category === filter.category)) return false;
  const q = matchText(filter.q);
  if (q) {
    const amounts = [t.amount, ...partsOf(t).map((p) => p.amount)]
      .map((a) => formatMoney(Math.abs(a), t.currency)).join(' ');
    const hay = matchText([t.party, t.details, t.ref, aptLabel(t.apartment),
      ...partsOf(t).map((p) => catLabel(p.category)), amounts].join(' '));
    // Every word must be found somewhere (e.g. "kaanon 89").
    if (!q.split(' ').every((w) => hay.includes(w))) return false;
  }
  return true;
}

function resultsHtml(todayKey) {
  const rates = store.getSettings().rates;
  const list = store.getSorted().filter(matches);
  let total = 0;
  let unconverted = 0;
  for (const t of list) {
    const v = shareOf(t, rates);
    if (v === null) unconverted++;
    else total += v;
  }
  const shown = list.slice(0, limit);
  return `<p class="find-summary" data-testid="find-summary"><b>${list.length}</b> line${list.length === 1 ? '' : 's'}
      · total <b class="num" data-testid="find-total">${esc(formatCents(total))}</b>${unconverted ? ` <span class="muted small">(${unconverted} SEK without rate left out)</span>` : ''}</p>
    ${shown.length ? `<ul class="list rent-list">${shown.map((t) => row(t, todayKey, false)).join('')}</ul>`
      : '<p class="muted">Nothing found.</p>'}
    ${list.length > shown.length ? `<button class="btn" data-find="more">Show ${Math.min(100, list.length - shown.length)} more</button>` : ''}`;
}

export function html(todayKey) {
  const years = [...new Set(store.getSorted().map((t) => t.date.slice(0, 4)))].sort().reverse();
  const names = store.getSettings().apartments;
  const apts = [['all', 'All'], ['a', names.a], ['b', names.b], ['both', 'Both'], ['none', 'Not rental']];
  return `<section class="card" data-testid="rent-find">
    <div class="field" style="margin-top:0">
      <label for="find-q">Search sorted lines</label>
      <input id="find-q" type="search" autocomplete="off" placeholder="Payee, description, reference or amount" value="${esc(filter.q)}">
    </div>
    <div class="seg find-apts" role="group" aria-label="Apartment">${apts.map(([v, label]) => `
      <button type="button" data-find-apt="${v}" aria-pressed="${filter.apartment === v}">${esc(label)}</button>`).join('')}</div>
    <div class="find-row">
      <div class="field"><label for="find-cat">Category</label>
        <select id="find-cat"><option value="all">All categories</option>${CATEGORIES.map((c) => `
          <option value="${c.id}" ${filter.category === c.id ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select></div>
      <div class="field"><label for="find-year">Year</label>
        <select id="find-year"><option value="all">All years</option>${years.map((y) => `
          <option value="${y}" ${filter.year === y ? 'selected' : ''}>${y}</option>`).join('')}</select></div>
    </div>
    ${isFiltered() ? '<button class="btn small-btn" data-find="clear">Clear filters</button>' : ''}
    <div id="find-results">${resultsHtml(todayKey)}</div>
    <p class="muted small" style="margin:8px 0 0">The total counts like the Year table: only the chosen category's part of a split line,
      and a flat's half of lines for both flats. Tap a line to change it.</p>
  </section>`;
}

export function bind(main, todayKey, rerender) {
  const results = main.querySelector('#find-results');
  const bindRows = () => {
    results.querySelectorAll('[data-tx]').forEach((b) => b.addEventListener('click', () => sortForm(store.get(b.dataset.tx))));
    results.querySelector('[data-find="more"]')?.addEventListener('click', () => {
      limit += 100;
      refresh();
    });
  };
  // Typing only redraws the results, so the search field keeps its focus.
  const refresh = () => {
    results.innerHTML = resultsHtml(todayKey);
    bindRows();
  };
  bindRows();
  main.querySelector('#find-q').addEventListener('input', (e) => {
    filter.q = e.target.value;
    limit = 100;
    refresh();
  });
  main.querySelectorAll('[data-find-apt]').forEach((b) => b.addEventListener('click', () => {
    filter.apartment = b.dataset.findApt;
    rerender();
  }));
  main.querySelector('#find-cat').addEventListener('change', (e) => {
    filter.category = e.target.value;
    rerender();
  });
  main.querySelector('#find-year').addEventListener('change', (e) => {
    filter.year = e.target.value;
    rerender();
  });
  main.querySelector('[data-find="clear"]')?.addEventListener('click', () => {
    setFilter({});
    rerender();
  });
}

/** Focus the search field (the / key). */
export function focusSearch(main) {
  const q = main.querySelector('#find-q');
  if (q) {
    q.focus();
    q.select();
  }
}
