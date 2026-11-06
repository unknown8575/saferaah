"""End-to-end tests (TC-90..TC-109) in headless Chrome at phone size.

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
            print(f'… {tc} {title}', flush=True)
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


SEEN = "localStorage.setItem('saferaah.v1', JSON.stringify({seenIntro:true}))"
DENY_GPS = "navigator.geolocation.watchPosition = (ok, err) => { setTimeout(() => err({ code: 1, message: 'denied' }), 50); return 1; }; navigator.geolocation.clearWatch = () => {};"


@case('TC-91', 'search a place, Directions from your location, change the start by search')
def tc91(b, base):
    ctx = b.new_context(**PHONE, permissions=['geolocation'], geolocation={'latitude': CP[1], 'longitude': CP[0], 'accuracy': 10})
    page = ctx.new_page(); page.add_init_script(SEEN)
    page.goto(base + '/'); page.wait_for_selector('#q', timeout=20000); page.wait_for_timeout(1500)
    page.locator('#q').click(); page.locator('#q').fill('India Gate')
    page.locator('.searchbar .suggest li', has_text='India Gate').first.click()
    expect(page.locator('#place-title')).to_contain_text('India Gate')
    expect(page.locator('.pc-facts')).to_contain_text('from you')
    page.locator('#directions').click()
    wait_routes(page)
    assert page.locator('#f-from').input_value() == 'Your location'
    n = page.locator('.route-card').count()
    assert 1 <= n <= 4, n
    feats = page.evaluate("() => window.__sr.map.getSource('routes').serialize().data.features.length")
    assert feats == n, (feats, n)
    page.locator('#f-from').click(); page.locator('#f-from').fill('Mandi House')
    page.locator('.field-from .suggest li', has_text='Mandi House').first.click()
    page.wait_for_function("() => window.__sr.S.from && window.__sr.S.from.label.includes('Mandi House') && document.querySelector('.route-card')", timeout=30000)
    page.locator('#swap').click()
    page.wait_for_function("() => window.__sr.S.to && window.__sr.S.to.label.includes('Mandi House')", timeout=10000)
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
    expect(page.locator('.prec-box .prec-head')).to_be_visible()
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
    expect(page.locator('#sheet')).to_contain_text('need the SafeRaah server', timeout=10000)
    ctx.close()


@case('TC-98', 'a point outside the covered area is explained')
def tc98(b, base):
    ctx = b.new_context(**PHONE); page = ctx.new_page()
    page.add_init_script("localStorage.setItem('saferaah.v1', JSON.stringify({seenIntro:true}))")
    page.goto(base + '/'); page.wait_for_selector('#q', timeout=20000); page.wait_for_timeout(2500)
    # pick a visible spot above the sheet, east of the covered area
    lon = page.evaluate("""() => { const m = window.__sr.map; m.jumpTo({center:[77.405, 28.60], zoom: 14}); return m.unproject([195, 220]).lng; }""")
    assert lon > 77.36, lon
    page.wait_for_timeout(500)
    page.mouse.click(195, 220)
    expect(page.locator('#toast')).to_contain_text('outside', timeout=5000)
    ctx.close()


@case('TC-99', 'safe places nearby and the help guides')
def tc99(b, base):
    ctx = b.new_context(**PHONE); page = ctx.new_page()
    page.goto(base + '/?demo=1&t=13:00'); page.wait_for_selector('#q', timeout=20000); page.wait_for_timeout(1500)
    page.get_by_role('button', name='Safe places near me').click()
    page.wait_for_selector('.places li .open-pill', timeout=15000)
    assert page.locator('.places li').count() >= 5
    expect(page.locator('.places')).to_contain_text('Police')
    assert page.locator('.hit-pin').count() == page.locator('.places li').count()
    page.locator('.chip.cat[data-cat=hospital]').click()
    page.wait_for_function("() => document.querySelector('.list-head h2')?.textContent.includes('Hospitals')", timeout=15000)
    page.get_by_role('button', name='Clear').click()
    page.locator('#menu').click()
    page.get_by_role('button', name='How to use SafeRaah').click()
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
    box = page.locator('#sheet').bounding_box(); tb = page.locator('#top').bounding_box()
    assert box['x'] < 40 and box['width'] <= 420 and box['y'] >= tb['y'] + tb['height'], (box, tb)
    assert tb['x'] < 40 and tb['width'] <= 420, tb
    ctx.close()


@case('TC-102', 'after one visit the app opens and plans routes with no network (offline PWA)')
def tc102(b, base):
    ctx = b.new_context(**PHONE); page = ctx.new_page()
    page.add_init_script("localStorage.setItem('saferaah.v1', JSON.stringify({seenIntro:true}))")
    page.goto(base + '/'); page.wait_for_selector('#q', timeout=20000)
    page.wait_for_function('() => navigator.serviceWorker && navigator.serviceWorker.controller !== undefined', timeout=20000)
    page.wait_for_timeout(9000)  # app caches its bundles a few seconds after start
    cached = page.evaluate("async () => (await (await caches.open('saferaah-v1')).keys()).length")
    assert cached >= 10, cached
    ctx.set_offline(True)
    page.goto(base + q(CP, IG, mode='walk', simulate=1)); wait_routes(page, timeout=40000)
    assert page.locator('.route-card').count() >= 1
    ctx.close()


@case('TC-103', 'blue dot, tap anywhere on the map, fastest route first with precautions, callouts select routes')
def tc103(b, base):
    ctx = b.new_context(**PHONE, permissions=['geolocation'], geolocation={'latitude': LAJ[1], 'longitude': LAJ[0], 'accuracy': 30})
    page = ctx.new_page(); page.add_init_script(SEEN)
    page.goto(base + '/?t=21:30'); page.wait_for_selector('.me .me-dot', timeout=20000)
    page.wait_for_selector('#locate.on', timeout=10000)
    acc = page.evaluate("() => window.__sr.map.getSource('acc').serialize().data.features.length")
    assert acc == 1, acc
    # tap a spot towards Soami Nagar
    page.evaluate(f"() => window.__sr.map.jumpTo({{ center: [{GIRI[0]}, {GIRI[1]}], zoom: 16 }})")
    page.wait_for_timeout(800)
    page.mouse.click(195, 300)
    page.wait_for_selector('#place-title', timeout=10000)
    page.wait_for_function("() => document.querySelector('.pc-facts')?.textContent.includes('Street right now')", timeout=10000)
    page.locator('#directions').click(); wait_routes(page)
    S = page.evaluate("() => ({ sel: window.__sr.S.selected, labels: window.__sr.S.reply.routes.map(r => r.labels), n: window.__sr.S.reply.routes.length })")
    assert S['sel'] == 0 and 'Fastest' in S['labels'][0], S
    expect(page.locator('.route-card').first).to_have_class(__import__('re').compile('sel'))
    assert page.locator('.rc-prec').count() == S['n']
    assert page.locator('.callout').count() == S['n']
    page.wait_for_function("() => [...document.querySelectorAll('.mode-tab small')].filter(x => /min|h/.test(x.textContent)).length >= 3", timeout=20000)
    if S['n'] > 1:
        page.locator('.callout').nth(S['n'] - 1).click()
        page.wait_for_function(f"() => window.__sr.S.selected === {S['n'] - 1}", timeout=5000)
        expect(page.locator('.route-card').nth(S['n'] - 1)).to_have_class(__import__('re').compile('sel'))
    # switching mode re-plans with that mode
    page.locator('.mode-tab[data-mode=auto]').click()
    page.wait_for_function("() => window.__sr.S.settings.mode === 'auto' && window.__sr.S.reply && window.__sr.S.selected === 0", timeout=30000)
    ctx.close()


@case('TC-104', 'no GPS: honest message, mark where I am on the map, then plan from there')
def tc104(b, base):
    ctx = b.new_context(**PHONE); page = ctx.new_page()
    page.add_init_script(SEEN); page.add_init_script(DENY_GPS)
    page.goto(base + '/'); page.wait_for_selector('#q', timeout=20000)
    expect(page.locator('.loc-note')).to_contain_text('Location is off', timeout=10000)
    page.locator('#locate').click()
    expect(page.locator('.modal-card h2')).to_contain_text('Location is blocked')
    page.locator('#mark-me').click()
    expect(page.locator('#crosshair')).to_be_visible()
    page.evaluate(f"() => window.__sr.map.jumpTo({{ center: [{CP[0]}, {CP[1]}], zoom: 16 }})")
    page.wait_for_timeout(1200)
    expect(page.locator('#pick-label')).not_to_have_text('…')
    page.locator('#pick-ok').click()
    page.wait_for_selector('.me.manual', timeout=5000)
    me = page.evaluate('() => window.__sr.S.manualMe')
    assert abs(me[0] - CP[0]) < 1e-4 and abs(me[1] - CP[1]) < 1e-4, me
    page.locator('#q').click(); page.locator('#q').fill('India Gate')
    page.locator('.searchbar .suggest li', has_text='India Gate').first.click()
    page.locator('#directions').click(); wait_routes(page)
    assert page.locator('#f-from').input_value() == 'Your location'
    ctx.close()


@case('TC-105', 'choose the destination on the map with the centre pin')
def tc105(b, base):
    ctx = b.new_context(**PHONE); page = ctx.new_page(); page.add_init_script(SEEN)
    page.goto(base + q(CP, IG, mode='walk', demo=1)); wait_routes(page)
    page.locator('#f-to').click()
    page.locator('.field-to .suggest li', has_text='Choose on map').click()
    expect(page.locator('#crosshair')).to_be_visible()
    page.evaluate("() => window.__sr.map.jumpTo({ center: [77.2090, 28.6139], zoom: 16 })")
    page.wait_for_timeout(1000)
    page.locator('#pick-ok').click(); wait_routes(page)
    to = page.evaluate('() => window.__sr.S.to.lonlat')
    assert abs(to[0] - 77.2090) < 1e-4 and abs(to[1] - 28.6139) < 1e-4, to
    ctx.close()


@case('TC-106', 'live report: report harassment where you are; the pin shows and routes there get riskier')
def tc106(b, base):
    # stand on the middle of the fastest night route, report, and plan again
    ctx = b.new_context(**PHONE); page = ctx.new_page(); page.add_init_script(SEEN)
    page.goto(base + q(LAJ, GIRI, t='21:30', mode='walk', demo=1)); wait_routes(page)
    before = page.evaluate('() => window.__sr.S.reply.routes[0]')
    mid = before['coords'][len(before['coords']) // 2]
    ctx2 = b.new_context(**PHONE, permissions=['geolocation'], geolocation={'latitude': mid[1], 'longitude': mid[0], 'accuracy': 10})
    p2 = ctx2.new_page(); p2.add_init_script(SEEN)
    p2.goto(base + '/'); p2.wait_for_selector('#locate.on', timeout=20000)
    p2.wait_for_function('() => window.__sr.S.reportsAt > 0', timeout=15000)
    p2.locator('#report-btn').click()
    p2.locator('.report-kind[data-kind=harassment]').click()
    expect(p2.locator('#toast')).to_contain_text('Thanks', timeout=10000)
    p2.wait_for_selector('.report-pin', timeout=10000)
    p2.locator('.report-pin').first.click()
    expect(p2.locator('.rp')).to_contain_text('Harassment')
    # the first traveller's app picks it up on its next refresh and re-plans
    page.evaluate('() => { window.__sr.S.reportsAt = 0; }')
    page.wait_for_function(f"""async () => {{ const r = await fetch('/api/reports?bbox=76.8,28.4,77.4,28.9').then(r => r.json()); return r.reports.length > 0; }}""", timeout=10000)
    ok = page.evaluate("""async () => { const S = window.__sr.S; const r = await fetch('/api/reports?bbox=76.8,28.4,77.4,28.9').then(r => r.json());
        await window.__sr.rpc({ type: 'reports', reports: r.reports, now: r.now });
        const rep = await window.__sr.rpc({ type: 'route', from: [%f, %f], to: [%f, %f], mode: 'walk', when: S.leaveAt.toISOString(), profile: 'woman' });
        return rep.reply.routes.map(x => ({ e: x.edges.join(','), m: x.meanRisk, why: x.dangerSpots.flatMap(d => d.reasons) })); }""" % (LAJ[0], LAJ[1], GIRI[0], GIRI[1]))
    same = [x for x in ok if x['e'] == ','.join(map(str, before['edges']))]
    # the reported street now counts as riskier for this route (or the router left it)
    if same: assert same[0]['m'] > before['meanRisk'] + 0.001, (same[0]['m'], before['meanRisk'])
    else: assert all(x['e'] != ','.join(map(str, before['edges'])) for x in ok)
    affected = page.evaluate("async () => (await window.__sr.rpc({ type: 'reports', reports: (await fetch('/api/reports?bbox=76.8,28.4,77.4,28.9').then(r => r.json())).reports, now: Date.now() })).affected")
    assert affected > 0, affected
    ctx2.close(); ctx.close()


@case('TC-107', 'layers: street safety colours every street in view and can be switched off')
def tc107(b, base):
    ctx = b.new_context(**PHONE); page = ctx.new_page(); page.add_init_script(SEEN)
    page.goto(base + '/?demo=1&t=22:00'); page.wait_for_selector('#locate.on', timeout=20000)
    page.evaluate(f"() => window.__sr.map.jumpTo({{ center: [{LAJ[0]}, {LAJ[1]}], zoom: 15.5 }})")
    page.wait_for_function("() => window.__sr.map.getSource('safety').serialize().data.features.length > 100", timeout=15000)
    colours = page.evaluate("() => new Set(window.__sr.map.getSource('safety').serialize().data.features.map(f => f.properties.r >= 0.46 ? 'red' : f.properties.r >= 0.32 ? 'yellow' : 'green')).size")
    assert colours >= 2, colours
    page.locator('#layers-btn').click()
    page.locator('input[data-layer=safety]').uncheck()
    assert page.evaluate("() => window.__sr.map.getLayoutProperty('safety', 'visibility')") == 'none'
    assert page.evaluate("() => JSON.parse(localStorage.getItem('saferaah.v1')).layers.safety") is False
    ctx.close()


@case('TC-108', 'navigation: leaving the route finds a new route from where you are and tells the server')
def tc108(b, base):
    ctx = b.new_context(**PHONE, permissions=['geolocation'], geolocation={'latitude': CP[1], 'longitude': CP[0], 'accuracy': 8})
    page = ctx.new_page(); page.add_init_script(SEEN)
    page.goto(base + q(CP, IG, mode='walk', toName='India Gate')); wait_routes(page)
    page.locator('#start').click()
    page.wait_for_function('() => window.__sr.S.journey && window.__sr.S.journey.handle', timeout=15000)
    share = page.evaluate('() => window.__sr.S.journey.handle.shareId')
    first = page.evaluate('() => window.__sr.S.journey.route.coords')
    # walk the wrong way: north up Janpath, away from the route
    for k in range(1, 7):
        ctx.set_geolocation({'latitude': CP[1] + 0.0009 * k, 'longitude': CP[0] - 0.0012, 'accuracy': 8})
        page.wait_for_timeout(1500)
    page.wait_for_function(f"() => window.__sr.S.journey && JSON.stringify(window.__sr.S.journey.route.coords[0]) !== '{json.dumps(first[0]).replace(' ', '')}'", timeout=20000)
    new0 = page.evaluate('() => window.__sr.S.journey.route.coords[0]')
    assert abs(new0[1] - CP[1]) > 0.002, new0
    page.wait_for_timeout(1500)
    import urllib.request
    sh = json.loads(urllib.request.urlopen(base + f'/api/share/{share}').read())
    assert abs(sh['route'][0][1] - new0[1]) < 1e-6, (sh['route'][0], new0)
    ctx.close()


SPEECH_SPY = """window.__spoken = [];
const realSpeak = speechSynthesis.speak.bind(speechSynthesis);
speechSynthesis.speak = (u) => { if (u.text.trim()) window.__spoken.push(u.text); };"""


@case('TC-109', 'navigation island and spoken turns; mute stops the voice')
def tc109(b, base):
    ctx = b.new_context(**PHONE); page = ctx.new_page()
    page.add_init_script(SEEN); page.add_init_script(SPEECH_SPY)
    page.goto(base + q(LAJ, GIRI, t='21:30', mode='walk', demo=1, speed=12)); wait_routes(page)
    page.locator('#start').click()
    page.wait_for_selector('#island', timeout=15000)
    page.wait_for_function("() => window.__spoken.some(t => t.startsWith('Starting your trip'))", timeout=10000)
    # an advance instruction ("In 100 metres, turn …") and the turn itself
    page.wait_for_function("() => window.__spoken.some(t => /^In \\d+ (metres|kilometres?), /.test(t))", timeout=90000)
    page.wait_for_function("() => window.__spoken.some(t => /^(Turn|Bear|Make|Continue)/.test(t))", timeout=90000)
    expect(page.locator('#island .isl-dist')).to_contain_text('m')
    page.locator('#island').click()
    expect(page.locator('#island .isl-more')).to_contain_text('Arrive')
    page.locator('#voice-toggle').click()
    assert page.evaluate('() => JSON.parse(localStorage.getItem("saferaah.v1")).voice') is False
    n = page.evaluate('() => window.__spoken.length')
    page.wait_for_timeout(15000)
    assert page.evaluate('() => window.__spoken.length') == n, 'spoke while muted'
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
                              (tc98, ()), (tc99, ()), (tc100, ()), (tc101, ()), (tc102, ()), (tc103, ()), (tc104, ()), (tc105, ()),
                              (tc106, ()), (tc107, ()), (tc108, ()), (tc109, ())]:
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
