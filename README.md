# Household Budget

A shared household budget for two people, replacing the monthly Google Sheet.
Once a month: enter salaries, the wallet budget and fixed costs, and the app tells each person their
private money and how much to deposit into the shared wallet (Revolut). During the month: check in
with the Revolut balance and see whether you are ahead of or behind plan.

**App address: https://tusov-home.github.io/Budgeting/** (repository `tusov-home/Budgeting`; until October 2026 it was `ttusov-art/Budgeting`, whose old address no longer works).

Setup: see **SETUP.md**. Updates are tested and pushed to this repository directly; after a push, press **Reload** in the app's update banner.

## How the money works

Every month you enter both salaries, agree on the wallet size, and list the fixed costs.

- **Household costs** = fixed costs + this month's share of big costs + wallet budget.
- **Leftover** = both salaries − household costs. It is split **evenly in two** as private money.
- **Deposit into the wallet** = your salary − the costs you pay from your own account − your private half.
  (Kristiina's costs are the old `*`, Tõnis's the old `**`; you pick the payer per cost.)
  Together the two deposits always equal the wallet budget (plus any costs paid from the wallet).
  A negative deposit means that person gets that amount back.
- **Pace** = spent so far ÷ (wallet budget × days elapsed ÷ days in month). Below 100 % = under plan.
- **Check-in** = the actual Revolut balance. Spent = start balance + money added − balance.
- **Start balance** = deposits + carry-over − fixed costs paid from the wallet (ticked as paid).
- **Carry-over** = automatically the previous month's last check-in balance; can be typed over on the
  Month screen (empty = automatic). Check in on the last day of a month for an exact carry-over.
- **Add money** = personal money put into the wallet (e.g. when the pace is too high). Raises the balance,
  never counts as negative spending.
- **Budget vs. actual** always compares spending with the agreed wallet budget only.
- **Lock**: at the start of a month, check the fixed costs and agree on the wallet budget; then **both** approve.
  The month locks when both approvals match the current numbers (changing anything after approving asks for
  approval again). A locked month can't be edited by accident and keeps its big-cost shares. Unlocking also
  needs both: one asks, the other agrees.
- **Purchases paid with private money**: import your Revolut statement each week, mark each purchase
  common or personal, and withdraw the common total from the shared pocket. Common purchases count as
  spent as soon as they are sorted: spent = start + top-ups − balance − withdrawals this month for
  earlier months' purchases + this month's common purchases not yet withdrawn at the check-in.
  Imports take only the month chosen at the top; pending payments are left out until a later
  import, where they count in the month they were paid.
  On Android, a statement generated in Revolut can be shared straight to the app (share target /
  file handler in the manifest; the service worker hands the file to the Purchases screen).
- **Close down**: when a new month starts, both close down last month's wallet on its Wallet screen.
  The first enters the Revolut balance at the end of the month (the *final balance*), and each confirms all their
  purchases from that month are sorted. When both agree on the same numbers, the month is **closed**: its final
  result (spent vs. budget, final balance = carry-over) is kept, and its check-ins, added money and common purchases
  can't change any more. Its purchases can still be sorted as personal or already settled, and withdrawing still works.
  Reopening needs both, like unlocking.
- **Big costs**: a one-off purchase is spread evenly over N months; a recurring bill (yearly,
  half-yearly, quarterly) sets aside amount ÷ period every month. The share counts as paid by
  whoever pays the bill.

## Screens

In the order of the monthly routine. The app opens on Month until the month is locked, then on Wallet.

| Screen | What it does |
| --- | --- |
| Month | Fixed costs (tick when paid), salaries, wallet budget, carry-over, big costs, **lock the budget** (both approve), transfers to the wallet (tap when done; on the phone **Open Revolut** copies your amount and asks afterwards whether it's done), private money, summary; "copy last month" |
| Wallet | Budget left, pace vs. plan, daily/weekly figures, check-ins, added money and withdrawals; app version. For a past month: **close down** (both), then the final result |
| Purchases | Helper for the check-in, in steps: 1. import and sort, 2. withdraw; reminds after 7 days without sorting. Import the Revolut CSV, sort purchases into common/personal (with suggestions per shop), withdraw the common total; "Already settled before…" clears old purchases without affecting suggestions; recent withdrawals |
| Big costs | Spread purchases and recurring bills |
| Rentals | **Only on Tõnis's devices.** Private page for the Swedbank accounts (Estonia EUR, Sweden SEK) and the two rental apartments: Overview (balances, upcoming payments, month by month), Sort (import Swedbank CSV, sort lines to apartment + category, suggestions per payee or by your text rules, e.g. a policy number), Bills (recurring payments), Year (income, costs, result and your share per apartment; copy as a table), Setup (names, share, SEK rates, private Sheet) |
| Settings | Names, whose phone, sync, backup, shortcuts, privacy |

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| `1` … `6` | Screens in tab order: Month / Wallet / Purchases / Big costs / (Rentals) / Settings. Rentals only shows on Tõnis's devices, so there Settings is `6` |
| `I` | Import Revolut statement (on Rentals: Swedbank statement) |
| `←` `→` | Previous / next month |
| `T` | Jump to this month |
| `C` | Check in the Revolut balance |
| `A` | Add money to the wallet |
| `N` | Add big cost (on Big costs); on Rentals: add by hand, or a recurring payment on Bills |
| `F` | Add fixed cost |
| `Ctrl+Z` / `Ctrl+Y` (or `Ctrl+Shift+Z`) | Undo / redo (on Rentals: the rentals data) |
| `Ctrl+S` | Sync now (on Rentals: the private Sheet) |
| `Enter` / `Esc` | Save / close a form |
| `?` | Show shortcuts |

Shortcuts don't fire while you type in a field.

On a phone, **swipe left / right** to move between the screens.

## Files

```
index.html             page structure
css/style.css          the look (light + dark mode)
js/main.js             starts the app, routing, wires modules together
js/state.js            data model; the only place that changes data (incl. undo/redo)
js/storage.js          storage on this device, backup file format
js/purchases.js        imported transactions (this phone only), sorting, shop memory
js/sync.js             sync with the Google Sheet
js/version.js          APP_VERSION (also in version.json)
js/lib/money.js        cents, parsing "12,30", formatting
js/lib/months.js       month keys like "2026-10"
js/lib/budget.js       deposits, big-cost shares, pace (pure functions)
js/lib/merge.js        merging records from two phones
js/ui/*.js             one file per screen + form dialog, shortcuts, helpers
js/ui/closedown.js     closing down last month's wallet (card, result, reminder)
js/lib/swedbank.js     reading Swedbank Estonia / Sweden CSV statements (pure)
js/lib/rentals.js      rental categories, year and month totals, recurring payments (pure)
js/rentals/store.js    Rentals data (own records "hr.*", never in the household Sheet)
js/rentals/sync.js     sync with Tõnis's private Sheet
js/ui/rentals/         the Rentals screen: index (sections), overview, sort, bills, year, setup
apps-script/Code.gs    the backend you paste into the Google Sheet
sw.js, manifest.webmanifest, icons/   offline start and "Add to Home screen"
tests/                 unit tests + Playwright end-to-end tests (made-up data)
```

### Data model

Everything is a flat list of **records**, each with `id`, `type`, `updatedAt`, `deleted`, `by`:
`settings`, `month` (wallet budget), `income` (one per person per month, so both phones can enter theirs at once), `fixed`, `spread`, `checkin` (balance), `topup` (money added), `transfer` (deposit done, one per person per month), `lockvote` (each person's approval or unlock request, with a fingerprint of the approved numbers), `closevote` (each person's close-down or reopen request, with a fingerprint of the final result; the final balance is a `checkin` with `final: true`, and a closed month has `closed` and `closedResult` on its `month` record), `expense` (a common purchase paid with private money), `settlement` (a withdrawal from the pocket, with the months it covers). Imported bank transactions and the per-shop memory are kept only on the phone (`hb.inbox`, `hb.shops`), never synced. Amounts are whole
cents. Deleting marks a record `deleted` so the deletion can reach the other phone. When both phones
changed the same record, the newer change wins.

**Rentals** (Tõnis only) has its own records, stored as `hr.*` in the browser and synced to a separate private Sheet:
`rsettings` (apartment names, your share, SEK per EUR per year), `racct` (account with its latest balance from a statement),
`rtx` (one transaction; `apartment` null until sorted, then `a`, `b`, `both` or `none`, plus a `category`),
`rpayee` (remembered choice per payee, and per payee + exact description; a payee used for both apartments is marked `mixed` and not guessed),
`rrule` (your rule: lines whose payee, description or reference number contain `text` go to an apartment and category; longest text wins),
`rbill` (recurring payment), `rpaid` (a payment marked as paid by hand).

## Tests

```
node --test tests/lib.test.mjs     # logic
python3 tests/app.spec.py          # app on Pixel 7 + 1366 px laptop, incl. two-phone sync (fake Sheet)
python3 tests/update.spec.py       # a new version arrives on reload despite GitHub's caching
python3 tests/close.spec.py        # closing down last month on two phones, reopening
python3 tests/rentals.spec.py      # Rentals: only for Tõnis, Swedbank import, sorting, bills, year, private Sheet
```

Test data in `tests/fixtures/` is made up.

## Privacy

- Imported bank statements and purchases marked personal stay on the phone that imported them.
- Data is kept in the browser on each phone and in **your own** Google Sheet via **your own** Apps Script.
- The sync key is stored only on the phones and in the script's properties, never in this repository or in backups.
- **Rentals** data never goes into the shared household Sheet: it stays in the browser and, if set up, in Tõnis's own private Sheet. The tab only shows on devices set to Tõnis. Swedbank statements are read in the app; the files are not uploaded.
- No analytics, no tracking, no third-party code or fonts.
- "Forget this phone" in Settings removes everything locally; delete the Sheet to remove the rest.

## Credits

No third-party libraries. System fonts. Built with Claude.
