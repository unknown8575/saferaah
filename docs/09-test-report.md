# SafeRaah — Test Report (Phases 6, 7 and 9)

Final run on the release build covering all of Delhi NCT, 6 Nov 2026.

| Suite | Result |
|---|---|
| TypeScript typecheck | clean |
| Unit tests (vitest, machine timezone forced to UTC) | 55 / 55 passed |
| API tests (real server, fresh SQLite) | 14 / 14 passed |
| End-to-end (headless Chrome, 390×844 phone, 360 px, 1280 px desktop) | 12 / 12 passed |

Every case in `docs/05-test-cases.md` is automated; TC-76 (CORS) and TC-102 (offline PWA) were added during Phase 9.

## Defects found and fixed

| # | Found by | Defect | Fix |
|---|---|---|---|
| 1 | router smoke test | Graph loader read garbage coordinates in Node: `Buffer#slice` returns a pooled view, not a copy | Copy with `Uint8Array.prototype.slice` |
| 2 | router smoke test | `opening_hours` throws on any `PH` (public holiday) rule — no Indian holiday calendar | Strip PH rules before parsing (TC-04) |
| 3 | calibration review | Risk too flat: busy daytime main roads came out "Take care"; safer alternatives barely safer | Hour-of-day scale τ(t); stronger busy/lit contrast; distinct-safety filter |
| 4 | screen tour | Two near-identical routes shown (same time, same risky stretches) | Replace a ≥75%-overlapping, equally fast route with the safer twin |
| 5 | screen tour | Alternatives listed out of time order | Sort alternatives by time |
| 6 | screen tour | Green tier label "Safest" clashed with the "Safest" route tag | Tier renamed "Low risk" |
| 7 | screen tour | Directions said "Continue onto the road" for unnamed streets | Natural phrasing ("Turn left into the lane") |
| 8 | first browser run | Map tiles never loaded: MapLibre 6 worker served as `application/octet-stream` | Correct `.mjs` MIME type; explicit worker URL |
| 9 | first browser run | Night/day style switch removed overlay sources mid-update | Overlay data kept and re-applied after every style change |
| 10 | demo journey | Accelerated demo trips were (correctly) rejected for review, but with a confusing reason | Demo trips flagged; server always refuses them with a clear message (TC-68) |
| 11 | API test TC-65 | Server accepted rating `"5"` (string) and used up the journey's only review | Strict integer validation |
| 12 | E2E TC-98 | Long-press to set destination didn't exist on iOS (no `contextmenu` on touch) | Own long-press detection |
| 13 | E2E TC-100 | Inline "Add a trusted contact" link under 36 px tap height | 44 px minimum |
| 14 | GIF recording | SOS button covered the turn instruction during a journey | SOS positioned from the sheet's measured height |
| 15 | GIF recording | False "Could not get your location" toast while GPS was working | Only warn after 60 s with no fix; permission errors still immediate |
| 16 | NFR-2 review | Offline launch impossible: hashed JS/CSS never cached on first visit | App caches its own bundles once the service worker is ready (TC-102) |
| 17 | native build review | Native apps (origin `capacitor://localhost`) could not reach the API | CORS for app origins only (TC-76); `VITE_API_BASE` |

## Performance (build machine, 2 vCPU)

* All four routes for a 5 km trip: 30–90 ms (TC-28 asserts < 500 ms).
* Graph load: ~50 ms. Data pipeline: ~4 s. Basemap: 281 tiles.
* Download on first visit (gzip): graph 2.3 MB, basemap 4.3 MB, app JS ~0.5 MB. Help GIFs (2.5 MB) load only when Help is opened.

## Not covered by automated tests

* Real devices: actual GPS behaviour, background tracking on locked Android/iOS phones, and native builds (Android Studio/Xcode were not available in the build environment).
* Real SMS delivery (requires DLT registration and a provider account).
* Field validation of the risk scores against real women's experience — the most important next step.

## Whole-Delhi update (v1.1)

Coverage grew from central Delhi (206 km²) to all of Delhi NCT (~2,700 km² including border margins). The graph format changed to junction nodes plus edge geometry, which keeps 2 million road points in a 400k-node graph.

| # | Found by | Defect | Fix |
|---|---|---|---|
| 18 | data review | Map tiles hold only ~2,300 buildings for all Delhi; mixing in the dense central-Delhi building data would have made central areas look safer | One uniform "activity" signal (mapped places, stops, schools, buildings) for the whole city |
| 19 | screenshot review | A green alternative route was labelled "Alternative" while the yellow fastest route was the only ranked one | Alternatives that are clearly safer join the fastest→safest list |
| 20 | screenshot review | Hundreds of hospital/police dots cluttered the city-wide view | Shown from zoom 13 (others from 15) |
| 21 | screenshot review | "3 polices" | Proper singular/plural nouns |
| 22 | search test TC-82 | "India Gate" not found: landmarks, markets, parks and colleges were missing from offline search | Indexed (search grew from 26,650 to 34,797 entries) |
| 23 | E2E TC-96 | Demo pause landed on a low-risk stretch, where the app correctly waits 10 min (not 4) before asking | Test pause length made configurable; behaviour unchanged |
| 24 | font regression | MapLibre requires `{fontstack}` in the glyph URL; a space-free path broke the style | Font stack renamed `noto` |

Speed on the whole-Delhi graph (build machine): graph load 0.15 s; risk field 0.1–0.35 s; walking trips 50–170 ms; 25–30 km drives ≈ 1 s for all routes.

## Map-first redesign and live layers (v1.2)

The app was rebuilt to behave like Google/Apple Maps: map first with a live blue dot (accuracy circle, heading cone, locate button), a search bar over the map, tap anywhere for a place card, category chips, Directions with Your location / swap / choose-on-map, a time for each travel mode, the fastest route selected by default with per-route precautions and time labels on the map, heading-up navigation with automatic re-routing and safer-route offers, and live layers (street safety now, live reports, open places refreshed every minute, optional traffic).

| # | Found by | Defect | Fix |
|---|---|---|---|
| 25 | user feedback | Start/destination could only be picked from the search list; no real "where I am" | Live blue dot; tap anywhere; choose on map with a centre pin; manual "I am here" when GPS is unavailable |
| 26 | user feedback | The safest route was pre-selected, hiding the fastest | Fastest selected first; every route shows what precautions it needs; the user decides |
| 27 | screenshot review | Shop and eatery dots cluttered the map at street zoom | Police/hospitals from zoom 13, medical stores/metro/petrol from 15, shops only from 17 |
| 28 | screenshot review | Night basemap drew main roads in yellow, which read as "take care" next to the safety colours | Neutral lavender main roads at night |
| 29 | screenshot review | Route time labels floated over the bottom sheet | Map placed in its own stacking layer |
| 30 | screenshot review | Long place names pushed "Open" pills off screen in category lists | Grid columns allowed to shrink; names truncate |
| 31 | code review | Rotated pin shapes were overwritten by the map library's marker positioning | Shapes moved into an inner element |
| 32 | E2E TC-106 | A single unconfirmed report on a busy main road does not create a "risky stretch" (correct), so the test expected the wrong signal | Test checks the route's risk rises instead |

New tests: 12 unit/API cases for live reports, precautions, mode times and re-routing (TC-110–114, TC-120–126) and 6 end-to-end cases (TC-103–108). Totals: 81 unit + API tests, 18 end-to-end cases.
