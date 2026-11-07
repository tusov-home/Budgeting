// Rentals → Setup: apartment names, your share, SEK rates, private Sheet, privacy.

import * as store from '../../rentals/store.js';
import * as rsync from '../../rentals/sync.js';
import { testConnection } from '../../sync.js';
import { esc, toast } from '../dom.js';
import { openForm } from '../form.js';

export function html(todayKey) {
  const st = store.getSettings();
  const d = store.getDevice();
  const status = rsync.getStatus();
  const years = [...new Set([todayKey.slice(0, 4), ...store.getTransactions().map((t) => t.date.slice(0, 4)), ...Object.keys(st.rates)])]
    .sort().reverse();
  return `
    <section class="card">
      <h2>Apartments</h2>
      <form id="rent-apts" class="stack">
        <div class="field"><label for="apt-a">First apartment</label><input id="apt-a" type="text" value="${esc(st.apartments.a)}"></div>
        <div class="field"><label for="apt-b">Second apartment</label><input id="apt-b" type="text" value="${esc(st.apartments.b)}"></div>
        <div class="field"><label for="rent-share">Your share of the result (%)</label>
          <input id="rent-share" type="text" inputmode="decimal" value="${esc(String(st.share))}"></div>
        <h3 style="margin:6px 0 0">SEK per 1 EUR</h3>
        <p class="muted small" style="margin:0">Used to show Swedish amounts in euros, e.g. the yearly average rate
          your tax advisor uses.</p>
        ${years.map((y) => `<div class="field"><label for="rate-${y}">${y}</label>
          <input id="rate-${y}" data-rate="${y}" type="text" inputmode="decimal" placeholder="e.g. 11,20" value="${esc(st.rates[y] ? String(st.rates[y]).replace('.', ',') : '')}"></div>`).join('')}
        <button class="btn" type="submit">Save</button>
      </form>
    </section>

    <section class="card">
      <h2>Private Sheet</h2>
      <p class="muted small" style="margin-top:0">${rsync.isConfigured()
        ? `Connected. ${status.at ? `Last sync ${esc(new Date(status.at).toLocaleString('en-GB'))}.` : ''} ${store.pendingCount()} change(s) waiting.`
        : 'Not set up: the rentals data stays in this browser only. Set up a second, private Sheet to use it on your phone and laptop (SETUP.md, "Rentals").'}</p>
      ${status.kind === 'error' ? `<p class="form-error" data-testid="rent-sync-error">Last sync failed: ${esc(status.message)}</p>` : ''}
      <form id="rent-sync">
        <div class="field"><label for="rent-url">Web app URL (private Sheet)</label>
          <input id="rent-url" type="url" autocomplete="off" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(d.syncUrl)}"></div>
        <div class="field"><label for="rent-key">Sync key (private Sheet)</label>
          <input id="rent-key" type="password" autocomplete="off" value="${esc(d.syncKey)}">
          <div class="hint">Not the household key: this Sheet is only yours. Stored only in this browser.</div></div>
        <div class="btn-row">
          <button class="btn primary" type="submit">Test and save</button>
          ${rsync.isConfigured() ? '<button class="btn" type="button" data-rent="sync">Sync now</button>' : ''}
        </div>
      </form>
    </section>

    <section class="card">
      <h2>Privacy</h2>
      <ul class="muted small" style="margin:0;padding-left:18px">
        <li>This tab shows only on devices set to Tõnis (Settings → This phone belongs to).</li>
        <li>Rentals data never goes into the shared household Sheet. It is kept in this browser and, if set up, in your own private Sheet.</li>
        <li>Statements are read here in the app; the files themselves are not uploaded anywhere.</li>
        <li>Account numbers are shown shortened (…1234).</li>
      </ul>
      <div class="btn-row" style="margin-top:10px">
        <button class="btn danger" type="button" data-rent="clear">Remove rentals data from this device</button>
      </div>
    </section>`;
}

const parseNumber = (text) => {
  const v = Number(String(text).trim().replace(',', '.'));
  return Number.isFinite(v) && v > 0 ? v : null;
};

export function bind(main) {
  main.querySelector('#rent-apts')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const rates = { ...store.getSettings().rates };
    main.querySelectorAll('[data-rate]').forEach((inp) => {
      const v = parseNumber(inp.value);
      if (v) rates[inp.dataset.rate] = v;
      else delete rates[inp.dataset.rate];
    });
    const share = parseNumber(main.querySelector('#rent-share').value);
    store.saveSettings({
      apartments: { a: main.querySelector('#apt-a').value.trim() || 'Apartment 1', b: main.querySelector('#apt-b').value.trim() || 'Apartment 2' },
      share: share && share <= 100 ? share : 50,
      rates,
    });
    toast('Saved');
  });

  main.querySelector('#rent-sync')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = main.querySelector('#rent-url').value.trim();
    const key = main.querySelector('#rent-key').value.trim();
    if (!url || !key) {
      store.setDevice({ syncUrl: url, syncKey: key });
      toast('Saved. Private sync is off.');
      return;
    }
    try {
      await testConnection(url, key);
      store.setDevice({ syncUrl: url, syncKey: key });
      rsync.startAutoSync();
      const ok = await rsync.syncNow();
      toast(ok ? 'Connected to your private Sheet and synced' : 'Connected, but the first sync failed');
    } catch (err) {
      toast(`Could not connect: ${err.message}`, undefined, 'sticky');
    }
  });

  main.querySelector('[data-rent="sync"]')?.addEventListener('click', async () => {
    toast((await rsync.syncNow()) ? 'Synced' : 'Sync failed, will retry');
  });

  main.querySelector('[data-rent="clear"]')?.addEventListener('click', async () => {
    const synced = rsync.isConfigured() && store.pendingCount() === 0;
    const ok = await openForm({
      title: 'Remove rentals data from this device?',
      fields: [],
      submitLabel: 'Remove',
      extraHtml: `<p class="muted" style="margin-top:0">${synced
        ? 'Your private Sheet keeps everything: connect again to get it back.'
        : 'This device has rentals data that is not in a private Sheet. It will be gone.'}</p>`,
    });
    if (!ok) return;
    store.clearDevice();
    toast('Rentals data removed from this device');
  });
}
