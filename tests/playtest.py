"""Playwright playtest for SirTet.

Serves the repo with python's http.server, then plays real games in
Chromium: one on a desktop viewport with the keyboard and mouse, one in
mobile emulation (360x640, touch) with taps, holds and swipes. It also
checks the title card at small and landscape sizes and that holding to
slide beside a cupboard never shuts its door.
An autopilot (src/bot.js) only *advises*; every move goes in as a
genuine key press or touch. Screenshots are saved at key moments and the
run fails if the console shows any errors.

Usage:
    python tests/playtest.py [--out DIR] [--chromium PATH] [--seconds N]
"""

import argparse
import glob
import json
import os
import random
import socket
import subprocess
import sys
import time

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

ADVISE_JS = """async () => {
	const bot = await import('/src/bot.js');
	const app = window.__sirtet;
	const g = app.game;
	const L = app.renderer.L;
	const p = g.active;
	let box = null;
	if (p) {
		const v = app.renderer.vis.get(p.id) || p;
		const w = Math.max(...p.cells.map((c) => c[0])) + 1;
		const h = Math.max(...p.cells.map((c) => c[1])) + 1;
		box = { x: L.colX + v.x * L.c, y: L.colY + v.y * L.c, w: w * L.c, h: h * L.c };
	}
	return { advice: bot.advise(g), box, L: { c: L.c, colX: L.colX, colY: L.colY, colW: L.colW, ox: L.ox, rightX: L.rightX } };
}"""

STATE_JS = """() => {
	const g = window.__sirtet.game;
	return {
		mode: g.mode, score: g.score, level: g.level, stored: g.stored, rejected: g.rejected,
		drawer: g.drawerCount, flying: g.flying.length, streak: g.streak, time: g.time,
		demo: window.__sirtet.demo, paused: !document.getElementById('paused').hidden,
		ghost: window.__sirtet.renderer.ghostTargets().map((t) => t.verdict),
		popups: window.__sirtet.renderer.popups.map((p) => p.text),
		cups: g.cupboards.map((c) => ({ type: c.type, n: c.items.length, door: c.door })),
	};
}"""


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def find_chromium():
    home = os.path.expanduser("~/.cache/ms-playwright")
    for pattern in ("chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell",
                    "chromium-*/chrome-linux64/chrome"):
        hits = sorted(glob.glob(os.path.join(home, pattern)))
        if hits:
            return hits[-1]
    return None


class Run:
    def __init__(self, page, out, name):
        self.page = page
        self.out = out
        self.name = name
        self.errors = []
        self.shots = []
        self.taken = set()
        page.on("console", lambda m: self.errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: self.errors.append(str(e)))

    def shot(self, label):
        path = os.path.join(self.out, f"{self.name}-{label}.png")
        self.page.screenshot(path=path)
        self.shots.append(path)
        return path

    def once(self, label, cond):
        if cond and label not in self.taken:
            self.taken.add(label)
            self.shot(label)

    def state(self):
        return self.page.evaluate(STATE_JS)

    def milestones(self, s):
        self.once("01-first-flight", s["flying"] > 0)
        self.once("01b-ghost-fits", "store" in s["ghost"])
        self.once("01c-ghost-refused", any(v in ("gap", "wrong", "taken") for v in s["ghost"]))
        self.once("02-first-store", s["stored"] >= 1)
        self.once("03-full-cupboard", any(c["n"] >= 3 for c in s["cups"]))
        self.once("04-rejected", s["rejected"] >= 1 and any(t in ("Too slow!", "Wrong cupboard!", "Wrong way round!") or "already has" in t for t in s["popups"]))
        self.once("05-cutlery-drawer", s["drawer"] >= 1)
        self.once("06-level-2", s["level"] >= 2)
        self.once("07-door-closing", any(c["door"] != "open" for c in s["cups"]))


def play(run, seconds, do, skill_every=7, rng=None):
    """Play for `seconds`, acting on the autopilot's advice through `do` at
    a human pace (180-320 ms between actions, 5% of them random mistakes).
    Every `skill_every`-th piece is deliberately left alone so the
    rejection path gets exercised too."""
    rng = rng or random.Random(1)
    page = run.page
    end = time.time() + seconds
    actions = 0
    sulk_until = 0
    last_stored = 0
    while time.time() < end:
        s = run.state()
        run.milestones(s)
        if s["mode"] != "playing":
            break
        if s["stored"] != last_stored:
            last_stored = s["stored"]
            if last_stored % skill_every == skill_every - 1:
                sulk_until = time.time() + 9
        if time.time() < sulk_until:
            page.wait_for_timeout(120)
            continue
        info = page.evaluate(ADVISE_JS)
        if info["advice"]:
            if rng.random() < 0.05:
                info["advice"] = rng.choice(["left", "right", "rotate"])
            do(info)
            actions += 1
        page.wait_for_timeout(rng.randint(180, 320))
    return actions


def keyboard_do(page):
    def do(info):
        a = info["advice"]
        if a.startswith("close:"):
            page.keyboard.press(f"Digit{int(a[6:]) + 1}")
        else:
            page.keyboard.press({"left": "ArrowLeft", "right": "ArrowRight", "rotate": "ArrowUp", "hurry": "Space", "sink": "ArrowDown"}[a])
    return do


def touch_do(page, cdp):
    def do(info):
        a = info["advice"]
        L = info["L"]
        box = info["box"]
        c = L["c"]
        low_y = L["colY"] + 17 * c  # well below the cupboards
        if a == "rotate" and box:
            page.touchscreen.tap(box["x"] + box["w"] / 2, box["y"] + box["h"] / 2)
        elif a == "left" and box:
            page.touchscreen.tap(max(4, box["x"] - 2.5 * c), low_y)
        elif a == "right" and box:
            page.touchscreen.tap(min(L["rightX"] + 3 * c, box["x"] + box["w"] + 2.5 * c), low_y)
        elif a in ("hurry", "sink"):
            x = L["colX"] + L["colW"] / 2
            y = L["colY"] + 16 * c
            d = -15 if a == "hurry" else 15
            swipe(cdp, x, y, 0, d)
        elif a.startswith("close:"):
            swipe_cupboard(page, cdp, info, int(a[6:]))
    return do


def swipe(cdp, x, y, dx, dy, steps=4):
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
    for k in range(1, steps + 1):
        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x + k * dx, "y": y + k * dy}]})
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})


def cupboard_centre(L, idx):
    c = L["c"]
    x = (L["ox"] if idx < 3 else L["rightX"]) + 2 * c
    y = L["colY"] + (idx % 3) * 2 * c + c
    return x, y


def swipe_cupboard(page, cdp, info, idx):
    """Swipe across a cupboard towards the column, like swinging its door shut."""
    x, y = cupboard_centre(info["L"], idx)
    c = info["L"]["c"]
    x -= c if idx < 3 else -c
    swipe(cdp, x, y, 10 if idx < 3 else -10, 0)


def title_fits(browser, url, w, h):
    """Is the Start button on screen and clickable without scrolling?"""
    ctx = browser.new_context(viewport={"width": w, "height": h}, is_mobile=True, has_touch=True)
    page = ctx.new_page()
    page.goto(url)
    page.wait_for_timeout(400)
    hit = page.evaluate("""() => {
        const b = document.getElementById('start').getBoundingClientRect();
        const e = document.elementFromPoint(b.x + b.width / 2, b.y + b.height - 3);
        return { ok: b.bottom <= innerHeight && !!e && (e.id === 'start' || !!e.closest('#start')), bottom: b.bottom };
    }""")
    ctx.close()
    return hit["ok"]


def hold_beside(page, cdp):
    """Hold a finger over the left cupboard while a piece is level with it:
    it must slide the piece, never shut the door."""
    page.evaluate("""() => {
        const g = window.__sirtet.game;
        for (const c of g.cupboards) { c.type = null; c.items = []; c.front = [0, 0]; c.door = 'open'; c.doorT = 0; }
        const C = g.cupboards[0];
        C.type = 'Z'; C.items = [{ type: 'Z', cells: [[0, 0], [1, 0], [1, 1], [2, 1]] }]; C.front = [2, 3];
        g.flying = [];
        g.flying.push({ id: 999, type: 'O', kind: 0, cells: [[0, 0], [1, 0], [0, 1], [1, 1]], x: 5, y: 0, state: 'ceiling', t: 0, zoneT: 0, hurry: false, vy: 0 });
        g.rowT = -30;
    }""")
    page.wait_for_timeout(100)
    info = page.evaluate(ADVISE_JS)
    x, y = cupboard_centre(info["L"], 0)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
    page.wait_for_timeout(800)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    return page.evaluate("""() => {
        const g = window.__sirtet.game;
        const p = g.flying.find((f) => f.id === 999);
        return { door: g.cupboards[0].door, n: g.cupboards[0].items.length, x: p ? p.x : null, gone: !p };
    }""")


def wait_for_over(run, limit=240):
    """Stop playing and let the dishes pile up (in real time) until the
    kitchen is full."""
    end = time.time() + limit
    while time.time() < end:
        if run.state()["mode"] == "over":
            return True
        run.page.wait_for_timeout(500)
    return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(ROOT, "tests", "shots"))
    ap.add_argument("--chromium", default=find_chromium())
    ap.add_argument("--seconds", type=float, default=75)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    port = free_port()
    srv = subprocess.Popen([sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1", "--directory", ROOT],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    url = f"http://127.0.0.1:{port}/"
    report = {}
    ok = True
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path=args.chromium) if args.chromium else p.chromium.launch()

            # ---- desktop: keyboard and mouse ------------------------------
            ctx = browser.new_context(viewport={"width": 1280, "height": 800})
            page = ctx.new_page()
            run = Run(page, args.out, "desktop")
            page.goto(url + "?seed=11")
            page.wait_for_timeout(1500)
            run.shot("00-title")
            t0 = run.state()
            page.wait_for_timeout(1000)
            demo_ok = t0["demo"] and run.state()["time"] > t0["time"]
            page.keyboard.press("Enter")
            page.wait_for_timeout(300)
            assert run.state()["mode"] == "playing", "Enter should start the game"
            actions = play(run, args.seconds, keyboard_do(page))
            s = run.state()
            # Shut a door with the mouse (press and hold).
            cups = [i for i, c in enumerate(s["cups"]) if c["n"] > 0 and c["door"] == "open"]
            door_ok = None
            if cups and s["mode"] == "playing":
                info = page.evaluate(ADVISE_JS)
                x, y = cupboard_centre(info["L"], cups[0])
                before = run.state()["score"]
                c = info["L"]["c"]
                sx = x - c if cups[0] < 3 else x + c
                page.mouse.move(sx, y)
                page.mouse.down()
                for k in range(1, 5):
                    page.mouse.move(sx + (k * 10 if cups[0] < 3 else -k * 10), y)
                page.mouse.up()
                page.wait_for_timeout(120)
                run.shot("09-door-shut")
                after = run.state()
                door_ok = after["cups"][cups[0]]["door"] != "open" and after["score"] > before and any(t.startswith("Door shut") for t in after["popups"])
            # Pause and resume: P key, then the on-screen button and card.
            page.keyboard.press("KeyP")
            st = run.state()
            paused = st["mode"] == "paused" and st["paused"]
            run.shot("10-paused")
            page.keyboard.press("KeyP")
            resumed = run.state()["mode"] == "playing"
            page.click("#pause-btn")
            paused &= run.state()["mode"] == "paused"
            page.click("#resume")
            resumed &= run.state()["mode"] == "playing"
            scrolled = page.evaluate("window.scrollY")
            mid = run.state()
            over = wait_for_over(run)
            page.wait_for_timeout(1200)
            run.shot("11-game-over")
            final = run.state()
            page.keyboard.press("Enter")
            page.wait_for_timeout(400)
            restarted = run.state()
            run.shot("12-restarted")
            report["desktop"] = {
                "actions": actions, "after_play": mid, "door_by_mouse": door_ok, "pause": paused, "resume": resumed,
                "demo_on_title": demo_ok, "no_page_scroll": scrolled == 0,
                "game_over": over, "final": {k: final[k] for k in ("score", "level", "stored", "rejected", "drawer")},
                "restart_ok": restarted["mode"] == "playing" and restarted["score"] == 0,
                "errors": run.errors, "screenshots": run.shots,
            }
            ok &= over and restarted["mode"] == "playing" and not run.errors and paused and resumed and mid["stored"] > 0
            ok &= bool(door_ok) and demo_ok and scrolled == 0
            ctx.close()

            # ---- mobile: touch -------------------------------------------
            ctx = browser.new_context(viewport={"width": 360, "height": 640}, device_scale_factor=2,
                                      is_mobile=True, has_touch=True)
            page = ctx.new_page()
            cdp = ctx.new_cdp_session(page)
            run = Run(page, args.out, "mobile")
            page.goto(url + "?seed=12")
            page.wait_for_timeout(500)
            run.shot("00-title")
            fits = {f"{w}x{h}": title_fits(browser, url, w, h) for (w, h) in ((360, 640), (320, 568), (640, 360), (568, 320))}
            page.locator("#start").tap()
            page.wait_for_timeout(300)
            assert run.state()["mode"] == "playing", "tapping Start should start the game"
            actions = play(run, args.seconds, touch_do(page, cdp))
            s = run.state()
            cups = [i for i, c in enumerate(s["cups"]) if c["n"] > 0 and c["door"] == "open"]
            door_ok = None
            if cups and s["mode"] == "playing":
                before = s["score"]
                swipe_cupboard(page, cdp, page.evaluate(ADVISE_JS), cups[0])
                page.wait_for_timeout(100)
                run.shot("08-door-shut")
                after = run.state()
                door_ok = after["cups"][cups[0]]["door"] != "open" and after["score"] > before
            mid = run.state()
            hold = None
            if mid["mode"] == "playing":
                hold = hold_beside(page, cdp)
                run.shot("08b-hold-slide")
            hold_ok = hold is not None and hold["door"] == "open" and (hold["gone"] or hold["x"] < 5)
            over = wait_for_over(run)
            page.wait_for_timeout(1200)
            run.shot("11-game-over")
            final = run.state()
            page.locator("#again").tap()
            page.wait_for_timeout(400)
            restarted = run.state()
            no_hscroll = page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
            report["mobile"] = {
                "actions": actions, "after_play": mid, "door_by_swipe": door_ok, "start_button_visible": fits,
                "hold_beside_cupboard_slides": hold,
                "game_over": over, "final": {k: final[k] for k in ("score", "level", "stored", "rejected", "drawer")},
                "restart_ok": restarted["mode"] == "playing" and restarted["score"] == 0, "no_horizontal_scroll": no_hscroll,
                "errors": run.errors, "screenshots": run.shots,
            }
            ok &= over and restarted["mode"] == "playing" and not run.errors and all(fits.values()) and no_hscroll and mid["stored"] > 0
            ok &= hold_ok and door_ok is not False
            browser.close()
    finally:
        srv.terminate()
    print(json.dumps(report, indent=1))
    print("PLAYTEST", "PASSED" if ok else "FAILED")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
