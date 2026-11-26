# SafeRaah — safe, clean-air routes for families (Delhi)

> **New: clean air.** SafeRaah now also helps families breathe less polluted air. Every route is scored for the **PM2.5 you would breathe**, a **Cleanest air** route steers around busy roads, industrial estates and Delhi's landfills, the home screen shows the **live AQI** (Indian National AQI) with a 24-hour forecast, and **Saans**, a Gemini-powered assistant, turns the forecast and your family's situation into a plan for the day, indoor air fixes and greener swaps with their impact. See [Clean air](#clean-air-saans) below and [docs/11-clean-air.md](docs/11-clean-air.md).

SafeRaah (सुरक्षित राह, "safe path") is our own map and router for India, covering **all of Delhi NCT** (all 11 districts including New Delhi, plus the bordering edges of Gurugram, Faridabad, Noida and Ghaziabad). For any trip — walking, scooty/bike, auto or car — it shows **up to four routes from the fastest to the safest**, coloured by real risk at that hour (🟥 high risk · 🔴 unsafe · 🟡 take care · 🟢 low risk), sends an **arrival message** to trusted contacts, checks on you if you stop on a risky street, and gives one-tap **SOS**.

It works like a normal maps app — live blue dot with accuracy and heading, search, tap anywhere for a place card, category chips (police, hospitals, medical stores, metro, petrol pumps), Directions with a time for every way of travelling, choose-on-map, heading-up navigation that re-routes when you leave the route — and adds live safety layers: every street coloured by its risk this hour, and Waze-style live reports (dark street, harassment, drunk group, someone following…) that other travellers confirm or dismiss and that routing avoids until they expire. The fastest route is selected first; each route shows the precautions it needs, and the user decides.

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
| Live | `shared/live.ts`, `shared/precautions.ts` | Live reports → extra risk on streets within 60 m (half until a second traveller confirms, fading to expiry; police patrols lower risk); plain-language precautions per route |
| Server | `server/` | Node + built-in SQLite: journeys (incl. mid-trip re-route), GPS fixes, verified reviews (one vote per device per street, 90-day half-life), live reports (near-you check, merge within 80 m, 6/hour, still-there/gone votes), live trip links, SOS, optional SMS |
| App | `web/src/` | MapLibre on our basemap, router in a web worker, all screens, PWA service worker |
| Native | `android/`, `ios/`, `capacitor.config.ts` | Background location while the screen is locked; `NavStatusPlugin` (Android) shows the next turn as an ongoing notification / Android 16 Live Update and speaks turns with the phone's text-to-speech |
| Nearby by kind | `shared/kinds.ts`, `web/src/browse.ts`, `pipeline/build_places.py` | "gym", "kirana", "chemist"… → nearest 5–7 of that kind with open state, or similar places; index of 26,000 mapped places with their precise type |
| Guidance | `web/src/nav.ts` | Spoken turn-by-turn (in advance and at the turn, stretch warnings, re-route, arrival) and the navigation island |
| Street air | `pipeline/build-air.ts`, `shared/air.ts` | Per street: distance to industrial land, busy roads and landfills (50 m raster + distance transform), named industrial areas; street pollution factor, PM2.5 dose by travel mode, Indian National AQI (CPCB) |
| Clean-air routes | `shared/router.ts` | Extra search with cost T·(F/0.7)^1.5·(1+0.5·E·R); every route gets dose, % vs fastest, busy-road and industry metres, areas passed and avoided |
| Live AQI | `web/src/airnow.ts`, `server/ai.ts` | CAMS forecast via Open-Meteo (no key), or Google Air Quality API on the server; position rounded to ~10 km |
| Saans assistant | `shared/saans/`, `server/ai.ts`, `web/src/saans.ts` | Notes knowledge base in topic clusters, BM25 + Gemini-embedding hybrid search, facts computed in code, Gemini writes the answer and cites notes; built-in engine when there is no key or no network |

Design documents: `docs/01-blueprint.md`, `docs/02-requirements.md`, `docs/05-test-cases.md`, `docs/09-test-report.md`, user manual `docs/08-user-manual.md`, research `docs/research/`.

## Tests

```bash
npm run typecheck
npm test               # 122 unit + API tests (vitest)
npm run build && npm run test:e2e   # 24 end-to-end cases in headless Chrome (needs Python Playwright + Chrome)
python3 tests/e2e/record_guides.py  # re-record the animated GIF manual into web/public/help/
```

## Clean air (Saans)

* **Live AQI card** on the home screen: Indian National AQI from PM2.5/PM10, the band's advice, and how many times above the WHO guideline the air is. Tap it to open Saans.
* **Cleanest air route.** Air at street level is estimated from the city forecast × a street factor: busy road up to +60 %, beside one up to +25 %, industrial land up to +50 %, next to a landfill up to +60 %, parks −10 %. The dose is that × minutes × breathing rate for your way of travelling (walking breathes 1.4 m³/h; a closed car lets in ~60 %). The route with the lowest dose is labelled *Cleanest air* with "N% less PM2.5 breathed than fastest" and the industrial areas it avoids. When the fastest route is already the cleanest, the app says so instead of inventing a detour. If the cleanest route is less safe at night, the details say so.
* **Air reports:** garbage burning, construction dust and heavy smoke can be reported like safety problems; clean-air routes avoid them until they expire (they don't change safety colours).
* **Saans** (सांस, "breath"): a next-24-hours plan for *your* family (children, elders, asthma, pregnancy, cooking fuel, bedroom size, commute; kept only on the phone), purifier sizing, cooking smoke, masks, school runs, and swaps with CO₂ saved per month. Every number is computed in code; Gemini only explains it and cites the notes it used. Without a key it still answers from the built-in engine.

Google services (all optional, set on the server only):

| Variable | Used for |
|---|---|
| `GEMINI_API_KEY` | Saans answers (`GEMINI_MODEL`, default `gemini-flash-latest`) and note embeddings for vector search (`GEMINI_EMBED_MODEL`, default `gemini-embedding-001`) |
| `GOOGLE_AIR_KEY` | Google Air Quality API current conditions (else CAMS via Open-Meteo) |
| `GEMINI_DAILY_LIMIT` | Most Gemini answers per day for the whole server (default 500); after that the built-in engine answers |

Deploy to Cloud Run: `gcloud run deploy saferaah --source . --region asia-south1 --allow-unauthenticated --set-env-vars GEMINI_API_KEY=…` (the `Dockerfile` builds the app and serves it on port 8080). The website uses the server at `https://saferaah-87901400101.asia-south1.run.app` (set in `.github/workflows/pages.yml`; the repository variable `SAFERAAH_API_BASE` overrides it) and `ALLOWED_ORIGINS` on the service to your website's origin.

## Privacy

Location stays on the phone. The air reading is asked for a ~10 km cell, never your exact position; the family profile is stored only on the phone and Saans conversations only in memory (the server does not log questions). During a trip the server receives GPS points only for the live link and the arrival check, and deletes them, the route, destination and name the moment the trip ends; the optional two questions afterwards are stored as anonymous per-street votes. Details: [docs/10-privacy.md](docs/10-privacy.md).

## Website (GitHub Pages)

Every push to `main` builds the app and publishes it with GitHub Pages (`.github/workflows/pages.yml`). In the repository's **Settings → Pages**, set **Source: GitHub Actions** once. The site is served over HTTPS, so phones can use real GPS. Routing, guidance, voice, check-ins and SOS work without a server; to turn on live trip links, live reports and reviews, run the server somewhere public and set the repository variable `SAFERAAH_API_BASE` to its https address.

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
* Air numbers are **estimates**: the forecast (CAMS) is coarse, and street factors are rounded from near-road and Delhi exposure studies, not measured on each street. Only three landfills are included; power plants and brick kilns are not mapped.
* Live traffic needs a paid key: set `VITE_TOMTOM_KEY` at build time and a Traffic layer appears under Layers.
* The hosted preview page cannot use GPS (its host does not grant location), so there you mark where you are on the map; the Android/iOS apps and the web app on your own domain (HTTPS) use real GPS. In the preview, live reports are kept in the page's shared store instead of the SafeRaah server.

Map data © OpenStreetMap contributors, ODbL. Fonts: Mukta (Ek Type, OFL), Noto Sans (OFL).
