"""Quick visual check: open the app in headless Chrome at phone size and screenshot key screens.

usage: python3 -I tests/e2e/shoot.py <base_url> <out_dir> [query]
"""
import sys, os, time
from playwright.sync_api import sync_playwright

base, out = sys.argv[1], sys.argv[2]
query = sys.argv[3] if len(sys.argv) > 3 else ''
os.makedirs(out, exist_ok=True)
logs = []
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'])
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    page = ctx.new_page()
    page.on('console', lambda m: logs.append(f'{m.type}: {m.text}'))
    page.on('pageerror', lambda e: logs.append(f'PAGEERROR: {e}'))
    page.goto(base + '/' + query)
    page.wait_for_timeout(5000)
    page.screenshot(path=f'{out}/1.png')
    if page.locator('#start').count():
        page.locator('.route-card').first.click()
        page.wait_for_timeout(800)
        page.screenshot(path=f'{out}/2.png')
    b.close()
print('\n'.join(logs[-30:]))
