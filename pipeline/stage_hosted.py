"""Stage web/dist for a static host that limits file size and file types.

usage: python3 -I pipeline/stage_hosted.py <dist_dir> <out_dir>

* splits data/graph.bin into parts under 14 MB and lists them in data/version.json
  (the app joins them again), so no single file exceeds the host's limit
* writes a body-only index.html for hosts that add their own <html>/<head> skeleton
* prints a JSON map of published path -> source for the host's upload API, giving
  binary files (graph parts, map packs, fonts) a served binary content type
"""
import json, os, re, shutil, sys

dist, out = sys.argv[1], sys.argv[2]
if os.path.exists(out): shutil.rmtree(out)
shutil.copytree(dist, out)
os.remove(os.path.join(out, 'sw.js'))  # service workers are not available on such hosts

g = os.path.join(out, 'data', 'graph.bin')
data = open(g, 'rb').read()
os.remove(g)
LIMIT = 14_000_000
parts = []
for i in range(0, len(data), LIMIT):
    name = f'graph.part{len(parts)}.bin'
    open(os.path.join(out, 'data', name), 'wb').write(data[i:i + LIMIT])
    parts.append(name)
vpath = os.path.join(out, 'data', 'version.json')
v = json.load(open(vpath)); v['graphParts'] = parts
json.dump(v, open(vpath, 'w'))

html = open(os.path.join(out, 'index.html')).read()
js = re.search(r'src="\./(assets/index-[^"]+\.js)"', html).group(1)
css = re.search(r'href="\./(assets/index-[^"]+\.css)"', html).group(1)
open(os.path.join(out, 'index.html'), 'w').write(f'''<title>SafeRaah</title>
<meta name="description" content="Safe routes for women and children across Delhi: up to four routes from fastest to safest, arrival messages and SOS." />
<link rel="icon" href="icon.svg" type="image/svg+xml" />
<link rel="stylesheet" href="./{css}">
<div id="app"></div>
<noscript>SafeRaah needs JavaScript to show the map.</noscript>
<script type="module" src="./{js}"></script>
''')

files = {}
for root, _, names in os.walk(out):
    for n in names:
        full = os.path.join(root, n)
        rel = os.path.relpath(full, out)
        if rel == 'index.html': continue
        if n.endswith('.bin') or n.endswith('.pbf'):
            files[rel] = {'from': full, 'contentType': 'application/wasm'}
        else:
            files[rel] = full
print(json.dumps(files))
print(f'{len(files)} files, graph in {len(parts)} parts', file=sys.stderr)
