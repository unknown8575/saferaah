"""Extract the basemap for an area from an OpenMapTiles .mbtiles into lazily loaded packs.

usage: python3 -I pipeline/extract_tiles.py <in.mbtiles> <out_dir> [west south east north]

Writes <out_dir>/index.json and one pack per zoom-11 area ("11_x_y.bin"), plus "low.bin"
for zooms 0-10. Each pack is: b'SRT1' | uint32 header length | header JSON | tile bytes,
where header.tiles["z/x/y"] = [offset, length] and tiles are uncompressed vector tiles.
The app fetches only the packs for the part of the city on screen.
"""
import gzip, json, math, os, sqlite3, struct, sys

src, out = sys.argv[1], sys.argv[2]
W, S, E, N = map(float, sys.argv[3:7]) if len(sys.argv) >= 7 else (76.83, 28.40, 77.35, 28.89)
os.makedirs(out, exist_ok=True)
db = sqlite3.connect(src)
meta = dict(db.execute('select name, value from metadata'))


def lon2x(lon, z): return int((lon + 180) / 360 * 2 ** z)
def lat2y(lat, z):
    r = math.radians(lat)
    return int((1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * 2 ** z)


packs = {}
for z in range(0, 15):
    for x in range(lon2x(W, z), lon2x(E, z) + 1):
        for y in range(lat2y(N, z), lat2y(S, z) + 1):
            row = db.execute('select tile_data from tiles where zoom_level=? and tile_column=? and tile_row=?',
                             (z, x, 2 ** z - 1 - y)).fetchone()
            if not row: continue
            data = gzip.decompress(row[0]) if row[0][:2] == b'\x1f\x8b' else row[0]
            key = 'low' if z <= 10 else f'11_{x >> (z - 11)}_{y >> (z - 11)}'
            packs.setdefault(key, []).append((f'{z}/{x}/{y}', data))

total = 0
for key, tiles in packs.items():
    off, idx, body = 0, {}, []
    for k, d in tiles:
        idx[k] = [off, len(d)]; body.append(d); off += len(d)
    head = json.dumps({'tiles': idx}, separators=(',', ':')).encode()
    with open(os.path.join(out, f'{key}.bin'), 'wb') as f:
        f.write(b'SRT1'); f.write(struct.pack('<I', len(head))); f.write(head); f.write(b''.join(body))
    total += off
index = {
    'minzoom': 0, 'maxzoom': 14, 'bounds': [W, S, E, N], 'packZoom': 11,
    'packs': sorted(packs), 'snapshot': (meta.get('planetiler:osm:osmosisreplicationtime') or '')[:10],
    'attribution': meta.get('attribution', ''),
}
with open(os.path.join(out, 'index.json'), 'w') as f:
    json.dump(index, f)
print(f'{len(packs)} packs, {sum(len(t) for t in packs.values())} tiles, {total / 1e6:.1f} MB uncompressed')
