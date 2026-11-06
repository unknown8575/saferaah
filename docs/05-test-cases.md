# SafeRaah — Phase 5 Test Cases

Each case is automated. **U** = unit test (vitest, `tests/unit`), **A** = API test against a real server on a random port with a fresh SQLite DB (`tests/api`), **E** = end-to-end in headless Chrome at phone size (`tests/e2e`). "Normal" cases check the expected path; "Edge" cases check boundaries, bad input and abuse.

## Time & opening hours
| ID | Type | Case | Expect | Req |
|---|---|---|---|---|
| TC-01 | U normal | IST conversion on a UTC machine | 18:00 UTC = 23:30 IST; band night | NFR-6 |
| TC-02 | U edge | Darkness ramps at dusk (17:30–19:00) and dawn | 0 at noon, 1 at 23:00, 0<x<1 at 18:15 | — |
| TC-03 | U normal | Tagged pharmacy `Mo-Sa 09:00-21:00` | open Tue 20:00 IST, closed 22:00, verified | FR-7 |
| TC-04 | U edge | Rules containing `PH` (no Indian holiday calendar) | parsed without throwing, PH ignored | FR-7 |
| TC-05 | U edge | Malformed `opening_hours` | falls back to category default, not verified | FR-7 |
| TC-06 | U normal | Untagged police / hospital | open at 03:00 (24×7) | FR-7 |
| TC-07 | U edge | Untagged bank on Sunday | closed | FR-7 |
| TC-08 | U edge | Overnight `22:00-02:00` window | open at 01:00 | FR-7 |

## Risk model
| ID | Type | Case | Expect | Req |
|---|---|---|---|---|
| TC-10 | U normal | Same street, 13:00 vs 23:30 | night risk > day risk for ≥95% of streets | FR-5 |
| TC-11 | U normal | Main roads vs lanes at night | median primary < median residential < median footway | FR-5 |
| TC-12 | U normal | Open places lower risk | a street with open havens has lower risk than when they are closed | FR-7 |
| TC-13 | U edge | Liquor shop open at night | raises risk vs same street without it | — |
| TC-14 | U edge | Crowd reviews below threshold (4 warnings) | no effect | FR-20 |
| TC-15 | U normal | 5+ distinct travellers warn | risk rises; 10+ needed to mark safer | FR-20 |
| TC-16 | U edge | Child profile on trunk roads | risk higher than woman profile | FR-2 |
| TC-17 | U edge | All risks within [0, 1] for every street at 6 times of day | true | — |

## Routing
| ID | Type | Case | Expect | Req |
|---|---|---|---|---|
| TC-20 | U normal | Night walk Lajpat Nagar → Giri Nagar | ≥3 ranked routes; time ↑ and risk ↓ along ranked list | FR-3, FR-4 |
| TC-21 | U normal | Any returned set | ≤4 routes; no two share >85% length | FR-4 |
| TC-22 | U normal | Ranked routes ≤1.6× fastest time (or +4 min) | true | FR-4 |
| TC-23 | U normal | Tier colours follow absolute risk; daytime main-road trip all green | true | FR-5 |
| TC-24 | U edge | Start == destination | one route of ~0 m, no crash | — |
| TC-25 | U edge | Point outside coverage / middle of the Yamuna | clear error message, no routes | FR-1 |
| TC-26 | U edge | Car never uses footway/steps; walk never uses motorway; auto never uses motorway | true | FR-2 |
| TC-27 | U edge | One-way street (synthetic graph) | car respects direction; walk may go both ways | — |
| TC-28 | U normal | 4 routes computed fast | < 500 ms on the build machine | NFR-1 |
| TC-29 | U normal | Explanation fields | havens, police share, danger spots with reasons | FR-6 |
| TC-30 | U normal | Walking at 23:30 is risky everywhere | advice suggests auto with its time | FR-8 |
| TC-31 | U normal | Turn-by-turn steps | start step, ≥1 turn, final "arrived"; distances sum ≈ route length | FR-10 |
| TC-32 | U normal | Whole Delhi: Narela→Najafgarh (scooty), Dwarka→Laxmi Nagar (auto), Mangolpuri→Sultanpuri (walk) | routes found in < 4 s, length between crow-flight and 2.2× | FR-3 |
| TC-33 | U edge | Real one-way streets on four trips by car/auto/scooty | every one-way segment travelled in its direction (> 20 checked) | FR-2 |
| TC-34 | U normal | Route geometry follows the real road shape | more points than segments; drawn length within 2% of route length | FR-3 |

## Journey monitor
| ID | Type | Case | Expect | Req |
|---|---|---|---|---|
| TC-40 | U normal | Fix 8 m from destination, accuracy 5 m | arrived | FR-11 |
| TC-41 | U edge | Fix 30 m away, accuracy 25 m (urban drift) | arrived (radius widened to 35 m) | FR-11 |
| TC-42 | U edge | Fix 45 m away, accuracy 50 m | not arrived (radius capped at 40 m) | FR-11 |
| TC-43 | U normal | 3 consecutive fixes 120 m off route | one `off_route`, then `back_on_route` | FR-13 |
| TC-44 | U edge | 2 off-route fixes then back | no `off_route` (noise) | FR-13 |
| TC-45 | U normal | Stationary 4 min on red stretch | `stopped` check-in | FR-14 |
| TC-46 | U edge | Stationary 4 min on green stretch | no alert until 10 min | FR-14 |
| TC-47 | U normal | ETA + 25% + 10 min passes without arrival | `overdue` once | FR-14 |
| TC-48 | U edge | Out-of-order / duplicate timestamps | ignored | — |
| TC-49 | U edge | 1 km jump in 5 s while walking | `gps_jump`, counted | FR-18 |
| TC-50 | U normal | Track covering the whole route | coverage ≥ 0.95, eligible | FR-18 |
| TC-51 | U edge | Track covering 60% then jumping to destination | not eligible (coverage + jump) | FR-18 |
| TC-52 | U edge | Arrived in 20% of ETA | not eligible (implausibly fast) | FR-18 |

## Server API
| ID | Type | Case | Expect | Req |
|---|---|---|---|---|
| TC-60 | A normal | Start → fixes → finish on an honest track | eligible, review token issued | FR-18 |
| TC-61 | A normal | Submit review with token | 200; edge votes stored | FR-17 |
| TC-62 | A edge | Second review for the same journey | 409 | FR-19 |
| TC-63 | A edge | Review from another device | 403 | FR-19 |
| TC-64 | A edge | Review without/with wrong token, or ineligible trip | 403 | FR-18 |
| TC-65 | A edge | Rating 0, 6, 3.5, "5" string | 400 for invalid values | FR-17 |
| TC-66 | A normal | Same device reviews same streets twice (two trips) | counts once per segment | FR-19 |
| TC-67 | A normal | Crowd stats decay: a 90-day-old vote weighs 0.5 | true | FR-20 |
| TC-68 | A edge | Simulated (demo) trip | never eligible | FR-18 |
| TC-69 | A normal | Live share shows last position, status changes to sos/arrived | true | FR-16 |
| TC-70 | A edge | Fixes from the future (> now + 60 s) or before start | dropped | FR-18 |
| TC-71 | A edge | Bad JSON 400; body > 512 KB 413; missing device id 400; unknown endpoint 404 | true | NFR-5 |
| TC-72 | A edge | Rate limit exceeded | 429 | NFR-5 |
| TC-73 | A edge | Static path traversal `/../server/app.ts` | not served | NFR-5 |
| TC-74 | A edge | Invalid route/mode/ETA on journey start | 400 | NFR-5 |
| TC-75 | A edge | Unknown share id | 404 | FR-16 |
| TC-76 | A edge | CORS: native app origins allowed, other origins not | true | NFR-5 |

## Other units
| ID | Type | Case | Expect | Req |
|---|---|---|---|---|
| TC-80 | U normal | Phone numbers `98765 43210`, `09876543210`, `+919876543210` | `+919876543210` | FR-21 |
| TC-81 | U edge | `12345`, `5876543210`, letters | rejected | FR-21 |
| TC-82 | U normal | Search "lajpat" | metro/police/market results first | FR-1 |
| TC-83 | U edge | Search 1 char, gibberish, mixed case / punctuation | [], [], matches | FR-1 |
| TC-84 | U normal | SMS / WhatsApp / SOS texts | correct scheme, encoded body, location link | FR-12, FR-15 |
| TC-85 | U normal | Graph file round-trip; corrupt file rejected | true | — |

## End-to-end (headless Chrome, 390×844 phone)
| ID | Type | Case | Expect | Req |
|---|---|---|---|---|
| TC-90 | E normal | First run: intro → add 2 contacts (one invalid number first) | error shown, then 2 saved | FR-21 |
| TC-91 | E normal | Search "India Gate" + "Rajiv Chowk" via UI, Show safe routes | 1–4 route cards with tier labels; lines on map | FR-1, FR-3 |
| TC-92 | E normal | Night trip via URL | night theme, advice shown, ranked labels | FR-5, FR-8 |
| TC-93 | E normal | Route details | facts, havens, contacts toggles, directions | FR-6 |
| TC-94 | E normal | Real-time trip with mocked browser GPS along the route (car, short) | arrival screen, "Tell … you reached" SMS link, review submitted | FR-10–12, FR-17 |
| TC-95 | E normal | Contact opens live-trip link during the trip | status "On the way" → "Reached safely" | FR-16 |
| TC-96 | E normal | Stop on route (demo pause) | "Are you OK?" countdown → no answer opens SOS with Call 112 | FR-14, FR-15 |
| TC-97 | E edge | Server down | planning still works; journey says live sharing unavailable | NFR-4 |
| TC-98 | E edge | Outside-coverage map pick | toast explains coverage | FR-1 |
| TC-99 | E normal | Safe places nearby, Help page with GIFs | lists open/closed; 6 guides load | FR-9, FR-22 |
| TC-100 | E edge | Every button/link has an accessible name; no horizontal scroll at 360 px | true | NFR-3 |
| TC-101 | E normal | Desktop 1280 px | side panel layout | NFR-3 |
| TC-102 | E normal | After one visit, reload with the network off | app opens and plans routes | NFR-2 |
