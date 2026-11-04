// Month screen: salaries, wallet budget, fixed costs, big-cost shares,
// each person's private money and deposit into the shared wallet.

import * as state from '../state.js';
import { formatCents, parseCents, centsToInput } from '../lib/money.js';
import { monthLabel } from '../lib/months.js';
import { esc, payerBadge, payerOptions, toast, REVOLUT_APP, isAndroid } from './dom.js';
import { openForm } from './form.js';
import * as closedown from './closedown.js';

export function render(main, ctx) {
  const { month } = ctx;

  const reminder = closedown.reminderHtml(ctx);
  if (!state.monthIsSetUp(month)) {
    renderStart(main, month, reminder);
    closedown.bindReminder(main, ctx);
    return;
  }

  // Both approved (or both asked to unlock) since the last look? Apply it first.
  state.applyLockVotes(month);
  const { m, fixed, spreadShares: shares, plan, carry, startBalance } = state.planFor(month);
  const incomes = state.getIncomes(month);
  const s = state.getSettings();
  const paidCount = fixed.filter((f) => f.paid).length;

  const locked = Boolean(m.locked);

  main.innerHTML = `
    <div class="stack">${reminder}
      <section class="card">
        <div class="card-head">
          <h2>Fixed costs <span class="muted small">${paidCount}/${fixed.length} paid</span></h2>
          ${locked ? '' : '<button class="btn small-btn" data-act="add-fixed" title="Add fixed cost (F)">+ Add <kbd>F</kbd></button>'}
        </div>
        ${fixed.length ? `<ul class="list">${fixed.map((f) => fixedRow(f, locked)).join('')}</ul>` : '<p class="empty">No fixed costs yet. Add rent, phone, electricity…</p>'}
      </section>

      <section class="card">
        <h2>This month's money</h2>
        <div class="stack">
          ${moneyField('income-t', `${s.names.t}'s salary`, incomes.t, locked)}
          ${moneyField('income-k', `${s.names.k}'s salary`, incomes.k, locked)}
          ${moneyField('wallet-budget', 'Wallet budget for everyday spending', m.walletBudget, locked)}
          ${carryField(carry, locked)}
        </div>
      </section>

      ${shares.length ? `
      <section class="card">
        <div class="card-head"><h2>Big costs this month</h2>${locked ? '<span class="muted small">frozen with the lock</span>' : '<a class="small" href="#big">Manage</a>'}</div>
        <ul class="list">${shares.map((sh) => `
          <li class="row">${payerBadge(sh.payer)}
            <span class="grow"><span class="title">${esc(sh.name)}</span><span class="sub">${esc(sh.note)}</span></span>
            <span class="amount">${formatCents(sh.amount)}</span></li>`).join('')}
        </ul>
      </section>` : ''}

      ${lockCard(month, m, s)}

      ${resultCard(s, plan, state.getTransfersDone(month))}

      <section class="card">
        <h2>Summary</h2>
        <table class="sumtable">
          <tr><td>Salaries together</td><td>${formatCents(plan.incomeTotal)}</td></tr>
          <tr><td>− Fixed costs</td><td>${formatCents(plan.fixedTotal)}</td></tr>
          ${plan.spreadTotal ? `<tr><td>− Big costs (this month's share)</td><td>${formatCents(plan.spreadTotal)}</td></tr>` : ''}
          <tr><td>− Wallet budget</td><td>${formatCents(plan.walletBudget)}</td></tr>
          <tr class="total"><td>Leftover</td><td>${formatCents(plan.leftover)}</td></tr>
          <tr><td>Private money each (${esc(s.initials.t)} / ${esc(s.initials.k)})</td><td>${formatCents(plan.privateMoney.t)} / ${formatCents(plan.privateMoney.k)}</td></tr>
        </table>
        <table class="sumtable" style="margin-top:14px">
          <tr><td></td><td>${esc(s.initials.t)} / ${esc(s.initials.k)}</td></tr>
          <tr><td>Salary</td><td>${formatCents(plan.income.t)} / ${formatCents(plan.income.k)}</td></tr>
          <tr><td>− Paid from own account</td><td>${formatCents(plan.paid.t)} / ${formatCents(plan.paid.k)}</td></tr>
          <tr><td>− Private money</td><td>${formatCents(plan.privateMoney.t)} / ${formatCents(plan.privateMoney.k)}</td></tr>
          <tr class="total"><td>Into the wallet</td><td>${formatCents(plan.deposit.t)} / ${formatCents(plan.deposit.k)}</td></tr>
        </table>
        <p class="muted small" style="margin:10px 0 0" data-testid="wallet-start">The wallet starts the month with ${formatCents(startBalance)}${startBalance !== plan.walletBudget ? ' (deposits + carry-over − costs paid from the wallet)' : ''}. Check-ins compare the balance with this.</p>
      </section>
    </div>`;

  main.querySelectorAll('[data-vote]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const want = btn.dataset.vote === 'none' ? null : btn.dataset.vote;
      state.voteLock(month, want);
      const { locked } = state.lockInfo(month);
      if (want === 'lock') toast(locked ? `${monthLabel(month)} is locked: both agreed` : 'Approved. Waiting for the other one.');
      else if (want === 'unlock') toast(locked ? 'Unlock requested. Waiting for the other one.' : 'Unlocked: both agreed');
      else toast('Approval withdrawn');
    });
  });

  closedown.bindReminder(main, ctx);
  if (locked) {
    bindTracking(main, month);
    return;
  }

  // Money fields save when you leave them (or press Enter).
  bindMoney(main, '#wallet-budget', m.walletBudget, (cents) => {
    state.put({ id: `month:${month}`, type: 'month', month, walletBudget: cents });
  });
  // Empty field = automatic carry-over from last month's final check-in.
  bindMoney(main, '#carry-over', carry.overridden ? carry.amount : null, (cents) => {
    state.put({ id: `month:${month}`, type: 'month', month, carryOver: cents });
  }, null);
  for (const p of ['t', 'k']) {
    bindMoney(main, `#income-${p}`, incomes[p], (cents) => state.setIncome(month, p, cents));
  }

  main.querySelector('[data-act="add-fixed"]').addEventListener('click', () => editFixed(ctx));
  main.querySelectorAll('[data-edit]').forEach((btn) => {
    btn.addEventListener('click', () => editFixed(ctx, state.allRecords()[btn.dataset.edit]));
  });
  bindTracking(main, month);
}

/** Things that stay possible after locking: ticking costs as paid, marking transfers. */
function bindTracking(main, month) {
  bindRevolut(main, month);
  // Tapping a deposit box toggles "to transfer" ↔ "transferred".
  main.querySelectorAll('[data-transfer]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const p = btn.dataset.transfer;
      const now = !state.getTransfersDone(month)[p];
      state.setTransferDone(month, p, now);
      toast(now ? 'Marked as transferred' : 'Marked as still to transfer', { label: 'Undo', run: state.undo });
    });
  });
  main.querySelectorAll('[data-paid]').forEach((box) => {
    box.addEventListener('change', () => state.put({ id: box.dataset.paid, paid: box.checked }));
  });
}

function lockCard(month, m, s) {
  const me = state.getDevice().me;
  const other = me === 't' ? 'k' : 't';
  const { locked, status } = state.lockInfo(month);
  const line = (p) => {
    const text = {
      approved: '✓ approved',
      stale: 'approved earlier numbers. Needs to approve again',
      waiting: locked ? 'happy with the lock' : 'not approved yet',
      unlock: 'asked to unlock',
    }[status[p]];
    return `<li class="vote ${status[p]}" data-testid="vote-${p}"><b>${esc(s.names[p])}</b> · ${esc(text)}</li>`;
  };

  if (locked) {
    const when = m.lockedAt ? new Date(m.lockedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';
    const iAsked = status[me] === 'unlock';
    const theyAsked = status[other] === 'unlock';
    return `<section class="card lock-card is-locked" data-testid="lock-card">
      <b>🔒 Budget locked</b> <span class="muted small">${esc(when)} · tracking uses these numbers</span>
      ${iAsked || theyAsked ? `<ul class="votes">${line('t')}${line('k')}</ul>` : ''}
      <div class="btn-row" style="margin-top:10px">
        ${iAsked
          ? '<button class="btn small-btn" data-vote="lock">Cancel my unlock request</button>'
          : `<button class="btn small-btn" data-vote="unlock">${theyAsked ? `Agree to unlock (${esc(s.names[other])} asked)` : 'Ask to unlock'}</button>`}
      </div>
      <p class="muted small" style="margin:8px 0 0">Unlocks only when both of you agree.</p>
    </section>`;
  }

  const mine = status[me];
  return `<section class="card lock-card" data-testid="lock-card">
    <h2>Agree and lock</h2>
    <p class="muted small" style="margin-top:0">Is the fixed-cost list complete, and is the wallet budget agreed?
      The budget locks when <b>both</b> of you have approved the same numbers. Changing anything after approving asks for approval again.</p>
    <ul class="votes">${line('t')}${line('k')}</ul>
    <div class="btn-row">
      ${mine === 'approved'
        ? '<button class="btn small-btn" data-vote="none">Withdraw my approval</button>'
        : `<button class="btn primary" data-vote="lock">✓ ${mine === 'stale' ? 'Approve the new numbers' : `I approve the ${esc(monthLabel(month))} budget`}</button>`}
    </div>
  </section>`;
}

function moneyField(id, label, cents, locked = false) {
  return `<div class="inline-field">
    <label for="${id}">${esc(label)}</label>
    <input id="${id}" class="money" inputmode="decimal" autocomplete="off" placeholder="0,00" value="${esc(cents ? centsToInput(cents) : '')}" ${locked ? 'readonly' : ''}>
  </div>`;
}

/**
 * Save a money field when you leave it. With emptyMeans = null, an empty
 * field saves null (used for "automatic" carry-over); otherwise it saves 0.
 */
function bindMoney(main, selector, oldCents, save, emptyMeans = 0) {
  const input = main.querySelector(selector);
  input.addEventListener('change', () => {
    const empty = input.value.trim() === '';
    const cents = empty ? emptyMeans : parseCents(input.value);
    if (!empty && (cents === null || cents < 0)) {
      input.value = oldCents ? centsToInput(oldCents) : '';
      toast('Please enter a number, e.g. 2450,50');
      return;
    }
    const before = oldCents === undefined ? emptyMeans : oldCents;
    if (cents !== before && !(emptyMeans === 0 && !cents && !before)) {
      save(cents);
      toast('Saved');
    }
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
  });
}

function carryField(carry, locked = false) {
  const autoText = carry.auto && state.isClosed(carry.prevKey)
    ? `Automatic: ${formatCents(carry.auto.balance)}, the final balance of ${monthLabel(carry.prevKey)} (closed down).`
    : carry.auto
    ? `Automatic: ${formatCents(carry.auto.balance)} from the last check-in of ${monthLabel(carry.prevKey)} (${carry.auto.date.slice(8)}.${carry.auto.date.slice(5, 7)}.).`
    : `Automatic: nothing, no check-in in ${monthLabel(carry.prevKey)}.`;
  return `<div class="inline-field">
    <label for="carry-over">Carried over from last month</label>
    <input id="carry-over" class="money" inputmode="decimal" autocomplete="off"
      placeholder="${esc(carry.auto ? centsToInput(carry.auto.balance) : '0,00')}"
      value="${esc(carry.overridden ? centsToInput(carry.amount) : '')}" ${locked ? 'readonly' : ''}>
  </div>
  <p class="muted small" style="margin:6px 0 0" data-testid="carry-hint">${esc(autoText)}
    ${carry.overridden ? 'You typed your own amount; empty the field to go back to automatic.' : 'Type an amount only to override it.'}
    It adds to the balance, not to the budget.</p>`;
}

function resultCard(s, plan, done) {
  if (!plan.hasIncomes) {
    return `<section class="card" aria-label="Result">
      <h2>Private money and deposits</h2>
      <p class="muted" style="margin:0">Enter both salaries below to see what stays with each of you and what goes into the wallet.</p>
    </section>`;
  }
  const warn = plan.leftover < 0
    ? `<p class="form-error" style="margin:10px 0 0">Costs and wallet are ${formatCents(-plan.leftover)} more than both salaries together.</p>` : '';
  return `<section class="card" aria-label="Result">
    <h2>Transfers to the wallet</h2>
    <div class="deposits">
      ${depositBox('t', s, plan, done.t)}
      ${depositBox('k', s, plan, done.k)}
    </div>
    ${revolutButton(s, plan, done)}
    <p class="muted small" style="margin:10px 0 0">Tap a box when the transfer is done in Revolut.
      Deposit = salary − own-account costs − private half.</p>
    ${warn}
    <div class="private-line">
      <span>Private money each</span>
      <span class="num" data-testid="private">${formatCents(plan.privateMoney.t)}</span>
    </div>
  </section>`;
}

/**
 * "Open Revolut": for this phone's owner, while their deposit is still to transfer.
 * Copies the amount (to paste in Revolut's transfer screen) and opens the app.
 */
function revolutButton(s, plan, done) {
  const me = state.getDevice().me;
  const amount = plan.deposit[me];
  if (!isAndroid() || amount <= 0 || done[me]) return '';
  return `<a class="btn primary revolut-btn" href="${REVOLUT_APP}" data-act="revolut-transfer" data-amount="${amount}"
      data-testid="revolut-transfer">Open Revolut · copy ${formatCents(amount)}</a>
    <p class="muted small" style="margin:6px 0 0">In Revolut: transfer to the shared wallet and paste the amount.
      When you come back, the app asks whether it's done.</p>`;
}

/** Amount as typed in Revolut: no thousands dots, comma for cents (1234,56). */
const pasteAmount = (cents) => centsToInput(cents).replace(/\./g, '');

/**
 * After "Open Revolut": copy the amount, and when the app is shown again,
 * offer to mark the transfer as done (one tap instead of finding the box).
 */
function bindRevolut(main, month) {
  const link = main.querySelector('[data-act="revolut-transfer"]');
  if (!link) return;
  link.addEventListener('click', () => {
    const cents = Number(link.dataset.amount);
    navigator.clipboard?.writeText(pasteAmount(cents)).catch(() => {});
    const me = state.getDevice().me;
    const onBack = () => {
      if (document.visibilityState !== 'visible') return;
      document.removeEventListener('visibilitychange', onBack);
      if (state.getTransfersDone(month)[me]) return;
      toast(`Transferred ${formatCents(cents)} to the wallet?`, {
        label: 'Yes, mark done',
        run: () => {
          state.setTransferDone(month, me, true);
          toast('Marked as transferred', { label: 'Undo', run: state.undo });
        },
      }, 'sticky');
    };
    // Wait until we have actually left for Revolut before listening for the way back.
    setTimeout(() => document.addEventListener('visibilitychange', onBack), 500);
  });
}

function depositBox(p, s, plan, isDone) {
  const v = plan.deposit[p];
  const status = v >= 0
    ? (isDone ? '✓ Transferred' : 'To transfer')
    : (isDone ? '✓ Received' : 'To receive');
  return `<button type="button" class="deposit ${p} ${isDone ? 'is-done' : ''}" data-testid="deposit-${p}"
      data-transfer="${p}" aria-pressed="${isDone}">
    <span class="who">${esc(s.names[p])} <span class="muted small">${esc(s.initials[p])}</span></span>
    <span class="v num">${formatCents(Math.abs(v))}</span>
    <span class="muted small">${v >= 0 ? 'into the wallet' : 'back from the wallet'}</span>
    <span class="status" data-testid="status-${p}">${status}</span>
  </button>`;
}

function fixedRow(f, locked) {
  const inner = `${payerBadge(f.payer)}
      <span class="grow"><span class="title">${esc(f.name)}</span></span>
      <span class="amount">${formatCents(f.amount)}</span>`;
  return `<li class="row ${f.paid ? 'is-paid' : ''}">
    <input type="checkbox" class="check" data-paid="${esc(f.id)}" ${f.paid ? 'checked' : ''} aria-label="${esc(f.name)} paid">
    ${locked
      ? `<span class="row-btn is-static">${inner}</span>`
      : `<button class="row-btn" data-edit="${esc(f.id)}" aria-label="Edit ${esc(f.name)}">${inner}</button>`}
  </li>`;
}

function renderStart(main, month, reminder = '') {
  const prev = state.previousSetUpMonth(month);
  main.innerHTML = `
    <div class="stack">${reminder}
      <section class="card">
        <h2>Start ${esc(monthLabel(month))}</h2>
        <p class="muted">${prev
          ? `Copy the salaries, wallet budget and fixed costs from ${esc(monthLabel(prev))}. Everything starts as unpaid, and you can change any amount afterwards.`
          : 'This is your first month. Start empty and add the wallet budget and fixed costs.'}</p>
        <div class="btn-row">
          ${prev ? `<button class="btn primary" data-act="copy">Copy from ${esc(monthLabel(prev))}</button>` : ''}
          <button class="btn ${prev ? '' : 'primary'}" data-act="empty">Start empty</button>
        </div>
      </section>
    </div>`;
  const copy = main.querySelector('[data-act="copy"]');
  if (copy) copy.addEventListener('click', () => {
    state.copyMonth(prev, month);
    toast(`Copied from ${monthLabel(prev)}`, { label: 'Undo', run: state.undo });
  });
  main.querySelector('[data-act="empty"]').addEventListener('click', () => {
    state.put({ id: `month:${month}`, type: 'month', month, walletBudget: 0 });
    setTimeout(() => document.getElementById('wallet-budget')?.focus(), 0);
  });
}

export async function editFixed(ctx, existing = null) {
  const month = existing ? existing.month : ctx.month;
  if (state.isLocked(month)) {
    toast('This month is locked. Unlock it on the Month screen to edit.');
    return;
  }
  if (!existing && !state.getMonth(month)) {
    state.put({ id: `month:${month}`, type: 'month', month, walletBudget: 0 });
  }
  const values = await openForm({
    title: existing ? 'Edit fixed cost' : 'Add fixed cost',
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true, value: existing?.name ?? '', placeholder: 'Rent', autofocus: true },
      { name: 'amount', label: 'Amount per month', type: 'money', required: true, value: existing?.amount ?? null },
      { name: 'payer', label: 'Paid from', type: 'choice', options: payerOptions(), value: existing?.payer ?? state.getDevice().me },
      ...(existing ? [{ name: 'paid', label: 'Paid this month', type: 'checkbox', value: existing.paid }] : []),
    ],
    deleteLabel: existing ? 'Delete' : null,
  });
  if (!values) return;
  if (values.__delete) {
    state.remove(existing.id);
    toast(`${existing.name} deleted`, { label: 'Undo', run: state.undo });
    return;
  }
  const order = existing ? existing.order : state.fixedFor(month).length;
  state.put({
    id: existing?.id || state.newId('fx'), type: 'fixed', month,
    name: values.name, amount: values.amount, payer: values.payer,
    paid: existing ? values.paid : false, order,
    createdAt: existing?.createdAt || new Date().toISOString(),
  });
  toast(existing ? 'Saved' : `${values.name} added`);
}
