"""
End-to-end test: closing down last month's wallet on two phones (made-up data only).

Run from the project folder:
    python3 tests/close.spec.py
Reuses the server, fake Sheet and helpers from app.spec.py.
"""
import importlib.util
import re
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright, expect

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("appspec", HERE / "app.spec.py")
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)
app.PORT = 8766
BASE = f"http://localhost:{app.PORT}/"
FIX = HERE / "fixtures"
SHOTS = app.SHOTS
check = app.check
NOV_1 = "2026-11-01T09:00:00+01:00"


def toast(page):
    return page.locator("#toast").inner_text()


def sync(*pages):
    for p in pages:
        p.keyboard.press("Control+s")
        p.wait_for_timeout(400)


def run(p):
    browser = p.chromium.launch()
    pixel = p.devices["Pixel 7"]
    sheet = app.FakeSheet()
    ctx_t, tonis = app.new_page(browser, device=pixel, sheet=sheet)
    ctx_k, kris = app.new_page(browser, device=pixel, sheet=sheet)

    def connect(page, me):
        page.goto(BASE + "#settings")
        page.get_by_text(me, exact=True).first.click()
        page.fill("#sync-url", app.SYNC_URL)
        page.fill("#sync-key", app.KEY)
        page.get_by_role("button", name="Test and save").click()
        page.locator('.tabs [data-view="wallet"]').click()
        expect(page.locator("#sync-chip")).to_contain_text("Synced", timeout=5000)

    connect(tonis, "Tõnis")
    connect(kris, "Kristiina")

    # ----- 31 October: a month with a budget, a check-in and a common purchase -----
    print("October (31 Oct)")
    tonis.goto(BASE + "#month")
    tonis.get_by_role("button", name="Start empty").click()
    tonis.fill("#wallet-budget", "800")
    tonis.keyboard.press("Enter")
    tonis.fill("#income-t", "3000")
    tonis.keyboard.press("Enter")
    tonis.fill("#income-k", "2500")
    tonis.keyboard.press("Enter")
    tonis.locator('.tabs [data-view="wallet"]').click()
    check("no close-down card while the month is still running", tonis.get_by_test_id("close-card").count() == 0)
    tonis.keyboard.press("c")
    tonis.locator("#form-dialog").get_by_role("button", name="Yes, enter balance").click()
    tonis.locator('#form-dialog [name="balance"]').fill("300")
    tonis.locator("#form-dialog").get_by_role("button", name="Save").click()
    tonis.locator('.tabs [data-view="buys"]').click()
    tonis.get_by_role("button", name=re.compile("Add common purchase by hand")).click()
    tonis.locator('#form-dialog [name="amount"]').fill("20")
    tonis.locator('#form-dialog [name="description"]').fill("Market, cash")
    tonis.locator("#form-dialog").get_by_role("button", name="Save").click()
    sync(tonis, kris)

    # Kristiina imports October purchases but doesn't sort them yet
    kris.locator('.tabs [data-view="buys"]').click()
    expect(kris.get_by_test_id("sort-count")).to_be_visible(timeout=5000)
    kris.set_input_files("#csv-file", str(FIX / "revolut-week1.csv"))
    expect(kris.locator(".sort-row").first).to_be_visible(timeout=5000)
    kris.keyboard.press("Escape")
    waiting = int(kris.get_by_test_id("sort-count").inner_text())
    check(f"Kristiina has October purchases waiting to sort ({waiting})", waiting > 0)

    # ----- 1 November -----
    print("1 November: close down October")
    for page in (tonis, kris):
        page.clock.set_system_time(NOV_1)
        page.goto(BASE + "#wallet")
        page.wait_for_timeout(300)
        page.keyboard.press("t")  # the test clock moves after loading: jump to "this month"
    sync(tonis, kris)

    check("November Wallet reminds to close down October",
          "October 2026 isn't closed down yet" in tonis.get_by_test_id("close-reminder").inner_text())
    tonis.locator('.tabs [data-view="month"]').click()
    check("November Month screen shows the reminder too", tonis.get_by_test_id("close-reminder").count() == 1)
    tonis.screenshot(path=str(SHOTS / "close-phone-reminder-month.png"), full_page=True)
    tonis.get_by_test_id("close-reminder").click()
    expect(tonis.get_by_test_id("close-card")).to_be_visible(timeout=5000)
    check("the reminder opens October's Wallet", tonis.locator("#month-title").inner_text() == "October 2026"
          and tonis.get_by_test_id("close-card").count() == 1)
    tonis.screenshot(path=str(SHOTS / "close-phone-card.png"), full_page=True)

    # Tõnis closes down: the "all sorted" tick is required
    tonis.get_by_test_id("close-card").get_by_role("button", name="Close down October").click()
    dlg = tonis.locator("#form-dialog")
    check("the balance field suggests the check-in from 31 Oct", dlg.locator('[name="balance"]').input_value() == "300,00")
    dlg.locator('[name="balance"]').fill("280")
    tonis.screenshot(path=str(SHOTS / "close-phone-dialog.png"))
    dlg.get_by_role("button", name="Close down October").click()
    check("closing down without ticking 'all sorted' is refused", "Please tick" in dlg.locator(".form-error").inner_text())
    dlg.locator('[name="sorted"]').check()
    dlg.get_by_role("button", name="Close down October").click()
    check("Tõnis closed down; waiting for Kristiina", "Waiting for Kristiina" in toast(tonis))
    check("Tõnis's vote shows as closed down", "✓ closed down" in tonis.get_by_test_id("close-vote-t").inner_text())
    result = tonis.get_by_test_id("close-result").inner_text()
    # start 800 − balance 280 + 20 common purchase not withdrawn = 540 spent
    check(f"result: spent 540 of 800, 260 under plan ({result!r})",
          "540,00" in result and "260,00" in result and "under plan" in result)
    check("the month is not closed yet with one vote", tonis.get_by_test_id("closed-card").count() == 0)
    check("the final balance appears among the entries", "Final balance" in tonis.locator("main").inner_text())
    sync(tonis, kris)

    # Kristiina still has unsorted October purchases → must sort first
    kris.locator("#prev-month").click()
    expect(kris.get_by_test_id("close-vote-t")).to_contain_text("closed down", timeout=5000)
    check("Kristiina sees that Tõnis closed down", True)
    kris.get_by_test_id("close-card").get_by_role("button", name="Close down October").click()
    check("with unsorted October purchases she is sent to sort first",
          kris.get_by_test_id("close-unsorted").count() == 1 and "still waiting to be sorted" in kris.get_by_test_id("close-unsorted").inner_text())
    kris.locator("#form-dialog").get_by_role("button", name="Go to Purchases").click()
    check("…to Purchases, on October", kris.locator("#month-title").inner_text() == "October 2026" and "#buys" in kris.url)
    expect(kris.locator(".sort-row").first).to_be_visible(timeout=5000)
    while kris.locator('.sort-row [data-choice="personal"]').count():
        kris.locator('.sort-row [data-choice="personal"]').first.click()
        kris.wait_for_timeout(50)

    # She closes down with a slightly different balance → Tõnis's vote needs confirming again
    kris.locator('.tabs [data-view="wallet"]').click()
    kris.get_by_test_id("close-card").get_by_role("button", name="Close down October").click()
    dlg = kris.locator("#form-dialog")
    check("Kristiina's form suggests Tõnis's balance", dlg.locator('[name="balance"]').input_value() == "280,00")
    check("…and says who entered it", "Tõnis entered this" in dlg.inner_text())
    dlg.locator('[name="balance"]').fill("275")
    dlg.locator('[name="sorted"]').check()
    dlg.get_by_role("button", name="Close down October").click()
    check("a changed balance doesn't close the month", kris.get_by_test_id("closed-card").count() == 0)
    check("Tõnis's close-down now needs confirming", "needs to confirm again" in kris.get_by_test_id("close-vote-t").inner_text().lower())
    sync(kris, tonis)

    expect(tonis.get_by_test_id("close-vote-t")).to_contain_text("confirm again", timeout=5000)
    tonis.get_by_role("button", name="Confirm the new numbers").click()
    dlg = tonis.locator("#form-dialog")
    check("Tõnis's form now shows Kristiina's balance", dlg.locator('[name="balance"]').input_value() == "275,00")
    dlg.locator('[name="sorted"]').check()
    dlg.get_by_role("button", name="Close down October").click()
    check("both agreed: October is closed", "closed: both agreed" in toast(tonis) and tonis.get_by_test_id("closed-card").count() == 1)
    check("final result 255 left, spent 545, balance 275",
          "255,00" in tonis.get_by_test_id("final-left").inner_text()
          and "545,00" in tonis.get_by_test_id("final-spent").inner_text()
          and "275,00" in tonis.get_by_test_id("final-balance").inner_text())
    tonis.screenshot(path=str(SHOTS / "close-phone-closed.png"), full_page=True)
    sync(tonis, kris)
    expect(kris.get_by_test_id("closed-card")).to_be_visible(timeout=5000)
    check("Kristiina's phone shows October closed after sync", True)

    # ----- nothing in October's wallet can change -----
    print("Closed October is fixed")
    check("no check-in or add-money buttons on a closed month",
          tonis.locator('[data-act="checkin"]').count() == 0 and tonis.locator('[data-act="topup"]').count() == 0)
    tonis.keyboard.press("c")
    check("C (check in) is refused on a closed month", "is closed down" in toast(tonis) and not tonis.locator("#form-dialog").is_visible())
    tonis.keyboard.press("a")
    check("A (add money) is refused too", "is closed down" in toast(tonis) and not tonis.locator("#form-dialog").is_visible())
    tonis.locator("[data-edit]").first.click()
    check("tapping an entry doesn't open it for editing", not tonis.locator("#form-dialog").is_visible())
    records_before = tonis.evaluate("localStorage.getItem('hb.records')")
    tonis.keyboard.press("Control+z")
    tonis.wait_for_timeout(200)
    check("undo can't change October's wallet", tonis.get_by_test_id("final-left").inner_text().startswith("255"))

    tonis.locator('.tabs [data-view="buys"]').click()
    expect(tonis.get_by_test_id("closed-buys")).to_be_visible(timeout=5000)
    check("Purchases says October is closed", True)
    tonis.get_by_role("button", name=re.compile("Add common purchase by hand")).click()
    tonis.locator('#form-dialog [name="amount"]').fill("9")
    tonis.locator('#form-dialog [name="description"]').fill("Late receipt")
    tonis.locator("#form-dialog").get_by_role("button", name="Save").click()
    check("a common purchase can't be added to a closed month", "closed down" in toast(tonis))
    tonis.set_input_files("#csv-file", str(FIX / "revolut-week1.csv"))
    tonis.keyboard.press("Escape")
    tonis.locator('.sort-row [data-choice="common"]').first.click(force=True)
    check("a closed month's purchase can't be sorted as common", "only be personal" in toast(tonis))
    tonis.locator('.sort-row [data-choice="personal"]').first.click()
    check("…but personal still works", "personal" in toast(tonis))
    tonis.get_by_role("button", name=re.compile("I've withdrawn 20,00")).click()
    tonis.locator("#form-dialog").get_by_role("button", name=re.compile("Yes, 20,00")).click()
    check("withdrawing October's common purchase still works", "Withdrawal of 20,00" in toast(tonis))
    tonis.locator('.tabs [data-view="wallet"]').click()
    check("the withdrawal doesn't change October's result", tonis.get_by_test_id("final-spent").inner_text().startswith("545"))

    # ----- November starts with October's final balance -----
    tonis.locator("#next-month").click()
    check("no reminder once October is closed", tonis.get_by_test_id("close-reminder").count() == 0)
    tonis.locator('.tabs [data-view="month"]').click()
    tonis.get_by_role("button", name="Copy from October 2026").click()
    hint = tonis.get_by_test_id("carry-hint").inner_text()
    check(f"November's carry-over is October's final balance ({hint[:70]}…)", "275,00" in hint and "final balance" in hint)

    # ----- laptop layout -----
    ctx_l, lap = app.new_page(browser, viewport={"width": 1366, "height": 900}, sheet=sheet)
    lap.goto(BASE + "#settings")
    lap.get_by_text("Tõnis", exact=True).first.click()
    lap.fill("#sync-url", app.SYNC_URL)
    lap.fill("#sync-key", app.KEY)
    lap.get_by_role("button", name="Test and save").click()
    lap.clock.set_system_time(NOV_1)
    lap.goto(BASE + "#wallet")
    lap.keyboard.press("t")
    sync(lap)
    lap.keyboard.press("ArrowLeft")
    expect(lap.get_by_test_id("closed-card")).to_be_visible(timeout=5000)
    lap.screenshot(path=str(SHOTS / "close-laptop-closed.png"), full_page=True)
    check("laptop shows the closed month", True)
    ctx_l.close()

    # ----- reopen needs both -----
    print("Reopen")
    tonis.locator('.tabs [data-view="wallet"]').click()
    tonis.locator("#prev-month").click()
    tonis.get_by_role("button", name="Ask to reopen").click()
    check("one request doesn't reopen", tonis.get_by_test_id("closed-card").count() == 1
          and "asked to reopen" in tonis.get_by_test_id("close-vote-t").inner_text())
    sync(tonis, kris)
    kris.locator('.tabs [data-view="wallet"]').click()
    expect(kris.get_by_role("button", name=re.compile("Agree to reopen"))).to_be_visible(timeout=5000)
    kris.get_by_role("button", name=re.compile("Agree to reopen")).click()
    check("both agreed: October is open again", "reopened" in toast(kris) and kris.get_by_test_id("close-card").count() == 1)
    check("…and its check-in button is back", kris.locator('[data-act="checkin"]').count() == 1)
    for phone in (kris, tonis):
        for w in (360, 340):
            phone.set_viewport_size({"width": w, "height": 800})
            wide = phone.evaluate("document.documentElement.scrollWidth > window.innerWidth")
            check(f"no sideways scrolling at {w} px", not wide)
    ctx_t.close()
    ctx_k.close()
    browser.close()


if __name__ == "__main__":
    srv = app.start_server()
    try:
        with sync_playwright() as p:
            run(p)
    except Exception as e:
        print("TEST CRASHED:", e)
        app.checks.append(("no crash", False))
    finally:
        srv.shutdown()
    if app.errors:
        print("Page errors:")
        for e in app.errors:
            print("  " + e)
    failed = [n for n, ok in app.checks if not ok]
    print(f"\n{len(app.checks) - len(failed)}/{len(app.checks)} checks passed, {len(app.errors)} page errors")
    sys.exit(1 if failed or app.errors else 0)
