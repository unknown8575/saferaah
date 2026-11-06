#!/usr/bin/env bash
# Rebuild SafeRaah's Delhi NCT data from the latest OpenStreetMap-based map pack.
#   bash pipeline/fetch_delhi.sh            (needs: curl, python3 with osmium-free deps below, node)
#   pip install mapbox-vector-tile shapely
# Source: Radar GPS map packs (https://github.com/Greymussh/radargps-maps), built monthly from
# Geofabrik's Northern Zone extract. Map data © OpenStreetMap contributors (ODbL).
set -euo pipefail
cd "$(dirname "$0")/.."
PACK=data/pack
mkdir -p "$PACK"
B=https://github.com/Greymussh/radargps-maps/releases/download/pack-northern-zone
for f in northern-zone.route.gz northern-zone.search.gz northern-zone.mbtiles; do
  [ -s "$PACK/$f" ] || curl -fL --retry 3 -o "$PACK/$f" "$B/$f"
done
gunzip -kf "$PACK/northern-zone.route.gz" "$PACK/northern-zone.search.gz"
BBOX="76.83 28.40 77.35 28.89"   # Delhi NCT plus a small margin
python3 -I pipeline/pack_to_geojson.py "$PACK" northern-zone data/raw/delhi-nct.geojson $BBOX
NODE_OPTIONS=--max-old-space-size=8000 npx tsx pipeline/build-data.ts data/raw/delhi-nct.geojson web/public/data "Delhi NCT"
rm -rf web/public/data/tiles
python3 -I pipeline/extract_tiles.py "$PACK/northern-zone.mbtiles" web/public/data/tiles $BBOX
echo "Done. Now: npm run build"
