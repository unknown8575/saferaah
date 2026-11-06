# SafeRaah — Phase 2 Requirements & Development Plan

## 1. Users
* **Woman travelling alone** (main user) — often at night, last-mile walk or auto from metro.
* **Parent / child** — child walking to tuition/school; parent wants arrival confirmation.
* **Anyone** who wants a safer route.
* **Trusted contact** — receives arrival/SOS messages and opens the live trip link (no app needed).

## 2. Functional requirements

### Planning
| ID | Requirement |
|---|---|
| FR-1 | Search places, metro stations, police/hospitals and streets **offline**; also pick a point by tapping/long-pressing the map, or use "My location". |
| FR-2 | Choose who is travelling (Woman / Child / Anyone), how (Walk / Scooty-bike / Auto / Car) and when (now or a chosen time). |
| FR-3 | Show **up to 4 routes** sorted fastest → safest, each with time, distance, colour tier (dark red / red / yellow / green), a text label and icon. |
| FR-4 | A slower route is shown in the ranked list only if it is measurably safer; near-duplicate routes are never shown twice. |
| FR-5 | Colours reflect each route's actual risk at the chosen time; daytime main roads may all be green. |
| FR-6 | Each route explains itself: share on main roads, open safe places passed (by type), police nearby, risky stretches with reasons (⚠️ markers on the map). |
| FR-7 | "Open now" uses the place's opening hours when mapped, else Delhi-typical hours marked *estimated*. |
| FR-8 | When walking is risky on every route and the trip is >700 m, suggest switching to auto/cab with its time. |
| FR-9 | Show safe places near me (police, hospitals, medical stores, petrol pumps, metro) with open/closed state and walking distance. |

### Journey
| ID | Requirement |
|---|---|
| FR-10 | Start a journey on the chosen route; show remaining time/distance and next turn. |
| FR-11 | Detect arrival inside a geofence: 10 m target widened by GPS accuracy (15–40 m). |
| FR-12 | On arrival, send a message to chosen contacts ("Reached safely") via SMS/WhatsApp link (or server SMS if configured). |
| FR-13 | Off-route detection after 3 consecutive fixes >50 m away; offer to re-route. |
| FR-14 | "Are you OK?" check-in when stopped ≥4 min on a red/yellow stretch (≥10 min on green) or 10 min past the expected arrival; 30 s countdown then SOS. |
| FR-15 | SOS button always visible: message contacts with live link + location, one-tap call 112 / 1091 / 181 / 1098. |
| FR-16 | Live trip link for contacts showing latest position, route, ETA and status (active / arrived / SOS). |

### Reviews
| ID | Requirement |
|---|---|
| FR-17 | After arrival, ask "How safe did this route feel?" (1–5) with quick tags (well lit, busy, dark, deserted, harassment…). |
| FR-18 | A review is accepted only if the trip entered the destination geofence, covered ≥80% of the route, had no impossible GPS jumps, and wasn't implausibly fast. |
| FR-19 | Each device counts once per street segment; one review per journey; only the traveller's device can review. |
| FR-20 | Crowd data changes a segment only after ≥5 distinct travellers (warnings) or ≥10 (marking safer); Bayesian average; 90-day half-life. |

### Settings
| ID | Requirement |
|---|---|
| FR-21 | Manage up to 5 trusted contacts (name + phone), stored on the device. |
| FR-22 | Built-in help: short animated guides (GIF) for each main task. |
| FR-23 | Works in Hindi/English labels for places where OSM has them (English UI in this version). |
| FR-24 | Live safety reports (v1.2): report what is happening where you are (no lights, deserted, harassment, drunk group, followed, stray dogs, police patrol); others confirm or dismiss; expire after 2–12 h; raise (or, for patrols, lower) street risk within 60 m for everyone's routing; reporter must be within 300 m; duplicates within 80 m merge; ≤ 6 per device per hour. |
| FR-25 | Live street-safety layer: every street in view coloured by its risk at the chosen time; open/closed places refresh every minute; optional live traffic layer with a provider key. |
| FR-26 | Map-first like Google/Apple Maps: live blue dot with accuracy circle and heading, locate button, search bar over the map, tap anywhere for a place card (name/street, distance, open now, street safety now), category chips, choose start/destination on the map with a centre pin; when GPS is unavailable say so and let the user mark their position. |
| FR-27 | Directions: start = your location by default, swap, a time for every travel mode, the fastest route selected first, every route showing its precautions (card line, full list in details) and a time label on the map; the user decides. |
| FR-28 | Navigation: heading-up follow mode with re-centre and compass; leaving the route re-plans from the current position keeping the user's choice (fastest/safest) and updates the live link; every 5 min offer a clearly safer route if one appears. |
| FR-29 | Spoken turn-by-turn guidance (English) with mute; a navigation island showing next turn, distance and ETA; in the Android app an ongoing navigation notification promoted to an Android 16 Live Update. |
| FR-30 | Privacy: location stays on the phone; trip GPS points, route, destination and name are deleted when the trip ends; after-trip questions (2, optional) are anonymous per-street votes; reports and leftovers are purged on schedule; user can wipe all data on the phone. |
| FR-31 | Search by kind of place (gym, grocery/kirana, chemist, salon, café, ATM…, English and common Hinglish): show the nearest 5–7 with open state; if that kind is not mapped nearby, show similar places; all on the map on Enter; also in the start/destination fields. |

## 3. Non-functional requirements
| ID | Requirement |
|---|---|
| NFR-1 | All 4 routes computed in < 500 ms on a mid-range phone (target < 150 ms on desktop). |
| NFR-2 | First load ≤ 6 MB compressed; works offline after first load (service worker). |
| NFR-3 | Usable at 360 px width; touch targets ≥ 44 px; text ≥ 14 px; colour never the only signal. |
| NFR-4 | Privacy: route planning on device; server stores only started journeys; share links are unguessable (128-bit). |
| NFR-5 | API validates all input, limits body size (512 KB), rate-limits per IP and device. |
| NFR-6 | All safety logic uses Delhi time (IST) regardless of device timezone. |
| NFR-7 | No paid API required to run; paid places/SMS providers are optional adapters. |
| NFR-8 | Map data attribution (© OpenStreetMap contributors, ODbL) visible. |

## 4. Out of scope (this version)
Turn-by-turn voice; public transport routing; real-time traffic; crime data (not published geocoded); automatic police dispatch.

## 5. Development steps
1. **Data pipeline** — OSM GeoJSON → `graph.bin` (nodes, segments, static safety features), `pois.json`, `search.json`, `version.json`. ✅
2. **Basemap** — OpenMapTiles vector tiles for Delhi NCT, split into 17 area packs that load on demand; MapLibre custom protocol. ✅
3. **Core logic (shared/)** — geometry, time (IST), opening hours, risk model, A* router + tiering, advice, journey monitor. ✅ (first pass)
4. **Server** — journeys, fixes, finish/verify, reviews, crowd stats, live share, SOS, static hosting. ✅ (first pass)
5. **Web app** — map, search, plan sheet, route list, details, journey screen, check-in, SOS, arrival + review, contacts, safe places, live trip viewer, help.
6. **Router in a web worker** so the UI never freezes.
7. **PWA** — manifest, service worker, icons; **Capacitor** config for Android/iOS (background geolocation, local notifications).
8. **Tests** — unit (vitest), API, end-to-end in headless Chrome.
9. **GIF manual** — scripted demo recorded to short GIFs.
10. **Final build** — production bundle, server start script, Android/iOS project instructions, release checks.
