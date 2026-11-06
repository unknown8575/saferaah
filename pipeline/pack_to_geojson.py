"""Convert an OpenStreetMap-derived Radar GPS map pack into SafeRaah's input GeoJSON.

A pack (https://github.com/Greymussh/radargps-maps, built from Geofabrik extracts) has:
  <id>.route    car road graph with one-way flags and names (RGR2 format)
  <id>.search   SQLite with places and POIs, including opening_hours tags
  <id>.mbtiles  OpenMapTiles vector tiles (footpaths, buildings, parks, landuse)

usage:
  python3 -I pipeline/pack_to_geojson.py <pack_dir> <pack_id> <out.geojson> [west south east north]

Default area: Delhi NCT with a small margin into Gurugram, Faridabad, Noida and Ghaziabad.
Map data © OpenStreetMap contributors (ODbL).
"""
import gzip, json, math, sqlite3, struct, sys
from array import array

import mapbox_vector_tile
from shapely.geometry import shape, box, mapping
from shapely.ops import transform

pack_dir, pack_id, out_path = sys.argv[1:4]
W, S, E, N = map(float, sys.argv[4:8]) if len(sys.argv) >= 8 else (76.83, 28.40, 77.35, 28.89)
inside = lambda lon, lat: W <= lon <= E and S <= lat <= N
feats = []
snapshot = ''


def add(kind, geom, tags=None, name='', center=None):
    p = {'kind': kind, 'tags': tags or {}, 'snapshot': snapshot}
    if name: p['name'] = name
    if center: p['center'] = center
    feats.append({'type': 'Feature', 'geometry': geom, 'properties': p})


# ---------------------------------------------------------------- map tiles
mb = sqlite3.connect(f'{pack_dir}/{pack_id}.mbtiles')
meta = dict(mb.execute('select name, value from metadata'))
snapshot = (meta.get('planetiler:osm:osmosisreplicationtime') or '')[:10]
Z = 14


def lon2x(lon): return int((lon + 180) / 360 * 2 ** Z)
def lat2y(lat):
    r = math.radians(lat)
    return int((1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * 2 ** Z)


def to_lonlat(tx, ty, extent):
    def f(x, y, z=None):
        lon = (tx + x / extent) / 2 ** Z * 360 - 180
        n = math.pi - 2 * math.pi * (ty + y / extent) / 2 ** Z
        lat = math.degrees(math.atan(math.sinh(n)))
        return (round(lon, 7), round(lat, 7))
    return f


PATHS = {'footway', 'pedestrian', 'path', 'steps', 'cycleway', 'bridleway', 'corridor'}
GREEN_LANDCOVER = {'wood', 'grass'}           # parks, lawns, forest (Delhi Ridge)
GREEN_SUB = {'park', 'forest', 'wood', 'garden', 'grass', 'nature_reserve', 'golf_course', 'recreation_ground', 'scrub'}
LANDUSE_ISOLATED = {'industrial': 'industrial', 'cemetery': 'cemetery', 'quarry': 'quarry', 'military': 'military'}
n_tiles = n_paths = n_bld = n_green = n_landuse = 0
for x in range(lon2x(W), lon2x(E) + 1):
    for y in range(lat2y(N), lat2y(S) + 1):
        row = mb.execute('select tile_data from tiles where zoom_level=? and tile_column=? and tile_row=?',
                         (Z, x, 2 ** Z - 1 - y)).fetchone()
        if not row: continue
        n_tiles += 1
        layers = mapbox_vector_tile.decode(gzip.decompress(row[0]), default_options={'y_coord_down': True})
        for name, layer in layers.items():
            ext = layer.get('extent', 4096)
            clip = box(0, 0, ext, ext)  # drop the tile buffer so neighbouring tiles don't duplicate
            proj = to_lonlat(x, y, ext)
            for f in layer['features']:
                p = f['properties']
                cls, sub = p.get('class'), p.get('subclass')
                want = None
                if name == 'transportation' and (cls == 'path' and sub in PATHS or cls == 'track'):
                    want = 'path'
                elif name == 'building':
                    want = 'building'
                elif name == 'landcover' and (cls in GREEN_LANDCOVER or sub in GREEN_SUB):
                    want = 'green'
                elif name == 'park':
                    want = 'green'
                elif name == 'landuse' and cls in LANDUSE_ISOLATED:
                    want = 'landuse'
                if not want: continue
                try:
                    g = shape(f['geometry']).intersection(clip)
                except Exception:
                    continue
                if g.is_empty: continue
                g = transform(proj, g)
                if want == 'path':
                    hw = 'track' if cls == 'track' else ('footway' if sub == 'corridor' else sub)
                    tags = {'highway': hw}
                    if p.get('brunnel') == 'tunnel': tags['tunnel'] = 'yes'
                    if p.get('brunnel') == 'bridge': tags['bridge'] = 'yes'
                    lines = [g] if g.geom_type == 'LineString' else [l for l in getattr(g, 'geoms', []) if l.geom_type == 'LineString']
                    for l in lines:
                        add('road', mapping(l), tags); n_paths += 1
                elif want == 'building':
                    c = g.centroid
                    if inside(c.x, c.y):
                        add('building', {'type': 'Point', 'coordinates': [round(c.x, 6), round(c.y, 6)]}, center=[round(c.x, 6), round(c.y, 6)])
                        n_bld += 1
                elif g.geom_type in ('Polygon', 'MultiPolygon'):
                    if want == 'green':
                        add('green', mapping(g), {'leisure': 'park' if name == 'park' else (sub or cls or 'green')}); n_green += 1
                    else:
                        add('landuse', mapping(g), {'landuse': LANDUSE_ISOLATED[cls]}); n_landuse += 1
print(f'tiles {n_tiles}: paths {n_paths}, buildings {n_bld}, green {n_green}, landuse {n_landuse}')

# ---------------------------------------------------------------- road graph (RGR2)
CLASS = {1: 'motorway', 2: 'trunk', 3: 'primary', 4: 'secondary', 5: 'tertiary', 6: 'unclassified',
         7: 'residential', 8: 'living_street', 9: 'service'}
buf = open(f'{pack_dir}/{pack_id}.route', 'rb').read()
assert buf[:4] == b'RGR2', 'not an RGR2 route file'
ver, nV, nE, nAdj, gBytes, nBytes = struct.unpack_from('<6i', buf, 4)
o = 28
def take(code, n):
    global o
    a = array(code); a.frombytes(buf[o:o + n * a.itemsize]); o += n * a.itemsize
    return a
vert = take('i', nV * 2); take('i', nV + 1); take('i', nAdj)
efrom, eto = take('i', nE), take('i', nE)
elen, etime = take('f', nE), take('f', nE)
ename, goff = take('i', nE), take('i', nE + 1)
eflag = buf[o:o + nE]; o += nE
geom = buf[o:o + gBytes]; o += gBytes
names = buf[o:o + nBytes].split(b'\0')


def varints(b, start, end):
    out, v, sh = [], 0, 0
    for i in range(start, end):
        c = b[i]
        v |= (c & 0x7F) << sh
        if c & 0x80: sh += 7
        else:
            out.append((v >> 1) ^ -(v & 1)); v = 0; sh = 0
    return out


n_roads = n_private = 0
for e in range(nE):
    a, b = efrom[e], eto[e]
    alat, alon, blat, blon = vert[2 * a] / 1e6, vert[2 * a + 1] / 1e6, vert[2 * b] / 1e6, vert[2 * b + 1] / 1e6
    if not (inside(alon, alat) or inside(blon, blat)): continue
    pts = [(alon, alat)]
    d = varints(geom, goff[e], goff[e + 1])
    la, lo = vert[2 * a], vert[2 * a + 1]
    for i in range(0, len(d), 2):
        la += d[i]; lo += d[i + 1]
        pts.append((lo / 1e6, la / 1e6))
    pts.append((blon, blat))
    fl = eflag[e]
    tags = {'highway': CLASS.get(fl >> 4, 'unclassified')}
    if fl & 1: tags['oneway'] = 'yes'
    if fl & 2: tags['junction'] = 'roundabout'
    kmh = elen[e] / etime[e] * 3.6 if etime[e] > 0 else 30
    if kmh <= 5.5:  # pack marks private / destination-only roads with a 5 km/h cap (gated colonies)
        tags['access'] = 'private'; tags['foot'] = 'yes'; n_private += 1
    nm = names[ename[e]].decode('utf-8', 'replace') if ename[e] >= 0 else ''
    if nm: tags['name'] = nm
    add('road', {'type': 'LineString', 'coordinates': [[round(x, 7), round(y, 7)] for x, y in pts]}, tags)
    n_roads += 1
print(f'roads {n_roads} (gated/private {n_private}) of {nE} in the pack')

# ---------------------------------------------------------------- places and POIs
db = sqlite3.connect(f'{pack_dir}/{pack_id}.search')
args = (int(W * 1e6), int(E * 1e6), int(S * 1e6), int(N * 1e6))
n_poi = n_place = 0
for name, latin, kind, sub, lat, lon, rank, tags in db.execute(
        'select name, latin, kind, sub, lat, lon, rank, tags from places where kind in (1, 2) and lon between ? and ? and lat between ? and ?', args):
    t = json.loads(tags) if tags else {}
    nm = latin if latin and not name.isascii() else name
    if nm: t.setdefault('name', nm)
    pt = {'type': 'Point', 'coordinates': [lon / 1e6, lat / 1e6]}
    if kind == 1:
        t['place'] = sub or 'locality'
        add('place', pt, t, nm); n_place += 1
    else:
        add('station' if t.get('railway') == 'station' else 'poi', pt, t, nm); n_poi += 1
print(f'places {n_place}, POIs {n_poi}')

with open(out_path, 'w') as f:
    json.dump({'type': 'FeatureCollection', 'bbox': [W, S, E, N], 'snapshot': snapshot,
               'source': 'OpenStreetMap contributors (ODbL), via Radar GPS map pack ' + pack_id,
               'features': feats}, f, separators=(',', ':'))
print('wrote', out_path, len(feats), 'features, snapshot', snapshot)
