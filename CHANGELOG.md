# Changelog

## 2026-11-07 h
- Rentals → each line has **For month**: the month a payment is for (e.g. May's rent paid at the end of April). Month by month shows it under that month; coming months that already have rent appear too. The Year table still counts by the date paid.
- Sorted lines show "for May 2026" when their month differs from the payment date.

## 2026-11-07 g
- Rentals → **Find**: search all sorted lines by payee, description, reference number or amount, and filter by apartment, category and year. Shows how many lines and their total, counted like the Year table. Tap a line to fix it.
- Rentals → Year: tap a category or any number to open Find with exactly the lines behind it.
- `/` opens Find with the cursor in the search field (on Tõnis's devices). Sort's "Recently sorted" shows the last 10, with a Find… button for older lines.

## 2026-11-07 f
- Rentals → rules can also check the **amount**: *Remember: By text* → *Also by amount? Only between…* (prefilled ±10 % around the line's amount). E.g. one manager bills both flats: the smaller invoice goes to one flat, the bigger to the other. A rule with an amount range wins over one without.
- For a payee used by both flats, the form starts with the payee as rule text, the amount range chosen, and the payee's usual category.
- Rentals → Setup shows each rule's amount range.

## 2026-11-07 e
- Rentals → Sort: **split one payment into two parts**, e.g. rent + utilities from the same tenant. Choose *Split: Yes*, enter the rent; the rest goes to the second category (new: *Utilities paid by tenant*, "Umlagen").
- The split is remembered with the payee or rule: next month the same rent amount is suggested with the new rest, and ✓ accepts it in one tap.
- Year and month-by-month count each part in its own category (the rent column shows only the rent part).
- Forms keep open with a message when something doesn't fit (e.g. a rent part larger than the payment).

## 2026-11-07 d
- Rentals → Sort: **remember by text**. When sorting a line, choose *Remember: By text* and keep only the part that tells the apartments apart (a word like "Vabriku", a policy or reference number). Lines whose payee, description or reference number contain it are suggested to that apartment. The longest matching text wins; rules come before the payee memory.
- Reference numbers from the statement are now kept and shown, so rules can use them (also added to lines imported earlier when the statement is imported again).
- A payee sorted to both apartments is no longer guessed: its lines say "Both apartments use this payee: pick one, or add a rule", and the form starts on *By text*.
- Rentals → Setup lists the rules, each with Delete.

## 2026-11-07 c
- Rentals → Import Swedbank CSV: the file picker no longer filters by file type, so the statement can't be greyed out whatever type the phone gives it. A wrong file gets a clear message.

## 2026-11-07 b
- Rentals → Import Swedbank CSV: the file picker now also offers CSV files the phone labels as Excel files (how Android often saves bank downloads), so Swedbank statements are no longer greyed out.
- Statements from the English internet bank ("Transfer reference" column) import fully: lines sharing a reference (payment + fee, loan principal + interest) and identical lines on the same day are all kept.
- Suggestions also remember the exact description, so two loans from the same payee, and interest lines without a payee, are suggested to the right apartment next month.

## 2026-11-07 a
- **New: Rentals**, a private tab only on devices set to Tõnis, for the Swedbank accounts and the two rental apartments.
  - **Sort**: import Swedbank Estonia (EUR) and Sweden (SEK) CSV statements, sort each line to an apartment (or both, or not rental) and a category. The choice is remembered per payee and suggested next time. Add lines by hand too.
  - **Overview**: account balances from the statements (SEK also in euros), upcoming recurring payments (ticked off automatically when a matching transaction is sorted, or by hand), and rent and costs month by month.
  - **Bills**: recurring payments (monthly, quarterly, half-yearly, yearly).
  - **Year**: income, costs and result per apartment and in total, with your share; the usual German words next to each category; copy as a table.
  - **Setup**: apartment names, your share, SEK rate per year, and your own private Sheet (a second Sheet with the same script and its own key).
  - Never in the shared household Sheet. `Ctrl+Z`, `Ctrl+S`, `I` and `N` work on the Rentals data while you're on that tab.
- Number keys follow the visible tabs: on Tõnis's devices `5` = Rentals, `6` = Settings.

## 2026-11-04 d
- Check in balance → **Sort transactions** now goes to Purchases and opens the same menu as **Import CSV** (on the phone: Open Revolut or Choose file; on a computer: the file picker).

## 2026-11-04 c
- Check in balance → "Are the latest purchases sorted?": the main (green) button is now **Sort transactions** (was "No, sort them first"); "Yes, enter balance" is a plain button.

## 2026-11-04 b
- Open Revolut copies the amount with a dot (1177.01): Revolut didn't accept the comma.

## 2026-11-04 a
- Month → Transfers to the wallet: **Open Revolut · copy 1.177,01 €** (phone only, for your own deposit while it's still to transfer). It copies your amount, ready to paste, and opens the Revolut app. When you come back to the Budget app, it asks "Transferred …?" and one tap marks it as done.
- Revolut has no public link that opens a transfer to a joint account or pocket with the amount filled in, so pasting the copied amount is the shortest way.

## 2026-11-01 a
- **Close down last month's wallet.** When a new month starts, the Wallet and Month screens remind you until last month is closed down. On last month's Wallet, each of you presses **Close down**: the first enters the Revolut balance at the end of the month, and each confirms that all their purchases from that month are sorted (if this phone still has unsorted purchases from that month, it sends you to Purchases first).
- The month closes when both have closed down with the same numbers. Changing the final balance, or sorting another common purchase into that month, asks the other one to confirm again.
- A closed month shows its final result: budget left or over, what was spent, the final balance and the carry-over into the next month.
- After closing, that month's wallet can't change: no check-ins, added money or common purchases (also not through undo). Its purchases can still be sorted as personal or already settled, and withdrawing still works.
- Reopening needs both, the same way as unlocking a budget.

## 2026-10-31 zk
- A tiny vibration (8 ms) when tapping buttons on Android. Can be switched off per phone in Settings → This phone belongs to.

## 2026-10-31 zj
- Buttons respond right after a swipe: a sideways swipe no longer also scrolls the page (that leftover glide swallowed the next tap), a new screen starts at the top standing still, and buttons never wait for a possible double tap.

## 2026-10-31 zi
- Check in balance first asks whether the latest purchases are sorted (and says how many are waiting). No → Purchases; Yes → enter the Revolut balance.

## 2026-10-31 zh
- Purchases: Import CSV is a green main button.

## 2026-10-31 zg
- Import results stay on screen until you tap OK. Other messages stay longer when they are longer.

## 2026-10-31 zf
- Open Revolut now opens the Revolut app directly (via revolut.com/app, which the app catches) instead of the Play Store.

## 2026-10-31 ze
- Purchases: on the phone, Import CSV asks: Open Revolut (with the three export steps) or Choose file. On a computer it still opens the file picker straight away.

## 2026-10-31 zd
- Purchases help: Revolut → Generate → open with Sheets → Share → Budget (confirmed on Android). Note that the app must be installed from Chrome to appear in the share list.

## 2026-10-31 zc
- Purchases help: back to the Sheets route for Revolut statements. Revolut only offers "Open with", and Chrome on Android doesn't list web apps there yet; sharing to Budget still works from apps that offer Share.

## 2026-10-31 zb
- Purchases: the month is shown at the top again. Importing a statement takes only the chosen month's purchases; the others are named in the message, with a button to import that month too. "Also to sort: 1 in October" points to purchases waiting in another month.
- Pending card payments (no balance yet in the custom statement) are left out and picked up by a later import once they go through, under the date they were paid.
- Adding a purchase by hand while looking at an earlier month suggests that month's last day.

## 2026-10-31 za
- Revolut statements can be sent straight to the app: after Generate, pick Budget in Android's Share / Open with list, and the purchases are imported on the Purchases screen (share target + file handler). No Google Sheets or saving step needed. The file stays on the phone.

## 2026-10-31 z
- Purchases: "How to export from Revolut" now describes the quicker route from the home screen (… More → Statement → Custom → CSV).

## 2026-10-31 y
- Wallet: the bar's marker is now labelled "expected by today" (was "plan for today"), and the pace message reads "… % of the expected pace".
- "+ Add money" stays on the same line as the pace message in the bottom-right corner of Budget left; the message wraps instead.

## 2026-10-31 x
- Form buttons (Cancel/Save) are pinned to the bottom of the form, so they stay visible above the keyboard; tighter spacing in forms on phones.

## 2026-10-31 w
- On-screen keyboard no longer hides the form you're filling in: the app area shrinks when the keyboard opens (interactive-widget=resizes-content), forms sit at the top on phones, never get taller than the visible area (they scroll inside), and the focused field is kept in view.

## 2026-10-31 v
- Purchases: panels in step order (1. To sort, 2. To withdraw). When everything is sorted it shows when you last sorted.
- Reminder when the last full sort is more than 7 days ago: note on Purchases, "!" on the tab, note on Wallet. An import with nothing new counts as sorted.
- Swiping between screens now works anywhere on the screen, also on empty space below short pages (e.g. Big costs).

## 2026-10-31 u
- Wallet: "Check in balance" is the one main button; "+ Add money" is a quiet link in the lower right of the Budget left panel.
- Progress bar thinner with a calmer green; the "plan for today" marker is a soft grey line. Orange/red stay strong when over plan.

## 2026-10-31 t
- Sync status moved out of the header (too close to the month arrows) into the Wallet panel, merged with the version: "● Synced 16:17 · v31.10 t". Tap to sync.
- Other screens show an orange line under the header only when sync fails or changes wait offline.

## 2026-10-31 s
- Screens follow the monthly routine: Month → Wallet → Purchases → Big costs → Settings (tabs, swiping, keys 1–5).
- Opening the app starts on Month until the current month is locked, then on Wallet.

## 2026-10-31 r
- One corner style everywhere: rectangles with slightly rounded corners (panels 12 px, buttons/inputs/chips 10 px, tags 6 px). No more pill or circle buttons. Set once as tokens at the top of css/style.css.

## 2026-10-31 q
- Locking needs both: the month locks when both have approved the same numbers, and unlocks only when both agree. Each phone votes for its owner (Settings → This phone belongs to).
- An approval is tied to the numbers: changing salaries, wallet budget, carry-over, fixed costs or big-cost shares after approving asks for approval again.

## 2026-10-31 p
- Purchases: new "Personal & already settled" list (collapsed) with "Back" per purchase and "Put all back", to fix wrong choices.

## 2026-10-31 o
- Purchases: "Already settled before…" clears unsorted purchases up to a date (e.g. ones balanced out before using the app) without counting them as common or personal and without teaching the shop memory. Undo available.

## 2026-10-31 n
- Fix: Revolut statements with garbled characters ("-â¬33.94" instead of "-€33.94") imported 0 purchases. Garbled text is now repaired (also umlauts in shop names), and amounts are read even with stray symbols.
- When nothing is imported, the message says why (incoming only, exchanges, unreadable amounts).

## 2026-10-31 m
- Pop-up messages: app colours (no white box), slightly rounded rectangle, long text wraps.
- Revolut import reads the app's "Custom statement" CSV: finds the transaction list after the introduction, handles several account sections, month-name dates and amounts with currency signs.
- Only the EUR account is imported; payments in other currencies (e.g. SEK) are reported as left out.
- Duplicate check uses normalised values, so the same purchase is recognised across export formats; identical purchases on one day are kept apart.
- Revolut's category is shown under each purchase to sort.

## 2026-10-31 l
- New **Purchases** screen for the weekly routine: import the Revolut statement (CSV), sort each purchase into common or personal, then record the withdrawal from the shared pocket.
- The app remembers per shop what you chose and suggests it next time ("Accept suggestions").
- Already-imported transactions are skipped, so overlapping exports are fine.
- Common purchases count as wallet spending as soon as they are sorted; withdrawals in a later month don't count twice.
- Personal purchases and imported statements stay on the phone; only common purchases and withdrawals are shared.
- Manual "add common purchase" for cash. Badge on the tab shows how many purchases wait to be sorted.
- Tabs/shortcuts: 1 Wallet, 2 Purchases, 3 Month, 4 Big costs, 5 Settings; I = import.

## 2026-10-31 k
- Month screen order follows the monthly routine: fixed costs → this month's money → big costs → lock → transfers → summary.
- "Lock budget": once agreed, salaries, wallet budget, carry-over and the fixed-cost list become read-only and the big-cost shares are frozen. Ticking costs as paid and marking transfers still work. "Unlock" reopens it.
- Wallet shows a reminder while the month's budget isn't locked.

## 2026-10-31 j
- Month: tap a deposit box to mark the transfer as done ("To transfer" ↔ "✓ Transferred"); synced, one record per person.
- "Private money each" moved to the bottom of the transfers panel.

## 2026-10-31 i
- Swiping now gives visible feedback: the page follows your finger, slides out when switching, bounces back at the first/last screen, and glides back when the swipe was too short.

## 2026-10-31 h
- Swiping between screens is more sensitive (shorter, slower and more diagonal swipes count).

## 2026-10-31 g
- Swipe left/right to move between Wallet, Month, Big costs and Settings (phones).

## 2026-10-31 f
- Android status and navigation bars now match the app background (no bright green edges).
- Entry titles wrap instead of running under the amount.

## 2026-10-31 e
- Version shown at the top of the Wallet page.
- "Add purchase" removed: check-ins use the actual Revolut balance.
- New "Add money" (shortcut A): personal money put into the wallet. It raises the balance but is not counted as negative spending and does not raise the budget.
- Carry-over is automatic: a month starts with the previous month's last check-in balance (can be overridden on the Month screen).
- Budget vs. actual compares spending with the agreed wallet budget only.

## 2026-10-31 d
- Fix: "Reload" for a new version could bring back the old version on the laptop for up to 10 minutes (GitHub Pages caching). The service worker now has Chrome re-check every file, and Reload clears saved copies first.
- New test: tests/update.spec.py checks updates arrive through GitHub-like caching.

## 2026-10-31 c
- Check-ins now record the **balance left in the wallet**; spent = start balance − balance. A new check-in replaces the previous one instead of mixing totals.
- Month: optional "Left in the wallet from last month"; the summary shows what the wallet starts the month with.
- Older "spent so far" check-ins are still understood.

## 2026-10-31 b
- Salaries per month: the leftover of both salaries (after fixed costs, big costs and the wallet) is split evenly as private money; deposits follow from that.
- Each salary syncs as its own record, so both phones can enter theirs at the same time.
- "Copy last month" also copies the salaries.
- Fix: keyboard shortcuts were ignored right after closing a form with Esc.

## 2026-10-31 a — first version
- Month setup: wallet budget, fixed costs with payer and "paid" tick, copy from last month.
- Deposits for each person (half of the household total minus own payments).
- Wallet: weekly check-ins, single purchases, pace vs. plan, daily/weekly figures.
- Big costs: one-off purchases spread over months, recurring bills set aside monthly.
- Sync between phones through a private Google Sheet (Apps Script), works offline.
- Undo/redo, keyboard shortcuts, backup/restore, install to home screen, new-version banner.
