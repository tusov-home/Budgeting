// Starts the app and wires the modules together. Little logic of its own.

import * as state from './state.js';
import * as sync from './sync.js';
import { requestPersistence } from './storage.js';
import { APP_VERSION } from './version.js';
import { monthKeyOf, dateKeyOf, addMonths, monthLabel } from './lib/months.js';
import { toast, esc } from './ui/dom.js';
import { openForm, isFormOpen } from './ui/form.js';
import { installShortcuts, SHORTCUTS } from './ui/shortcuts.js';
import * as walletView from './ui/wallet.js';
import * as monthView from './ui/month.js';
import * as bigView from './ui/bigcosts.js';
import * as settingsView from './ui/settings.js';
import * as purchasesView from './ui/purchases.js';
import * as rentalsView from './ui/rentals/index.js';
import * as rentalsStore from './rentals/store.js';
import * as rentalsSync from './rentals/sync.js';
import { toSort, sortStatus } from './purchases.js';
import { installSwipe } from './ui/swipe.js';
import { installHaptics } from './ui/haptics.js';

// Order = the monthly routine = tab order = swipe order = keys 1–6.
const VIEWS = { month: monthView, wallet: walletView, buys: purchasesView, big: bigView, rentals: rentalsView, settings: settingsView };

/** The screens this device shows: Rentals only on Tõnis's devices. */
function visibleViews() {
  const rentals = rentalsView.isVisibleFor(state.getDevice().me);
  return Object.keys(VIEWS).filter((v) => v !== 'rentals' || rentals);
}

const main = document.getElementById('main');
let currentMonth = monthKeyOf(new Date());

function currentView() {
  const name = location.hash.replace('#', '');
  return visibleViews().includes(name) ? name : startView();
}

/** Where to start when no screen is chosen: Month until this month is locked, then Wallet. */
function startView() {
  return state.isLocked(monthKeyOf(new Date())) ? 'wallet' : 'month';
}

function ctx() {
  return { month: currentMonth, todayKey: dateKeyOf(new Date()), setMonth };
}

// ---------- rendering ----------

let pendingRender = false;

function render() {
  // Don't redraw under someone who is typing in a field on the page;
  // redraw as soon as they leave the field instead.
  const active = document.activeElement;
  if (active && main.contains(active) && (active.tagName === 'INPUT') && active.type !== 'checkbox' && active.type !== 'radio') {
    pendingRender = true;
    return;
  }
  pendingRender = false;

  const view = currentView();
  const shown = visibleViews();
  document.getElementById('month-title').textContent = monthLabel(currentMonth);
  document.querySelectorAll('.tabs a').forEach((a) => {
    const i = shown.indexOf(a.dataset.view);
    a.hidden = i === -1;
    // Tooltip with the tab's key; the label is the link's own text (without icon and badge).
    a.dataset.label ??= [...a.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
    a.title = `${a.dataset.label} (${i + 1})`;
    if (a.dataset.view === view) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  document.querySelector('.tabs').classList.toggle('six', shown.length === 6);
  // Month navigation means nothing on Settings and Rentals (Rentals has its own year).
  document.querySelector('.month-nav').style.visibility = view === 'settings' || view === 'rentals' ? 'hidden' : 'visible';
  if (shown.includes('rentals')) {
    rentalsSync.startAutoSync(); // only does something once, and only syncs when set up
    const rentWaiting = rentalsStore.getUnsorted().length;
    const rentBadge = document.getElementById('rent-badge');
    rentBadge.hidden = rentWaiting === 0;
    rentBadge.textContent = rentWaiting > 99 ? '99+' : String(rentWaiting);
  }

  // Badge on the Purchases tab: how many imported purchases still need sorting.
  // Or "!" when sorting is overdue (last full sort more than a week ago).
  const waiting = toSort().length;
  const overdue = sortStatus().overdue;
  const badge = document.getElementById('buys-badge');
  badge.hidden = waiting === 0 && !overdue;
  badge.textContent = waiting ? (waiting > 99 ? '99+' : String(waiting)) : '!';

  VIEWS[view].render(main, ctx());
  renderSyncChip(sync.getStatus());
}

main.addEventListener('focusout', () => {
  if (pendingRender) setTimeout(render, 0);
});

function setMonth(key) {
  currentMonth = key;
  render();
}

// ---------- sync status chip ----------

/**
 * Sync status: shown as a chip (with the version) on the Wallet page.
 * On other screens it only appears, as an orange line under the header, when something is wrong.
 */
function renderSyncChip(status) {
  const pending = state.pendingCount();
  let text;
  switch (status.kind) {
    case 'off': text = 'Not synced'; break;
    case 'syncing': text = 'Syncing…'; break;
    case 'offline': text = pending ? `Offline · ${pending} waiting` : 'Offline'; break;
    case 'error': text = 'Sync failed'; break;
    case 'ok': text = status.at ? `Synced ${new Date(status.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : 'Synced'; break;
    default: text = sync.isConfigured() ? 'Sync' : 'Not synced';
  }
  const kind = sync.isConfigured() ? status.kind : 'off';
  const title = status.kind === 'error' ? `Sync failed: ${status.message} (Ctrl+S to retry)` : 'Sync now (Ctrl+S)';

  const chip = document.getElementById('sync-chip');
  if (chip) {
    chip.querySelector('.sync-text').textContent = text;
    chip.dataset.kind = kind;
    chip.title = title;
  }

  const alert = document.getElementById('sync-alert');
  const problem = sync.isConfigured() && (status.kind === 'error' || (status.kind === 'offline' && pending > 0));
  alert.hidden = !problem || Boolean(chip);
  alert.textContent = status.kind === 'error' ? 'Sync failed. Tap to retry' : `Offline · ${pending} change${pending === 1 ? '' : 's'} waiting to sync`;
  alert.title = title;
}

// ---------- actions (used by buttons and shortcuts) ----------

function showHelp() {
  openForm({
    title: 'Keyboard shortcuts',
    fields: [],
    submitLabel: 'Close',
    extraHtml: `<dl class="shortcut-list">${SHORTCUTS.map((sc) =>
      `<dt>${sc.keys.map((k) => `<kbd>${esc(k)}</kbd>`).join(' ')}</dt><dd>${esc(sc.label)}</dd>`).join('')}</dl>`,
  });
}

// On the Rentals screen, undo/redo and sync work on the private rentals data.
function doUndo() {
  const done = currentView() === 'rentals' ? rentalsStore.undo() : state.undo();
  toast(done ? 'Undone' : 'Nothing to undo');
}

function doRedo() {
  const done = currentView() === 'rentals' ? rentalsStore.redo() : state.redo();
  toast(done ? 'Redone' : 'Nothing to redo');
}

function doSync() {
  if (currentView() === 'rentals') {
    if (!rentalsSync.isConfigured()) toast('Private Sheet not set up yet (Rentals → Setup)');
    else rentalsSync.syncNow().then((ok) => toast(ok ? 'Synced (private Sheet)' : 'Sync failed, will retry'));
    return;
  }
  if (!sync.isConfigured()) {
    toast('Sync is not set up yet (Settings)');
    return;
  }
  sync.syncNow().then((ok) => toast(ok ? 'Synced' : 'Sync failed, will retry'));
}

const actions = {
  'view:wallet': () => { location.hash = 'wallet'; },
  'view:month': () => { location.hash = 'month'; },
  'view:big': () => { location.hash = 'big'; },
  'view:settings': () => { location.hash = 'settings'; },
  'view:buys': () => { location.hash = 'buys'; },
  import: () => {
    if (currentView() === 'rentals') return rentalsView.importAction(main, ctx());
    if (currentView() !== 'buys') location.hash = 'buys';
    setTimeout(purchasesView.openImport, 0);
  },
  prevMonth: () => setMonth(addMonths(currentMonth, -1)),
  nextMonth: () => setMonth(addMonths(currentMonth, 1)),
  today: () => setMonth(monthKeyOf(new Date())),
  checkin: () => walletView.checkIn(ctx()),
  topup: () => walletView.addTopup(ctx()),
  new: () => {
    if (currentView() === 'big') bigView.editSpread(ctx());
    else if (currentView() === 'rentals') rentalsView.newAction();
  },
  fixed: () => { location.hash = 'month'; monthView.editFixed(ctx()); },
  help: showHelp,
  undo: doUndo,
  redo: doRedo,
  sync: doSync,
};
// Digit keys: the n-th visible tab.
for (let n = 1; n <= 6; n++) {
  actions[`tab:${n}`] = () => {
    const name = visibleViews()[n - 1];
    if (name) location.hash = name;
  };
}

// ---------- new version check ----------

async function checkForUpdate() {
  try {
    const res = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const { version } = await res.json();
    if (version && version > APP_VERSION) document.getElementById('update-banner').hidden = false;
  } catch {
    // Offline: try again later.
  }
}

/**
 * Reload with the newest files: let the new service worker take over,
 * throw away saved copies, then reload.
 */
async function reloadFresh() {
  const btn = document.getElementById('reload-btn');
  btn.disabled = true;
  btn.textContent = 'Loading…';
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        await reg.update();
        if (reg.installing || reg.waiting) {
          // Wait (max 3 s) until the new service worker controls this page.
          await new Promise((resolve) => {
            navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true });
            setTimeout(resolve, 3000);
          });
        }
      }
    }
    if (window.caches) {
      for (const key of await caches.keys()) await caches.delete(key);
    }
  } catch {
    // Whatever happens, still reload.
  }
  location.reload();
}

// ---------- start ----------

document.getElementById('prev-month').addEventListener('click', actions.prevMonth);
document.getElementById('next-month').addEventListener('click', actions.nextMonth);
document.getElementById('month-title').addEventListener('click', actions.today);
document.getElementById('sync-alert').addEventListener('click', doSync);
// The chip is redrawn with the Wallet page, so listen on the page instead of the chip itself.
main.addEventListener('click', (e) => {
  if (e.target.closest('#sync-chip')) doSync();
});
document.getElementById('reload-btn').addEventListener('click', reloadFresh);

// Which way the next screen slides in ('left', 'right' or null).
let slideFrom = null;

window.addEventListener('hashchange', () => {
  render();
  if (slideFrom) {
    // A new screen starts at the top, standing still. This also stops any scrolling
    // that was still gliding from the swipe, so the next tap works at once.
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    main.classList.remove('slide-from-left', 'slide-from-right');
    void main.offsetWidth; // restart the animation
    main.classList.add(`slide-from-${slideFrom}`);
    slideFrom = null;
  }
  main.focus({ preventScroll: true });
  window.scrollTo(0, 0);
});

/** Go to the screen `step` places away in tab order (+1 = next, −1 = previous). */
function stepView(step) {
  const names = visibleViews();
  const i = names.indexOf(currentView()) + step;
  if (i < 0 || i >= names.length) return; // already at the first/last screen
  slideFrom = step > 0 ? 'right' : 'left';
  location.hash = names[i];
}

function canStep(step) {
  const names = visibleViews();
  const i = names.indexOf(currentView()) + step;
  return i >= 0 && i < names.length;
}

// Listen on the whole document, so swiping also works on empty space below short pages.
installSwipe(document, {
  target: main,
  canGo: canStep,
  onLeft: () => stepView(1),
  onRight: () => stepView(-1),
});

let renderQueued = false;
state.subscribe(() => {
  // Several changes in one go (e.g. a sync) → one redraw.
  if (renderQueued) return;
  renderQueued = true;
  queueMicrotask(() => {
    renderQueued = false;
    if (!isFormOpen()) render();
    else pendingRender = true;
  });
  renderSyncChip(sync.getStatus());
  // Once there is data worth keeping, ask Chrome not to clear it.
  requestPersistence();
});
// Rentals data changes (edits, private sync) → redraw when that screen is shown.
rentalsStore.subscribe(() => {
  if (!isFormOpen()) render();
  else pendingRender = true;
});
document.getElementById('form-dialog').addEventListener('close', () => {
  if (pendingRender) render();
});

// Opened without a screen in the address (e.g. from the home screen icon): pick the right one.
if (!visibleViews().includes(location.hash.replace('#', ''))) history.replaceState(null, '', `#${startView()}`);

sync.onStatus(renderSyncChip);
installShortcuts(actions);
installHaptics();
render();
renderSyncChip(sync.getStatus());
sync.startAutoSync();

checkForUpdate();
setInterval(checkForUpdate, 30 * 60 * 1000);

// Statements handed to the app by Android: "Share" → Household Budget
// (share target, parked by the service worker) or "Open with" → Household
// Budget (file handler, delivered through launchQueue).
async function takeSharedStatements() {
  const params = new URLSearchParams(location.search);
  if (!params.has('shared')) return;
  history.replaceState(null, '', location.pathname + '#buys');
  let texts = [];
  try {
    const cache = await caches.open('household-budget-shared');
    const key = new URL('shared-statements', location.href).href;
    const stored = await cache.match(key);
    if (stored) texts = await stored.json();
    await cache.delete(key);
  } catch { /* nothing parked */ }
  importShared(texts);
}

function importShared(texts) {
  location.hash = 'buys';
  if (!texts.length) {
    toast('No statement file arrived. Choose CSV as the format in Revolut and share the file.', undefined, 'sticky');
    return;
  }
  texts.forEach((t) => purchasesView.importText(t, ctx()));
}

takeSharedStatements();
if ('launchQueue' in window) {
  window.launchQueue.setConsumer(async (launch) => {
    if (!launch.files || !launch.files.length) return;
    const texts = [];
    for (const handle of launch.files) texts.push(await (await handle.getFile()).text());
    importShared(texts);
  });
}

// Service workers need a secure page: https (GitHub Pages) or localhost.
if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
