"""
End-to-end tests with Playwright (made-up data only).

Run from the project folder:
    python3 tests/app.spec.py
It starts a local web server, fakes the Google Apps Script backend,
and drives the app on an Android phone profile and a laptop viewport.
Screenshots go to tests/screenshots/.
"""
import json
import re
import sys
import threading
import functools
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parent.parent
SHOTS = ROOT / "tests" / "screenshots"
SHOTS.mkdir(exist_ok=True)
PORT = 8765
BASE = f"http://localhost:{PORT}/"
SYNC_URL = "https://script.google.com/macros/s/TEST/exec"
KEY = "test-key-0123456789abcdef"
NOW = "2026-10-31T10:00:00+01:00"


# ---------- local web server ----------
class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def start_server():
    handler = functools.partial(QuietHandler, directory=str(ROOT))
    srv = ThreadingHTTPServer(("localhost", PORT), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


# ---------- fake Apps Script: same logic as apps-script/Code.gs ----------
class FakeSheet:
    def __init__(self):
        self.rows = {}  # id -> {"rec":..., "seq":...}
        self.seq = 0
        self.lock = threading.Lock()

    def handle(self, route):
        body = json.loads(route.request.post_data or "{}")
        if body.get("key") != KEY:
            return route.fulfill(json={"ok": False, "error": "Wrong sync key."})
        if body.get("action") == "ping":
            return route.fulfill(json={"ok": True})
        with self.lock:
            for rec in body.get("records", []):
                old = self.rows.get(rec["id"])
                if old and old["rec"]["updatedAt"] >= rec["updatedAt"]:
                    continue
                self.seq += 1
                self.rows[rec["id"]] = {"rec": rec, "seq": self.seq}
            since = int(body.get("since") or 0)
            changed = [r["rec"] for r in self.rows.values() if r["seq"] > since]
            return route.fulfill(json={"ok": True, "serverTime": self.seq, "records": changed})


errors = []
checks = []


def check(name, cond):
    checks.append((name, bool(cond)))
    print(("  ok   " if cond else "  FAIL ") + name)


def new_page(browser, device=None, viewport=None, sheet=None):
    opts = dict(device or {})
    if viewport:
        opts["viewport"] = viewport
    ctx = browser.new_context(**opts, locale="en-GB", timezone_id="Europe/Berlin")
    page = ctx.new_page()
    page.clock.install(time=NOW)
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    page.on("console", lambda m: m.type == "error" and errors.append(f"console: {m.text}"))
    if sheet:
        page.route("https://script.google.com/**", sheet.handle)
    return ctx, page


def swipe(page, dx, dy=0, ms=150):
    """Simulate a one-finger swipe on the page (dx < 0 = right-to-left), with moves in between."""
    page.evaluate("""async ([dx, dy, ms]) => {
        const x0 = 200, y0 = 450, el = document.querySelector('main');
        const touch = (x, y) => new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
        const fire = (type, x, y, active) => el.dispatchEvent(new TouchEvent(type, { bubbles: true,
            touches: active ? [touch(x, y)] : [], changedTouches: [touch(x, y)] }));
        fire('touchstart', x0, y0, true);
        for (let i = 1; i <= 5; i++) {
            await new Promise(r => setTimeout(r, ms / 5));
            fire('touchmove', x0 + dx * i / 5, y0 + dy * i / 5, true);
        }
        fire('touchend', x0 + dx, y0 + dy, false);
    }""", [dx, dy, ms])
    page.wait_for_timeout(400)  # let the slide / bounce animation finish


def be(page, name):
    """Switch 'This phone belongs to' (Settings) and come back to the Month screen."""
    page.locator('.tabs [data-view="settings"]').click()
    page.locator('label[for="me-%s"]' % ("t" if name == "Tõnis" else "k")).click()
    page.locator('.tabs [data-view="month"]').click()


def feedback(page):
    return page.evaluate("document.querySelector('main').dataset.swipeFeedback || ''")


def fill_form(page, values):
    dlg = page.locator("#form-dialog")
    for name, val in values.items():
        dlg.locator(f'[name="{name}"]:not([type="radio"])').first.fill(val) if not name.startswith("radio:") else None
    return dlg


def run(p):
    browser = p.chromium.launch()
    pixel = p.devices["Pixel 7"]

    # ===== 1. Phone: set up a month and use the wallet =====
    print("Phone flow (Pixel 7)")
    ctx, page = new_page(browser, device=pixel)
    page.goto(BASE + "#month")
    check("month title shows October 2026", page.locator("#month-title").inner_text() == "October 2026")
    page.get_by_role("button", name="Start empty").click()

    check("asks for salaries before showing deposits", "Enter both salaries" in page.locator("main").inner_text())
    page.fill("#wallet-budget", "930")
    page.keyboard.press("Enter")
    page.fill("#income-t", "3000")
    page.keyboard.press("Enter")
    page.fill("#income-k", "2500")
    page.keyboard.press("Enter")
    page.wait_for_timeout(100)

    # Fixed costs: rent paid by Kristiina, phone paid by Tõnis
    for name, amount, payer in [("Rent", "1000", "Kristiina"), ("Phone", "50", "Tõnis"), ("Netflix+Spotify", "25,98", "Tõnis")]:
        page.get_by_role("button", name=re.compile(r"\+ Add")).click()
        dlg = page.locator("#form-dialog")
        dlg.locator('[name="name"]').fill(name)
        dlg.locator('[name="amount"]').fill(amount)
        dlg.get_by_text(payer, exact=True).click()
        dlg.get_by_role("button", name="Save").click()
    # Total = 1000 + 50 + 25.98 + 930 = 2005.98 → 1002.99 each
    # Salaries 5500 − costs 2005.98 = leftover 3494.02 → 1747.01 private each
    # Tõnis: 3000 − 75.98 − 1747.01 = 1177.01 in; Kristiina: 2500 − 1000 − 1747.01 = −247.01 (gets back)
    dep_t = page.get_by_test_id("deposit-t").inner_text()
    dep_k = page.get_by_test_id("deposit-k").inner_text()
    check("private money 1.747,01 € each", "1.747,01" in page.get_by_test_id("private").inner_text())
    check("Tõnis deposits 1.177,01 €", "1.177,01" in dep_t and "into the wallet" in dep_t)
    check("Kristiina gets 247,01 € back", "247,01" in dep_k and "back from the wallet" in dep_k)

    check("deposit starts as 'To transfer'", page.get_by_test_id("status-t").inner_text() == "To transfer")

    # "Open Revolut · copy": copies this phone's amount, opens Revolut, asks on the way back
    rv = page.get_by_test_id("revolut-transfer")
    check("Open Revolut button shows Tõnis's amount", rv.count() == 1 and "1.177,01" in rv.inner_text())
    check("it opens the Revolut app link", rv.get_attribute("href") == "https://www.revolut.com/app/")
    page.screenshot(path=str(SHOTS / "phone-transfer-revolut.png"), full_page=True)
    page.context.grant_permissions(["clipboard-read", "clipboard-write"])
    # Stay on the page in the test (on the phone, the Revolut app catches the link).
    page.evaluate("document.querySelector('[data-act=revolut-transfer]').addEventListener('click', e => e.preventDefault())")
    rv.click()
    page.wait_for_timeout(700)
    check("the amount is copied with a dot, as Revolut wants it (1177.01)", page.evaluate("navigator.clipboard.readText()") == "1177.01")
    page.evaluate("""() => {
        const set = (v) => { Object.defineProperty(document, 'visibilityState', { value: v, configurable: true });
                             document.dispatchEvent(new Event('visibilitychange')); };
        set('hidden'); set('visible');
    }""")
    check("coming back asks whether the transfer is done", "Transferred 1.177,01" in page.locator("#toast").inner_text())
    page.locator("#toast").get_by_role("button", name="Yes, mark done").click()
    check("one tap marks it transferred", "Transferred" in page.get_by_test_id("status-t").inner_text())
    check("…and the Revolut button goes away", page.get_by_test_id("revolut-transfer").count() == 0)
    page.get_by_test_id("deposit-t").click()
    check("no Revolut button for money coming back (Kristiina's box)", "revolut" not in page.locator(".deposit.k").inner_html().lower())
    page.get_by_test_id("deposit-t").click()
    check("tapping Tõnis's deposit marks it transferred", "Transferred" in page.get_by_test_id("status-t").inner_text())
    check("Kristiina's (money back) shows 'To receive'", page.get_by_test_id("status-k").inner_text() == "To receive")
    page.get_by_test_id("deposit-t").click()
    check("tapping again sets it back to 'To transfer'", page.get_by_test_id("status-t").inner_text() == "To transfer")
    page.get_by_test_id("deposit-t").click()
    box = page.locator(".card[aria-label=Result]")
    check("private money is at the bottom of the panel",
          box.locator(".private-line").bounding_box()["y"] > box.locator(".deposits").bounding_box()["y"])
    page.locator('[data-paid]').first.check()
    page.wait_for_timeout(50)
    check("ticking paid strikes the row through", page.locator(".row.is-paid").count() == 1)
    page.screenshot(path=str(SHOTS / "phone-412-month.png"), full_page=True)

    # Order and lock
    tops = page.evaluate("[...document.querySelectorAll('main .card')].map(c => (c.querySelector('h2')||{}).textContent || c.dataset.testid || '')")
    check("Month screen starts with the fixed costs", tops[0].startswith("Fixed costs"))
    page.locator('.tabs [data-view="wallet"]').click()
    expect(page.get_by_test_id("lock-notice")).to_have_count(1)
    check("wallet reminds that the budget isn't locked", True)
    page.locator('.tabs [data-view="month"]').click()
    # Lock needs both: Tõnis approves first
    page.get_by_role("button", name=re.compile("I approve the October 2026 budget")).click()
    check("one approval doesn't lock yet", "Agree and lock" in page.get_by_test_id("lock-card").inner_text())
    check("Tõnis shows as approved, Kristiina not yet", "approved" in page.get_by_test_id("vote-t").inner_text() and "not approved" in page.get_by_test_id("vote-k").inner_text())
    # Changing a number after approving makes the approval stale
    page.fill("#wallet-budget", "935")
    page.keyboard.press("Enter")
    page.wait_for_timeout(100)
    check("changing the budget after approving asks to approve again", "approve again" in page.get_by_test_id("vote-t").inner_text())
    page.fill("#wallet-budget", "930")
    page.keyboard.press("Enter")
    page.wait_for_timeout(100)
    check("back to the approved numbers: approval counts again", "✓ approved" in page.get_by_test_id("vote-t").inner_text())
    be(page, "Kristiina")
    page.get_by_role("button", name=re.compile("I approve the October 2026 budget")).click()
    check("locked: shows 'Budget locked' once both approved", "Budget locked" in page.get_by_test_id("lock-card").inner_text())
    check("locked: salary and budget fields are read-only", page.locator("#income-t").get_attribute("readonly") is not None and page.locator("#wallet-budget").get_attribute("readonly") is not None)
    check("locked: no + Add for fixed costs", page.get_by_role("button", name=re.compile(r"\+ Add")).count() == 0)
    page.locator("[data-paid]").nth(1).check()
    page.wait_for_timeout(50)
    check("locked: ticking a cost as paid still works", page.locator(".row.is-paid").count() == 2)
    page.locator("[data-paid]").nth(1).uncheck()
    page.wait_for_timeout(50)
    page.keyboard.press("f")
    check("locked: F shortcut explains it is locked", "locked" in page.locator("#toast").inner_text())
    page.locator('.tabs [data-view="wallet"]').click()
    expect(page.get_by_test_id("lock-notice")).to_have_count(0)
    check("wallet reminder disappears when locked", True)
    page.locator('.tabs [data-view="month"]').click()
    page.get_by_role("button", name="Ask to unlock").click()
    check("one unlock request keeps it locked", "Budget locked" in page.get_by_test_id("lock-card").inner_text() and page.locator("#income-t").get_attribute("readonly") is not None)
    check("the request is shown", "asked to unlock" in page.get_by_test_id("vote-k").inner_text())
    be(page, "Tõnis")
    page.get_by_role("button", name=re.compile("Agree to unlock")).click()
    check("unlocks when both agree; fields editable again", page.locator("#income-t").get_attribute("readonly") is None)
    page.get_by_role("button", name=re.compile("I approve the October 2026 budget")).click()
    be(page, "Kristiina")
    page.get_by_role("button", name=re.compile("I approve the October 2026 budget")).click()
    check("locked again after both approve", "Budget locked" in page.get_by_test_id("lock-card").inner_text())
    page.goto(BASE)
    check("once locked, opening the app starts on Wallet", page.url.endswith("#wallet"))
    tabs = page.evaluate("[...document.querySelectorAll('.tabs a')].map(a => a.dataset.view)")
    check("tabs follow the routine: Month, Wallet, Purchases, Big costs, Settings", tabs == ["month", "wallet", "buys", "big", "settings"])
    page.goto(BASE + "#month")
    be(page, "Tõnis")

    # Wallet
    page.locator('.tabs [data-view="wallet"]').click()
    page.get_by_role("button", name=re.compile("Check in")).click()
    page.get_by_role("button", name="No, sort them first").click()
    expect(page).to_have_url(re.compile("#buys$"), timeout=2000)
    check("check-in: 'No, sort them first' goes to Purchases without a check-in", not page.locator("#form-dialog[open]").count())
    page.locator('.tabs [data-view="wallet"]').click()
    page.get_by_role("button", name=re.compile("Check in")).click()
    page.get_by_role("button", name="Yes, enter balance").click()
    page.locator('#form-dialog [name="balance"]').fill("59,61")
    page.locator("#form-dialog").get_by_role("button", name="Save").click()
    pace = page.get_by_test_id("pace").inner_text()
    check("pace shows 93,6 % like the sheet", "93,6" in pace and "under plan" in pace)
    check("remaining 59,61 €", "59,61" in page.get_by_test_id("remaining").inner_text())
    # A second check-in replaces the balance; it must not stack on the first
    page.get_by_role("button", name=re.compile("Check in")).click()
    page.get_by_role("button", name="Yes, enter balance").click()
    page.locator('#form-dialog [name="balance"]').fill("50")
    page.locator('#form-dialog [name="balance"]').press("Enter")
    check("second check-in: balance 50 € → 880 € spent, remaining 50 €", "50,00" in page.get_by_test_id("remaining").inner_text() and "880,00" in page.locator("main").inner_text())
    page.locator(".row-btn", has_text="Balance").filter(has_text="50,00").click()
    page.locator("#form-dialog").get_by_role("button", name="Delete").click()
    check("deleting it brings back the first check-in", "59,61" in page.get_by_test_id("remaining").inner_text())
    meta = page.evaluate("[...document.querySelectorAll('meta[name=theme-color]')].map(m => m.content + ' ' + m.media)")
    check("status bar colour follows light/dark background, not green", all("#2f6b4f" not in m for m in meta) and len(meta) == 2)
    pills = page.evaluate("""() => [...document.querySelectorAll('button, .btn, input, .badge, .chip-btn, .status, .version-tag, .pace-pill, .seg, .card, .toast')]
        .filter(el => { const r = parseFloat(getComputedStyle(el).borderTopLeftRadius); return r > 14; })
        .map(el => el.className || el.tagName)""")
    check("no pill- or egg-shaped buttons or panels (corners ≤ 14 px)", pills == [])
    check("version is shown on the wallet page (merged with sync status)", re.search(r"v\d\d\.\d\d [a-z]", page.get_by_test_id("version").inner_text()) is not None)
    check("the header has only the month arrows (no sync chip next to them)", page.locator("header #sync-chip").count() == 0)
    check("no Add purchase button any more", page.get_by_role("button", name=re.compile("Add purchase")).count() == 0)

    # Keyboard open = only ~420 px visible: the form sits at the top and fits (scrolls inside)
    page.set_viewport_size({"width": 412, "height": 420})
    page.get_by_role("button", name=re.compile("Check in")).click()
    page.get_by_role("button", name="Yes, enter balance").click()
    box = page.locator("#form-dialog").bounding_box()
    field = page.locator('#form-dialog [name="balance"]').bounding_box()
    check("with the keyboard open the form starts at the top of the screen", box["y"] <= 20)
    check("the form is never taller than the visible area", box["y"] + box["height"] <= 420 + 1)
    check("the balance field is visible above the keyboard", field["y"] + field["height"] <= 420)
    save_box = page.locator("#form-dialog").get_by_role("button", name="Save").bounding_box()
    check("Save is visible without scrolling (pinned to the bottom of the form)", save_box["y"] + save_box["height"] <= 420)
    page.set_viewport_size({"width": 412, "height": 330})
    page.wait_for_timeout(100)
    save_box = page.locator("#form-dialog").get_by_role("button", name="Save").bounding_box()
    check("even with very little room, Save stays visible", save_box["y"] + save_box["height"] <= 330)
    page.keyboard.press("Escape")
    page.set_viewport_size({"width": 412, "height": 915})

    # Kristiina tops up 100 € of personal money; the balance rises, spending doesn't go down
    page.get_by_role("button", name=re.compile("Add money")).click()
    dlg = page.locator("#form-dialog")
    dlg.locator('[name="amount"]').fill("100")
    dlg.get_by_text("Kristiina", exact=True).click()
    dlg.get_by_role("button", name="Save").click()
    page.get_by_role("button", name=re.compile("Check in")).click()
    page.get_by_role("button", name="Yes, enter balance").click()
    page.locator('#form-dialog [name="balance"]').fill("120")
    page.locator('#form-dialog [name="balance"]').press("Enter")
    # spent = 930 start + 100 top-up − 120 balance = 910 → 20 left of the agreed 930
    check("top-up is not counted as spending (910 spent, 20 budget left)",
          "910,00" in page.get_by_test_id("spent").inner_text() and "20,00" in page.get_by_test_id("remaining").inner_text())
    check("balance line shows the top-up", "100,00 € topped up" in page.get_by_test_id("balance-line").inner_text().replace("\xa0", " "))
    page.screenshot(path=str(SHOTS / "phone-412-wallet.png"), full_page=True)

    for w in (340, 360):
        page.set_viewport_size({"width": w, "height": 800})
        page.wait_for_timeout(100)
        overlaps = page.evaluate("""() => [...document.querySelectorAll('.row-btn')].filter(b => {
            const t = b.querySelector('.title').getBoundingClientRect();
            const a = b.querySelector('.amount').getBoundingClientRect();
            return t.right > a.left + 1;
        }).length""")
        check(f"entry titles don't run under the amounts at {w}px", overlaps == 0)
        beside = page.evaluate("""() => {
            const pill = document.querySelector('.pace-pill'), btn = document.querySelector('.quiet-btn');
            if (!pill || !btn) return true;
            const p = pill.getBoundingClientRect(), b = btn.getBoundingClientRect();
            return b.left >= p.right && b.top < p.bottom && b.bottom > p.top;
        }""")
        check(f"'+ Add money' sits beside the pace message at {w}px", beside)
        overflow = page.evaluate("document.documentElement.scrollWidth > window.innerWidth")
        check(f"no horizontal scroll at {w}px (wallet)", not overflow)
        page.screenshot(path=str(SHOTS / f"phone-{w}-wallet.png"), full_page=True)
        page.goto(BASE + "#month")
        overflow = page.evaluate("document.documentElement.scrollWidth > window.innerWidth")
        check(f"no horizontal scroll at {w}px (month)", not overflow)
        page.goto(BASE + "#wallet")

    # Swipe between screens (order: Month, Wallet, Purchases, Big costs, Settings)
    page.goto(BASE + "#month")
    swipe(page, -150)
    check("swipe left: Month → Wallet (with slide feedback)", page.url.endswith("#wallet") and feedback(page) == "go")
    stopped = page.evaluate("""() => {
        const el = document.querySelector('main');
        const touch = (x, y) => new Touch({ identifier: 7, target: el, clientX: x, clientY: y });
        const fire = (type, x, y) => { const e = new TouchEvent(type, { bubbles: true, cancelable: true,
            touches: type === 'touchend' ? [] : [touch(x, y)], changedTouches: [touch(x, y)] }); el.dispatchEvent(e); return e.defaultPrevented; };
        fire('touchstart', 200, 400);
        const side = fire('touchmove', 170, 405);
        fire('touchend', 170, 405);
        fire('touchstart', 200, 400);
        const down = fire('touchmove', 202, 360);
        fire('touchend', 202, 360);
        return { side, down };
    }""")
    page.wait_for_timeout(300)
    check("a sideways swipe doesn't also scroll the page (no glide that eats the next tap)", stopped["side"] is True)
    check("scrolling up and down is left to the browser", stopped["down"] is False)
    page.evaluate("window.scrollTo(0, 300)")
    swipe(page, -150, dy=-20)
    title = page.locator("#month-title").inner_text()
    page.locator("#prev-month").click()
    check("month arrow works right after a swipe", page.locator("#month-title").inner_text() != title)
    check("the new screen starts at the top", page.evaluate("window.scrollY") == 0)
    page.locator("#next-month").click()
    swipe(page, 150)
    swipe(page, -150)
    check("swipe left: Wallet → Purchases", page.url.endswith("#buys"))
    swipe(page, -150)
    check("swipe left: Purchases → Big costs", page.url.endswith("#big"))
    swipe(page, 150)
    check("swipe right: back to Purchases", page.url.endswith("#buys"))
    swipe(page, 40, 300)
    check("scrolling down does not switch screens", page.url.endswith("#buys"))
    swipe(page, -60, 30, ms=600)
    check("a short, slightly diagonal swipe counts (more sensitive)", page.url.endswith("#big"))
    swipe(page, 60, 30, ms=600)
    swipe(page, -150, ms=1500)
    check("a slow drag does not switch screens", page.url.endswith("#buys"))
    # Swiping also works on the empty space below a short page (Big costs)
    page.goto(BASE + "#big")
    page.evaluate("""async () => {
        const y = window.innerHeight - 120, el = document.documentElement;
        const t = (x) => new Touch({ identifier: 2, target: el, clientX: x, clientY: y });
        el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [t(250)], changedTouches: [t(250)] }));
        await new Promise(r => setTimeout(r, 60));
        el.dispatchEvent(new TouchEvent('touchmove', { bubbles: true, touches: [t(150)], changedTouches: [t(150)] }));
        el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, touches: [], changedTouches: [t(100)] }));
    }""")
    page.wait_for_timeout(400)
    check("swiping on empty space below a short page works (Big costs → Settings)", page.url.endswith("#settings"))
    page.goto(BASE + "#month")
    swipe(page, 150)
    check("swipe right on the first screen (Month) stays there and bounces", page.url.endswith("#month") and feedback(page) == "bounce")
    swipe(page, -20)
    check("too-short swipe glides back without switching", page.url.endswith("#month") and feedback(page) == "cancel")
    check("page is back in place after the feedback", page.evaluate("getComputedStyle(document.querySelector('main')).transform") in ("none", "matrix(1, 0, 0, 1, 0, 0)"))
    page.goto(BASE + "#wallet")
    page.get_by_role("button", name=re.compile("Check in")).click()
    page.get_by_role("button", name="Yes, enter balance").click()
    swipe(page, -150)
    check("no swipe while a form is open", page.url.endswith("#wallet"))
    page.keyboard.press("Escape")

    # Next month: copy from October
    page.set_viewport_size({"width": 412, "height": 915})
    page.goto(BASE + "#month")
    page.locator("#next-month").click()
    page.get_by_role("button", name="Copy from October 2026").click()
    check("November copied 3 fixed costs, all unpaid", page.locator("[data-paid]").count() == 3 and page.locator(".row.is-paid").count() == 0)
    check("a copied month starts unlocked and unapproved", page.get_by_role("button", name=re.compile("I approve the November 2026 budget")).count() == 1)
    check("a new month starts with transfers not done", page.get_by_test_id("status-t").inner_text() == "To transfer")
    check("November copied the salaries", page.input_value("#income-t") == "3000,00" and page.input_value("#income-k") == "2500,00")

    # Big cost: 300 € washer over 3 months paid by Tõnis, from November
    page.locator('.tabs [data-view="big"]').click()
    page.get_by_role("button", name=re.compile(r"\+ Add")).click()
    dlg = page.locator("#form-dialog")
    dlg.locator('[name="name"]').fill("Washing machine")
    dlg.locator('[name="amount"]').fill("300")
    check("one-off shows months field, hides period", dlg.locator('[data-field="months"]').is_visible() and not dlg.locator('[data-field="period"]').is_visible())
    dlg.get_by_text("Tõnis", exact=True).click()
    dlg.get_by_role("button", name="Save").click()
    page.screenshot(path=str(SHOTS / "phone-412-bigcosts.png"), full_page=True)
    page.locator('.tabs [data-view="month"]').click()
    # Costs 2105.98 → leftover 3394.02 → 1697.01 each; Tõnis 3000 − 175.98 − 1697.01 = 1127.01
    check("big cost share lowers private money and counts as Tõnis's payment", "1.127,01" in page.get_by_test_id("deposit-t").inner_text() and "1.697,01" in page.get_by_test_id("private").inner_text())
    # Carry-over: October's last check-in (120 €) carries into November automatically
    check("carry-over taken from October's last check-in", "120,00" in page.get_by_test_id("carry-hint").inner_text())
    check("November wallet starts with 930 + 120 = 1.050 €", "1.050,00" in page.get_by_test_id("wallet-start").inner_text())
    page.locator('.tabs [data-view="wallet"]').click()
    page.get_by_role("button", name=re.compile("Check in")).click()
    page.get_by_role("button", name="Yes, enter balance").click()
    page.locator('#form-dialog [name="balance"]').fill("1000")
    page.locator('#form-dialog [name="balance"]').press("Enter")
    check("budget vs actual uses only the agreed 930 € (50 spent → 880 left)",
          "880,00" in page.get_by_test_id("remaining").inner_text() and "of the agreed 930,00" in page.locator("main").inner_text())
    check("balance line mentions the carry-over", "120,00 € carried over" in page.get_by_test_id("balance-line").inner_text().replace("\xa0", " "))
    # Override the carry-over by hand, then back to automatic
    page.locator('.tabs [data-view="month"]').click()
    page.fill("#carry-over", "150")
    page.keyboard.press("Enter")
    page.wait_for_timeout(100)
    check("typed carry-over overrides the automatic one", "1.080,00" in page.get_by_test_id("wallet-start").inner_text())
    page.fill("#carry-over", "")
    page.keyboard.press("Enter")
    page.wait_for_timeout(100)
    check("emptying the field goes back to automatic", "1.050,00" in page.get_by_test_id("wallet-start").inner_text())
    ctx.close()

    # ===== 2. Laptop with keyboard =====
    print("Laptop flow (1366 px, keyboard)")
    ctx, page = new_page(browser, viewport={"width": 1366, "height": 860})
    page.goto(BASE)
    expect(page.locator("#month-title")).to_have_text("October 2026")  # app has started
    check("opening the app without a screen starts on Month (not locked yet)", page.url.endswith("#month"))
    page.keyboard.press("2")
    expect(page).to_have_url(re.compile("#wallet$"), timeout=2000)
    check("key 2 opens Wallet", page.url.endswith("#wallet"))
    page.keyboard.press("1")
    check("key 1 opens Month", page.url.endswith("#month"))
    with page.expect_file_chooser(timeout=2000) as fc:
        page.keyboard.press("i")
    check("laptop: I goes straight to the file picker", fc.value is not None)
    check("laptop: no Revolut chooser", not page.locator("#form-dialog[open]").count())
    page.keyboard.press("1")
    page.get_by_role("button", name="Start empty").click()
    page.fill("#wallet-budget", "600")
    page.locator("body").click(position={"x": 5, "y": 400})
    page.keyboard.press("2")
    page.keyboard.press("c")
    check("C first asks whether purchases are sorted", page.locator("#form-dialog[open] h2").inner_text() == "Are the latest purchases sorted?")
    page.keyboard.press("Enter")
    check("Enter (yes) opens the check-in", page.locator("#form-dialog[open] h2").inner_text() == "Check in balance")
    page.keyboard.type("550")
    page.keyboard.press("Enter")
    check("check-in saved with keyboard (50 spent)", "550,00" in page.get_by_test_id("remaining").inner_text())
    page.keyboard.press("Control+z")
    page.wait_for_timeout(50)
    check("Ctrl+Z undoes the check-in", "600,00" in page.get_by_test_id("remaining").inner_text())
    page.keyboard.press("Control+y")
    page.wait_for_timeout(50)
    check("Ctrl+Y redoes it", "550,00" in page.get_by_test_id("remaining").inner_text())
    page.keyboard.press("a")
    check("A opens Add money", page.locator("#form-dialog[open] h2").inner_text() == "Add money to the wallet")
    page.keyboard.press("Escape")
    check("Esc closes the dialog", page.locator("#form-dialog[open]").count() == 0)
    expect(page.locator("#form-dialog")).not_to_have_attribute("open", "")
    page.keyboard.press("ArrowLeft")
    expect(page.locator("#month-title")).to_have_text("September 2026", timeout=2000)
    check("← goes to previous month", page.locator("#month-title").inner_text() == "September 2026")
    page.keyboard.press("t")
    check("T returns to this month", page.locator("#month-title").inner_text() == "October 2026")
    page.keyboard.press("Shift+?")
    check("? shows shortcut list", page.locator("#form-dialog[open] h2").inner_text() == "Keyboard shortcuts")
    page.screenshot(path=str(SHOTS / "laptop-1366-help.png"))
    page.keyboard.press("Escape")
    page.screenshot(path=str(SHOTS / "laptop-1366-wallet.png"), full_page=True)
    page.keyboard.press("5")
    page.screenshot(path=str(SHOTS / "laptop-1366-settings.png"), full_page=True)
    ctx.close()

    # ===== 3. Two phones syncing through the (fake) Sheet =====
    print("Sync between two phones")
    sheet = FakeSheet()
    ctx_t, tonis = new_page(browser, device=pixel, sheet=sheet)
    ctx_k, kris = new_page(browser, device=pixel, sheet=sheet)

    def connect(page, me):
        page.goto(BASE + "#settings")
        page.get_by_text(me, exact=True).first.click()
        page.fill("#sync-url", SYNC_URL)
        page.fill("#sync-key", KEY)
        page.get_by_role("button", name="Test and save").click()
        page.locator('.tabs [data-view="wallet"]').click()
        expect(page.locator("#sync-chip")).to_contain_text("Synced", timeout=5000)

    connect(tonis, "Tõnis")
    connect(kris, "Kristiina")

    tonis.goto(BASE + "#month")
    tonis.get_by_role("button", name="Start empty").click()
    tonis.fill("#wallet-budget", "800")
    tonis.keyboard.press("Enter")
    tonis.keyboard.press("Control+s")
    tonis.wait_for_timeout(300)

    kris.goto(BASE + "#wallet")
    kris.keyboard.press("Control+s")
    expect(kris.get_by_test_id("remaining")).to_contain_text("800,00", timeout=5000)
    check("Kristiina's phone receives Tõnis's budget", True)

    # Both enter their own salary before syncing: neither may overwrite the other.
    kris.goto(BASE + "#month")
    tonis.fill("#income-t", "3100")
    tonis.keyboard.press("Enter")
    kris.fill("#income-k", "2600")
    kris.keyboard.press("Enter")
    tonis.keyboard.press("Control+s")
    tonis.wait_for_timeout(300)
    kris.keyboard.press("Control+s")
    kris.wait_for_timeout(300)
    tonis.keyboard.press("Control+s")
    expect(tonis.locator("#income-k")).to_have_value("2600,00", timeout=5000)
    check("salaries entered at the same time on both phones are both kept",
          kris.input_value("#income-t") == "3100,00" and tonis.input_value("#income-t") == "3100,00")
    # Lock across two phones: approvals travel through the Sheet
    tonis.get_by_role("button", name=re.compile("I approve the October 2026 budget")).click()
    tonis.keyboard.press("Control+s")
    tonis.wait_for_timeout(400)
    kris.keyboard.press("Control+s")
    expect(kris.get_by_test_id("vote-t")).to_contain_text("approved", timeout=5000)
    check("Kristiina's phone sees Tõnis's approval", True)
    kris.get_by_role("button", name=re.compile("I approve the October 2026 budget")).click()
    check("Kristiina's approval locks it on her phone", "Budget locked" in kris.get_by_test_id("lock-card").inner_text())
    kris.wait_for_timeout(2500)
    tonis.keyboard.press("Control+s")
    expect(tonis.get_by_test_id("lock-card")).to_contain_text("Budget locked", timeout=5000)
    check("and Tõnis's phone shows it locked after sync", True)

    # Transfer status syncs: Kristiina marks hers, Tõnis sees it
    kris.get_by_test_id("deposit-k").click()
    kris.wait_for_timeout(2500)
    tonis.keyboard.press("Control+s")
    expect(tonis.get_by_test_id("status-k")).to_contain_text("✓", timeout=5000)
    check("transfer status syncs to the other phone", True)
    kris.goto(BASE + "#wallet")

    kris.get_by_role("button", name=re.compile("Add money")).click()
    kris.locator('#form-dialog [name="amount"]').fill("45")
    kris.locator('#form-dialog [name="note"]').fill("Market week")
    kris.locator("#form-dialog").get_by_role("button", name="Save").click()
    kris.wait_for_timeout(2500)  # auto-sync after 2 s
    tonis.goto(BASE + "#wallet")
    tonis.keyboard.press("Control+s")
    expect(tonis.get_by_test_id("balance-line")).to_contain_text(re.compile(r"45,00\s€ topped up"), timeout=5000)
    check("Tõnis's phone receives Kristiina's top-up (auto-sync)", True)
    check("entry shows who added it (Kristiina, KM)", "Kristiina added money" in tonis.locator(".list").inner_text() and "KM" in tonis.locator(".list").inner_text())

    # Delete on one phone travels to the other
    tonis.get_by_text("Market week").click()
    tonis.locator("#form-dialog").get_by_role("button", name="Delete").click()
    tonis.keyboard.press("Control+s")
    tonis.wait_for_timeout(300)
    kris.keyboard.press("Control+s")
    expect(kris.get_by_test_id("balance-line")).not_to_contain_text("topped up", timeout=5000)
    check("deletion syncs to the other phone", True)

    # Offline edits wait and go out later
    ctx_k.set_offline(True)
    kris.evaluate("window.dispatchEvent(new Event('offline'))")
    kris.get_by_role("button", name=re.compile("Check in")).click()
    kris.get_by_role("button", name="Yes, enter balance").click()
    kris.locator('#form-dialog [name="balance"]').fill("700")
    kris.locator("#form-dialog").get_by_role("button", name="Save").click()
    kris.wait_for_timeout(300)
    check("offline chip shows waiting change", "waiting" in kris.locator("#sync-chip").inner_text())
    kris.locator('.tabs [data-view="month"]').click()
    expect(kris.locator("#sync-alert")).to_be_visible(timeout=3000)
    alert_text = kris.locator("#sync-alert").inner_text()
    check("on other screens, an offline/sync warning appears under the header", "waiting to sync" in alert_text or "Sync failed" in alert_text)
    kris.locator('.tabs [data-view="wallet"]').click()
    ctx_k.set_offline(False)
    kris.evaluate("window.dispatchEvent(new Event('online'))")
    expect(kris.locator("#sync-chip")).to_contain_text("Synced", timeout=5000)
    tonis.keyboard.press("Control+s")
    expect(tonis.get_by_test_id("remaining")).to_contain_text("700,00", timeout=5000)
    check("offline check-in arrives after reconnecting", True)

    # ===== Weekly purchases: import Revolut CSV, sort, withdraw =====
    FIX = ROOT / "tests" / "fixtures"
    tonis.goto(BASE + "#buys")
    tonis.get_by_role("button", name=re.compile("Import CSV")).click()
    link = tonis.locator("#form-dialog a", has_text="Open Revolut")
    check("phone: Import CSV offers Open Revolut", link.is_visible() and (link.get_attribute("href") or "") == "https://www.revolut.com/app/")
    with tonis.expect_file_chooser(timeout=2000) as fc:
        tonis.get_by_role("button", name="Choose file").click()
    check("phone: Choose file opens the file picker", fc.value is not None)
    tonis.get_by_role("button", name=re.compile("Import CSV")).click()
    tonis.keyboard.press("Escape")
    check("phone: chooser closes with Esc", not tonis.locator("#form-dialog[open]").count())
    tonis.set_input_files("#csv-file", str(FIX / "revolut-week1.csv"))
    expect(tonis.get_by_test_id("sort-count")).to_have_text("3", timeout=3000)
    check("import keeps 3 finished card payments (skips salary and pending)", True)
    check("tab badge shows 3 to sort", tonis.locator("#buys-badge").inner_text() == "3")
    tonis.get_by_role("button", name="Lidl 4521 Berlin: common").click()
    tonis.get_by_role("button", name="Bäckerei Schmidt, Mitte: personal").click()
    tonis.get_by_role("button", name="Bio Hofladen Erde: common").click()
    # 23,45 + 10,35 (incl. fee) = 33,80
    check("withdraw total = common purchases (33,80 €)", "33,80" in tonis.get_by_test_id("withdraw-total").inner_text())
    check("nothing left to sort, badge hidden", tonis.get_by_test_id("sort-count").inner_text() == "0" and tonis.locator("#buys-badge").is_hidden())

    tonis.set_input_files("#csv-file", str(FIX / "revolut-week1.csv"))
    expect(tonis.locator("#toast")).to_contain_text("3 already imported", timeout=3000)
    check("importing the same file again adds nothing", tonis.get_by_test_id("sort-count").inner_text() == "0")

    tonis.set_input_files("#csv-file", str(FIX / "revolut-week2.csv"))
    expect(tonis.get_by_test_id("sort-count")).to_have_text("2", timeout=3000)
    check("overlapping export: only the 2 new purchases appear", True)
    check("a known shop is suggested ('usually common' for another Lidl)", "usually common" in tonis.locator(".sort-row", has_text="Lidl 1100").inner_text())
    tonis.get_by_role("button", name=re.compile("Accept 1 suggestion")).click()
    check("accepting suggestions sorts the Lidl purchase", tonis.get_by_test_id("sort-count").inner_text() == "1")
    tonis.get_by_role("button", name="Kino International: personal").click()
    check("withdraw total now 49,40 €", "49,40" in tonis.get_by_test_id("withdraw-total").inner_text())

    # The app's "Custom statement" format: long introduction, EUR and SEK sections
    tonis.set_input_files("#csv-file", str(FIX / "revolut-custom-statement.csv"))
    expect(tonis.locator("#toast")).to_contain_text("2 in SEK left out", timeout=3000)
    check("custom statement: EUR purchases recognised as already imported, SEK reported", "3 already imported" in tonis.locator("#toast").inner_text())
    check("pop-up message has square-ish corners and the app's colours",
          tonis.evaluate("(() => { const t = getComputedStyle(document.getElementById('toast')); return t.borderRadius === '10px' && t.backgroundColor !== 'rgb(255, 255, 255)'; })()"))

    # A real-layout file whose euro signs arrived garbled ("-â¬33.94")
    tonis.set_input_files("#csv-file", str(FIX / "revolut-custom-garbled.csv"))
    expect(tonis.locator("#toast")).to_contain_text("3 new purchases", timeout=3000)
    check("garbled Revolut file: 3 purchases recognised (incoming payment skipped)", True)
    check("garbled umlauts are repaired in shop names", tonis.locator(".sort-row", has_text="Bäckerei Musterbrot").count() == 1)
    for name in ["REWE.de", "Zenvital", "Bäckerei Musterbrot"]:
        tonis.get_by_role("button", name=f"{name}: personal").click()

    # A statement across the month change: only the chosen month is imported
    check("month stays visible on Purchases", tonis.locator(".month-nav").is_visible())
    tonis.set_input_files("#csv-file", str(FIX / "revolut-month-end.csv"))
    expect(tonis.locator("#toast")).to_contain_text("1 new purchase in October 2026", timeout=3000)
    check("other month's purchases are left out and named", "2 from September 2026 left out" in tonis.locator("#toast").inner_text())
    tonis.wait_for_timeout(9000)
    check("import result stays until it is read (still there after 9 s)", tonis.locator("#toast.show").count() == 1)
    check("only October's purchase waits in To sort", tonis.get_by_test_id("sort-count").inner_text() == "1")
    tonis.locator("#toast button", has_text="Import September").click()
    expect(tonis.locator("#month-title")).to_have_text("September 2026", timeout=2000)
    expect(tonis.get_by_test_id("sort-count")).to_have_text("2", timeout=3000)
    check("toast button imports the left-out month (a purchase paid 30 Sep, completed 2 Oct, counts in September)",
          tonis.locator(".sort-row", has_text="Beispiel Drogerie").count() == 1)
    check("the other month's waiting purchases are pointed out", "1 in October 2026" in tonis.get_by_test_id("sort-elsewhere").inner_text())
    tonis.get_by_role("button", name="Musterladen Nord: personal").click()
    tonis.get_by_role("button", name="Beispiel Drogerie: personal").click()
    tonis.get_by_test_id("sort-elsewhere").get_by_role("button").click()
    expect(tonis.locator("#month-title")).to_have_text("October 2026", timeout=2000)
    tonis.get_by_role("button", name="Testmarkt Süd: personal").click()
    check("all months sorted, badge hidden", tonis.locator("#buys-badge").is_hidden())

    # Wallet counts unwithdrawn common purchases as spent already: 800 − 700 balance = 100, + 49,40
    tonis.locator('.tabs [data-view="wallet"]').click()
    check("wallet: common purchases count as spent before withdrawal", "149,40" in tonis.get_by_test_id("spent").inner_text())
    check("wallet shows what is not withdrawn yet", "49,40" in tonis.get_by_test_id("pending-line").inner_text())

    # Sync and privacy
    tonis.keyboard.press("Control+s")
    tonis.wait_for_timeout(400)
    kris.goto(BASE + "#buys")
    kris.keyboard.press("Control+s")
    expect(kris.get_by_test_id("other-pending")).to_contain_text("49,40", timeout=5000)
    check("Kristiina sees Tõnis's pending common purchases", "Tõnis: 3 purchases" in kris.get_by_test_id("other-pending").inner_text())
    sheet_text = json.dumps([r["rec"] for r in sheet.rows.values()])
    check("personal purchases never reach the Sheet", "Bäckerei" not in sheet_text and "Kino" not in sheet_text)
    check("common purchases do reach the Sheet", "Lidl 4521 Berlin" in sheet_text)
    check("Kristiina has nothing to sort (imports stay on Tõnis's phone)", kris.get_by_test_id("sort-count").inner_text() == "0")

    # Withdraw
    tonis.goto(BASE + "#buys")
    tonis.get_by_role("button", name=re.compile("I've withdrawn 49,40")).click()
    tonis.locator("#form-dialog").get_by_role("button", name=re.compile("Yes, 49,40")).click()
    check("after withdrawing, nothing is left to withdraw", "0,00" in tonis.get_by_test_id("withdraw-total").inner_text())
    check("withdrawal listed under recent withdrawals", "49,40" in tonis.locator("main").inner_text() and "Tõnis withdrew" in tonis.locator("main").inner_text())
    tonis.locator('.tabs [data-view="wallet"]').click()
    check("wallet spent unchanged right after withdrawing (149,40)", "149,40" in tonis.get_by_test_id("spent").inner_text())
    tonis.get_by_role("button", name=re.compile("Check in")).click()
    tonis.get_by_role("button", name="Yes, enter balance").click()
    tonis.locator('#form-dialog [name="balance"]').fill("650,60")
    tonis.locator('#form-dialog [name="balance"]').press("Enter")
    check("check-in after the withdrawal: no double counting (still 149,40)", "149,40" in tonis.get_by_test_id("spent").inner_text())
    check("withdrawal shows in the wallet entries", "withdrew for purchases" in tonis.locator(".list").inner_text())

    # Purchases panels in step order; last-sorted info
    tonis.goto(BASE + "#buys")
    labels = tonis.evaluate("[...document.querySelectorAll('main section.card')].map(c => c.getAttribute('aria-label') || '')")
    check("Purchases: 'To sort' comes before 'To withdraw'", labels.index("To sort") < labels.index("To withdraw"))
    check("when everything is sorted it says when (today)", "Last sorted today" in tonis.get_by_test_id("last-sorted").inner_text())
    check("no reminder right after sorting", tonis.get_by_test_id("sort-reminder").count() == 0)

    # Over 7 days since the last full sort → reminders on Purchases, the tab and the Wallet
    tonis.evaluate("localStorage.setItem('hb.lastSorted', JSON.stringify(new Date(Date.now() - 9 * 86400000).toISOString()))")
    tonis.reload()
    tonis.goto(BASE + "#buys")
    expect(tonis.get_by_test_id("sort-reminder")).to_contain_text("9 days ago", timeout=3000)
    check("Purchases shows a reminder after 9 days", True)
    check("the Purchases tab shows '!'", tonis.locator("#buys-badge").inner_text() == "!")
    tonis.locator('.tabs [data-view="wallet"]').click()
    check("the Wallet reminds to sort before checking in", "9 days ago" in tonis.get_by_test_id("wallet-sort-reminder").inner_text())
    tonis.goto(BASE + "#buys")
    tonis.set_input_files("#csv-file", str(FIX / "revolut-week1.csv"))
    expect(tonis.locator("#toast")).to_contain_text("already imported", timeout=3000)
    check("importing (nothing new) counts as sorted: reminder gone", tonis.get_by_test_id("sort-reminder").count() == 0 and tonis.locator("#buys-badge").is_hidden())

    # "Already settled before…": clear old purchases without teaching the shop memory
    ctx_s, solo = new_page(browser, device=pixel)
    solo.goto(BASE + "#buys")
    solo.set_input_files("#csv-file", str(FIX / "revolut-week1.csv"))
    expect(solo.get_by_test_id("sort-count")).to_have_text("3", timeout=3000)
    solo.get_by_role("button", name="Lidl 4521 Berlin: common").click()
    solo.get_by_role("button", name=re.compile("Already settled before")).click()
    check("settle-before form defaults to the latest purchase date", solo.locator('#form-dialog [name="date"]').input_value() == "2026-10-29")
    solo.locator("#form-dialog").get_by_role("button", name="Clear them").click()
    check("old purchases cleared from 'To sort'", solo.get_by_test_id("sort-count").inner_text() == "0")
    check("the common one is kept for withdrawal", "23,45" in solo.get_by_test_id("withdraw-total").inner_text())
    shops = json.loads(solo.evaluate("localStorage.getItem('hb.shops')") or "{}")
    check("cleared shops are not remembered (only Lidl, as common)", shops == {"lidl berlin": "common"})
    solo.get_by_role("button", name="Undo").click()
    check("Undo brings the cleared purchases back", solo.get_by_test_id("sort-count").inner_text() == "2")
    solo.get_by_role("button", name=re.compile("Already settled before")).click()
    solo.locator('#form-dialog [name="date"]').fill("2026-10-27")
    solo.locator("#form-dialog").get_by_role("button", name="Clear them").click()
    check("only purchases up to the chosen date are cleared", solo.get_by_test_id("sort-count").inner_text() == "1" and solo.locator(".sort-row", has_text="Bio Hofladen").count() == 1)
    solo.set_input_files("#csv-file", str(FIX / "revolut-week1.csv"))
    expect(solo.locator("#toast")).to_contain_text("3 already imported", timeout=3000)
    check("cleared purchases don't come back on re-import", solo.get_by_test_id("sort-count").inner_text() == "1")

    # Wrong choice? Put personal / settled purchases back into "To sort"
    solo.get_by_role("button", name="Bio Hofladen Erde: personal").click()
    solo.get_by_test_id("sorted-away").locator("summary").click()
    check("personal and settled purchases are listed", "Bäckerei Schmidt" in solo.get_by_test_id("sorted-away").inner_text() and "personal" in solo.get_by_test_id("sorted-away").inner_text())
    solo.get_by_role("button", name="Bio Hofladen Erde: back to sorting").click()
    check("'Back' puts one purchase back into To sort", solo.get_by_test_id("sort-count").inner_text() == "1" and solo.locator(".sort-row", has_text="Bio Hofladen").count() == 1)
    solo.get_by_test_id("sorted-away").locator("summary").click()
    solo.once("dialog", lambda d: d.accept())
    solo.get_by_role("button", name=re.compile("Put all 1 back")).click()
    check("'Put all back' returns the settled ones too", solo.get_by_test_id("sort-count").inner_text() == "2")
    solo.locator("[data-expense]").first.click()
    solo.locator("#form-dialog").get_by_role("button", name="Not common after all").click()
    check("a common one can go back too (Not common after all)", solo.get_by_test_id("sort-count").inner_text() == "3")

    # Tiny vibration on taps (switchable per phone)
    solo.evaluate("() => { window.__buzz = []; navigator.vibrate = (ms) => { window.__buzz.push(ms); return true; }; }")
    solo.locator('.tabs [data-view="wallet"]').click()
    solo.locator("#next-month").click()
    buzz = solo.evaluate("window.__buzz")
    check(f"tapping buttons gives a tiny vibration (8 ms each): {buzz}", buzz == [8, 8])
    solo.locator('.tabs [data-view="settings"]').click()
    solo.locator("#vibrate").uncheck()
    solo.evaluate("window.__buzz = []")
    solo.locator('.tabs [data-view="wallet"]').click()
    solo.locator("#prev-month").click()
    check("vibration can be switched off in Settings", solo.evaluate("window.__buzz") == [])
    ctx_s.close()

    # Wrong key is refused
    kris.goto(BASE + "#settings")
    kris.fill("#sync-key", "wrong")
    kris.get_by_role("button", name="Test and save").click()
    expect(kris.locator("#toast")).to_contain_text("Wrong sync key", timeout=3000)
    check("wrong key is refused with a clear message", True)
    check("sheet never received the key in stored rows", all("key" not in r["rec"] for r in sheet.rows.values()))

    # Backup excludes the key
    with kris.expect_download() as dl:
        kris.get_by_role("button", name="Download backup").click()
    content = Path(dl.value.path()).read_text()
    check("backup contains records but not the sync key", '"records"' in content and KEY not in content)
    ctx_t.close()
    ctx_k.close()
    browser.close()


if __name__ == "__main__":
    srv = start_server()
    try:
        with sync_playwright() as p:
            run(p)
    except Exception as e:
        print("TEST CRASHED:", e)
        checks.append(("no crash", False))
    finally:
        srv.shutdown()
    if errors:
        print("Page errors:")
        for e in errors:
            print("  " + e)
    failed = [n for n, ok in checks if not ok]
    print(f"\n{len(checks) - len(failed)}/{len(checks)} checks passed, {len(errors)} page errors")
    sys.exit(1 if failed or errors else 0)
