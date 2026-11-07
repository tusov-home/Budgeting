// All keyboard shortcuts in one table: keys → action.
// main.js passes in the actions; this module only decides which key does what.

import { isFormOpen } from './form.js';

export const SHORTCUTS = [
  { keys: ['1', '…', '6'], label: 'Screens in tab order: Month, Wallet, Purchases, Big costs, (Rentals,) Settings', action: null },
  { keys: ['I'], label: 'Import statement (Revolut; Swedbank on Rentals)', action: 'import' },
  { keys: ['←', '→'], label: 'Previous / next month', action: null },
  { keys: ['T'], label: 'Jump to this month', action: 'today' },
  { keys: ['C'], label: 'Check in the Revolut balance', action: 'checkin' },
  { keys: ['A'], label: 'Add money to the wallet', action: 'topup' },
  { keys: ['N'], label: 'Add big cost (on Big costs); add by hand or a recurring payment (on Rentals)', action: 'new' },
  { keys: ['F'], label: 'Add fixed cost', action: 'fixed' },
  { keys: ['Ctrl', 'Z'], label: 'Undo', action: null },
  { keys: ['Ctrl', 'Y'], label: 'Redo (also Ctrl+Shift+Z)', action: null },
  { keys: ['Ctrl', 'S'], label: 'Sync now', action: null },
  { keys: ['Enter'], label: 'Save the open form', action: null },
  { keys: ['Esc'], label: 'Close the open form', action: null },
  { keys: ['?'], label: 'Show shortcuts', action: 'help' },
];

// Plain keys (no Ctrl) → action name.
const PLAIN = {
  // Digits follow the visible tabs (Rentals only shows on Tõnis's devices).
  '1': 'tab:1', '2': 'tab:2', '3': 'tab:3', '4': 'tab:4', '5': 'tab:5', '6': 'tab:6', i: 'import',
  ArrowLeft: 'prevMonth', ArrowRight: 'nextMonth',
  t: 'today', c: 'checkin', a: 'topup', n: 'new', f: 'fixed', '?': 'help',
};

function isTyping(target) {
  if (!target) return false;
  // A field inside a dialog that has just closed doesn't count as typing.
  const dlg = target.closest && target.closest('dialog');
  if (dlg && !dlg.open) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

/** actions: { name: () => void } */
export function installShortcuts(actions) {
  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey; // Ctrl on Windows, Cmd on Mac

    if (mod && !e.altKey) {
      const k = e.key.toLowerCase();
      let name = null;
      if (k === 'z' && !e.shiftKey) name = 'undo';
      else if (k === 'y' || (k === 'z' && e.shiftKey)) name = 'redo';
      else if (k === 's') name = 'sync';
      if (!name) return;
      // Undo/redo inside a text field should stay the browser's own text undo.
      if ((name === 'undo' || name === 'redo') && isTyping(e.target)) return;
      if (isFormOpen() && name !== 'sync') return;
      e.preventDefault();
      actions[name]?.();
      return;
    }

    if (e.altKey || mod || isFormOpen() || isTyping(e.target)) return;
    const name = PLAIN[e.key.length === 1 ? e.key.toLowerCase() : e.key] || PLAIN[e.key];
    if (!name || !actions[name]) return;
    e.preventDefault();
    actions[name]();
  });
}
