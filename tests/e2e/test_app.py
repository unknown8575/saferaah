"""End-to-end tests (TC-90..TC-101) in headless Chrome at phone size.

Starts its own server (fresh database) on a free port, runs every case,
prints a summary and exits non-zero on failure.

usage:  npm run build && python3 -I tests/e2e/test_app.py
"""
import json, math, os, socket, subprocess, sys, time, traceback, functools, http.server, threading
from playwright.sync_api import sync_playwright, expect

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
GL = ['--no-sandbox', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader']
PHONE = dict(viewport={'width': 390, 'height': 844}, device_scale_factor=1, is_mobile=True, has_touch=True)
CP, IG = (77.2197, 28.6328), (77.2295, 28.6129)
LAJ, GIRI = (77.24318, 28.57009), (77.22429, 28.54259)  # Lajpat Nagar II -> Soami Nagar
results = []


def free_port():
    s = socket.socket(); s.bind(('127.0.0.1', 0)); p = s.getsockname()[1]; s.close(); return p


def case(tc, title):
    def deco(fn):
        @functools.wraps(fn)
        def run(*a):
            t = time.time()
            try:
                fn(*a); results.append((tc, title, 'PASS', time.time() - t, ''))
            except Exception as e:  # noqa
                results.append((tc, title, 'FAIL', time.time() - t, f'{type(e).__name__}: {e}'.split('\n')[0][:300]))
                traceback.print_exc()
        return run
    return deco


def q(frm, to, **kw):
    parts = [f'from={frm[0]},{frm[1]}', f'to={to[0]},{to[1]}'] + [f'{k}={v}' for k, v in kw.items()]
    return '/?' + '&'.join(parts)


def wait_routes(page, timeout=30000):
    page.wait_for_selector('.route-card', timeout=timeout)


def interp(coords, step_m):
    pts = []
    for (a, b) in zip(coords, coords[1:]):
        d = math.hypot((b[0] - a[0]) * 97630, (b[1] - a[1]) * 111195)
        n = max(1, math.ceil(d / step_m))
        for k in range(n):
            f = k / n
            pts.append((a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f))
    pts.append(tuple(coords[-1]))
    return pts


@case('TC-90', 'first run: intro, contact validation, two contacts saved')
def tc90(b, base):
    ctx = b.new_context(**PHONE); page = ctx.new_page()
    page.goto(base + '/'); page.wait_for_selector('.intro', timeout=20000)
    page.get_by_role('button', name='Add a contact').click()
    page.get_by_label('Contact name').fill('Maa')
    page.get_by_label('Contact mobile number').fill('12345')
    page.locator('#add-contact').click()
    expect(page.locator('.error')).to_contain_text('valid mobile number')
    page.get_by_label('Contact mobile number').fill('98765 43210')
    page.locator('#add-contact').click()
    page.get_by_label('Contact name').fill('Didi'); page.get_by_label('Contact mobile number').fill('9123456780')
    page.locator('#add-contact').click()
    expect(page.locator('.contacts li')).to_have_count(2)
    expect(page.locator('.contacts')).to_contain_text('+919876543210')
    page.reload(); page.wait_for_timeout(2500)
    stored = page.evaluate("() => JSON.parse(localStorage.getItem('saferaah.v1')).contacts.length")
    assert stored == 2, stored
    ctx.close()


@case('TC-91', 'plan with offline search UI, routes drawn on the map')
def tc91(b, base):
    ctx = b.new_context(**PHONE); page = ctx.new_page()
    page.add_init_script("localStorage.setItem('saferaah.v1', JSON.stringify({seenIntro:true}))")
    page.goto(base + '/'); page.wait_for_selector('#f-from', timeout=20000); page.wait_for_timeout(1500)
    page.locator('#f-from').click(); page.locator('#f-from').fill('Rajiv Chowk')
    page.locator('.field-from .suggest li', has_text='Rajiv Chowk').first.click()
    page.locator('#f-to').click(); page.locator('#f-to').fill('India Gate')
    page.locator('.field-to .suggest li', has_text='India Gate').first.click()
    wait_routes(page)
    n = page.locator('.route-card').count()
    assert 1 <= n <= 4, n
    expect(page.locator('.route-card .tier').first).to_be_visible()
    feats = page.evaluate("() => window.__sr.map.getSource('routes').serialize().data.features.length")
    assert feats == n, (feats, n)
    ctx.close()


@case('TC-92', 'night trip: night theme, advice, fastest and safest labels')
def tc92(b, base):
    ctx = b.new_context(**PHONE); page = ctx.new_page()
    page.goto(base + q(LAJ, GIRI, t='21:30', mode='walk', demo=1)); wait_routes(page)
    assert page.evaluate('document.documentElement.dataset.theme') == 'night'
    expect(page.locator('.advice')).to_be_visible()
    expect(page.locator('.lbl-fastest')).to_have_count(1)
    expect(page.locator('.lbl-safest')).to_have_count(1)
    assert page.locator('.route-card').count() >= 3
    ctx.close()


@case('TC-93', 'route details explain the score and list contacts and directions')
def tc93(b, base):
    ctx = b.new_context(**PHONE); page = ctx.new_page()
    page.add_init_script("localStorage.setItem('saferaah.v1', JSON.stringify({seenIntro:true, contacts:[{id:'1',name:'Maa',phone:'+919876543210',notify:true}]}))")
    page.goto(base + q(LAJ, GIRI, t='21:30', mode='walk', demo=1)); wait_routes(page)
    page.locator('.route-card.sel').click()
    expect(page.locator('.facts li').first).to_contain_text('main roads')
    expect(page.locator('.havens li').first).to_be_visible()
    expect(page.get_by_role('button', name='✓ Maa')).to_be_visible()
    page.locator('details.steps summary').click()
    assert page.locator('details.steps li').count() >= 3
    ctx.close()


@case('TC-94/95', 'real-time trip with mocked GPS: live link, arrival message, verified review')
def tc94(b, base):
    ctx = b.new_context(**PHONE, permissions=['geolocation'], geolocation={'latitude': CP[1], 'longitude': CP[0], 'accuracy': 8})
    page = ctx.new_page()
    page.add_init_script("localStorage.setItem('saferaah.v1', JSON.stringify({seenIntro:true, travellerName:'Riya', contacts:[{id:'1',name:'Maa',phone:'+919876543210',notify:true}]}))")
    # short car trip around Connaught Place
    page.goto(base + q(CP, (77.2245, 28.6290), mode='car', toName='Barakhamba Road')); wait_routes(page)
    page.locator('#start').click()
    page.wait_for_function('() => window.__sr.S.journey && window.__sr.S.journey.handle', timeout=15000)
    coords = page.evaluate('() => window.__sr.S.journey.route.coords')
    eta = page.evaluate('() => window.__sr.S.journey.route.timeS')
    share = page.evaluate('() => window.__sr.S.journey.handle.shareId')
    # contact opens the live link mid-trip
    viewer = ctx.new_page()
    viewer.goto(base + f'/?track={share}')
    expect(viewer.locator('#sheet h2')).to_contain_text('On the way', timeout=20000)
    pts = interp(coords, 12)
    dur = max(eta * 0.5, 40)  # plausible: half the ETA by car
    dt = dur / len(pts)
    for lon, lat in pts:
        ctx.set_geolocation({'latitude': lat, 'longitude': lon, 'accuracy': 8})
        page.wait_for_timeout(int(dt * 1000))
    page.wait_for_selector('.arrived-mark', timeout=30000)
    href = page.locator('#send-arrival').get_attribute('href')
    assert href.startswith('sms:+919876543210') and 'reached' in href, href
    page.wait_for_selector('.star', timeout=10000)
    page.locator('.star').nth(3).click()
    page.get_by_role('button', name='💡 Well lit').click()
    page.locator('#submit-review').click()
    expect(page.locator('.review .ok-msg')).to_contain_text('Thanks', timeout=10000)
    viewer.reload()
    expect(viewer.locator('#sheet h2')).to_contain_text('Reached safely', timeout=20000)
    ctx.close()


@case('TC-96', 'stopping triggers "Are you OK?"; no answer opens SOS')
def tc96(b, base):
    ctx = b.new_context(**PHONE); page = ctx.new_page()
    page.goto(base + q(LAJ, GIRI, t='21:30', mode='walk', demo=1, pause='0.2', pauseS=720, speed=60)); wait_routes(page)
    page.locator('#start').click()
    page.wait_for_selector('.checkin', timeout=90000)
    expect(page.locator('.countdown')).to_be_visible()
    page.wait_for_selector('.sos-card', timeout=40000)
    assert page.get_by_role('link', name='Call 112').get_attribute('href') == 'tel:112'
    expect(page.locator('.sos-card h2')).to_contain_text('No answer')
    ctx.close()


@case('TC-97', 'without the server the app still plans and navigates')
def tc97(b, base, static_base):
    ctx = b.new_context(**PHONE); page = ctx.new_page()
    page.goto(static_base + q(CP, IG, mode='walk', demo=1)); wait_routes(page)
    page.locator('#start').click()
    expect(page.locator('#sheet')).to_contain_text('Offline: live sharing and reviews need an internet connection', timeout=10000)
    ctx.close()


@case('TC-98', 'a point outside the covered area is explained')
def tc98(b, base):
    ctx = b.new_context(**PHONE); page = ctx.new_page()
    page.add_init_script("localStorage.setItem('saferaah.v1', JSON.stringify({seenIntro:true}))")
    page.goto(base + '/'); page.wait_for_selector('#f-to', timeout=20000); page.wait_for_timeout(2500)
    # pick a visible spot above the sheet, east of the covered area
    lon = page.evaluate("""() => { const m = window.__sr.map; m.jumpTo({center:[77.405, 28.60], zoom: 14}); return m.unproject([195, 220]).lng; }""")
    assert lon > 77.36, lon
    page.wait_for_timeout(500)
    page.mouse.click(195, 220, button='right')
    expect(page.locator('#toast')).to_contain_text('outside', timeout=5000)
    ctx.close()


@case('TC-99', 'safe places nearby and the help guides')
def tc99(b, base):
    ctx = b.new_context(**PHONE); page = ctx.new_page()
    page.goto(base + q(LAJ, GIRI, t='13:00', mode='walk', demo=1)); wait_routes(page)
    page.get_by_role('button', name='Safe places near me').click()
    page.wait_for_selector('.places li .open-pill', timeout=15000)
    assert page.locator('.places li').count() >= 5
    expect(page.locator('.places')).to_contain_text('Police')
    page.get_by_role('button', name='Back').click()
    page.get_by_role('button', name='Help').click()
    expect(page.locator('.guide')).to_have_count(6)
    page.wait_for_timeout(2500)
    loaded = page.evaluate("() => [...document.querySelectorAll('.guide img')].filter(i => i.complete && i.naturalWidth > 0).length")
    assert loaded == 6, f'{loaded}/6 guide animations loaded'
    ctx.close()


@case('TC-100', 'accessible names everywhere and no sideways scroll at 360 px')
def tc100(b, base):
    ctx = b.new_context(viewport={'width': 360, 'height': 740}, is_mobile=True, has_touch=True); page = ctx.new_page()
    page.goto(base + q(LAJ, GIRI, t='21:30', mode='walk', demo=1)); wait_routes(page)
    for view in ['routes', 'details']:
        if view == 'details':
            page.locator('.route-card.sel').click(); page.wait_for_timeout(500)
        unnamed = page.evaluate("""() => [...document.querySelectorAll('button, a, input, [role=radio]')].filter(e => e.offsetParent !== null &&
            !(e.getAttribute('aria-label') || e.textContent.trim() || e.labels?.length || e.getAttribute('placeholder'))).map(e => e.outerHTML.slice(0, 80))""")
        assert not unnamed, unnamed
        sw = page.evaluate('document.documentElement.scrollWidth'); assert sw <= 360, sw
        small = page.evaluate("""() => [...document.querySelectorAll('#sheet button, #sheet a.btn')].filter(e => e.offsetParent !== null).filter(e => { const r = e.getBoundingClientRect(); return r.height < 36; }).map(e => e.textContent.slice(0,30))""")
        assert not small, f'touch targets under 36 px: {small}'
    ctx.close()


@case('TC-101', 'desktop layout uses a side panel')
def tc101(b, base):
    ctx = b.new_context(viewport={'width': 1280, 'height': 800}); page = ctx.new_page()
    page.goto(base + q(CP, IG, mode='walk', demo=1)); wait_routes(page)
    box = page.locator('#sheet').bounding_box()
    assert box['x'] < 40 and box['width'] <= 420 and box['height'] > 600, box
    ctx.close()


@case('TC-102', 'after one visit the app opens and plans routes with no network (offline PWA)')
def tc102(b, base):
    ctx = b.new_context(**PHONE); page = ctx.new_page()
    page.add_init_script("localStorage.setItem('saferaah.v1', JSON.stringify({seenIntro:true}))")
    page.goto(base + '/'); page.wait_for_selector('#f-to', timeout=20000)
    page.wait_for_function('() => navigator.serviceWorker && navigator.serviceWorker.controller !== undefined', timeout=20000)
    page.wait_for_timeout(9000)  # app caches its bundles a few seconds after start
    cached = page.evaluate("async () => (await (await caches.open('saferaah-v1')).keys()).length")
    assert cached >= 10, cached
    ctx.set_offline(True)
    page.goto(base + q(CP, IG, mode='walk', simulate=1)); wait_routes(page, timeout=40000)
    assert page.locator('.route-card').count() >= 1
    ctx.close()


def main():
    port, sport = free_port(), free_port()
    env = dict(os.environ, PORT=str(port), DB_PATH=os.path.join(ROOT, 'data', 'e2e.db'), STATIC_DIR=os.path.join(ROOT, 'web', 'dist'))
    try: os.remove(env['DB_PATH'])
    except FileNotFoundError: pass
    srv = subprocess.Popen(['npx', 'tsx', 'server/main.ts'], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT, start_new_session=True)
    # a plain static server with no API, for the offline case
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.path.join(ROOT, 'web', 'dist'))
    handler.log_message = lambda *a: None
    static = http.server.ThreadingHTTPServer(('127.0.0.1', sport), handler)
    threading.Thread(target=static.serve_forever, daemon=True).start()
    base, static_base = f'http://127.0.0.1:{port}', f'http://127.0.0.1:{sport}'
    import urllib.request
    for _ in range(120):
        try:
            urllib.request.urlopen(base + '/api/health', timeout=1); break
        except Exception: time.sleep(0.5)
    else:
        raise SystemExit('server did not start')
    only = set(sys.argv[1:])
    try:
        with sync_playwright() as p:
            b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=GL)
            for fn, extra in [(tc90, ()), (tc91, ()), (tc92, ()), (tc93, ()), (tc94, ()), (tc96, ()), (tc97, (static_base,)),
                              (tc98, ()), (tc99, ()), (tc100, ()), (tc101, ()), (tc102, ())]:
                if only and not any(o in fn.__name__ for o in only): continue
                fn(b, base, *extra)
            b.close()
    finally:
        os.killpg(srv.pid, 15); static.shutdown()
    print('\n' + '\n'.join(f'{s}  {tc:9} {t:5.1f}s  {title}' + (f'\n           {err}' if err else '') for tc, title, s, t, err in results))
    failed = [r for r in results if r[2] == 'FAIL']
    print(f'\n{len(results) - len(failed)}/{len(results)} end-to-end cases passed')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
