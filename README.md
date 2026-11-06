# SafeRaah — safe routes for women and children (Delhi)

SafeRaah (सुरक्षित राह, "safe path") is our own map and router for India, covering **all of Delhi NCT** (all 11 districts including New Delhi, plus the bordering edges of Gurugram, Faridabad, Noida and Ghaziabad). For any trip — walking, scooty/bike, auto or car — it shows **up to four routes from the fastest to the safest**, coloured by real risk at that hour (🟥 high risk · 🔴 unsafe · 🟡 take care · 🟢 low risk), sends an **arrival message** to trusted contacts, checks on you if you stop on a risky street, and gives one-tap **SOS**.

Runs as a web app (PWA, works offline after the first visit) and as Android/iOS apps via Capacitor.

## Quick start

```bash
npm install
npm run build          # bundle the web app into web/dist
npm start              # server + app on http://localhost:8787
```
Open `http://localhost:8787/?demo=1` to try it without walking (movement is simulated).

Try a demo trip: `/?demo=1&from=77.24318,28.57009&to=77.22429,28.54259&t=21:30` (Lajpat Nagar II → Soami Nagar, 9:30 pm walk: red 60 min → yellow 61 → safest 63, plus an alternative). For an outer district: `/?demo=1&from=77.0853,28.6977&to=77.0634,28.6927&t=22:30` (Mangolpuri → Sultanpuri).

## How it works

| Part | Where | What |
|---|---|---|
| Data pipeline | `pipeline/fetch_delhi.sh` → `pack_to_geojson.py`, `build-data.ts`, `extract_tiles.py` | OpenStreetMap (31 Oct 2026) → routing graph for all of Delhi with per-street safety features (400k junctions, 533k segments with real geometry and one-way streets), 18k safe-haven places, 35k-entry offline search, and the basemap split into 17 area packs loaded on demand |
| Risk model | `shared/risk.ts` | R(e,t) from open places within 50 m, police distance, busyness, lighting prior, parks/empty land, child traffic, verified reviews; scaled by time of day |
| Router | `shared/router.ts` | A* with cost T·(1 + α·E·R) for α ∈ {0, 0.5, 1.5, 5}; de-duplication; Pareto filter (slower ⇒ clearly safer); max 1.6× detour; alternatives up to 4 (a clearly safer alternative joins the ranked list). Walks: ~0.1 s; 30 km drives: ~1 s |
| Journey | `shared/journey.ts` | Arrival geofence (10 m target, widened by GPS accuracy to 15–40 m), off-route, stop/overdue check-ins, 80% route-coverage verification |
| Server | `server/` | Node + built-in SQLite: journeys, GPS fixes, verified reviews (one vote per device per street, 90-day half-life), live trip links, SOS, optional SMS |
| App | `web/src/` | MapLibre on our basemap, router in a web worker, all screens, PWA service worker |
| Native | `android/`, `ios/`, `capacitor.config.ts` | Background location while the screen is locked |

Design documents: `docs/01-blueprint.md`, `docs/02-requirements.md`, `docs/05-test-cases.md`, `docs/09-test-report.md`, user manual `docs/08-user-manual.md`, research `docs/research/`.

## Tests

```bash
npm run typecheck
npm test               # 66 unit + API tests (vitest)
npm run build && npm run test:e2e   # 12 end-to-end cases in headless Chrome (needs Python Playwright + Chrome)
python3 tests/e2e/record_guides.py  # re-record the animated GIF manual into web/public/help/
```

## Android and iOS

```bash
VITE_API_BASE=https://your-server.example npm run build   # native apps need your server's address
npx cap sync
npx cap open android    # Android Studio → Run / Build APK
npx cap open ios        # Xcode (macOS) → Run
```
Location permissions and background mode are already declared. Google Play requires a background-location declaration form and a short video for publishing.

## Deploying the server

```bash
PORT=8787 DB_PATH=/var/lib/saferaah/db.sqlite STATIC_DIR=web/dist npm start
```
Put it behind HTTPS. Optional SMS (India requires TRAI DLT registration first):
`SMS_PROVIDER=twilio TWILIO_SID=… TWILIO_TOKEN=… TWILIO_FROM=…` or `SMS_PROVIDER=webhook SMS_WEBHOOK_URL=…`.
Without SMS, the app sends arrival/SOS messages through pre-filled SMS and WhatsApp links from the user's own phone.
`ALLOWED_ORIGINS` adds extra web origins allowed to call the API.

## Updating or extending the map

```bash
pip install mapbox-vector-tile shapely
npm run data        # downloads the latest Northern Zone OSM pack (~420 MB), rebuilds Delhi NCT data
npm run build
```
`pipeline/fetch_delhi.sh` takes the monthly OpenStreetMap-based pack from [Radar GPS map packs](https://github.com/Greymussh/radargps-maps) (built from Geofabrik's Northern Zone extract): its car road graph with one-way flags, its places database with opening hours, and its OpenMapTiles vector tiles (footpaths, parks, buildings, labels). Change `BBOX` in that script to cover another area of North India; other regions have their own packs. `pipeline/build-data.ts` also accepts any OSM-derived GeoJSON with `kind` road/poi/station/place/building/green/landuse features and OSM `tags`.

## Known limits

* Scores describe the **street environment**, not reported crime (Delhi Police does not publish geocoded incidents). Weights are research-informed priors, not calibrated against outcomes.
* Only ~5–7% of Indian shops have opening hours in OSM; the rest use Delhi-typical hours, shown as "estimated". A Google Places / Ola Maps adapter can add live data.
* Lighting is estimated from road type (OSM `lit=*` covers <1% of Indian streets).
* OpenStreetMap is mapped less densely in outer and lower-income areas. Where few shops are mapped, "nothing open nearby" can partly mean "nothing mapped yet", which can make those areas score riskier than they are. Verified reviews correct this over time.
* Footpaths come from map tiles, so a few may not connect perfectly to roads.
* GPS-based review verification can be fooled by a determined spoofer; it stops casual abuse.

Map data © OpenStreetMap contributors, ODbL. Fonts: Mukta (Ek Type, OFL), Noto Sans (OFL).
