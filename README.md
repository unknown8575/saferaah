# SafeRaah — safe routes for women and children (Delhi)

SafeRaah (सुरक्षित राह, "safe path") is our own map and router for India. For any trip — walking, scooty/bike, auto or car — it shows **up to four routes from the fastest to the safest**, coloured by real risk at that hour (🟥 high risk · 🔴 unsafe · 🟡 take care · 🟢 low risk), sends an **arrival message** to trusted contacts, checks on you if you stop on a risky street, and gives one-tap **SOS**.

Runs as a web app (PWA, works offline after the first visit) and as Android/iOS apps via Capacitor.

## Quick start

```bash
npm install
npm run build          # bundle the web app into web/dist
npm start              # server + app on http://localhost:8787
```
Open `http://localhost:8787/?demo=1` to try it without walking (movement is simulated).

Try the demo trip from the research: `/?demo=1&from=77.24024,28.5682&to=77.26285,28.54035&t=21:30` (Lajpat Nagar → Giri Nagar, 9:30 pm walk: four routes, fastest-red to safest).

## How it works

| Part | Where | What |
|---|---|---|
| Data pipeline | `pipeline/build-data.ts`, `pipeline/build-tiles.ts` | OpenStreetMap → routing graph with per-street safety features (126k junctions, 144k segments), 6.9k safe-haven places, offline search index, and our own vector-tile basemap in one file |
| Risk model | `shared/risk.ts` | R(e,t) from open places within 50 m, police distance, busyness, lighting prior, parks/empty land, child traffic, verified reviews; scaled by time of day |
| Router | `shared/router.ts` | A* with cost T·(1 + α·E·R) for α ∈ {0, 0.5, 1.5, 5}; de-duplication; Pareto filter (slower ⇒ clearly safer); max 1.6× detour; alternatives up to 4 |
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

The pipeline reads an OSM-derived GeoJSON (`data/raw/central-delhi.geojson`, snapshot 2026-10-15, Mehrauli → Old Delhi).
To cover all of Delhi NCR or another city, convert a Geofabrik / openstreetmap.fr extract to the same GeoJSON form
(features with `kind` road/place/station/building/green/water and the OSM `tags`), then:

```bash
npx tsx pipeline/build-data.ts <input.geojson> web/public/data
npx tsx pipeline/build-tiles.ts <input.geojson> web/public/data
```
With a full extract, `oneway` tags are picked up automatically and the vehicle-mode warning disappears.

## Known limits

* Scores describe the **street environment**, not reported crime (Delhi Police does not publish geocoded incidents). Weights are research-informed priors, not calibrated against outcomes.
* Only ~5–7% of Indian shops have opening hours in OSM; the rest use Delhi-typical hours, shown as "estimated". A Google Places / Ola Maps adapter can add live data.
* Lighting is estimated from road type (OSM `lit=*` covers <1% of Indian streets).
* This data snapshot has no one-way tags: vehicle routes may use a one-way street against traffic.
* GPS-based review verification can be fooled by a determined spoofer; it stops casual abuse.

Map data © OpenStreetMap contributors, ODbL. Fonts: Mukta (Ek Type, OFL), Noto Sans (OFL).
