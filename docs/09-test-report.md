# SafeRaah — Test Report (Phases 6, 7 and 9)

Final run on the release build, 6 Nov 2026.

| Suite | Result |
|---|---|
| TypeScript typecheck | clean |
| Unit tests (vitest, machine timezone forced to UTC) | 52 / 52 passed |
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
