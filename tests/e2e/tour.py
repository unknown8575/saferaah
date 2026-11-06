"""Walk through every screen in headless Chrome at phone size and save screenshots.

usage: python3 -I tests/e2e/tour.py <base_url> <out_dir>
"""
import sys, os
from playwright.sync_api import sync_playwright

base, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
logs = []
TRIP = 'from=77.24318,28.57009&fromName=Lajpat%20Nagar%20II&to=77.22429,28.54259&toName=Soami%20Nagar'
GL = ['--no-sandbox', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader']


def shot(page, name):
    # wait until MapLibre has drawn every tile (software GL is slow in headless Chrome)
    page.wait_for_timeout(600)
    try:
        page.evaluate("""() => new Promise((res) => { const m = window.__sr && window.__sr.map; if (!m) return res();
            const done = () => res(); if (m.loaded() && m.areTilesLoaded()) { m.once('idle', done); m.triggerRepaint(); } else m.once('idle', done);
            setTimeout(done, 8000); })""")
    except Exception:
        pass
    page.wait_for_timeout(400)
    page.screenshot(path=f'{out}/{name}.png')


with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=GL)
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    page = ctx.new_page()
    page.on('console', lambda m: logs.append(f'{m.type}: {m.text}') if 'GL Driver' not in m.text else None)
    page.on('pageerror', lambda e: logs.append(f'PAGEERROR: {e}'))

    # first run: intro, plan
    page.goto(base + '/')
    page.wait_for_timeout(4500)
    shot(page, '01-intro')
    page.get_by_role('button', name='Add a contact').click()
    page.get_by_label('Your name').fill('Riya')
    page.get_by_label('Your name').dispatch_event('change')
    page.get_by_label('Contact name').fill('Maa')
    page.get_by_label('Contact mobile number').fill('98765 43210')
    page.locator('#add-contact').click()
    page.get_by_label('Contact name').fill('Didi')
    page.get_by_label('Contact mobile number').fill('9123456780')
    page.locator('#add-contact').click()
    shot(page, '02-contacts')
    page.get_by_role('button', name='Back').click()
    page.locator('#f-to').click()
    page.locator('#f-to').fill('lajpat')
    shot(page, '03-search')
    page.keyboard.press('Escape')

    # night trip with four ranked routes
    page.goto(base + f'/?demo=1&{TRIP}&t=21:30&mode=walk&who=woman')
    page.wait_for_timeout(6500)
    shot(page, '04-routes-night')
    page.locator('.route-card').last.click()
    page.wait_for_timeout(500)
    page.locator('.route-card').last.click()
    page.wait_for_timeout(1200)
    shot(page, '05-details')

    # journey with a pause on the way (check-in), fast simulation
    page.goto(base + f'/?demo=1&{TRIP}&t=21:30&mode=walk&pause=0.3&speed=60')
    page.wait_for_timeout(6000)
    page.locator('#start').click()
    page.wait_for_timeout(2500)
    shot(page, '06-journey')
    page.wait_for_selector('.checkin', timeout=60000)
    shot(page, '07-checkin')
    page.locator('#im-ok').click()
    page.wait_for_timeout(500)
    page.locator('#sos').click()
    page.wait_for_timeout(800)
    shot(page, '08-sos')
    page.get_by_role('button', name='I am safe, close').click()
    page.wait_for_selector('.arrived-mark', timeout=120000)
    page.wait_for_timeout(1000)
    shot(page, '09-arrived')
    if page.locator('.star').count():
        page.locator('.star').nth(3).click()
        page.get_by_role('button', name='💡 Well lit').click()
        shot(page, '10-review')
        page.locator('#submit-review').click()
        page.wait_for_timeout(800)
        shot(page, '11-review-sent')

    # daytime: same trip, everything green
    page.goto(base + f'/?demo=1&{TRIP}&t=13:00&mode=walk')
    page.wait_for_timeout(6000)
    shot(page, '12-routes-day')
    page.get_by_role('button', name='Safe places near me').click()
    page.wait_for_timeout(1500)
    shot(page, '13-places')
    page.get_by_role('button', name='Back').click()
    page.get_by_role('button', name='Help').click()
    shot(page, '14-help')

    # desktop layout
    page.set_viewport_size({'width': 1280, 'height': 800})
    page.goto(base + f'/?demo=1&{TRIP}&t=21:30&mode=auto')
    page.wait_for_timeout(6500)
    shot(page, '15-desktop-auto')
    b.close()
print('\n'.join(logs[-40:]))
