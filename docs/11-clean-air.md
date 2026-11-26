# 11 — Clean air: routes, live AQI and the Saans assistant

**Problem.** Delhi families breathe some of the most polluted air in the world, and most of what they can control is *when* they go out, *which way* they go, and what happens *inside the home*. SafeRaah already chooses streets for safety; this release makes it choose streets, hours and habits for cleaner air too, and explains the impact of each choice in numbers.

## 1. Before and after

| | Before | After |
|---|---|---|
| Home screen | Safety status only | Live **Indian National AQI** card (value, band, PM2.5, × WHO guideline) |
| Routes | Fastest → safest, coloured by safety | Same routes, each with **PM2.5 breathed**; a **Cleanest air** route when one is clearly better; named industrial areas avoided; honest note when the fastest is also cleanest |
| Reports | Safety problems | Plus **garbage burning, construction dust, smoke** — clean-air routes avoid them |
| Advice | — | **Saans**: next-24-hours plan for the family, indoor fixes (purifier size, cooking smoke, incense), masks, school runs, greener swaps with CO₂ saved |

## 2. Street air model (`pipeline/build-air.ts`, `shared/air.ts`)

City-level PM2.5 comes from the CAMS forecast (cells ~10–45 km). It cannot tell one street from the next, so we add a **street factor F(e)** from OpenStreetMap:

| Source | Effect on F | Fades over |
|---|---|---|
| Road class of the street itself | motorway +60 %, trunk +55 %, primary +45 %, secondary +30 %, tertiary +12 %; footpaths −5…8 % | — |
| A busy road nearby (for quieter streets) | up to +25 % | 150 m |
| Industrial / quarry / construction land | up to +50 % | 600 m |
| Landfill (Ghazipur, Bhalswa, Okhla) | up to +60 % | 1.5 km |
| Inside a park / beside a large park | −10 % / −5 % | — |
| Live air report (burning, dust, smoke) | +0.4 … +0.6 × report strength | 80 m full, 250 m zero |

F is clamped to 0.7–2.2. Distances are computed once for the whole city on a 50 m raster with a two-pass chamfer distance transform (1,070 × 1,090 cells, ~2 s), sampled at both ends and the middle of each of the 532,890 street segments, and stored in `air.bin` (2.6 MB). 22,000+ segments carry the name of the industrial area or landfill they pass (from OSM locality names such as "Wazirpur Industrial Area", "Okhla Phase II", "Mayapuri Industrial Area I").

**Dose** on a route = Σ PM2.5_city × F(e) × cabin(mode) × breathing(mode) × time(e):

| Mode | Breathing (m³/h) | Cabin ratio |
|---|---|---|
| Walk | 1.4 | 1.0 |
| Two-wheeler | 0.8 | 1.15 (in the exhaust stream) |
| Open auto | 0.7 | 1.05 |
| Closed car | 0.6 | 0.6 (windows up, recirculation) |

**Router.** One extra A* search per request with cost c(e) = T(e)·(F(e)/0.7)^1.5·(1 + 0.5·E_mode·R(e)) — proportional to dose (slightly steeper so smoky peaks count), never below T, so the A* heuristic stays admissible; safety still counts a little. Its result joins the list if it is not a near-copy (overlap < 85 %), is within the detour cap, and breathes ≥ 3 % less than every route offered. The lowest-dose route is labelled **Cleanest air** if it beats the fastest by ≥ 3 %; otherwise the fastest is marked *Also cleanest* and the app says "less time outside beats a detour".

### Results on real trips (09:30, background 180 µg/m³)

| Trip | Fastest | Cleanest air | Saving |
|---|---|---|---|
| Mayapuri → Janakpuri (auto) | 24.5 min, F 1.27, passes Mayapuri Ind. Area | 25.1 min, F 1.15, busy-road metres 1,543 → 505 | **7 % less PM2.5** for 36 s more |
| CP → India Gate (walk) | 36.8 min, F 1.31 | 37.7 min, F 1.20, avoids construction land | **6 % less** for 54 s more |
| Okhla Phase I → Sarita Vihar (walk) | 51 min, F 1.81 through Okhla Ph I/II and landfill | — | fastest is already cleanest |

These are model estimates, not measurements; we show them as estimates in the app.

## 3. Indian National AQI (CPCB)

Sub-indices from PM2.5 (0–30–60–90–120–250 µg/m³) and PM10 (0–50–100–250–350–430) breakpoints, linear within a band; the larger one is the AQI. Bands: Good, Satisfactory, Moderate, Poor, Very Poor, Severe, each with plain advice.

## 4. Saans assistant

```
question ──► retrieve notes ──► compute facts ──► Gemini writes ──► answer + [n] citations
             BM25 + clusters     plan.ts (code)     (server, key)        │
             + Gemini embeddings                     else built-in ◄─────┘
```

* **Knowledge base** (`shared/saans/knowledge.ts`): 33 short notes, each with a source (WHO, CPCB, US EPA, AHAM, CAQM, peer-reviewed studies), grouped into five **topic clusters**: going out, at home, family health, cleaner swaps, Delhi air.
* **Retrieval** (`retrieve.ts`): Hinglish normalisation (bachche → children, khansi → cough, dhuan → smoke…), BM25 over title + text + tags, cluster detection (sum of squared scores per cluster; the winning cluster gets a 15 % boost), and — when the server has a Gemini key — a **vector search**: every note is embedded once with `gemini-embedding-001`, the question is embedded per request, and the final score is 0.5·BM25(normalised) + 0.5·cosine. The intent of the question (plan, purifier, route, swaps, mask) also pins the one note it needs.
* **Facts** (`plan.ts`): the cleanest and dirtiest 2-hour windows from the hourly forecast and the % less PM2.5 per breath between them; purifier CADR = floor area × 3 m × 5 air changes/h; commute CO₂ per month for each swap (car 0.17, auto 0.07, two-wheeler 0.05, bus 0.04, metro 0.03 kg/person-km; 22 working days); family-specific steps (children, elders, asthma, pregnancy, cooking fuel); the selected route's % saving and the areas it avoids.
* **Generation** (`server/ai.ts`): Gemini gets a system instruction (use only numbers in FACTS, cite notes as [n], ≤ 140 words, reply in the user's language, not a doctor, emergencies → 112), the last four turns, the FACTS and the numbered NOTES. Output is tidied (no headings) and returned with the note list so the app can show sources.
* **Built-in engine** (`assistant.ts` `compose`): the same notes and facts with intent-specific templates, used when there is no key, Gemini fails, or the phone is offline. The answer card says which engine answered.
* **Safety and cost**: questions ≤ 500 characters, 20 questions per 10 minutes per phone (pseudonymous key), every field the app sends is clamped, keys live in server environment variables and travel in headers, never in URLs or the app bundle.

### Nearby places for clean-air needs

"Plant nurseries near me", "where can I buy an air purifier", "N95 mask kahan milega": a question is treated as a place look-up only when it names a kind of place *and* has a "near / where / buy / kahan" cue. The phone searches its own index of 26,000 mapped places (`nearbyFor`) around the user's position and sends the server only names, kinds, distances rounded to 50 m and open/closed — never coordinates. Gemini is told to recommend only from that list; the app shows the places as cards with a directions button. For plants, Saans also says honestly that plants don't clean room air measurably.

## 5. Privacy

The air reading is requested for a ~10 km cell (position rounded to 0.1°). The family profile is stored only in the phone's local storage and removed by "Delete my data on this phone". Conversations live in memory and vanish when the app closes; the server neither logs nor stores questions or answers.

## 6. Limits

* CAMS forecasts are coarse and can miss local spikes; street factors are rounded from literature, not calibrated on Delhi sensors. Next step: calibrate against CPCB/DPCC station data and low-cost sensor networks.
* Only three landfills; power plants, brick kilns and small industrial units outside zoned estates are not mapped.
* Dose ignores time inside metro stations and wind direction.
