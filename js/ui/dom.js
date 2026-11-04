// Small DOM helpers shared by the screens.

import { getSettings } from '../state.js';

/** Make text safe to put inside HTML (names and notes are typed by people). */
export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Opens the Revolut app on Android: Revolut's app catches this web address
// (tested on our phone; its start screen can't be opened with an "intent:" link).
// Without the app installed it simply opens Revolut's website.
// Revolut has no public link that opens a transfer to a joint account or pocket
// with the amount filled in, so the app copies the amount instead.
export const REVOLUT_APP = 'https://www.revolut.com/app/';
export const isAndroid = () => /Android/i.test(navigator.userAgent);

/** Coloured initials badge for a payer: 't', 'k' or 'wallet'. */
export function payerBadge(payer) {
  const s = getSettings();
  const label = payer === 'wallet' ? 'W' : s.initials[payer] || '?';
  const title = payerName(payer);
  return `<span class="badge ${esc(payer)}" title="Paid by ${esc(title)}">${esc(label)}</span>`;
}

export function payerName(payer) {
  if (payer === 'wallet') return 'shared wallet';
  return getSettings().names[payer] || payer;
}

/** Options for the "who pays" choice in forms. */
export function payerOptions() {
  const s = getSettings();
  return [
    { value: 't', label: s.names.t },
    { value: 'k', label: s.names.k },
    { value: 'wallet', label: 'Wallet' },
  ];
}

let toastTimer = null;
/**
 * Short message at the bottom; optional action button (e.g. Undo).
 * It stays long enough to read (longer messages stay longer).
 * ms: 'sticky' keeps it until OK is tapped, e.g. for import results.
 */
export function toast(message, action, ms = null) {
  const el = document.getElementById('toast');
  el.innerHTML = `<span>${esc(message)}</span>`;
  const hide = () => {
    clearTimeout(toastTimer);
    el.classList.remove('show');
  };
  const buttons = document.createElement('span');
  buttons.className = 'toast-buttons';
  if (action) {
    const btn = document.createElement('button');
    btn.textContent = action.label;
    btn.addEventListener('click', () => {
      hide();
      action.run();
    });
    buttons.appendChild(btn);
  }
  if (ms === 'sticky') {
    const ok = document.createElement('button');
    ok.textContent = 'OK';
    ok.dataset.act = 'toast-ok';
    ok.addEventListener('click', hide);
    buttons.appendChild(ok);
  }
  if (buttons.childElementCount) el.appendChild(buttons);
  el.classList.add('show');
  clearTimeout(toastTimer);
  if (ms === 'sticky') return;
  // About 15 characters a second, plus time to notice it.
  const readingTime = 1500 + message.length * 65;
  toastTimer = setTimeout(hide, Math.max(ms || 0, action ? 6000 : 2500, readingTime));
}
