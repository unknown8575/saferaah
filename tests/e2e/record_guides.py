"""Record the in-app animated user manual (Phase 8).

Drives the real app in headless Chrome, shows a tap ripple where a finger would
touch, captures frames and encodes six small looping GIFs into web/public/help/.

usage:  npm run build && python3 -I tests/e2e/record_guides.py
"""
import io, os, sys, math, shutil, subprocess, tempfile, time, socket, urllib.request
from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'web', 'public', 'help')
GL = ['--no-sandbox', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader']
PHONE = dict(viewport={'width': 390, 'height': 844}, device_scale_factor=1, is_mobile=True, has_touch=True)
SEED = """localStorage.setItem('saferaah.v1', JSON.stringify({seenIntro:true, travellerName:'Riya',
  contacts:[{id:'1',name:'Maa',phone:'+919876543210',notify:true},{id:'2',name:'Didi',phone:'+919123456780',notify:true}]}))"""
RIPPLE = """(([x, y]) => { const d = document.createElement('div');
  d.style.cssText = `position:fixed;left:${x-22}px;top:${y-22}px;width:44px;height:44px;border-radius:50%;
  background:rgba(108,99,255,.45);border:3px solid #fff;z-index:99999;pointer-events:none;transition:all .45s ease-out`;
  document.body.appendChild(d); requestAnimationFrame(() => { d.style.transform='scale(1.6)'; d.style.opacity='0'; });
  setTimeout(() => d.remove(), 600); })"""
LAJ, GIRI = '77.24318,28.57009', '77.22429,28.54259'  # Lajpat Nagar II -> Soami Nagar


class Rec:
    def __init__(self, page, name):
        self.page, self.name, self.n = page, name, 0
        self.dir = tempfile.mkdtemp(prefix=f'gif-{name}-')

    def frame(self, hold=1):
        path = os.path.join(self.dir, f'{self.n:04d}.png')
        # Headless Chrome drops the WebGL map when one capture spans both the map and the
        # scrolling sheet, so capture the area above the sheet and the rest separately.
        top = int(self.page.evaluate("() => { const s = document.getElementById('sheet'); const m = document.getElementById('modal');"
                                     " if (m && !m.hidden) return 844; return s && s.offsetParent ? Math.max(1, Math.floor(s.getBoundingClientRect().top)) : 844; }"))
        a = self.page.screenshot(clip={'x': 0, 'y': 0, 'width': 390, 'height': top})
        img = Image.new('RGB', (390, 844))
        img.paste(Image.open(io.BytesIO(a)).convert('RGB'), (0, 0))
        if top < 844:
            b2 = self.page.screenshot(clip={'x': 0, 'y': top, 'width': 390, 'height': 844 - top})
            img.paste(Image.open(io.BytesIO(b2)).convert('RGB'), (0, top))
        img.save(path)
        self.n += 1
        for _ in range(hold - 1):
            shutil.copy(path, os.path.join(self.dir, f'{self.n:04d}.png')); self.n += 1

    def frames(self, count, gap_ms=180):
        for _ in range(count):
            self.page.wait_for_timeout(gap_ms); self.frame()

    def tap(self, locator, hold=3):
        locator.scroll_into_view_if_needed()
        box = locator.bounding_box()
        x, y = box['x'] + box['width'] / 2, box['y'] + box['height'] / 2
        self.page.evaluate(RIPPLE, [x, y])
        self.page.wait_for_timeout(120); self.frame()
        self.page.wait_for_timeout(150); self.frame()
        locator.click()
        self.frames(hold)

    def type(self, locator, text):
        locator.click()
        for i in range(1, len(text) + 1):
            locator.fill(text[:i])
            if i % 2 == 0 or i == len(text): self.page.wait_for_timeout(60); self.frame()

    def settle(self, ms=1500):
        """wait for the map to finish drawing"""
        # software GL in headless Chrome is slow: wait for every tile, then for the frame to be painted
        self.page.wait_for_timeout(300)
        self.page.wait_for_function("() => { const m = window.__sr && window.__sr.map; return !m || (m.loaded() && m.areTilesLoaded()); }", timeout=30000)
        self.page.wait_for_timeout(9000 + ms)

    def save(self, fps=6, colors=64):
        os.makedirs(OUT, exist_ok=True)
        gif = os.path.join(OUT, f'{self.name}.gif')
        pal = os.path.join(self.dir, 'pal.png')
        scale = 'scale=240:-1:flags=lanczos'
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', str(fps), '-i', os.path.join(self.dir, '%04d.png'),
                        '-vf', f'{scale},palettegen=max_colors={colors}:stats_mode=diff', pal], check=True)
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', str(fps), '-i', os.path.join(self.dir, '%04d.png'), '-i', pal,
                        '-lavfi', f'{scale}[x];[x][1:v]paletteuse=dither=none:diff_mode=rectangle', '-loop', '0', gif], check=True)
        shutil.rmtree(self.dir)
        print(f'{self.name}.gif  {self.n} frames  {os.path.getsize(gif) // 1024} KB')


def new_page(b, **kw):
    ctx = b.new_context(**PHONE, **kw)
    ctx.add_init_script(SEED)
    return ctx, ctx.new_page()


def g_plan(b, base):
    ctx, page = new_page(b)
    page.goto(base + '/?demo=1'); page.wait_for_selector('#f-to', timeout=20000)
    r = Rec(page, 'plan'); r.settle(); r.frame(hold=4)
    r.tap(page.locator('.chip[data-v="woman"]'), hold=1)
    r.tap(page.locator('.chip[data-v="walk"]'), hold=2)
    r.type(page.locator('#f-to'), 'India Gate')
    page.wait_for_timeout(200); r.frame(hold=3)
    r.tap(page.locator('.field-to .suggest li', has_text='India Gate').first, hold=2)
    page.wait_for_selector('.route-card', timeout=20000)
    r.settle(); r.frame(hold=10)
    r.save(colors=128); ctx.close()


def g_routes(b, base):
    ctx, page = new_page(b)
    page.goto(base + f'/?demo=1&from={LAJ}&fromName=Lajpat%20Nagar%20II&to={GIRI}&toName=Soami%20Nagar&t=21:30')
    page.wait_for_selector('.route-card', timeout=20000)
    r = Rec(page, 'routes'); r.settle(); r.frame(hold=8)
    cards = page.locator('.route-card')
    for i in range(cards.count()):
        r.tap(cards.nth(i), hold=1); r.settle(400); r.frame(hold=4)
    r.tap(page.locator('.route-card.sel'), hold=2)
    r.settle(600); r.frame(hold=6)
    page.locator('#sheet').evaluate('e => e.scrollTo({top: 260, behavior: "instant"})'); r.frame(hold=8)
    r.save(colors=128); ctx.close()


def g_journey(b, base):
    ctx, page = new_page(b)
    page.goto(base + f'/?demo=1&from={LAJ}&fromName=Lajpat%20Nagar%20II&to={GIRI}&toName=Soami%20Nagar&t=21:30&speed=25')
    page.wait_for_selector('.route-card', timeout=20000)
    page.locator('.route-card.sel').click(); page.wait_for_selector('.facts')
    r = Rec(page, 'journey'); r.settle(); r.frame(hold=4)
    page.locator('#sheet').evaluate('e => e.scrollTo({top: 9999, behavior: "instant"})'); r.frame(hold=3)
    r.tap(page.get_by_role('button', name='✓ Didi'), hold=2)
    r.tap(page.locator('#start'), hold=1)
    for _ in range(16):
        page.wait_for_timeout(450); r.frame()
    r.frame(hold=4)
    r.save(); ctx.close()


def g_checkin(b, base):
    ctx, page = new_page(b)
    page.goto(base + f'/?demo=1&from={LAJ}&to={GIRI}&toName=Soami%20Nagar&t=21:30&pause=0.08&pauseS=720&speed=60')
    page.wait_for_selector('.route-card', timeout=20000)
    page.locator('#start').click()
    page.wait_for_timeout(1500)
    r = Rec(page, 'checkin'); r.frame(hold=3)
    page.wait_for_selector('.checkin', timeout=90000)
    for _ in range(14): page.wait_for_timeout(500); r.frame()
    r.tap(page.locator('#im-ok'), hold=3)
    r.frame(hold=4)
    r.save(); ctx.close()


def g_sos(b, base):
    ctx, page = new_page(b)
    page.goto(base + f'/?demo=1&from={LAJ}&to={GIRI}&toName=Soami%20Nagar&t=21:30&speed=20')
    page.wait_for_selector('.route-card', timeout=20000)
    page.locator('#start').click(); page.wait_for_timeout(2500)
    r = Rec(page, 'sos'); r.settle(500); r.frame(hold=4)
    r.tap(page.locator('#sos'), hold=6)
    r.frame(hold=4)
    r.tap(page.locator('.sos-card summary'), hold=6)
    r.frame(hold=6)
    r.save(); ctx.close()


def g_review(b, base):
    cp, dest = (77.2197, 28.6328), (77.2245, 28.6290)
    ctx, page = new_page(b, permissions=['geolocation'], geolocation={'latitude': cp[1], 'longitude': cp[0], 'accuracy': 8})
    page.goto(base + f'/?from={cp[0]},{cp[1]}&fromName=Rajiv%20Chowk&to={dest[0]},{dest[1]}&toName=Barakhamba%20Road&mode=car')
    page.wait_for_selector('.route-card', timeout=20000)
    page.locator('#start').click()
    page.wait_for_function('() => window.__sr.S.journey && window.__sr.S.journey.handle', timeout=15000)
    coords = page.evaluate('() => window.__sr.S.journey.route.coords')
    eta = page.evaluate('() => window.__sr.S.journey.route.timeS')
    pts = []
    for a, c in zip(coords, coords[1:]):
        d = math.hypot((c[0] - a[0]) * 97630, (c[1] - a[1]) * 111195); n = max(1, math.ceil(d / 12))
        pts += [(a[0] + (c[0] - a[0]) * k / n, a[1] + (c[1] - a[1]) * k / n) for k in range(n)]
    pts.append(tuple(coords[-1]))
    r = Rec(page, 'review')
    dt = max(eta * 0.5, 40) / len(pts)
    for i, (lon, lat) in enumerate(pts):
        ctx.set_geolocation({'latitude': lat, 'longitude': lon, 'accuracy': 8})
        page.wait_for_timeout(int(dt * 1000))
        if i % max(1, len(pts) // 8) == 0: r.frame()
    page.wait_for_selector('.star', timeout=30000)
    r.frame(hold=8)
    r.tap(page.locator('.star').nth(3), hold=2)
    r.tap(page.get_by_role('button', name='💡 Well lit'), hold=1)
    r.tap(page.get_by_role('button', name='👥 Busy'), hold=1)
    r.tap(page.locator('#submit-review'), hold=2)
    r.frame(hold=8)
    r.save(); ctx.close()


def main():
    s = socket.socket(); s.bind(('127.0.0.1', 0)); port = s.getsockname()[1]; s.close()
    env = dict(os.environ, PORT=str(port), DB_PATH=os.path.join(tempfile.mkdtemp(), 'rec.db'), STATIC_DIR=os.path.join(ROOT, 'web', 'dist'))
    srv = subprocess.Popen(['npx', 'tsx', 'server/main.ts'], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT, start_new_session=True)
    base = f'http://127.0.0.1:{port}'
    for _ in range(120):
        try: urllib.request.urlopen(base + '/api/health', timeout=1); break
        except Exception: time.sleep(0.5)
    only = set(sys.argv[1:])
    try:
        with sync_playwright() as p:
            b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=GL)
            for fn in [g_plan, g_routes, g_journey, g_checkin, g_sos, g_review]:
                if only and fn.__name__[2:] not in only: continue
                fn(b, base)
            b.close()
    finally:
        os.killpg(srv.pid, 15)


if __name__ == '__main__':
    main()
