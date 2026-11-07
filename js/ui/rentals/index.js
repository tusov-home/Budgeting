// Rentals screen: Tõnis's private page for the Swedbank accounts and the rental apartments.
// Shown only on devices set to Tõnis. Sections: Overview, Sort, Bills, Year, Setup.
// Data: js/rentals/store.js (never in the shared household Sheet).

import * as store from '../../rentals/store.js';
import { esc } from '../dom.js';
import * as overview from './overview.js';
import * as sort from './sort.js';
import * as bills from './bills.js';
import * as year from './year.js';
import * as setup from './setup.js';
import * as find from './find.js';

const SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'sort', label: 'Sort' },
  { id: 'find', label: 'Find' },
  { id: 'bills', label: 'Bills' },
  { id: 'year', label: 'Year' },
  { id: 'setup', label: 'Setup' },
];

let section = null; // chosen section (null = pick: Sort when there is something to sort)
let shownYear = null;

/** The Rentals tab is only for Tõnis's devices. */
export const isVisibleFor = (me) => me === 't';

function currentSection() {
  if (section) return section;
  if (!store.hasData()) return 'setup';
  return store.getUnsorted().length ? 'sort' : 'overview';
}

export function render(main, ctx) {
  const todayKey = ctx.todayKey;
  const current = currentSection();
  const y = shownYear || Number(todayKey.slice(0, 4));
  const waiting = store.getUnsorted().length;
  const yearNav = `<div class="year-nav">
    <button class="icon-btn" data-year="-1" aria-label="Previous year">‹</button>
    <b data-testid="rent-year-label">${y}</b>
    <button class="icon-btn" data-year="1" aria-label="Next year">›</button></div>`;

  let body;
  if (current === 'sort') body = sort.html(todayKey);
  else if (current === 'bills') body = bills.html(todayKey);
  else if (current === 'year') body = year.html(y, yearNav);
  else if (current === 'setup') body = setup.html(todayKey);
  else if (current === 'find') body = find.html(todayKey);
  else body = overview.html(todayKey, y, yearNav);

  main.innerHTML = `
    <div class="stack rentals">
      <div class="rent-head">
        <div class="seg rent-tabs" role="tablist" aria-label="Rentals sections">
          ${SECTIONS.map((s) => `<button type="button" role="tab" data-section="${s.id}" aria-selected="${s.id === current}"
            data-testid="rent-tab-${s.id}">${esc(s.label)}${s.id === 'sort' && waiting ? ` <span class="tab-count">${waiting}</span>` : ''}</button>`).join('')}
        </div>
      </div>
      ${body}
    </div>`;

  main.querySelectorAll('[data-section]').forEach((b) => b.addEventListener('click', () => {
    section = b.dataset.section;
    render(main, ctx);
  }));
  main.querySelectorAll('[data-year]').forEach((b) => b.addEventListener('click', () => {
    shownYear = y + Number(b.dataset.year);
    render(main, ctx);
  }));
  // Open Find with a filter (from the Year table or the "Find…" button).
  const openFind = (f) => {
    if (f) find.setFilter(f);
    section = 'find';
    render(main, ctx);
    if (!f) find.focusSearch(main);
  };
  if (current === 'sort') {
    sort.bind(main);
    main.querySelector('[data-rent="find"]')?.addEventListener('click', () => openFind(null));
  } else if (current === 'find') find.bind(main, todayKey, () => render(main, ctx));
  else if (current === 'bills') bills.bind(main);
  else if (current === 'year') year.bind(main, y, openFind);
  else if (current === 'setup') setup.bind(main);
  else overview.bind(main);
}

/** I on the Rentals screen: go to Sort and open the file picker. */
export function importAction(main, ctx) {
  section = 'sort';
  render(main, ctx);
  sort.pickFile(main);
}

/** / on the Rentals screen: go to Find and focus its search field. */
export function searchAction(main, ctx) {
  section = 'find';
  render(main, ctx);
  find.focusSearch(main);
}

/** N on the Rentals screen: a recurring payment on Bills, otherwise a transaction by hand. */
export function newAction() {
  if (currentSection() === 'bills') bills.editBill(null);
  else sort.addManual();
}
