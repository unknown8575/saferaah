# 02 — Tech Stack & Data Sources for an India-focused Safety-Aware Navigation App

Research date: 2026-11-06. Prices are as published by vendors at the time of research; re-check before committing.
Legend: **[verified]** = read on the source page during this research; **[secondary]** = from a third-party/vendor-competitor page; **[inferred]** = my engineering judgement.

---

## 0. TL;DR

- **Routing engine:** **GraphHopper** (custom models sent per request; supports `lit`, `road_class`, `foot_network`, `sidewalk`, polygons via `areas`) is the best fit for runtime per-request weighting. **Valhalla** is the runner-up: it has a built-in `use_lit` pedestrian option and `exclude_polygons`, but it can't take arbitrary per-edge weights per request. **OSRM** isn't suitable for per-request safety weights. For one city in an MVP, a **JS graph with ngraph.path** (or a small Python/Rust service) gives total control.
- **Data:** OSM India is the base. `lit` sits on only ~30k objects nationwide (22,345 `yes` / 7,758 `no`) against ~10.8M highway ways, so lighting has to be inferred. `opening_hours` is present on only **~6.9% of shops** and **~4.7% of amenities**. "Open now" therefore needs a commercial POI API (Google Places, Ola Maps, Mappls) or time-of-day priors.
- **Maps:** MapLibre GL JS / MapLibre Native, with OpenFreeMap (free, no key) for the MVP and self-hosted Protomaps PMTiles on Cloudflare R2 for production. Don't use `tile.openstreetmap.org` for an app.
- **Cross-platform:** A **PWA can't do background location or geofencing on iOS**. Arrival detection and live-trip sharing need native code: **Expo/React Native** (one TS codebase plus React Native Web) or **Capacitor** (wrap the web app). Google Play requires a background-location declaration and a video.
- **Messaging:** India A2P SMS requires **TRAI DLT** registration (~₹5,900 per entity, templates, headers, and new variable pre-tagging from Nov 2025). For the MVP, use free `sms:` / `wa.me` deep links. Later, add WhatsApp Cloud API utility templates (₹0.13/msg in India) and DLT SMS via MSG91/Fast2SMS (~₹0.15–0.25/SMS).
- **Competitors:** None of the competitors found combines **multi-route safety scoring with live "open now" POIs** and **verified reviews** on web, iOS and Android. My Safetipin comes closest (safety audits plus a "safest route"), but its data is crowd and audit based, not live.

---

## 1. Routing engines with custom per-edge weights

### 1.1 GraphHopper (Apache-2.0) — **best for per-request weighting**
- Latest release: **GraphHopper 11.0, 14 Oct 2025** [verified, github.com/graphhopper/graphhopper/releases].
- **Custom models** (`custom_model` in a POST `/route` body) change `priority` (desirability, no change to ETA), `speed`, and `distance_influence` (default 70). They also accept **`areas`**, a GeoJSON FeatureCollection of polygons that you reference in conditions as `in_<id>` [verified, docs.graphhopper.com/openapi/custom-model, GitHub docs/core/custom-models.md].
- **Encoded values usable in conditions** [verified]: categorical `road_class`, `road_environment`, `road_access`, `surface`, `sidewalk`, `foot_network`, `urban_density`, `country`, `state`, …; boolean **`lit`**, `roundabout`, `*_access`; numeric `max_speed`, `lanes`, `average_slope`, `*_priority`, …. Call the `/info` endpoint to get the full list.
- **Per-request flexibility vs speed:**
  - With CH (contraction hierarchies), a custom model can't change weights. Send `"ch.disable": true` to switch to the flexible mode (A*/LM).
  - **LM (landmarks)** "allows for adjustments of the routing profile per-request", with one constraint: **weights can only be increased, never decreased**. In practice you can only make edges *less* desirable or slower than the prepared profile. Design the base profile as "optimistic" and penalise risky edges per request [verified, graphhopper.com blog 2022-06-27].
  - Docs warn that **custom models are beta** and that dynamic priority values slow A* when CH/LM are off [verified].
- **How to feed safety scores to GraphHopper:** GraphHopper can't take an arbitrary per-edge numeric array in a request. Options [inferred]:
  1. **Import-time custom encoded value.** Add a `safety_score` tag (e.g. 0–10) to OSM ways in a preprocessed PBF, and register a custom EncodedValue/TagParser in a fork. Then a request can say `if: safety_score < 4, multiply_by: 0.3`. Rebuild nightly.
  2. **Per-request `areas`.** Send polygons for "dark/deserted zones" or "currently-closed commercial strip" built from your risk layer (time-of-day dependent) and multiply priority. This works with zero forking, but large polygon payloads slow requests.
  3. Combine 1 and 2: static parts (lighting, road class, police proximity) at import, dynamic parts (open shops now, recent incidents) as `areas`.
- **Four routes:** GraphHopper supports `algorithm=alternative_route` (`alternative_route.max_paths`). The cleaner approach is to run **four requests with different custom models** (e.g. safety weight 0, 0.33, 0.66, 1.0) and de-duplicate [inferred].
- **Hosted option:** the GraphHopper Directions API (paid) accepts custom models on its "flexible" endpoints (see docs.graphhopper.com).

### 1.2 Valhalla (MIT) — good built-ins, less arbitrary
- Latest release: **3.9.1, 6 Oct 2026** [verified, GitHub releases].
- Since 3.4.0 (May 2023): "ADDED: `use_lit` costing option for pedestrian costing" and "parse `lit` tag on ways" [verified].
- **Pedestrian costing options (per request, in `costing_options.pedestrian`)** [verified, valhalla.github.io/valhalla/api/route/api-reference/]:
  - `use_lit` 0–1 (default 0; 1 = avoid unlit)
  - `walkway_factor` (default 1.0)
  - `sidewalk_factor` (1.0)
  - `alley_factor` (2.0)
  - `driveway_factor` (5.0)
  - `use_living_streets` (0.6)
  - `use_tracks` (0.5)
- **Request-level:**
  - `exclude_polygons`: rings or a FeatureCollection; roads intersecting them are avoided.
  - `exclude_locations`.
- **Limits:**
  - No general "multiply by X when edge is in polygon" mechanism. You can only *exclude* polygons, which is too blunt for soft risk.
  - No arbitrary per-edge custom attributes without modifying C++ costing.
  - Valhalla's tiled graph does support historical/live traffic speeds, which is a hook for "busyness" if you repurpose it [inferred].
- **Good for:** a quick "avoid unlit streets" walking mode, isochrones, and map-matching.

### 1.3 OSRM (BSD-2) — **not suitable for per-request safety weights**
- Weights are defined in **Lua profiles at extract time**.
- Changing weights requires re-running `osrm-contract` (CH) or `osrm-customize` (MLD) with a `--segment-speed-file` CSV (`from_node,to_node,speed[,rate]`, one direction per line). Then restart or hot-reload `osrm-routed` via `osrm-datastore` [verified, OSRM wiki "Traffic"].
- MLD customisation is "significantly faster" than CH re-contraction, but it's still a **batch update applied to every user**, not per request. The feature is labelled experimental [verified].
- **Use OSRM only if** you accept a few fixed profiles (e.g. "night-safe", "day-safe"), each rebuilt every N minutes. It's very fast for queries but inflexible.

### 1.4 pgRouting (GPL-2) — maximum flexibility, slower
- `pgr_dijkstra` / `pgr_aStar` take an **SQL string that returns `id, source, target, cost, reverse_cost`**, so you can compute cost per query, e.g. `length * (1 + w * risk_at(now))` with joins to POI or open-hours tables [verified, workshop.pgrouting.org].
- Good fit for a city-scale MVP on PostGIS, and it lets the risk model live in SQL.
- Downsides [inferred]:
  - It builds the graph per query, so it's slow on large graphs (seconds on a metro). Mitigate with a bounding-box filter around origin/destination.
  - It has no turn-by-turn instructions.

### 1.5 JS / client-side routing for a small city graph
- **ngraph.path** (MIT, by anvaka) [verified, github.com/anvaka/ngraph.path]:
  - Finders: `aStar`, `aGreedy` (fast, suboptimal), `nba` (bidirectional NBA*, optimal).
  - Takes a custom `distance(fromNode, toNode, link)` function, so per-edge safety cost can be computed at query time with the current hour as a parameter.
  - Benchmark on the NYC road graph (264k nodes, 734k edges): **NBA* avg 44 ms, A* avg 55 ms, Dijkstra 264 ms**.
  - A single Indian city's walk/drive graph (e.g. Delhi NCT) is in the same order of magnitude, so this is **feasible in a Web Worker or on the server in Node**.
- Alternatives:
  - `geojson-path-finder` (simpler, GeoJSON in, Dijkstra).
  - OSMnx (Python) + NetworkX for offline experimentation and score calibration.
- **Generating 4 routes [inferred]:** run k shortest paths with varied weights `cost = time × (1 + α·risk)` for α ∈ {0, 0.5, 1.5, 4}. Alternatively use a penalty method: after finding a route, multiply its edges by 1.3 and search again. De-duplicate by overlap below 70%.

### 1.6 Verdict
| Need | Best choice |
|---|---|
| Runtime per-request weighting, production | **GraphHopper** (custom model + LM, safety EV baked at import, dynamic `areas`) |
| Quick "avoid unlit" mode | Valhalla `use_lit` |
| Fixed profiles, huge QPS | OSRM |
| City MVP, risk logic in SQL | pgRouting |
| City MVP, risk logic in TS, cheapest infra | ngraph.path on a preprocessed graph (server Node or Web Worker) |

---

## 2. OSM data for India

### 2.1 Extracts
- Geofabrik's Asia index lists India at **~1.5 GB .osm.pbf**, but the full-country file is shown as *not available*. Download it by **zone** instead [verified, download.geofabrik.de/asia/india.html]:
  - Central 328 MB
  - Eastern 227 MB
  - North-Eastern 91 MB
  - **Northern 206 MB** (includes Delhi)
  - Southern 518 MB
  - Western 191 MB
- For a single-city MVP, clip further with `osmium extract -b <bbox>`, or use BBBike or a city extract [inferred].
- **Legal note on borders:** The Survey of India sent Maps.me a notice over its depiction of J&K/Ladakh, after which **Google and Apple removed it from their app stores (Jan 2025)**. The notice cited Section 79(3)(b) of the IT Act and the Criminal Law (Amendment) Act 1990 [verified, medianama.com 2025-01]. If you render country-level zooms from OSM-derived tiles, **apply an India-compliant boundary layer or hide international boundaries**. City-zoom apps are low-risk but should still be checked [inferred].

### 2.2 Safety-relevant tags and India counts
Counts are from taginfo.geofabrik.de/asia:india, data as of 2026-11-05 [verified].

| Tag | India count | Use |
|---|---|---|
| `highway=*` | 10,765,529 ways | base graph |
| ↳ residential / unclassified / service | 6.71M / 1.23M / 1.04M | default "quiet" streets |
| ↳ primary / secondary / tertiary / trunk | 105k / 140k / 440k / 142k | busy arterials (busyness prior) |
| ↳ footway / path / pedestrian / living_street / steps | 85k / 112k / 5k / 85k / 15k | walk-only, often deserted at night |
| ↳ track | 623k | rural, high risk at night |
| `lit=*` | ~30,300 objects (**yes 22,345; no 7,758**; plus junk values like "24/7") | very sparse, so infer lighting |
| `amenity=hospital` | 55,802 | safe anchor (24h usually) |
| `amenity=clinic` / `doctors` | 22,690 / 3,841 | |
| `amenity=pharmacy` | 8,257 | |
| `amenity=police` | 4,590 | safe anchor |
| `amenity=townhall` | 812 | govt buildings (also `office=government`) |
| `amenity=fuel` | 19,444 | often 24h, lit, staffed, so a good night anchor |
| `amenity=atm` / `bank` | 13,851 / 22,580 | ATMs have guards and lights |
| `amenity=restaurant` / `cafe` | 33,256 / 10,858 | activity proxy |
| `shop=*` | 163,549 | activity proxy |
| `opening_hours=*` | **45,104** total | |
| ↳ on `shop=*` | 11,465 (**6.9% of shops**) | |
| ↳ on `amenity=*` | 23,259 (**4.7% of amenities**) | |

Other useful tags:
- `sidewalk=*`
- `footway=sidewalk|crossing`
- `highway=street_lamp` (nodes, rare in India)
- `surface`
- `width`
- `access`
- `landuse=*` (commercial/retail vs industrial/vacant)
- `building=*` density
- `railway=station`
- `public_transport=*`
- `amenity=bus_station`

**Implication:** OSM's `opening_hours` and `lit` are too sparse in India to drive "open now" or lighting directly. They work as a seed or override layer only.

### 2.3 Parsing `opening_hours`
- **opening_hours.js** (npm `opening_hours`). Latest **v3.15.0, 21 Sep 2026** [verified]. License **LGPL-3.0-only** since v3.4 [verified].
- API:
  - `new opening_hours(value, nominatimObj)`
  - `oh.getState(date)` returns true or false
  - `oh.getUnknown()`
  - `oh.getNextChange(date)`
  - `oh.getOpenIntervals(from, to)`
- **No India public-holiday definitions** are bundled [verified], so `PH` rules won't resolve. Contribute them or treat `PH` as unknown.
- Python alternative: `humanized_opening_hours` [inferred].

### 2.4 Lighting proxies (since `lit` is sparse) [inferred]
- **Road-class prior:** primary/secondary/trunk are usually lit in metros; residential lanes are partially lit; tracks and paths are unlit.
- **POI density:** shops, fuel and ATMs nearby suggest light spill.
- **VIIRS / NASA Black Marble** night lights: 500 m resolution. That's fine for "is this neighbourhood lit at all" but far too coarse for street-level lighting.
- **Safetipin "Nite" audits:** a phone on a car windscreen photographs streets and codes lighting, openness, visibility, crowd, presence of women, security, transport and walk path. Data has been shared with Delhi PWD, Delhi Police and MCD [verified, safetipin.com]. This is a possible **data partnership**.
- **Crowdsourced "is this street lit?"** prompts in-app (MapComplete-style), written back to OSM as `lit=yes/no`. Contributing to OSM is a nice community angle.
- City streetlight GIS (some smart-city SPVs publish these) [inferred, check data.gov.in or the city portal].

---

## 3. "Open now" POI APIs

### 3.1 Google Places API (New)
- Fields: `currentOpeningHours` (includes `openNow`), `regularOpeningHours`, `currentSecondaryOpeningHours`. All three are **Enterprise-tier fields**, and Nearby Search (New) can return them under the Nearby Search Enterprise SKU [verified, Place Data Fields page].
- **Nearby Search (New)** [verified]:
  - Max **20 results** per call.
  - Circle radius up to **50 km**.
  - `includedTypes` (e.g. `pharmacy`, `hospital`, `police`).
  - `rankPreference` POPULARITY or DISTANCE.
  - **No `openNow` request filter**: you filter client-side on `currentOpeningHours.openNow`.
- **Text Search (New)** **does** support `openNow: true` as a request parameter, plus `includedType` and `locationBias`/`locationRestriction` [verified].
- **Pricing (global, since 1 Mar 2025):** the $200 credit was replaced by per-SKU free caps of 10k (Essentials), 5k (Pro) and 1k (Enterprise) per month [secondary, openplacesapi.com].
- **India pricing** applies to India billing accounts with mostly-India usage, effective 1 Aug 2024, billed in INR [verified, developers.google.com/maps/billing-and-pricing/pricing-india]:

| SKU (India) | Free / month | per 1,000 (≤5M) | per 1,000 (>5M) |
|---|---|---|---|
| Nearby Search Pro | 35,000 | $9.60 | $2.40 |
| Nearby Search Enterprise (hours) | 7,000 | $10.50 | $2.63 |
| Place Details Enterprise | 7,000 | $6.00 | $1.51 |
| Compute Routes Essentials | 70,000 | $1.50 | $0.38 |
| Compute Routes Pro (traffic-aware) | 35,000 | $3.00 | $0.75 |
| Dynamic Maps | 70,000 | $2.10 | $0.53 |
| 2D Map Tiles | 700,000 | $0.18 | $0.045 |

- **Terms caveat:** Google Maps Platform terms generally restrict caching Places content (place_id caching is allowed) and require showing results on a Google map or with attribution. That **conflicts with storing "open now" in your own risk graph and rendering on MapLibre** [inferred, verify against the GMP Service Specific Terms before relying on it]. A safer pattern is to query live per route corridor and not persist the results.
- **Cost strategy [inferred]:**
  - Never query per edge. Query **per route corridor**: sample 4–8 circles along each candidate route, with types {pharmacy, hospital, police, convenience_store, restaurant}.
  - Cache by H3 cell for ≤ 30 min in memory only.
  - At ~6 calls per route request × 4 routes, the 7k free Enterprise calls cover only ~300 searches/month. **Budget for paid use or use Ola/Mappls.**

### 3.2 Ola Maps (Krutrim)
- Pricing page [verified, maps.olakrutrim.com/pricing]: **Tier 1 free up to 100K calls per API per month**. Tier 2 covers 100K–5M; Tier 3 is above 5M.

| Ola API | Tier 2 (₹/1k) | Tier 3 (₹/1k) |
|---|---|---|
| Places Nearby Search | ₹638 | ₹159 |
| Place Details | ₹99 | ₹25 |
| Place Details Advance | ₹339 | ₹85 |
| Directions | ₹199 | ₹49 |
| Directions Basic | ₹99 | ₹25 |
| Dynamic Maps (per load) | ₹141 | ₹36 |

- **Change from 1 Sep 2026:** billing moved to **prepaid Ola Maps credits** (card auto-debit ended). The free tier needs no balance. The grace period ran to 8 Sep 2026 [verified, maps.olakrutrim.com/pricing/update-2026].
- The pricing page doesn't document opening-hours fields. **Verify whether Place Details Advance returns opening hours** before relying on it.
- A third-party page claims 500k pooled free calls and free use for ONDC partners until Aug 2027 [secondary, maps.guru, a vendor-competitor page].

### 3.3 Mappls (MapmyIndia)
- Nearby API: "search for nearby places under a particular category" from a lat/lng, with keyword/category, radius and filter [verified, about.mappls.com/api/search; docs at developer.mappls.com/documentation/sdk/rest-apis/mappls-maps-near-by-api-example/].
- **Pricing isn't published.** There's a free trial via the console; paid plans go through sales [verified/secondary].
- Strengths: strongest India POI and address data (since 1995) and **Survey of India-compliant borders**. Opening-hours availability isn't documented, so ask sales.

### 3.4 Open/free alternatives
- **Overture Maps Places** (Meta/Microsoft-sourced, CDLA-Permissive-2.0, monthly releases). It has good POI breadth in India, but **no reliable opening hours**. Use it to densify POIs where OSM is thin [inferred; schema check recommended].
- **OSM + opening_hours.js:** free, but only ~5–7% coverage, as above.
- **Category-default hours [inferred]:** when hours are unknown, assume typical Indian patterns:

| Category | Assumed hours |
|---|---|
| Pharmacy | 09:00–22:00 (24h if name contains "24") |
| Hospital | 24/7 |
| Clinic | 10:00–14:00 and 17:00–21:00 |
| Kirana / general shop | 07:00–22:00 |
| Restaurant | 11:00–23:00 |
| Fuel | 06:00–23:00, many 24h |
| Police | 24/7 |

  Learn these from Google or crowd data later.

---

## 4. Traffic and busyness signals

| Source | What you get | Free tier | Notes |
|---|---|---|---|
| **Google Routes API** `TRAFFIC_AWARE` / `TRAFFIC_AWARE_OPTIMAL` | Traffic-aware ETA and polyline for drive / two-wheeler | Pro SKU, India 35k free/mo, $3/1k | Two-wheeler is the **Enterprise** SKU and beta, with a mandatory warning [verified]. You can't inject your own weights; use it only for the ETA or "fastest" baseline. |
| **TomTom Traffic Flow** (segment data / flow tiles) | Current speed vs free-flow per segment | **Monthly**: 200K map/traffic tiles, **20K Flow Segment Data**, 20K routing, 2.5K incidents [verified, docs.tomtom.com/pricing] | India coverage exists; per-segment calls are too costly per edge. Flow **tiles** are good as a visual overlay and as a coarse "road is active" signal. |
| **HERE Traffic API v7** | Flow and incidents by bbox | Freemium (limits not visible on the current portal) | Check the current plan on here.com/developer. |
| **Google Popular Times** | Relative hourly busyness per venue | **Not in any official API** [verified, apiserpent.com summary of Google Place Data Fields] | Only via scrapers (SerpApi, Outscraper, Apify, BestTime.app). Values are relative to each venue's own peak. ToS risk, so avoid in production. |
| **Time-of-day priors (recommended)** | Busyness(edge, hour) from road class + POI density + land use | Free | See below. |

**Busyness prior model [inferred]:**
`busy(e, t) = f(road_class) × g(open POIs within 75 m at t) × h(landuse) × k(transit stop nearby, service hours) × m(hour-of-day curve)`
- Calibrate with TomTom flow tiles for arterials (speed below free-flow means traffic present).
- Calibrate with crowd "this street felt deserted/busy" taps.
- Optionally use Safetipin's "people" / "openness" audit parameters.
- Night curve: arterials stay "busy" until ~23:00 in Delhi; residential lanes drop after ~21:00.

---

## 5. Map rendering

- **MapLibre GL JS** (BSD-3): v5 added globe (5.0, Jan 2025). The 5.x line continues (5.15 by Dec 2025) [verified, maplibre.org newsletter; OSM rails PRs].
  - Use GeoJSON sources with **data-driven line colours** for the 4 routes (e.g. `line-color` by `route_rank`, with casing) and a heatmap layer for risk.
- **MapLibre Native** (Android/iOS), with PMTiles support since Android 11.8 / iOS 6.10 [verified].
- **@maplibre/maplibre-react-native v10:**
  - Released early 2025 after 29 alphas and 21 betas.
  - Has Expo improvements and a compatibility layer for RN New Architecture [verified].
  - Use it instead of `react-native-maps`. That library wraps Google/Apple maps, which means Google billing on Android and no custom vector style.
- **Flutter:** `maplibre_gl` (official flutter-maplibre-gl) [verified exists].

**Tile sources:**
| Source | Cost | Notes |
|---|---|---|
| **OpenFreeMap** | Free, **no API key, no request limits**, donation-funded [verified, github.com/hyperknot/openfreemap] | Weekly planet builds (also as PMTiles); self-hostable via deploy scripts. No SLA. Best for the MVP. |
| **Protomaps PMTiles** | Self-host: "pennies for moderate usage"; R2 has no egress fees [verified, protomaps.com/faq] | `pmtiles extract <planet-build-url> india.pmtiles --region=india.geojson --maxzoom=15` [verified CLI syntax]. Single static file, so it can serve offline maps in-app. Best for production and offline. |
| `tile.openstreetmap.org` | Free but **not for apps at scale** | Policy: no heavy use, no bulk prefetch or offline, must send a distinct User-Agent, no SLA, may be blocked without notice [verified, operations.osmfoundation.org/policies/tiles]. |
| Google 2D Map Tiles | India: 700k free/mo, then $0.18/1k [verified] | Requires Google ToS and attribution. |
| Ola / Mappls vector tiles | Ola: 100k free/mo per API | India-compliant borders (Mappls explicitly SoI-aligned). |

---

## 6. Cross-platform choice and background location

### 6.1 PWA limits (critical)
- On iOS, **PWAs have no background location**. Background Sync, Periodic Background Sync and Background Fetch are all unsupported. Geolocation works in the foreground only.
- Push works only after a home-screen install on iOS 16.4+.
- In the **EU (iOS 17.4+)**, PWAs don't run standalone. This doesn't affect India, but matters if you expand [verified, magicbell.com].
- **No Web Geofencing API** exists in browsers [inferred, well-known].
- So a PWA **can't reliably detect "arrived safely"** or keep sharing live location when the screen locks or the user switches apps. That's fine for planning routes on the web, and **not OK for the trip-monitoring/SOS part**.

### 6.2 Native geofencing limits
- **iOS (Core Location region monitoring / CLMonitor):**
  - **20 regions per app**, shared across all location managers.
  - A crossing fires after the user is ~200 m past the boundary for ≥ 20 s; use a radius of 200 m or more.
  - iOS can **relaunch a terminated app** on a geofence event [verified, capawesome.io; Expo docs].
- **Android Geofencing API:**
  - **100 geofences per app per device user**.
  - Recommended radius 100–150 m.
  - A terminated app is not restarted by Expo's handler [verified, Expo Location docs].
- For "arrived at destination", register **one geofence at the destination** (plus maybe the origin). That's well within limits.

### 6.3 Play Store background location policy [verified, support.google.com/googleplay/android-developer/answer/9799150]
- Only allowed for **core functionality**. Physical and perceived safety is explicitly a "significant benefit"; ads and analytics are not.
- Requirements:
  - A **prominent in-app disclosure** before the permission prompt, mentioning "location" and "when the app is closed/not in use".
  - A **Permissions Declaration Form** declaring **one** feature.
  - A **≤30 s video** showing the disclosure, the prompt and the background feature.
- A **foreground service (type `location`)** started by a user action ("Start trip") and stopped when the trip ends is the cleanest path. On Android 14+ it needs `FOREGROUND_SERVICE_LOCATION`.
- **Prefer "foreground service during an active trip only"** over always-on background location. It's easier to get approved and better for battery and privacy [inferred].
- iOS: background access needs "Always" authorisation plus `UIBackgroundModes: location`. For a trip-only design, "While Using" plus `allowsBackgroundLocationUpdates` during an active trip (blue status pill) can suffice [inferred].

### 6.4 Framework comparison

| | PWA only | **Capacitor** (web app + native shell) | **React Native / Expo** | Flutter |
|---|---|---|---|---|
| Web target | native | same code is the web app | React Native Web (OK for simple UIs) | Flutter Web (heavy) |
| Map | MapLibre GL JS | MapLibre GL JS in WebView (fine) | maplibre-react-native v10 | maplibre_gl |
| Background location | ✗ | `@capacitor-community/background-geolocation` (MIT; Android FG service, iOS bg mode; Capacitor 8 support) [verified]; or Capawesome (paid, $99/mo Insiders) | `expo-location` + TaskManager: `startLocationUpdatesAsync` with `foregroundService` and `startGeofencingAsync` (free) [verified] | `geolocator`, `flutter_background_geolocation` |
| Geofencing | ✗ | Capawesome Geofences plugin | `expo-location` geofencing (20 iOS / 100 Android) | plugins |
| Premium all-in-one | — | Transistorsoft: **$399 one-time per app**; since v9 (Mar 2026) a key is needed for **release builds on iOS and Android** [verified, capawesome blog / transistorsoft README] | Transistorsoft RN, same pricing, Expo plugin | Transistorsoft Flutter |
| Dev speed for a web dev | ★★★ | ★★★ | ★★ | ★ |
| Caveat | can't monitor trips | WebView HTTP throttled after 5 min in background on Android; use native HTTP [verified] | Expo Go lacks background location, so use a dev build [verified] | Dart, separate web story |

**Recommendation [inferred]:**
- **MVP:** a React + MapLibre GL JS web app, shipped as a PWA *and* wrapped with **Capacitor** for iOS/Android. Add the community background-geolocation plugin plus a native geofence for arrival detection. One codebase gives the simplest UX.
- **If native map smoothness matters,** go **Expo (React Native) + maplibre-react-native**, with the web build via Expo Router web or a separate Vite web app sharing the TS core (risk model, API client).

---

## 7. Arrival / SOS messaging in India

### 7.1 Regulation: TRAI DLT (mandatory for domestic A2P SMS)
- Every business sending SMS to Indian numbers must register on a telco DLT portal (Jio, Airtel, Vi/VilPower, BSNL, Tata). One registration is valid across all operators. Items to register:
  - **Principal Entity**: KYC with PAN, GST, etc.; fee **~₹5,900 incl. GST**, usually annual and non-refundable.
  - **Header / Sender ID**: 6 characters.
  - **Content templates**: each message must match an approved template.
  - Verification takes ~2–5 days. Scrubbing charges are about 2.5 paise/SMS [secondary, smsgatewayhub].
- **New (TRAI Direction, 18 Nov 2025):** **every variable in a template must be pre-tagged** (`#url#`, `#numeric#`, `#urlott#`, `#cbn#`). URLs and callback numbers must be **pre-whitelisted**. After a 60-day logger period, non-compliant messages are **rejected** [verified, fonearena 2025-11-19; TRAI PR No.133 of 2025].
  - For an SOS message with a live-location link, register a template like `"{#var#} may need help. Live location: {#url#} - SafeRoute"` and whitelist your short-link domain.
- **Twilio** [verified, twilio.com]:
  - India SMS costs **$0.0832/segment**, plus a $0.001 failed-message fee.
  - Domestic traffic needs DLT-registered alphanumeric sender IDs (~10 business days to provision).
  - International-route traffic bypasses DLT and DND but arrives from random short codes.
  - Shortened URLs aren't allowed domestically.
  - It's expensive compared with local aggregators.

### 7.2 Local SMS providers
| Provider | Price | Notes |
|---|---|---|
| **Fast2SMS** | DLT SMS ₹0.25/SMS (₹100–3,999 recharge) down to ₹0.11 (₹6 lakh+); min recharge ₹100; ₹50 signup credit; +18% GST [verified, fast2sms.com/pricing] | "Quick SMS" non-DLT route at a separate rate. Helps with DLT registration. |
| **MSG91** | from ~₹0.18/SMS (₹0.25 → ₹0.16 by volume; negotiable to ~₹0.13); +18% GST [secondary, getpulsesignal] | Also offers WhatsApp, OTP and voice. Good DX. |
| Twilio | ~₹7/SMS ($0.0832) | Global, pricey. |

### 7.3 WhatsApp Business Platform (Cloud API)
- **Per-message pricing since 1 Jul 2025.** India rates [secondary, MyOperator KB, consistent with Meta's rate card]:
  - **Marketing ₹0.86**
  - **Utility ₹0.13**
  - **Authentication ₹0.13**
  - **Service (reply within 24 h of a user message) free**
- An arrival or SOS alert to a trusted contact is a **utility template**, e.g. "{{1}} reached {{2}} safely at {{3}}" or "{{1}} triggered SOS. Location: {{2}}". Templates need Meta approval.
  - The recipient must have opted in. Ask contacts to opt in via a `wa.me` link when they're added.
- **Caveat:** an Indian contact may not have opted in or may not use WhatsApp. Keep SMS as the fallback.

### 7.4 Free fallback: deep links (no DLT, no cost, user sends from own phone)
- **SMS:**
  - Android: `sms:+91XXXXXXXXXX?body=<urlencoded>`
  - iOS: `sms:+91XXXXXXXXXX&body=<urlencoded>` (iOS 8+). Older iOS uses `;body=` [verified, west-wind weblog].
  - Multiple recipients: `sms:+91A,+91B?body=` works on most Android builds; iOS supports it via `sms:/open?addresses=` inconsistently [inferred], so prefer one contact per tap or the native share sheet.
- **WhatsApp:**
  - `https://wa.me/91XXXXXXXXXX?text=<urlencoded>` (international format, no `+`, no leading zeros).
  - `https://wa.me/?text=...` opens the contact picker [inferred, standard click-to-chat].
- **Native:** on Android, Capacitor/RN can send SMS directly with `SEND_SMS` permission. But **Play restricts SMS permissions** to default-SMS-handler apps, with narrow exceptions. Use the intent instead [inferred].
- **Best MVP pattern [inferred]:** "I've arrived" / "SOS" buttons open a pre-filled WhatsApp or SMS with a live-location link (your own short URL to a page showing the trip). There's zero backend messaging cost and no DLT. Add automatic server-sent alerts (WhatsApp utility, then DLT SMS) in v2 for the "didn't arrive in time" dead-man switch.

### 7.5 Emergency numbers and government apps
- **112:** single pan-India emergency number (ERSS). It integrates 100 (police), 101 (fire), 108 (ambulance), 181 and 1090 (women's helplines) [verified, factly.in].
  - **Panic triggers:** smartphones, press power 3×; feature phones, long-press 5 or 9 [verified].
- **112 India app:** sends name, age, emergency contacts and location to the state PSAP. Its **SHOUT** feature alerts registered volunteers nearby [verified].
- **100:** Police (now routed into 112 in most states).
- **1091:** women helpline (police). Delhi Police re-launched **24/7 1091 plus WhatsApp 7835075012** (Nov 2024) [verified, millenniumpost].
- **181:** Women Helpline (MWCD scheme; DV and crisis, 24/7) [verified, myscheme.gov.in/schemes/whl-181].
- **1098:** Child Helpline (now integrated with 112 in many states). 108: ambulance. 1930: cybercrime.
- **Himmat Plus (Delhi Police):** an SOS sends location plus audio/video to the Delhi Police control room. It needs registration with OTP/ID. The App Store version was last updated **v1.0.6 (Aug 2020)** and has too few ratings to display [verified]. Delhi-only. Delhi Police's broader app is **Tatpar**.
- **Integration idea [inferred]:** the SOS screen should show **one-tap `tel:112`** (plus a state-aware number like 1091/181) and a "send location to contacts" action. Never try to auto-dial or fake an integration with 112. There's **no public 112/ERSS API**.

---

## 8. Competitor landscape

| App | What it does | What it doesn't do |
|---|---|---|
| **My Safetipin** (Safetipin, Delhi) | Safety audits on 9 parameters (lighting, walk path, security, public transport, visibility, openness, people, gender usage, feeling), each scored 0–3. Aggregated into a **Safety Score out of 10**. **"Safest Route"** suggestions. Safetipin Nite car-camera audits in Delhi NCR, Mumbai and Bengaluru; data used by Delhi PWD, Police and MCD [verified, safetipin.com] | Data is audit-based and ages. No live "open now". Sparse coverage outside audited cities. No police link. Weak trip monitoring. Not multi-route colour comparison. |
| **Safecity** (Red Dot Foundation) | Anonymous crowd reports of sexual harassment, shown as map hotspots; 10k+ stories across 50+ cities (as of 2017) [verified, deutschland.de] | No routing, no live POIs, no SOS. Possible **data partner** for incident priors. |
| **bSafe** | SOS to guardians with location and audio, "Follow Me" live tracking, timer check-in alarm, fake call; premium ~₹500/yr [secondary] | No routing or safety scoring, no police link. |
| **Life360** | Family location sharing; **SOS and Crash Detection now free** (US-focused) [verified, life360 blog] | No safety-aware routing. Paid tiers and dispatch are US-centric. |
| **Noonlight** | Hold-to-alert button; a monitoring centre dispatches police; timeline. Free / $5 / $10 per month; **US only** [verified, noonlight.com] | Not available in India. No routing. |
| **112 India** | Official SOS to PSAP, SHOUT volunteers [verified] | No routing, no prevention. Response quality varies by state. |
| **Himmat Plus** | Delhi Police SOS with audio/video [verified] | Delhi-only, stale (2020), registration friction. |
| **Raksha** (several apps; e.g. a 2014 BJP-launched Android app; student projects) | SOS to contacts / volume-button trigger [secondary] | Fragmented, mostly abandoned, no routing. |
| **Google Maps** | Live location and trip sharing, two-wheeler mode in India. A **"lighting" layer** was spotted in a 2019 beta, with India rumoured as the pilot [verified, 9to5google, Dec 2019] | **No confirmed public launch** of a lit-streets layer or safety routing found as of Nov 2026 (one 2026 blog claims "well-lit route preferences in supported cities" without a source; treat as unverified). No crowd safety reviews. |

**Gap your app fills:** multi-route safety colour coding, a time-aware risk model (open POIs now, lighting, busyness), verified reviews, and trip monitoring with arrival/SOS, on **web + iOS + Android**, India-first.

---

## 9. Recommended stack: MVP vs production

### 9.1 MVP (1 city, e.g. Delhi NCT; ~₹0–2k/month infra)
| Layer | Choice |
|---|---|
| Client | **React + Vite + TypeScript**, **MapLibre GL JS**, deployed as a **PWA** (route planning on any device) and wrapped with **Capacitor 8** for Android/iOS |
| Background / arrival | `@capacitor-community/background-geolocation` (MIT) during active trips (Android FG service); a destination geofence via the Capawesome Geofences plugin, or a simple distance check during the FG session |
| Tiles | **OpenFreeMap** (no key), with a custom light/dark style; hide international boundaries at low zoom |
| Graph data | Geofabrik **Northern Zone** PBF (206 MB), clipped to the city with osmium; OSMnx/pyrosm to build the walk/drive graph; precompute static edge features (road class, `lit`, sidewalk, POI counts within 50/100 m by category, police/hospital distance, land use) |
| Routing | **Node service with ngraph.path (NBA*)**: cost = `time × (1 + α·risk(e, hour))` for 4 α values plus overlap de-dup (or pgRouting if you prefer SQL) |
| Open-now | OSM `opening_hours` via **opening_hours.js**, plus **category-default hours**, plus an on-demand **Google Places Text Search `openNow:true`** or **Ola Places** for the route corridor only (within free tiers) |
| Busyness | Time-of-day prior from road class, POI density and transit stops |
| Reviews | Supabase (Postgres + PostGIS + Auth with phone OTP) for per-segment ratings (lit / busy / felt safe 1–5, tags), with photo optional; "verified" = phone-verified + GPS-proximity check at submission time + rate limits |
| Messaging | **`wa.me` / `sms:` deep links** with a live-trip share URL; `tel:112` and a state helpline button |
| Hosting | Vercel/Netlify (web), Fly.io/Render (Node router), Supabase free tier |

### 9.2 Production (multi-city, scale)
| Layer | Choice |
|---|---|
| Client | Either keep Capacitor (if UX is good) or move to **Expo (React Native) + maplibre-react-native v10** with a shared TS core and a separate web app; consider a **Transistorsoft licence ($399/app)** for robust background tracking, motion detection and survival after force-quit |
| Tiles | **Self-hosted Protomaps PMTiles** (India extract) on **Cloudflare R2 + CDN**, with an India-compliant boundary overlay (or Mappls tiles where government or enterprise contracts need SoI compliance); offline city packs from the same PMTiles |
| Routing | **GraphHopper 11** self-hosted (per zone), with a forked custom encoded value `safety_static` baked nightly from your feature pipeline; per-request **custom models** for user safety preference and **`areas`** for dynamic time-of-day / incident zones; LM enabled ("increase-only" weights) |
| Risk pipeline | Python (pyrosm/OSMnx, GeoPandas, H3) nightly: OSM + Overture places (POI densification) + crowd reviews + Safecity/Safetipin partnerships + optional streetlight GIS → edge scores per hour bucket; store in PostGIS/Redis |
| Open-now | **Ola Maps Places** (100k free/mo, then ₹25–₹638/1k) or a **Mappls** contract for India POIs; Google Places Enterprise selectively (watch caching ToS); feed back crowd "this shop was open" confirmations |
| Busyness | TomTom flow tiles (200k/mo free) to calibrate arterials; learned hourly priors from anonymised app trip density (opt-in, k-anonymised) |
| Messaging | **WhatsApp Cloud API utility templates** (₹0.13/msg) for auto arrival/overdue alerts, plus **DLT-registered SMS via MSG91/Fast2SMS** (~₹0.15–0.25) as fallback. Register the entity, header and pre-tagged templates (`#url#` whitelisted domain) per the TRAI Nov-2025 direction. Keep deep links as the zero-cost path. |
| Compliance | Play background-location declaration (single feature: "trip safety monitoring"), prominent disclosure, 30 s video; iOS purpose strings; **DPDP Act 2023** consent, data minimisation, deletion; don't store raw location traces longer than needed |
| Observability | Sentry, PostHog (self-host for privacy), uptime checks on router and messaging |

### 9.3 Cost snapshot (monthly, indicative)
- **MVP:** tiles free (OpenFreeMap). Router on a 1–2 GB VM: ~$5–10. Supabase free. Google/Ola within free tiers. Messaging ₹0 via deep links.
- **Production (≈100k MAU) [inferred]:**
  - R2 + CDN for tiles: ~$5–30.
  - GraphHopper per zone (8–16 GB RAM VM): ~$40–100.
  - POI API: Ola ~₹10–50k depending on corridor-query volume.
  - WhatsApp utility at ~2 alerts/trip × 50k trips = ~₹13k.
  - DLT: ₹5,900/yr plus per-SMS cost.

---

## Sources
- GraphHopper custom model docs: https://docs.graphhopper.com/openapi/custom-model.md
- GraphHopper custom models (encoded values, areas): https://github.com/graphhopper/graphhopper/blob/master/docs/core/custom-models.md
- GraphHopper LM per-request note: https://www.graphhopper.com/blog/2022/06/27/host-your-own-worldwide-route-calculator-with-graphhopper/
- GraphHopper releases: https://github.com/graphhopper/graphhopper/releases
- Valhalla API reference (pedestrian costing, exclude_polygons): https://valhalla.github.io/valhalla/api/route/api-reference/
- Valhalla 3.4.0 release (`use_lit`): https://www.github.com/valhalla/valhalla/releases/tag/3.4.0
- Valhalla releases: https://github.com/valhalla/valhalla/releases
- OSRM traffic wiki: https://github.com/Project-OSRM/osrm-backend/wiki/Traffic
- pgRouting workshop: https://workshop.pgrouting.org/2.6/en/chapters/shortest_path.html
- ngraph.path: https://github.com/anvaka/ngraph.path
- Geofabrik India: https://download.geofabrik.de/asia/india.html
- Geofabrik Asia index: https://download.geofabrik.de/asia.html
- Taginfo India: https://taginfo.geofabrik.de/asia:india/ (API: /api/4/key/stats, /key/values, /key/combinations)
- opening_hours.js: https://npmjs.com/package/opening_hours
- opening_hours.js releases: https://github.com/opening-hours/opening_hours.js/releases
- Google Places data fields: https://developers.google.com/maps/documentation/places/web-service/data-fields
- Google Nearby Search (New): https://developers.google.com/maps/documentation/places/web-service/nearby-search
- Google Text Search (New): https://developers.google.com/maps/documentation/places/web-service/text-search
- Google India pricing: https://developers.google.com/maps/billing-and-pricing/pricing-india
- Google India pricing FAQ: https://developers.google.com/maps/billing-and-pricing/india
- Google Routes billing: https://developers.google.com/maps/documentation/routes/usage-and-billing
- Google two-wheeler routing: https://developers.google.cn/maps/documentation/routes/route_two_wheel
- Google Places pricing explainer (secondary): https://openplacesapi.com/blog/google-places-api-pricing
- Ola Maps pricing: https://maps.olakrutrim.com/pricing
- Ola Maps Sept 2026 billing notice: https://maps.olakrutrim.com/pricing/update-2026
- Mappls search APIs: https://about.mappls.com/api/search
- Mappls Nearby docs: https://developer.mappls.com/documentation/sdk/rest-apis/mappls-maps-near-by-api-example/Readme
- India maps API comparison (secondary, vendor): https://maps.guru/blog/best-maps-api-for-india
- TomTom pricing: https://docs.tomtom.com/pricing
- HERE developer portal: https://www.here.com/developer
- Popular Times availability: https://apiserpent.com/blog/google-maps-popular-times-api-data
- OpenFreeMap: https://github.com/hyperknot/openfreemap
- OSM tile usage policy: https://operations.osmfoundation.org/policies/tiles/
- Protomaps FAQ: https://protomaps.com/faq
- PMTiles CLI: https://docs.protomaps.com/pmtiles/cli
- MapLibre Jan 2025 newsletter: https://maplibre.org/news/2025-02-03-maplibre-newsletter-january-2025/
- maplibre-react-native: https://github.com/maplibre/maplibre-react-native
- flutter-maplibre-gl: https://maplibre.org/flutter-maplibre-gl/
- Maps.me removal over India map: https://www.medianama.com/2025/01/223-google-apple-app-stores-remove-navigation-app-maps-me-incorrect-india-map/
- PWA iOS limits: https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide
- Geofence limits/workarounds: https://capawesome.io/docs/blog/how-to-work-around-the-ios-geofence-limit/
- Expo Location: https://docs.expo.dev/versions/latest/sdk/location/
- Play background location policy: https://support.google.com/googleplay/android-developer/answer/9799150?hl=en
- Capacitor community background geolocation: https://www.github.com/capacitor-community/background-geolocation
- Transistorsoft RN plugin: https://github.com/transistorsoft/react-native-background-geolocation
- Transistorsoft pricing comparison: https://capawesome.io/blog/alternative-to-transistorsoft-background-geolocation/
- DLT fees: https://crm.smsgatewayhub.com/knowledge-base/article/dlt-registration-charges-cost-breakdown-in-india
- TRAI variable pre-tagging (Nov 2025): https://www.fonearena.com/blog/469120/trai-mandates-pre-tagging-sms-variables-curb-phishing-misuse.html
- TRAI PR No.133 of 2025: https://trai.gov.in/sites/default/files/2025-11/PR_No.133_of_2025.PDF
- Twilio India SMS pricing: https://www.twilio.com/sms/pricing/in
- Twilio India guidelines: https://www.twilio.com/en-us/guidelines/in/sms
- Fast2SMS pricing: https://fast2sms.com/pricing
- MSG91 pricing (secondary): https://getpulsesignal.com/pricing/msg91
- WhatsApp India per-message rates: https://support.myoperator.com/portal/en/kb/articles/whatsapp-has-shifted-to-per-message-pricing-effective-july-1-2025-based-on-message-categories-and-your-recipient-s-country-in-india-there-are-three-paid-categories
- WhatsApp pricing docs: https://developers.facebook.com/docs/whatsapp/pricing
- sms: URI scheme: https://weblog.west-wind.com/posts/2013/Oct/09/Prefilling-an-SMS-on-Mobile-Devices-with-the-sms-Uri-Scheme
- ERSS / 112 explainer: https://factly.in/explainer-what-is-emergency-response-support-system-erss-or-112
- WHL 181 scheme: https://www.myscheme.gov.in/schemes/whl-181
- Delhi Police 1091 relaunch (Nov 2024): https://www.millenniumpost.in/delhi/delhi-police-launches-247-helplines-for-womens-safety-586799
- Himmat Plus (App Store): https://apps.apple.com/us/app/himmat-plus/id1337677961
- Himmat Plus relaunch (2017): https://www.shethepeople.tv/news/delhi-police-to-relaunch-himmat-plus-with-new-features
- India safety apps roundup (secondary, 2026): https://naariai.pages.dev/articles/personal-safety-apps-indian-women-2026/
- My Safetipin help: https://safetipin.com/my-safetipin-app-help/
- Safetipin Nite: https://safetipin.com/using-safetipin-nite-to-collect-safety-data-in-cities/
- Safecity: https://deutschland.de/en/safecity-aims-to-make-cities-safer-india
- Life360 free safety features: https://www.life360.com/blog/3-safety-features-you-didnt-know-were-free-on-life360
- Noonlight: https://www.noonlight.com/noonlight-app
- Google Maps lighting layer report (2019): https://9to5google.com/?p=327638
- Google Maps lighting layer report (LEDinside): https://ledinside.com/news/2026/08/googleamaps_streetlighting
- NASA Black Marble: https://ladsweb.modaps.eosdis.nasa.gov/missions-and-measurements/science-domain/nighttime-lights/
