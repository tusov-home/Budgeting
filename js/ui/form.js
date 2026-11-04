// One reusable form dialog. Screens describe the fields; this module
// builds the form, validates it and returns the values.
//
//   const values = await openForm({
//     title: 'Add purchase',
//     fields: [{ name: 'amount', label: 'Amount', type: 'money', required: true }],
//   });
//   // values is null when cancelled, or { amount: 1230 } (cents)
//
// Field types: text, money, date, number, choice (segmented buttons), checkbox.
// The native <dialog> element gives us focus trapping and Esc-to-close.

import { esc } from './dom.js';
import { parseCents, centsToInput } from '../lib/money.js';

const dialog = () => document.getElementById('form-dialog');

export function isFormOpen() {
  return dialog().open;
}

// submitPrimary: false when another button in extraHtml is the main (green) one.
export function openForm({ title, fields, submitLabel = 'Save', deleteLabel = null, extraHtml = '', submitPrimary = true }) {
  const dlg = dialog();
  dlg.innerHTML = `
    <form method="dialog" novalidate>
      <h2 id="form-dialog-title">${esc(title)}</h2>
      ${fields.map(fieldHtml).join('')}
      ${extraHtml}
      <p class="form-error" aria-live="polite"></p>
      <div class="dialog-actions">
        ${deleteLabel ? `<button type="button" class="btn danger" data-act="delete">${esc(deleteLabel)}</button><span class="spacer"></span>` : ''}
        <button type="button" class="btn" data-act="cancel">Cancel <kbd>Esc</kbd></button>
        <button type="submit" class="btn ${submitPrimary ? 'primary' : ''}">${esc(submitLabel)}</button>
      </div>
    </form>`;

  const form = dlg.querySelector('form');
  const errorEl = dlg.querySelector('.form-error');

  // Remember where focus was, to give it back when the form closes.
  const opener = document.activeElement;

  return new Promise((resolve) => {
    let done = false;
    const cleanups = [];
    const finish = (result) => {
      if (done) return;
      done = true;
      cleanups.forEach((undo) => undo());
      if (dlg.open) dlg.close();
      // Without this, focus can stay on an input inside the closed dialog,
      // and keyboard shortcuts would think you are still typing.
      if (dlg.contains(document.activeElement)) document.activeElement.blur();
      if (opener && opener.isConnected && opener !== document.body) opener.focus({ preventScroll: true });
      resolve(result);
    };

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const { values, error } = readValues(form, fields);
      if (error) {
        errorEl.textContent = error;
        return;
      }
      finish(values);
    });
    dlg.querySelector('[data-act="cancel"]').addEventListener('click', () => finish(null));
    const del = dlg.querySelector('[data-act="delete"]');
    if (del) del.addEventListener('click', () => finish({ __delete: true }));
    // The "close" event arrives a moment after closing. When one form opens right after
    // another, the old form's close must not shut the new one: only react while closed.
    const onClose = () => { if (!dlg.open) finish(null); };
    dlg.addEventListener('close', onClose);
    cleanups.push(() => dlg.removeEventListener('close', onClose));

    applyShowIf(form, fields);
    form.addEventListener('change', () => applyShowIf(form, fields));

    // Whichever field gets focus, keep it visible above the keyboard.
    form.addEventListener('focusin', (e) => keepVisible(e.target));
    if (window.visualViewport) {
      const onResize = () => keepVisible(document.activeElement);
      window.visualViewport.addEventListener('resize', onResize);
      cleanups.push(() => window.visualViewport.removeEventListener('resize', onResize));
    }

    // A thin line above the pinned buttons only when the form is scrollable.
    const markScrolling = () => dlg.classList.toggle('is-scrolling', dlg.scrollHeight > dlg.clientHeight + 1);
    dlg.addEventListener('scroll', markScrolling, { passive: true });
    window.visualViewport?.addEventListener('resize', markScrolling);
    cleanups.push(() => window.visualViewport?.removeEventListener('resize', markScrolling));
    cleanups.push(() => dlg.removeEventListener('scroll', markScrolling));

    dlg.showModal();
    markScrolling();
    const first = form.querySelector('[autofocus]') || form.querySelector('input:not([type="radio"]), input[type="radio"]:checked');
    if (first) {
      first.focus();
      if (first.select && first.type !== 'date') first.select();
    }
  });
}

/** Scroll a field into view inside the dialog (e.g. after the keyboard opened). */
function keepVisible(el) {
  if (!el || !dialog().contains(el) || el.tagName === 'BUTTON') return;
  // Wait a moment: the keyboard animates in and the visible area shrinks.
  setTimeout(() => el.scrollIntoView({ block: 'nearest', inline: 'nearest' }), 250);
}

// Fields with showIf: { field: 'kind', value: 'oneoff' } only show when that choice is picked.
function applyShowIf(form, fields) {
  for (const f of fields) {
    if (!f.showIf) continue;
    const checked = form.querySelector(`input[name="${f.showIf.field}"]:checked`);
    const visible = checked && checked.value === String(f.showIf.value);
    form.querySelector(`[data-field="${f.name}"]`).hidden = !visible;
  }
}

function fieldHtml(f) {
  return fieldInner(f).replace('<div class="field"', `<div class="field" data-field="${f.name}"`);
}

function fieldInner(f) {
  const id = `f-${f.name}`;
  const hint = f.hint ? `<div class="hint">${esc(f.hint)}</div>` : '';
  const auto = f.autofocus ? 'autofocus' : '';
  switch (f.type) {
    case 'money':
      return `<div class="field"><label for="${id}">${esc(f.label)}</label>
        <input id="${id}" name="${f.name}" class="money" inputmode="decimal" autocomplete="off"
          placeholder="0,00" value="${esc(f.value == null ? '' : centsToInput(f.value))}" ${auto}>${hint}</div>`;
    case 'date':
      return `<div class="field"><label for="${id}">${esc(f.label)}</label>
        <input id="${id}" name="${f.name}" type="date" value="${esc(f.value || '')}" ${auto}>${hint}</div>`;
    case 'number':
      return `<div class="field"><label for="${id}">${esc(f.label)}</label>
        <input id="${id}" name="${f.name}" type="number" inputmode="numeric" min="${f.min ?? ''}" max="${f.max ?? ''}"
          value="${esc(f.value ?? '')}" ${auto}>${hint}</div>`;
    case 'choice':
      return `<div class="field" role="radiogroup" aria-labelledby="${id}-l"><div class="label" id="${id}-l">${esc(f.label)}</div>
        <div class="seg">${f.options.map((o, i) => `
          <input type="radio" id="${id}-${i}" name="${f.name}" value="${esc(o.value)}" ${String(o.value) === String(f.value) ? 'checked' : ''}>
          <label for="${id}-${i}">${esc(o.label)}</label>`).join('')}
        </div>${hint}</div>`;
    case 'checkbox':
      return `<div class="field"><label class="check-field"><input type="checkbox" class="check" name="${f.name}" ${f.value ? 'checked' : ''}> ${esc(f.label)}</label>${hint}</div>`;
    default:
      return `<div class="field"><label for="${id}">${esc(f.label)}</label>
        <input id="${id}" name="${f.name}" type="${f.inputType || 'text'}" autocomplete="off"
          value="${esc(f.value || '')}" placeholder="${esc(f.placeholder || '')}" ${auto}>${hint}</div>`;
  }
}

function readValues(form, fields) {
  const values = {};
  for (const f of fields) {
    let v;
    if (f.type === 'choice') {
      const checked = form.querySelector(`input[name="${f.name}"]:checked`);
      v = checked ? checked.value : null;
      if (v !== null && typeof f.options[0].value === 'number') v = Number(v);
    } else if (f.type === 'checkbox') {
      v = form.querySelector(`input[name="${f.name}"]`).checked;
    } else {
      const raw = form.querySelector(`[name="${f.name}"]`).value.trim();
      if (f.type === 'money') {
        v = raw === '' ? null : parseCents(raw);
        if (raw !== '' && v === null) return { error: `${f.label}: please enter a number, e.g. 12,50` };
        if (v !== null && v < 0 && !f.allowNegative) return { error: `${f.label} cannot be negative.` };
      } else if (f.type === 'number') {
        v = raw === '' ? null : Number(raw);
        if (v !== null && (!Number.isFinite(v) || (f.min != null && v < f.min))) {
          return { error: `${f.label}: please enter a number of at least ${f.min}.` };
        }
      } else {
        v = raw;
      }
    }
    if (f.required && f.type === 'checkbox' && !v) return { error: `Please tick: ${f.label}.` };
    if (f.required && (v === null || v === '')) return { error: `${f.label} is needed.` };
    values[f.name] = v;
  }
  return { values };
}
