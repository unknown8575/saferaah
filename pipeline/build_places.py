"""Nearby-places index for search: every mapped place in the coverage area with its
precise type (gym, cafe, supermarket…), so typing "gym" or "kirana" can list what is
near you.  Reads the map pack's place database (read-only) and writes
web/public/data/places.json as compact rows.

usage: python3 -I pipeline/build_places.py <pack.search sqlite> <version.json> <out.json>
"""
import json, sqlite3, sys

src, version_path, out_path = sys.argv[1:4]
W, S, E, N = json.load(open(version_path))['bbox']
db = sqlite3.connect(f'file:{src}?mode=ro', uri=True)

SKIP = {'yes', 'fixme', 'vacant', 'disused', 'construction', 'bench', 'waste_basket', 'recycling', 'vending_machine',
        'drinking_water', 'shelter', 'grave_yard', 'apartment', 'company', 'estate_agent', 'property_management',
        'diplomatic', 'association', 'ngo', 'lawyer', 'financial', 'insurance', 'trade', 'information', 'artwork'}
# useful even without a name
UNNAMED_OK = {'atm', 'toilets', 'fuel', 'charging_station', 'parking', 'bus_stop', 'pharmacy', 'police'}

subs, sub_idx, rows, seen = [], {}, [], set()
for name, latin, sub, lat, lon, tags in db.execute(
        'select name, latin, sub, lat, lon, tags from places where kind = 2 and sub is not null '
        'and lon between ? and ? and lat between ? and ?', (int(W * 1e6), int(E * 1e6), int(S * 1e6), int(N * 1e6))):
    if sub in SKIP:
        continue
    t = json.loads(tags) if tags else {}
    nm = (t.get('name:en') or (latin if latin and name and not name.isascii() else name) or '').strip()
    if not nm and sub not in UNNAMED_OK:
        continue
    key = (nm.lower(), sub, round(lon / 1e6, 4), round(lat / 1e6, 4))
    if key in seen:  # the same place mapped twice (node + building)
        continue
    seen.add(key)
    if sub not in sub_idx:
        sub_idx[sub] = len(subs)
        subs.append(sub)
    row = [nm, round(lon / 1e6, 6), round(lat / 1e6, 6), sub_idx[sub]]
    if t.get('opening_hours'):
        row.append(t['opening_hours'])
    rows.append(row)

with open(out_path, 'w') as f:
    json.dump({'subs': subs, 'rows': rows}, f, separators=(',', ':'), ensure_ascii=False)
print(f'{len(rows)} places, {len(subs)} kinds -> {out_path}')
