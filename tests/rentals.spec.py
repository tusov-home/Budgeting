"""
End-to-end test: the private Rentals page (made-up data only).

Run from the project folder:
    python3 tests/rentals.spec.py
Reuses the server and helpers from app.spec.py. Two fake Sheets: the shared
household one and Tõnis's private one, to check that rentals data never
reaches the shared Sheet.
"""
import importlib.util
import json
import re
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright, expect

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("appspec", HERE / "app.spec.py")
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)
app.PORT = 8767
BASE = f"http://localhost:{app.PORT}/"
FIX = HERE / "fixtures"
SHOTS = app.SHOTS
check = app.check
PRIVATE_URL = "https://script.google.com/macros/s/PRIVATE/exec"
PRIVATE_KEY = "private-key-abcdef0123456789"


class Sheet:
    """Fake Apps Script web app with its own key."""
    def __init__(self, key):
        self.key, self.rows, self.seq, self.lock = key, {}, 0, threading.Lock()

    def handle(self, route):
        body = json.loads(route.request.post_data or "{}")
        if body.get("key") != self.key:
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

    def types(self):
        return {r["rec"].get("type") for r in self.rows.values()}


def new_page(browser, shared, private, **kw):
    ctx, page = app.new_page(browser, **kw)
    page.route("https://script.google.com/**",
               lambda route: (private if "PRIVATE" in route.request.url else shared).handle(route))
    return ctx, page


def toast(page):
    return page.locator("#toast").inner_text().replace("\xa0", " ")


def text(loc):
    """Visible text with normal spaces (amounts use non-breaking spaces)."""
    return loc.inner_text().replace("\xa0", " ")


def run(p):
    browser = p.chromium.launch()
    pixel = p.devices["Pixel 7"]
    shared = app.FakeSheet()
    private = Sheet(PRIVATE_KEY)
    ctx_t, t = new_page(browser, shared, private, device=pixel)
    ctx_k, k = new_page(browser, shared, private, device=pixel)

    def connect_household(page, me):
        page.goto(BASE + "#settings")
        page.get_by_text(me, exact=True).first.click()
        page.fill("#sync-url", app.SYNC_URL)
        page.fill("#sync-key", app.KEY)
        page.get_by_role("button", name="Test and save").click()
        page.wait_for_timeout(300)

    connect_household(t, "Tõnis")
    connect_household(k, "Kristiina")

    print("Only on Tõnis's devices")
    check("Tõnis sees the Rentals tab", t.locator('.tabs [data-view="rentals"]').is_visible())
    check("Kristiina doesn't", not k.locator('.tabs [data-view="rentals"]').is_visible())
    k.goto(BASE + "#rentals")
    k.wait_for_timeout(200)
    check("…and can't open it by address", k.locator(".rentals").count() == 0)
    k.keyboard.press("5")
    k.wait_for_timeout(200)
    check("on her phone, 5 is still Settings", "#settings" in k.url)

    print("Setup")
    t.locator('.tabs [data-view="rentals"]').click()
    expect(t.get_by_test_id("rent-tab-setup")).to_have_attribute("aria-selected", "true")
    check("an empty Rentals page starts at Setup", True)
    t.fill("#apt-a", "Flat A")
    t.fill("#apt-b", "Flat B")
    t.fill("#rate-2026", "11,2")
    t.get_by_role("button", name="Save", exact=True).click()
    t.fill("#rent-url", PRIVATE_URL)
    t.fill("#rent-key", "household-key-is-wrong-here")
    t.locator("#rent-sync").get_by_role("button", name="Test and save").click()
    expect(t.locator("#toast")).to_contain_text("Could not connect", timeout=5000)
    check("a wrong private key is refused", True)
    t.fill("#rent-key", PRIVATE_KEY)
    t.locator("#rent-sync").get_by_role("button", name="Test and save").click()
    expect(t.locator("#toast")).to_contain_text("private Sheet", timeout=5000)
    check("connected to the private Sheet", True)

    print("Import and sort")
    t.get_by_test_id("rent-tab-sort").click()
    t.set_input_files("#rent-file", [str(FIX / "swedbank-ee.csv"), str(FIX / "swedbank-se.csv")])
    expect(t.get_by_test_id("rent-unsorted")).to_have_text("9", timeout=5000)
    check("both statements imported: 6 + 3 lines to sort", True)
    check("the Rentals tab shows how many to sort", t.locator("#rent-badge").inner_text() == "9")
    t.set_input_files("#rent-file", str(FIX / "swedbank-ee.csv"))
    expect(t.locator("#toast")).to_contain_text("0 new lines, 6 already here", timeout=3000)
    check("importing the same statement again adds nothing", t.get_by_test_id("rent-unsorted").inner_text() == "9")
    t.screenshot(path=str(SHOTS / "rentals-phone-sort.png"), full_page=True)

    def sort_line(party, apt, category=None, remember="payee", rule=None):
        t.locator("[data-tx]", has_text=party).first.click()
        dlg = t.locator("#form-dialog")
        dlg.locator(".seg label", has_text=re.compile(f"^{re.escape(apt)}$")).click()
        if category:
            dlg.locator('select[name="category"]').select_option(category)
        label = {"payee": "By payee", "text": "By text", "no": "No"}[remember]
        dlg.locator(".seg label", has_text=re.compile(f"^{label}$")).click()
        if rule is not None:
            dlg.locator('[name="ruleText"]').fill(rule)
        dlg.get_by_role("button", name="Save").click()
        t.wait_for_timeout(100)

    t.locator("[data-tx]", has_text="Mari Maasikas").click()
    check("money in suggests Rent first", t.locator('#form-dialog select[name="category"]').input_value() == "rent")
    check("the form shows date and amount", "650,00" in t.get_by_test_id("rent-sort-info").inner_text())
    t.screenshot(path=str(SHOTS / "rentals-phone-sort-form.png"))
    t.keyboard.press("Escape")
    sort_line("Mari Maasikas", "Flat A", "rent")
    sort_line("Haldus", "Flat A", "management")
    sort_line("Korteriühistu", "Both", "utilities")
    sort_line("Jaan Jõgi", "Flat B", "rent")
    sort_line("Šokolaadi", "Flat B", "repairs")
    sort_line("Kuutasu", "Both", "fees")
    sort_line("Försäkring", "Flat B", "insurance")
    sort_line("Egen överföring", "Not rental")
    sort_line("Swedbank avgift", "Both", "fees")
    check("everything sorted", t.get_by_test_id("rent-unsorted").inner_text() == "0")
    check("sorted lines are listed with their choice", "Flat B · Repairs" in t.locator("main").inner_text())

    print("Overview")
    t.get_by_test_id("rent-tab-overview").click()
    balances = [b.replace("\xa0", " ") for b in t.get_by_test_id("acct-balance").all_inner_texts()]
    check(f"balances from the statements ({balances})", "2.580,33 €" in balances and any("8.188,00" in b and "SEK" in b for b in balances))
    check("SEK balance also shown in euros (≈ 731 €)", "≈ 731 €" in text(t.get_by_test_id("rent-balances")))
    months = text(t.get_by_test_id("rent-months"))
    check("October: rent from both flats arrived", "✓ 650 €" in months and "✓ 720 €" in months)
    check("months before the first statement aren't called missing", "missing" not in months)

    print("Bills")
    t.get_by_test_id("rent-tab-bills").click()
    t.get_by_role("button", name="Add", exact=True).click()
    dlg = t.locator("#form-dialog")
    dlg.locator('[name="name"]').fill("Management fee")
    dlg.locator('select[name="category"]').select_option("management")
    dlg.locator('[name="amount"]').fill("55")
    dlg.locator('[name="firstDue"]').fill("2026-01-05")
    dlg.get_by_role("button", name="Add").click()
    t.keyboard.press("n")
    dlg.locator('[name="name"]').fill("Home insurance")
    dlg.locator(".seg label", has_text=re.compile("^Flat B$")).click()
    dlg.locator('select[name="category"]').select_option("landtax")
    dlg.locator('[name="amount"]').fill("30")
    dlg.locator(".seg label", has_text=re.compile("^Yearly$")).click()
    dlg.locator('[name="firstDue"]').fill("2025-10-20")
    dlg.get_by_role("button", name="Add").click()
    check("N adds a recurring payment on Bills", t.get_by_test_id("bill-row").count() == 2)
    t.get_by_test_id("rent-tab-overview").click()
    up = t.get_by_test_id("rent-upcoming")
    check("October's management fee was paid (not listed); November's is due soon",
          t.get_by_test_id("bill-due-soon").count() == 1 and "5 Nov" in text(t.get_by_test_id("bill-due-soon")))
    check("the yearly payment without a matching transaction shows as not paid", t.get_by_test_id("bill-overdue").count() == 1)
    t.screenshot(path=str(SHOTS / "rentals-phone-overview.png"), full_page=True)
    t.get_by_test_id("bill-overdue").get_by_role("button", name=re.compile("as paid")).click()
    check("Paid ticks it off", t.get_by_test_id("bill-overdue").count() == 0)
    t.keyboard.press("Control+z")
    t.wait_for_timeout(200)
    check("Ctrl+Z on Rentals undoes the rentals change", t.get_by_test_id("bill-overdue").count() == 1)
    t.keyboard.press("Control+y")
    t.wait_for_timeout(200)
    check("Ctrl+Y redoes it", t.get_by_test_id("bill-overdue").count() == 0)

    print("Year")
    t.get_by_test_id("rent-tab-year").click()
    year = text(t.get_by_test_id("rent-year"))
    check("result per flat and total (521,49 / 519,82 / 1.041,31)", "521,49" in year and "519,82" in year and "1.041,31" in year)
    check("your 50 % share", "260,75" in year and "259,91" in year and "520,66" in year)
    check("German words help find the line", "Mieteinnahmen" in year and "Erhaltungsaufwand" in year)
    t.screenshot(path=str(SHOTS / "rentals-phone-year.png"), full_page=True)
    t.context.grant_permissions(["clipboard-read", "clipboard-write"])
    t.get_by_role("button", name="Copy table").click()
    t.wait_for_timeout(200)
    copied = t.evaluate("navigator.clipboard.readText()")
    check("Copy table gives a tab-separated table", copied.startswith("Rentals 2026") and "\tFlat A\tFlat B\tTotal" in copied and "521,49" in copied)
    t.get_by_role("button", name="Previous year").click()
    check("the year can be changed", t.get_by_test_id("rent-year-label").inner_text() == "2025")
    for w in (412, 360, 340):
        t.set_viewport_size({"width": w, "height": 800})
        wide = t.evaluate("document.documentElement.scrollWidth > window.innerWidth")
        check(f"no sideways scrolling at {w} px", not wide)
    t.screenshot(path=str(SHOTS / "rentals-phone-340.png"))

    print("Private")
    t.wait_for_timeout(2500)  # auto-sync after edits
    t.keyboard.press("Control+s")
    t.wait_for_timeout(500)
    # A household change too, so the shared Sheet has something to compare with.
    t.locator('.tabs [data-view="month"]').click()
    t.get_by_role("button", name="Start empty").click()
    t.fill("#wallet-budget", "800")
    t.keyboard.press("Enter")
    t.locator('.tabs [data-view="wallet"]').click()
    t.keyboard.press("Control+s")
    t.wait_for_timeout(500)
    rental_types = {"rtx", "racct", "rbill", "rpayee", "rpaid", "rsettings"}
    shared_types = {r["rec"].get("type") for r in shared.rows.values()}
    check(f"the shared household Sheet has no rentals data ({sorted(t for t in shared_types if t)})", shared_types and not (shared_types & rental_types))
    check("the private Sheet has it", {"rtx", "racct", "rbill", "rsettings"} <= private.types())
    k.keyboard.press("Control+s")
    k.wait_for_timeout(500)
    check("nothing about rentals on Kristiina's phone", "rtx" not in (k.evaluate("JSON.stringify(localStorage)") or ""))

    print("Laptop")
    ctx_l, lap = new_page(browser, shared, private, viewport={"width": 1366, "height": 900})
    connect_household(lap, "Tõnis")
    lap.keyboard.press("5")
    lap.wait_for_timeout(200)
    check("on Tõnis's laptop, 5 opens Rentals", "#rentals" in lap.url)
    lap.fill("#rent-url", PRIVATE_URL)
    lap.fill("#rent-key", PRIVATE_KEY)
    lap.locator("#rent-sync").get_by_role("button", name="Test and save").click()
    expect(lap.locator("#toast")).to_contain_text("synced", timeout=5000)
    lap.get_by_test_id("rent-tab-year").click()
    check("the laptop gets everything from the private Sheet", "1.041,31" in text(lap.get_by_test_id("rent-year")))
    lap.screenshot(path=str(SHOTS / "rentals-laptop-year.png"), full_page=True)
    lap.keyboard.press("6")
    lap.wait_for_timeout(200)
    check("…and 6 opens Settings", "#settings" in lap.url)
    ctx_l.close()
    t.set_viewport_size({"width": 412, "height": 915})
    t.locator('.tabs [data-view="rentals"]').click()
    t.get_by_test_id("rent-tab-sort").click()
    print("English statement, two loans from one payee")
    check("the file picker has no type filter, so no statement is greyed out", t.locator("#rent-file").get_attribute("accept") is None)
    t.set_input_files("#rent-file", {"name": "photo.jpg", "mimeType": "image/jpeg", "buffer": b"\xff\xd8\xff\xe0 not a statement"})
    expect(t.locator("#toast")).to_contain_text("doesn't look like a Swedbank statement", timeout=3000)
    check("picking a wrong file gives a clear message", True)
    t.set_input_files("#rent-file", str(FIX / "swedbank-ee-en-oct.csv"))
    expect(t.get_by_test_id("rent-unsorted")).to_have_text("9", timeout=5000)
    check("English-language statement: all 9 lines, also the two identical fees on one day", True)
    sort_line("Laenu põhiosa: 11-000001", "Flat A", "principal")
    sort_line("Laenu põhiosa: 22-000002", "Flat B", "principal")
    sort_line("Kogunenud intress: 11-000001", "Flat A", "interest")
    sort_line("Kogunenud intress: 22-000002", "Flat B", "interest")
    t.set_input_files("#rent-file", str(FIX / "swedbank-ee-en-nov.csv"))
    expect(t.get_by_test_id("rent-unsorted")).to_have_text("10", timeout=5000)
    def tag_of(text):
        return t.locator(".rent-row", has_text=text).filter(has_text="Nov").first.locator(".tag").inner_text()
    check("next month, each loan is suggested to its own flat",
          "Flat A" in tag_of("põhiosa: 11-000001") and "Flat B" in tag_of("põhiosa: 22-000002"))
    check("…and interest lines without a payee too",
          "Flat A · Loan interest" in tag_of("intress: 11-000001") and "Flat B · Loan interest" in tag_of("intress: 22-000002"))
    print("Rules by text: two policies from one insurer, one manager for both flats")
    t.set_input_files("#rent-file", str(FIX / "swedbank-ee-rules-1.csv"))
    t.wait_for_timeout(300)
    t.locator("[data-tx]", has_text="Arve 300100").click()
    check("the form shows the reference number", "90000111" in t.get_by_test_id("rent-sort-info").inner_text())
    t.keyboard.press("Escape")
    sort_line("Arve 300100", "Flat A", "insurance", remember="text", rule="90000111")
    sort_line("Arve 300200", "Flat B", "insurance", remember="text", rule="90000222")
    sort_line("Arve nr 2026-501", "Flat A", "management")
    sort_line("Arve nr 2026-502", "Flat B", "management")
    t.set_input_files("#rent-file", str(FIX / "swedbank-ee-rules-2.csv"))
    t.wait_for_timeout(300)
    def tag_for(text):
        return t.locator(".rent-row", has_text=text).first.locator(".tag").inner_text()
    check("next month, policy 90000111 → Flat A by its rule", tag_for("Arve 310100").startswith("→ Flat A · Insurance") and '"90000111"' in tag_for("Arve 310100"))
    check("…and policy 90000222 → Flat B", tag_for("Arve 310200").startswith("→ Flat B · Insurance"))
    check("a payee used for both flats isn't guessed; it asks for a choice or a rule",
          "Both apartments use this payee" in tag_for("Arve nr 2026-601"))
    t.locator("[data-tx]", has_text="Arve nr 2026-601").click()
    check("…and its form starts on 'By text'", t.locator('#form-dialog input[name="remember"][value="text"]').is_checked())
    t.keyboard.press("Escape")
    t.get_by_test_id("rent-tab-setup").click()
    rules = t.get_by_test_id("rent-rules")
    check("Setup lists the rules", '"90000111"' in rules.inner_text() and '"90000222"' in rules.inner_text())
    rules.get_by_role("button", name='Delete rule 90000222').click()
    check("a rule can be deleted", '"90000222"' not in t.get_by_test_id("rent-rules").inner_text())
    t.screenshot(path=str(SHOTS / "rentals-phone-rules.png"), full_page=True)

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
