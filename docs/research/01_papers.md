# 01 — Literature review: safety-aware routing for women and children (Delhi first)

Compiled 2026-11-06. All summaries are paraphrased. "Evidence strength" notes are my own judgement.
Source URLs are the ones actually opened or found during this research. Where I could not open a full text, the note says so.

---

## 0. TL;DR for the team

1. **The algorithm side is solved; the risk model is not.** Bi-objective routing (length vs. risk), alternative route generation (penalty / via-node / plateau / dissimilar-k-paths) and Pareto approximations are mature and run fast on city graphs. No paper gives a *validated* edge-risk formula for women's safety. Every safe-routing paper we found either uses crime counts only or hand-picked weights with no outcome validation.
2. **Lighting** has the strongest causal evidence: an RCT in NYC found about a 36% drop in outdoor nighttime index crimes (net of spillover). Meta-analyses show a smaller average effect (about 14%), mostly on property crime, with no significant effect on violent crime. Lighting matters even more for *perceived* safety and for whether people walk at all.
3. **"Eyes on the street" is supported for perception and contested for crime.** Indian studies consistently find that vendors, open shops, other women and police make women *feel* safer. Criminology finds that commercial places can also *generate* street crime, and that the effect depends on opening hours. Your "must be OPEN now" rule is well supported.
4. **Time of day is the largest single modifier.** Darkness multiplied street robbery by about 2.6 in London. It cuts pedestrian numbers roughly in half, and by much more on unlit paths. Delhi audit data show 27% of locations are fully deserted at night and 70% are deserted or male-only. Harassment reports, however, also peak in the daytime and evening (crowded buses and markets). Crowding is not purely protective.
5. **Women accept large detours.** In a Delhi study, women would accept about 40% more travel time for a route one standard deviation safer. That justifies a "safest" option up to about 1.5× the fastest route's length. Other systems cap it at 10–12%.
6. **Crowdsourced ratings need Bayesian shrinkage plus Sybil defenses.** A single script ran 1,000 fake Waze "vehicles". Use a Beta/Bayesian prior with a minimum count, trajectory-verified reviews, per-user reliability weighting and time decay.

---

## 1. Safe-routing and alternative-route algorithms

### 1.1 Galbrun, Pelechrinis, Terzi — "Safe Navigation in Urban Environments" / "Urban navigation beyond shortest route: The case of safe paths"
- **Venue / year:** UrbComp workshop at KDD 2014; journal version in *Information Systems* (Elsevier) 57, 2016.
- **URL:** https://www.cs.uic.edu/~urbcomp2013/urbcomp2014/papers/Galbrun_Safe%20Navigation.pdf · https://hal.archives-ouvertes.fr/hal-01399249
- **What it does:** This is the canonical "SafePaths" paper. It models each OSM edge with length ℓ(e) and risk r(e), where r(e) comes from a Gaussian kernel density of crime incidents. It defines two problems:
  - **TOTAL-PATHS**: minimise path length and the total risk along the path.
  - **MAX-PATHS**: minimise path length and the worst single edge on the path.
  Instead of one route, it returns a small set of non-dominated routes.
- **Useful for us:**
  - *Sum-Recursive* finds the lower convex hull of the Pareto front by repeatedly running Dijkstra on the edge weight r(e) + λ·ℓ(e). Each new λ is the slope between two routes already found. This method maps directly onto a "fastest → safest" colour ramp.
  - *MAX-PATHS* is the right model for "avoid the one deserted underpass" situations.
  - The paper uses ellipse pruning and early stopping. A front capped at 8 paths with γ = 0.1 kept about 80% of the exact front's quality.
  - In their example, the safest route was about 1.5× the length of the shortest.
- **Weak points:** The risk model uses crime counts only. Time of day is ignored. Normalising by footfall is proposed but not done.

### 1.2 Levy, Xiong, Belding, Wang — "SafeRoute: Learning to Navigate Streets Safely in an Urban Environment"
- **Venue / year:** arXiv 1811.01147, 2018 (UCSB).
- **URL:** https://arxiv.org/abs/1811.01147
- **What it does:** A reinforcement-learning policy chooses one of 8 compass directions at each intersection. States are node2vec embeddings. The model is first trained to imitate Dijkstra, then fine-tuned with REINFORCE. The reward is distance from recent crimes divided by path length. Data: Boston, NYC and SF.
- **Useful for us:** The idea of avoiding *small* hotspots that KDE smoothing blurs away. The evaluation metric (average distance from crime points along the route, plus length) is cheap to compute.
- **Weak points:** RL is overkill for us. A deterministic graph search is easier to explain and debug, and it guarantees the route reaches the destination. Use the paper as a source of metrics, not as an architecture.

### 1.3 Shah, Bao, Lu, Chen — "CROWDSAFE: Crowd Sourcing of Crime Incidents and Safe Routing on Mobile Devices"
- **Venue / year:** ACM SIGSPATIAL GIS 2011 (demo).
- **URL:** https://people.cs.vt.edu/ctlu/Publication/2011/P521-Shah-Proceedings.pdf
- **What it does:** Merges user-reported incidents with official DC crime data. It offers three cost functions: shortest, safest (incidents within a buffer of the edge) and "best" = (1−β)·lengtĥ + β·crimê, where both terms are normalised and β ∈ [0,1].
- **Useful for us:** This is the earliest example of our exact product shape: a crowd layer combined with an official layer and a user-tunable safety slider. Normalising both terms before mixing them is the key detail.
- **Weak points:** It is a demo with no quantitative evaluation, and all crime types are weighted equally.

### 1.4 Kaur, Goyal, Gunturi et al. — "A Navigation System for Safe Routing"
- **Venue / year:** IEEE MDM 2021 (Toronto). The underlying work is Ramneek Kaur's PhD thesis, IIIT-Delhi, 2022.
- **URL:** https://hull-repository.worktribe.com/output/4388310 · https://repository.iiitd.edu.in/jspui/handle/123456789/1036
- **What it does:** This is **Delhi-specific**. The OSM graph has 11,399 nodes and 24,803 edges. Each segment starts with a safety score of 8 on a 0–15 scale, then:
  - +3 near a police station
  - + for residential scenes, detected with a Places-365 CNN on street-view images
  - −2 for deserted scenes
  - − for streetlight and road complaints to the PWD, GPS dead zones (from bus GPS feeds) and traffic tweets
  - any segment with a crime incident (from Times of India news 2016–20 and NCRB data) is set to 0
  Routing is posed as an **Arc Orienteering Problem**: maximise total safety subject to a length budget, for example ≤10% over the shortest route. It is solved with a "multiple segment replacement" heuristic.
- **Useful for us:**
  - It is the closest prior work in Delhi.
  - It shows which Delhi data sources are actually obtainable: PWD complaints, bus GPS, news-geocoded crime, police station locations.
  - The budgeted formulation, "safest within +X% length", is how we should define the green route.
- **Weak points:**
  - No quantitative evaluation or user study is reported.
  - Shops and open hours are not used.
  - Setting a segment to zero for any news crime is crude and biased by news coverage.

### 1.5 Sharma, Kulshreshtha, Singh, Agrawal, Kumar — "Analyzing Newspaper Crime Reports for Identification of Safe Transit Paths"
- **Venue / year:** NAACL 2015 (Student Research Workshop). Authors from IIT Kanpur.
- **URL:** https://liner.com/review/analyzing-newspaper-crime-reports-for-identification-safe-transit-paths (summary page) · project report: https://www.cse.iitk.ac.in/users/cs365/2014/_submissions/puneets/project/report.pdf
- **What it does:** Classifies news articles as crime or not (LSA/kNN, about 89% accuracy). Extracts locations with NER and LDA. Adds crime counts to edge costs and runs Dijkstra.
- **Useful for us:** India has no open, street-level police data, so news geoparsing is a realistic cold-start signal. The weakest step is location extraction, which they did not evaluate.

### 1.6 Abraham, Delling, Goldberg, Werneck — "Alternative Routes in Road Networks"
- **Venue / year:** SEA 2010; journal version in ACM JEA 2013 (Microsoft Research).
- **URL:** https://www.microsoft.com/en-us/research/wp-content/uploads/2010/01/alternativeSea2010.pdf
- **What it does:** Formally defines an *admissible* alternative route P relative to the optimum route Opt. P must satisfy three conditions:
  - **Limited sharing:** the length P shares with Opt is at most γ·ℓ(Opt).
  - **Local optimality (T-test):** every sub-path up to T = α·ℓ(Opt) is itself a shortest path, so there are no silly zig-zags.
  - **Uniformly bounded stretch:** every sub-path is at most (1+ε)× optimal.
  Candidates are generated with the **via-node** method: the shortest path s→v concatenated with the shortest path v→t. Suggested values: γ = 0.8, ε = 0.25, α = 0.25.
- **Useful for us:** Use these three tests as a **filter on all 4 routes**. They stop the "safe" routes from making detours that look absurd. Compute sharing and stretch on *risk-weighted* cost, not raw length.

### 1.7 Dees, Geisberger, Sanders, Bader — "Defining and Computing Alternative Routes in Road Networks" (also published as "Alternative Route Graphs in Road Networks", TAPAS 2011)
- **Venue / year:** KIT and BMW; arXiv 1002.4330 (2010); TAPAS 2011.
- **URL:** https://arxiv.org/abs/1002.4330
- **What it does:** Describes the **penalty method**:
  1. Find the shortest path.
  2. Multiply the weights of its edges by a factor k ∈ [1, 2].
  3. Add a *rejoin penalty* on edges that leave or rejoin the routes found so far.
  4. Repeat.
  It also defines quality measures for a set of alternatives: totalDistance (amount of real choice), averageDistance (relative length) and decisionEdges (how many branch points a user must handle).
- **Useful for us:** The simplest robust way to force 4 *distinct* routes. After each route is chosen, penalise its edges and re-run with the next λ. The decision-edges measure matters for walking: fewer turns are easier to follow at night.

### 1.8 Paraskevopoulos, Zaroliagis — "Improved Alternative Route Planning"
- **Venue / year:** ATMOS 2013, OASIcs vol. 33.
- **URL:** https://drops.dagstuhl.de/entities/document/10.4230/OASIcs.ATMOS.2013.108
- **What it does:** Improves the penalty and plateau methods with pruning, filtering and fine-tuning. The resulting alternative graphs have low overlap, small stretch and low complexity. **Plateau method:** build forward and backward shortest-path trees and treat long shared segments ("plateaus") as natural via-corridors.
- **Useful for us:** The plateau method is a cheap generator of candidate routes that look natural to users.

### 1.9 Li, Cheema, Lu, Ali, Toosi — "Comparing Alternative Route Planning Techniques: A Comparative User Study on Melbourne, Dhaka and Copenhagen Road Networks"
- **Venue / year:** arXiv 2006.08475 (2020, revised 2021); later published in IEEE TKDE.
- **URL:** https://arxiv.org/abs/2006.08475
- **What it does:** 520 user ratings compared Google Maps, Plateau, Penalty and Dissimilarity (SSVP-D+) routes. Average ratings were all between 3.4 and 3.5 out of 5, with **no significant difference**. Penalty and Plateau sometimes returned near-identical routes. Dissimilarity gave the most distinct routes.
- **Useful for us:**
  - Dhaka is the closest South-Asian analogue we found.
  - Users do not strongly prefer any one generation technique, so choose by engineering convenience.
  - **Add an explicit dissimilarity constraint**, because penalty or plateau alone can produce near-duplicates. This is exactly the failure mode we are worried about.

### 1.10 Chondrogiannis, Bouros, Gamper, Leser, Blumenthal — "Finding k-shortest paths with limited overlap" and "Finding k-Dissimilar Paths with Minimum Collective Length"
- **Venue / year:** VLDB Journal 2020 (DOI 10.1007/s00778-020-00604-x); ACM SIGSPATIAL 2018 (extended version on arXiv).
- **URL:** https://cris.fau.de/publications/259224002 · https://arxiv.org/abs/1809.06831
- **What it does:** kSPwLO finds k paths, each as short as possible, with pairwise similarity at most θ. The exact algorithms are OnePass and MultiPass; heuristics trade off speed or completeness. kDPwML minimises the total length of k dissimilar paths and is strongly NP-hard. The SSVP-D+ greedy heuristic is the fastest and only about 6% worse than the alternatives.
- **Useful for us:** Gives a precise definition of "not near-identical": Sim(Pᵢ, Pⱼ) = ℓ(Pᵢ ∩ Pⱼ) / ℓ(Pⱼ) ≤ θ. Greedy single-via-path generation is fast enough for a mobile backend.

### 1.11 Yen — "Finding the K Shortest Loopless Paths in a Network"
- **Venue / year:** *Management Science* 17(11):712–716, 1971.
- **URL:** https://ideas.repec.org/a/inm/ormnsc/v17y1971i11p712-716.html
- **Useful for us:** The standard k-shortest-loopless-paths algorithm, available in NetworkX as `shortest_simple_paths`. **Do not use raw Yen for the 4 routes.** Its top-k results on a city grid differ by one or two blocks, which is the near-identical-route problem. It is useful only as a candidate generator *followed by* a dissimilarity filter.

### 1.12 Martins — "On a special class of bicriterion path problems"; Salzman, Hernández, Felner, Koenig — "Multi-Objective Search: Algorithms, Applications, and Emerging Directions"
- **Venue / year:** *EJOR* 17(1), 1984; survey on arXiv 2510.25504 (2025, AAAI).
- **URL:** https://ideas.repec.org/a/eee/ejores/v17y1984i1p85-94.html · https://arxiv.org/abs/2510.25504
- **Useful for us:**
  - Martins' label-setting algorithm is the classical exact method for the bi-objective shortest path.
  - BOA* and NAMOA*dr are the modern exact methods. PPA* and A*pex compute ε-approximate Pareto fronts.
  - On large road networks the exact front can contain **thousands** of paths. We should present a curated 4, not the front.
  - If we need non-convex trade-off points that the weighted-sum sweep misses, use BOA* with ε-approximation.

### 1.13 Quercia, Schifanella, Aiello — "The Shortest Path to Happiness: Recommending Beautiful, Quiet, and Happy Routes in the City"
- **Venue / year:** ACM Hypertext 2014; arXiv 1407.1031.
- **URL:** https://arxiv.org/abs/1407.1031
- **What it does:** Collected crowdsourced pairwise votes on street images (3.3K participants) to score locations, then routed to favour pleasant places. Routes were about 12% longer and were perceived as about 30% more beautiful. User studies were run in London (n = 30) and Boston (n = 54).
- **Useful for us:**
  - It is the methodological template for **perception-based routing plus a user-study evaluation**.
  - It shows a 12% detour is acceptable for a "nicer" route.
  - Pairwise comparison is more reliable than absolute 1–5 ratings for subjective qualities like "feels safe". Consider "Which segment felt safer, A or B?" prompts.

### 1.14 Theron, Breetzke — "What's the safest way home? Mapping safe transport routes in South Africa with (and without) crime data"
- **Venue / year:** *Journal of Transport Security* 17, art. 10, 2024.
- **URL:** https://link.springer.com/article/10.1007/s12198-024-00278-4
- **What it does:** Compares three cost models in Khayelitsha (Cape Town): crime per metre; proximity to "risky facilities" (malls, parks, transit, liquor outlets, schools) treated as barriers; and the two combined. On one OD pair, the crime-only safest route was 12 km vs. 8.4 km and passed about 450 fewer historical crimes.
- **Useful for us:** A Global-South case where crime data is under-reported. It shows that **facility-based proxies** can stand in when crime data is missing. Note that its facilities are treated as *risk* generators (liquor outlets, transit hubs), which is the opposite sign to our "open shop = safer" assumption. See §3.
- **Weak points:** One OD pair, evaluated in-sample on the same crimes used to build the weights. Avoid this evaluation flaw.

### 1.15 Rishe, Sadjadi, Adjouadi — "Crime-Avoiding Routing Navigation"
- **Venue / year:** *IPSI Transactions on Internet Research* 20(1), 2024 (FIU).
- **URL:** https://par.nsf.gov/biblio/10517978
- **What it does:** Weights crimes by their relevance to the traveller and mode (for example, pickpocketing matters for pedestrians, insider trading is excluded). The user sets a tri-objective trade-off (time, cost, crime) with a triangle slider.
- **Useful for us:** Supports **crime-type weighting by persona**. Women and children face different risks (harassment, stalking, abduction) from those of an adult male (robbery). Evaluation is weak; there are no experiments.

### 1.16 Mata, Torres-Ruiz, Guzmán et al. — "A Mobile Information System Based on Crowd-Sensed and Official Crime Data for Finding Safe Routes: A Case Study of Mexico City"
- **Venue / year:** *Mobile Information Systems*, 2016.
- **URL:** https://www.oas.org/ext/en/security/crime-prevention-network/Resources/Digital-Library/a-mobile-information-system-based-on-crowd-sensed-and-official-crime-data-for-finding-safe-routes-a-case-study-of-mexico-city
- **What it does:** Classifies tweets as crime or not, clusters them, and estimates crime likelihood **per place per hour**. Validates against official data with about 75% effectiveness, using a held-out procedure.
- **Useful for us:** A time-indexed risk model built from crowd data in a Global-South megacity. The validation (hide known records, predict them) is a reusable evaluation pattern.

### 1.17 Toda-Puiuelet, Trifan — "Safest paths for women at night in Cluj-Napoca" (UrbanPathfinders)
- **Venue / year:** ACM womENcourage 2025 (poster or short paper).
- **URL:** https://womencourage.acm.org/2025/wp-content/uploads/2025/12/Safest-paths-for-women-at-night-in-Cluj-Napoca-_-a-feature-offered-by-UrbanPathfinders.pdf
- **What it does:**
  - Edge cost w = α·t + β·p + γ·s (time, pollution, safety risk).
  - Safety risk uses lighting, incidents, crowd level and CCTV.
  - Routes are found with A*, then the top-k are re-ranked by a small neural network trained on beta-tester feedback.
  - Edge weights refresh every 5 minutes.
- **Useful for us:** The closest product analogue in Europe. The "A* then learned re-ranker from user feedback" pattern is how our post-journey reviews could eventually *learn* the weights.
- **Weak points:** No metrics or baselines are reported.

---

## 2. Women's safety in India (Delhi focus)

### 2.1 Safetipin — Delhi Safety Analysis Report (and the audit method)
- **Venue / year:** Safetipin report, around 2017. Based on 44,396 audits covering 3,910 km of road.
- **URL:** https://safetipin.com/wp-content/uploads/2020/01/Delhi-Report-Print.pdf · https://safetyscore.safetipin.com/projects/54/delhi-safety-analysis-report/
- **Audit parameters (9, each scored 0–3):** Lighting, Openness, Visibility, Crowd, Security, Walkpath, Public Transport, Gender Usage, Feeling. All except Feeling are scored against a rubric. The report names **Lighting** as the biggest driver of perceived safety, followed by **Gender Usage** and **Visibility**. Public Transport mattered least.
- **Delhi numbers at night:**
  - Lighting: 7% of the audited area is completely dark and 13% is poorly lit. 32% of locations have non-working lights.
  - Security: 55% of locations have no police or guards.
  - Gender usage: 70% of locations are deserted or male-only.
  - Crowd: 27% of locations are completely deserted.
  - Visibility: 37% of locations have no visibility, largely because of boundary walls in central Delhi.
- **Useful for us:**
  - These 9 parameters are a ready-made, India-validated feature schema. Map our edge features onto them.
  - "Gender usage" is a separate signal from "crowd". A street busy only with men is not safe in this framework.
  - "Visibility", meaning blank boundary walls versus active frontage, is something OSM and street imagery can partly capture.
  - Safetipin also licenses data. Its point audits would make the best ground truth for validating our model in Delhi.

### 2.2 Viswanath, Basu — "SafetiPin: an innovative mobile app to collect data on women's safety in Indian cities"
- **Venue / year:** *Gender & Development* 23(1), 2015. DOI 10.1080/13552074.2015.1013669.
- **URL:** https://policy-practice.oxfam.org/resources/safetipin-an-innovative-mobile-app-to-collect-data-on-womens-safety-in-indian-c-347219/
- **Useful for us:** The peer-reviewed description of turning the Jagori safety-audit method into a crowdsourced app, with data from 7 Indian cities. It is the citation to use for our feature set. Full text not opened; abstract only.

### 2.3 Karlekar, Bansal — "SafeCity: Understanding Diverse Forms of Sexual Harassment Personal Stories"
- **Venue / year:** EMNLP 2018.
- **URL:** https://arxiv.org/abs/1809.04739 · https://aclanthology.org/D18-1303/
- **What it does:** Uses 9,892 Safecity reports, each a free-text story with a location and harassment tags. It classifies the three most common tags (commenting, ogling, groping) with about 82–87% accuracy, using CNN-RNN models.
- **Useful for us:**
  - Safecity (Red Dot Foundation) is the largest public crowdsourced harassment dataset for India, and it can be used with permission.
  - The paper shows you can **auto-classify free-text post-journey reviews** into harassment types. Severity weights can then differ: groping or stalking should weigh more than a comment.
  - Liu et al. 2019 (arXiv 1911.00547) extend this to extracting harasser, time and location.

### 2.4 Safecity aggregate trends (YourStory data piece, 2016)
- **URL:** https://yourstory.com/2016/11/sexual-harassment-indian-cities
- **Useful for us:**
  - In NCR, commenting accounts for over a quarter of reports and touching or groping for 16%.
  - Report counts peak around **1 PM and 6 PM**, not late at night.
  - Poor lighting is flagged in about 15% of Maharashtra incidents.
  - **Harassment risk is a daytime and crowded-place problem as well as a night-time one.** The model must not set risk to zero just because it is daytime.
- **Caveat:** This is journalism on top of crowdsourced data, so it is weak evidence. Reporting times reflect when women are out, not only per-capita risk.

### 2.5 Borker — "Safety First: Perceived Risk of Street Harassment and Educational Choices of Women"
- **Venue / year:** World Bank Policy Research Working Paper 9731, 2021.
- **URL:** https://documents1.worldbank.org/curated/en/723631626710146405/pdf/Safety-First-Perceived-Risk-of-Street-Harassment-and-Educational-Choices-of-Women.pdf
- **What it does:** Uses about 3,700 Delhi University students, their actual routes and up to 12 Google Maps alternative routes to each college. Route safety comes from **Safetipin and Safecity** data. A mixed logit model estimates the trade-offs.
- **Key numbers, for a route one standard deviation safer:**
  - Women accept **about 27 more minutes per day**, roughly 40% more travel time. Men accept about 21 minutes.
  - Women would pay about ₹17,500 per year extra, 75% more than men.
  - Women accept a college about 8.8 percentage points lower in cutoff score, four times men's trade-off.
  - A one-SD improvement in perceived walking safety is associated with about 3.1% fewer reported rapes.
- **Useful for us:** **The single most important paper for product calibration.** It shows Delhi women *do* trade large detours for safety. It validates the Safetipin + Safecity route-scoring approach. It tells us the "green" route can be substantially longer and still be chosen.

### 2.6 Jagori / UN Women — Safe Delhi baseline survey (Safe Cities Free of Violence Against Women and Girls)
- **Venue / year:** Jagori with UN Women; interviews January–March 2010; more than 5,000 respondents.
- **URL:** https://stopstreetharassment.org/2010/07/in-delhi-2-out-of-3-women-experience-harassment/ · https://jagori.org/sites/jagori/files/ResearchReportpdf/SAFE_CITIES_FOR_WOMEN_AND_GIRLS_0.pdf (2016 update)
- **Useful for us:**
  - About 2 in 3 Delhi women reported harassment 2–5 times in the previous year.
  - Buses, roadsides and the metro were the main sites, with harassment at all times of day.
  - The 2016 update reports that audits found **vendor presence** to be one of the strongest determinants of whether women felt an area was safe, and that **police presence** markedly increased felt safety.
  - Only about 4% of Delhi's toilets are designated for women.
  - **Women's toilets are a safety-relevant POI we had not listed.**

### 2.7 Kapoor (with Viswanath et al.) — "Expanding Access to Opportunities for Girls and Women: Working Towards Safe Mobility"
- **Venue / year:** FIA Foundation Research Series Paper 12, November 2020 (Safetipin with Jagori and CEQUIN).
- **URL:** https://www.fiafoundation.org/media/02db3gny/safetipin-safe-mobility.pdf
- **Useful for us:**
  - In peri-urban and inner-city Delhi sites, 84% of audit points had non-existent or very poor walkpaths, and 95% had insufficient security.
  - 44% of audit points were rated frightening or uncomfortable.
  - **Where women were regular users, 89% of points were rated comfortable or acceptable.** This is direct evidence for a "gender usage" feature.
  - The **last mile** (from a metro or bus stop to home) is the main pain point. This is a strong product hint: optimise last-mile walking legs.

### 2.8 Joshi, Bailey — "What happens next? Exploring women's transport motility through the story completion method"
- **Venue / year:** *Journal of Transport Geography* 107, 103547, 2023.
- **URL:** https://dspace.library.uu.nl/bitstream/handle/1874/427882/1_s2.0_S0966692323000194_main.pdf
- **Useful for us:** A qualitative Delhi Metro study (n = 84 women). Women choose routes, coaches and times to manage risk, accept extra travel time to avoid deserted platforms at night, and value CCTV, staff and security. It supports **time-of-day-dependent routing** and **share-my-location** features.

### 2.9 Tony, Tiwari, Fujiyama, Manoj, Chatterjee — pedestrian environment safety perception study, Delhi vs. London
- **Venue / year:** *IATSS Research*, July 2025 (IIT Delhi TRIPP with UCL); 426 pedestrians surveyed in south Delhi in 2022.
- **URL:** https://www.tribuneindia.com/news/delhi/12-out-of-15-pedestrian-environments-rated-unsafe-by-delhiites-study-finds/ (news report; journal full text not opened)
- **Useful for us:**
  - 12 of 15 pedestrian conditions were rated unsafe.
  - **Street vendors were the single safest-rated element.** Police presence, CCTV and good lighting raised felt safety. Poor lighting and walking after sunset were major concerns.
  - Women felt less safe than men, especially where vehicles were parked on footpaths or guardrails were missing.
  - **Traffic safety and personal safety mix in Delhi.** For children especially, the route model should also penalise crossing fast arterials without a signal.

### 2.10 Garg — "Safe Travels: Transport Advancement and Women's Safety in India"
- **Venue / year:** University of Warwick job-market paper, presented at SIOE 2025.
- **URL:** https://www.sioe.org/conference/2025/program/paper/1352-safe-travels-transport-advancement-and-womens-safety-in-india
- **What it does:** Uses the universe of Delhi crime reports at police-station-day level, 2016–2019, and the staggered opening of metro stations.
- **Key result:** Reported public sexual harassment fell **29%** in a police jurisdiction after its first metro station opened. Non-gender crimes did not fall, and there was no displacement into the metro.
- **Useful for us:**
  - Proximity to an operating metro station is a plausible positive safety signal.
  - It shows that **police-station-level FIR data exists** in Delhi, although it is not public; Garg built her own dataset. That granularity, about 180 police stations, is the best "official" layer we could hope for. Use it as a coarse prior, not as per-edge truth.

### 2.11 Roy, Jahangir, Bailey, van Noorloos — "Visibility matters: Constructing safe passages on the streets of Kolkata"
- **Venue / year:** *Journal of Urban Affairs*, 2022 (online 2023).
- **URL:** https://impressions.manipal.edu/open-access-archive/4820
- **Useful for us:**
  - Qualitative Indian evidence that **open, porous frontages** and the watchfulness of shopkeepers, hawkers and passers-by make women feel safer.
  - Closed walls, poor lighting, empty streets and, notably, *affluent gated areas* increase fear.
  - Counter-intuitively, posh areas with high walls can feel *less* safe. **Do not use income or "nice neighbourhood" as a safety proxy.**

### 2.12 Tanner, Kalms, Cull, Matthewson, Aisenberg — "Disruption and Design: Crowdmapping Young Women's Experience in Cities"
- **Venue / year:** *IDS Bulletin* 51(2), 2020 (Plan International "Free to Be"; includes Delhi).
- **URL:** https://bulletin.ids.ac.uk/index.php/idsbo/article/view/3104
- **Useful for us:** A multi-city crowdmap of good and bad places, including Delhi. The companion Monash XYX Lab and Arup lighting analysis of Melbourne hotspots (2019) found that **brighter is not always safer**:
  - Women's unsafe sites had about *double* the light level of safe sites, because of floodlit paths next to dark surroundings.
  - Even, layered, warm lighting with good colour rendering felt safest.
  - Source: https://lens.monash.edu/@design-architecture/2019/05/29/1375201/more-lighting-alone-does-not-create-safer-cities-for-women
  - Implication for us: score **continuity and uniformity** of lighting, not just presence or brightness.

### 2.13 Nayak, Benazeer — "Identifying and Addressing the Issue of Women's Fear of Victimization in Public Transport: A Case of Delhi"
- **Venue / year:** *Journal of the Eastern Asia Society for Transportation Studies* 12, 2017 (IIT Roorkee).
- **URL:** https://www.jstage.jst.go.jp/article/easts/12/0/12_2392/_article/-char/en
- **Useful for us:** Groups Delhi women's fear factors into sociological, socio-demographic and environmental categories, based on questionnaire, street survey and rapid assessment. Abstract only; the full paper was not opened. Use it as a reference for survey design if we run our own baseline study.

### 2.14 A caution on apps: Weiss — "An Analysis of Anti Gender-Based Street Harassment Mobile Applications"
- **Venue / year:** *Intersect* (Stanford) 9(3), 2016.
- **URL:** https://ojs.stanford.edu/ojs/index.php/intersect/article/view/855
- **Useful for us:** Finds no evidence that anti-harassment apps reduce incidents or increase women's mobility, and argues that over-claiming can backfire. **Product copy should say "lower reported risk", never "safe".**

---

## 3. Environmental-criminology signals

### 3.1 Chalfin, Hansen, Lerner, Parker — "Reducing Crime Through Environmental Design: Evidence from a Randomized Experiment of Street Lighting in New York City"
- **Venue / year:** *Journal of Quantitative Criminology* 38:127–157, 2022 (NBER WP 25798, 2019).
- **URL:** https://www.nber.org/papers/w25798
- **Design:** 80 NYCHA public-housing developments were paired; 39 received about 7 temporary, very bright light towers each, in March–August 2016.
- **Result:**
  - Outdoor nighttime index crimes fell **about 36%** net of spillovers into a 2-block ring, and about 59% on the treated campuses.
  - There was no clear displacement.
  - The estimated benefit-to-cost ratio was about 4:1.
- **Useful for us:**
  - The strongest causal evidence for lighting.
  - The effect is concentrated at **night and outdoors**, which supports a lighting weight that switches on after dark.
- **Caveat:** The towers were far brighter than normal streetlights, the sites were high-crime US public housing, and the crimes were index crimes, not harassment.

### 3.2 Welsh, Farrington — "Effects of Improved Street Lighting on Crime" (Campbell systematic review)
- **Venue / year:** *Campbell Systematic Reviews* 4(1), 2008.
- **URL:** https://ideas.repec.org/a/wly/camsys/v4y2008i1p1-51.html · https://www.ojp.gov/ncjrs/virtual-library/abstracts/effects-improved-street-lighting-crime
- **Result:** 13 studies (US and UK); about **21% less crime** in areas with improved lighting. Night crime fell no more than day crime. The authors therefore favour a *community pride and informal social control* mechanism over a surveillance mechanism.
- **Useful for us:** Lighting may proxy for "this place is cared for". Also include **maintenance signals** (broken lights, garbage, potholes), which can come from the PWD and MCD complaint data that Kaur et al. used.

### 3.3 Welsh, Farrington, Douglas — "Effectiveness of Street Lighting in Preventing Crime in Public Places: An Updated Systematic Review and Meta-Analysis"
- **Venue / year:** Brå (Swedish National Council for Crime Prevention), December 2021; CrimRxiv 2024. I believe the journal version appeared in *Criminology & Public Policy* in 2022, but I did not open it.
- **URL:** https://bra.se/english/publications/archive/2021-12-21-effectiveness-of-street-lighting-in-preventing-crime-in-public-places · https://www.crimrxiv.com/pub/wl9zqxga
- **Result:**
  - 21 studies, 17 in the meta-analysis.
  - Overall crime fell **14%**. Property crime fell 12%, which was significant.
  - The effect on **violent crime was not significant** (RES about 0.99).
- **Useful for us:** **An honest calibration point.** For the crimes women fear most (assault, harassment), the meta-analytic crime evidence for lighting is weak. Lighting's case rests on (a) perception and avoidance, (b) the NYC RCT and (c) its effect on pedestrian presence (§3.5).

### 3.4 Tompson, Bowers — "A Stab in the Dark? A Research Note on Temporal Patterns of Street Robbery"
- **Venue / year:** *Journal of Research in Crime and Delinquency* 50(4):616–631, 2013.
- **URL:** https://discovery-pp.ucl.ac.uk/1359524/1/Journal_of_Research_in_Crime_and_Delinquency-2013-Tompson-616-31.pdf
- **Result:** Uses seasonal variation in sunset time across 6-hour shifts. Moving from full daylight to full darkness multiplied predicted street robbery by about **2.6 in London** and about 1.2 in Glasgow.
- **Useful for us:** Model darkness as a **multiplier on risk**, computed from actual sunset and civil twilight for the date (Delhi sunset ranges from about 17:25 in winter to 19:20 in summer), *not* from clock time. The effect size varies a lot by city, so it should be tuned locally.

### 3.5 Fotios, Uttley, Fox — "A whole-year approach showing that ambient light level influences walking and cycling"
- **Venue / year:** *Lighting Research & Technology* 51(1):55–64, 2019.
- **URL:** https://eprints.whiterose.ac.uk/124505/
- **Result:** At the same clock hour (18:00–19:00), pedestrian counts were higher in daylight than after dark, with an odds ratio of **1.93**. The darkness penalty was **1.50 on lit paths vs. 3.62 on unlit paths**.
- **Useful for us:** **Lighting and busyness are linked.** An unlit street empties out after dark much more than a lit one. A historical "busy" estimate from daytime data (for example, from Google Popular Times) must be *down-weighted after dark, more so on unlit segments*.

### 3.6 Fotios, Unwin — "Relative weighting of lighting in affecting pedestrian reassurance"
- **Venue / year:** CIE Centenary Conference, Paris, 2013.
- **URL:** https://eprints.whiterose.ac.uk/81130/
- **Result:**
  - In interviews (n = 53), lighting was mentioned as often as **"access to help"** in open discussion.
  - When participants assessed photos of their own routes, lighting ranked *below* access to help and about level with spatial features.
  - Their literature table includes Okuda et al. (Hiroshima): "dark lighting" and "empty street" were each cited by 36% of respondents as fear factors.
- **Useful for us:** **"Access to help" (open shops, pharmacies, hospitals, police, people) may matter as much as or more than lighting for reassurance.** This supports our open-POI features. It suggests that at night, open-POI and lighting weights should be about equal, rather than lighting dominating.

### 3.7 Jacobs — *The Death and Life of Great American Cities* ("eyes on the street")
- **Venue / year:** Random House, 1961.
- **Useful for us:** The origin of the idea that natural surveillance from active ground-floor uses and residents deters crime and reassures pedestrians. It is the theory behind our busyness and open-shop signals. The empirical tests below give mixed results.

### 3.8 Cohen, Felson — "Social Change and Crime Rate Trends: A Routine Activity Approach"
- **Venue / year:** *American Sociological Review* 44(4), 1979.
- **URL:** https://faculty.washington.edu/matsueda/courses/587/readings/Cohen%20and%20Felson%201979%20Routine%20Activities.pdf
- **Useful for us:** Crime needs a motivated offender, a suitable target and the **absence of a capable guardian**. Open shopkeepers, security guards, police and other women are *guardians*. Crowds of strangers also supply *offenders and targets*. This is the theoretical reason busyness is non-monotonic.

### 3.9 Brantingham, Brantingham — "Criminality of place: Crime generators and crime attractors"
- **Venue / year:** *European Journal on Criminal Policy and Research* 3(3), 1995.
- **URL:** https://www.ojp.gov/ncjrs/virtual-library/abstracts/criminality-place-crime-generators-and-crime-attractors
- **Useful for us:** Busy places such as markets, transit hubs and malls *generate* crime simply through volume. Some places, such as bars and liquor shops, *attract* offenders. **Not all open POIs are protective.** A liquor shop ("theka") open at 22:00 should carry a *negative* weight. Pharmacies, hospitals, police and general stores staffed by visible people should be positive.

### 3.10 Haberman, Ratcliffe — "Testing for Temporally Differentiated Relationships among Potentially Criminogenic Places and Census Block Street Robbery Counts"
- **Venue / year:** *Criminology* 53(3), 2015 (Philadelphia).
- **URL:** https://www.jerryratcliffe.net/_files/ugd/f5df24_d5457aec4434472ca41f82bef76a9af3.pdf
- **Result:**
  - 12 facility types were studied across 4 time windows.
  - ATMs and banks, corner stores and fast food were associated with *more* street robbery at all hours.
  - Pawn shops and drug-treatment centres mattered only during opening hours. Parks did not matter late at night, when they are empty.
- **Useful for us:**
  - Strong support for **"open now" gating**: a facility's effect switches on when it operates.
  - A warning that the **sign** can be positive (more crime) for some facility types. The variable measured was robbery, not harassment or women's perception.

### 3.11 Humphrey, Jensen, Small, Thurston — "Urban Vibrancy and Safety in Philadelphia"
- **Venue / year:** arXiv 1702.07909, 2017; later in *Environment and Planning B* (2020).
- **URL:** https://arxiv.org/abs/1702.07909
- **Result:**
  - More crimes occurred near businesses overall, but **businesses open longer hours were associated with fewer nearby crimes** for most business types.
  - Vacant lots were linked to higher crime at neighbourhood level.
- **Useful for us:** The closest empirical support for "open-now shops = safer". Pharmacy results were mixed. Our POI-openness feature is directionally supported but noisy.

### 3.12 Rosenthal, Urrego — "Eyes on the Street, Spatial Concentration of Retail Activity and Crime"
- **Venue / year:** Syracuse University working paper (AEA 2022 programme).
- **URL:** https://aeaweb.org/conference/2022/preliminary/paper/z36tB3FK
- **Result:** In NYC, a one-SD increase in spatially concentrated retail cut property crime by about 8.5%. **The crowding effect was weaker at night** and during the COVID lockdown, but **storefront visibility** still deterred crime.
- **Useful for us:** Active frontage helps even when foot traffic drops, which echoes Safetipin's "Visibility" parameter.

### 3.13 Anderson, MacDonald, Bluthenthal, Ashwood — "Reducing Crime by Shaping the Built Environment with Zoning: An Empirical Study of Los Angeles"
- **Venue / year:** *University of Pennsylvania Law Review* 161, 2013 (RAND).
- **URL:** https://www.rand.org/pubs/external_publications/EP51286.html
- **Result:**
  - Commercial-only blocks had about 45% more crime than comparable blocks with residences.
  - Mixed-use blocks had less crime than commercial-only blocks.
  - The study found little support for the specific "commercial uses supply eyes on the street" mechanism.
- **Useful for us:** **Residential mixed-use beats pure commercial.** A street of shuttered shops at night is worse than a residential lane with lit homes. This argues for a "residential frontage" feature, which Kaur et al. also used.

### 3.14 Cozens, Saville, Hillier — "Crime prevention through environmental design (CPTED): a review and modern bibliography"
- **Venue / year:** *Property Management* 23(5):328–356, 2005.
- **URL:** https://www.emerald.com/insight/content/doi/10.1108/02637470510631483/full/html
- **Useful for us:** The CPTED principles are surveillance, access control, territoriality, maintenance (image), activity support and target hardening. The review says evidence is "promising but inconclusive". Natural surveillance, maintenance and activity support map onto our visibility, lighting/maintenance and open-POI features. Abstract only.

### 3.15 Abraham, Kang, Ceccato, et al. — "Crime and Visually Perceived Safety of the Built Environment: A Deep Learning Approach"
- **Venue / year:** *Annals of the American Association of Geographers* 115(7):1613–1633, 2025 (Stockholm).
- **URL:** https://ideas.repec.org/a/taf/raagxx/v115y2025i7p1613-1633.html
- **Result:** A street-view perceived-safety score (deep learning) was related to crime types, but **"mismatching geographies of perceived safety and crime are common."** The UCL London women's night-walk study (2021) found the same divergence. Source: https://www.ucl.ac.uk/grand-challenges/case-studies/2021/sep/exploring-womens-night-walking-safety-london-built-environment-perspective
- **Useful for us:** **Perceived safety ≠ crime risk.** Our 4-route display mixes both. Be explicit internally about which signals estimate *actual incident risk* (crime and harassment reports) and which estimate *comfort* (lighting, people, reviews). Consider showing both.

### 3.16 Naik, Philipoom, Raskar, Hidalgo — "Streetscore: Predicting the Perceived Safety of One Million Streetscapes"
- **Venue / year:** CVPR Workshops 2014 (MIT Media Lab; built on Salesses et al.'s Place Pulse, PLoS ONE 2013).
- **URL:** https://www.media.mit.edu/publications/streetscore-predicting-the-perceived-safety-of-one-million-streetscapes/
- **Useful for us:** Shows perceived safety can be predicted from street imagery at city scale. For Delhi, this is a way to estimate "visibility / openness / walkpath" where OSM is thin. **Models trained on US imagery will not transfer to Delhi**, so it would need local labels.

---

## 4. Crowdsourced rating aggregation and abuse resistance

### 4.1 Wilson score interval (Wilson 1927) as popularised by Miller — "How Not To Sort By Average Rating"
- **URL:** https://evanmiller.org/how-not-to-sort-by-average-rating.html
- **Method:** For binary ratings (felt safe / felt unsafe), with p̂ the fraction of positive ratings and n the number of ratings, use the lower bound of the Wilson interval:

  $$\text{LB} = \frac{\hat p + \frac{z^2}{2n} - z\sqrt{\frac{\hat p(1-\hat p)}{n} + \frac{z^2}{4n^2}}}{1 + \frac{z^2}{n}}, \quad z = 1.96 \text{ for 95\%}$$

- **Useful for us:** Few reviews give a wide interval, so the score is conservative automatically. **For safety, apply it asymmetrically.** Use the *upper* bound of P(unsafe) when deciding whether to warn, and the *lower* bound of P(safe) when deciding whether to give the segment a bonus.

### 4.2 Bayesian average / Beta prior — Miller "Bayesian Average Ratings"; Jøsang, Ismail — "The Beta Reputation System"
- **Venue / year:** Miller (blog); Jøsang and Ismail, 15th Bled e-Commerce Conference, 2002.
- **URL:** https://evanmiller.org/bayesian-average-ratings.html · https://mn.uio.no/ifi/english/people/aca/josang/publications/ji2002-bled.pdf
- **Method:** Treat the counts as a Beta distribution. The expected safety is

  $$\mathbb{E}[\theta] = \frac{r + a}{r + s + a + b}$$

  where r and s are the safe and unsafe counts and a and b form the prior. For star ratings, the Bayesian average is

  $$\bar x_{\text{bayes}} = \frac{C\cdot m + \sum_i x_i}{C + n}$$

  where m is the prior mean (for example, our model's score for that segment), C is the prior strength and n is the number of ratings. Jøsang adds two features:
  - a **forgetting factor** λ ∈ (0, 1], which down-weights old feedback
  - **discounting by reporter reputation**
- **Useful for us:** This is the best fit for our "minimum verified reviews" rule. Instead of a hard on/off switch, reviews *shrink towards* the model prior and take over as n grows. Use the environmental model's score as m, so an unreviewed edge keeps its model score.

### 4.3 Dawid, Skene — "Maximum Likelihood Estimation of Observer Error-Rates Using the EM Algorithm"
- **Venue / year:** *Journal of the Royal Statistical Society, Series C* 28(1):20–28, 1979.
- **URL:** https://ideas.repec.org/a/bla/jorssc/v28y1979i1p20-28.html
- **Useful for us:** The standard way to learn **per-reviewer reliability** jointly with the true label. Off-the-shelf implementations exist (for example, Toloka `crowd-kit`). Once we have thousands of reviews, run it nightly. Reviewers who consistently disagree with the consensus, or who rate every segment 1 or every segment 5, get down-weighted.

### 4.4 Yu, Kaminsky, Gibbons, Flaxman — "SybilGuard: Defending Against Sybil Attacks via Social Networks"
- **Venue / year:** ACM SIGCOMM 2006.
- **URL:** https://www.comp.nus.edu.sg/~yuhf/sybilguard-sigcomm06.pdf
- **Useful for us:** The key idea: an attacker can create many identities but few *real trust links* to honest users. With g attack edges and random-route length w = Θ(√(n log n)), the number of accepted Sybils is bounded by roughly g·w. For us, the "trust links" can be verified phone numbers, account age and co-located journeys. It is the theory behind making fake accounts cheap to *create* but expensive to make *count*.

### 4.5 Wang, Wang, Wang, Nika, Zheng, Zhao — "Defending against Sybil Devices in Crowdsourced Mapping Services" ("Ghost Riders")
- **Venue / year:** ACM MobiSys 2016; arXiv 1508.00837.
- **URL:** https://arxiv.org/abs/1508.00837
- **Result:**
  - The authors reverse-engineered Waze's API. One server ran **1,000 fake "vehicles"**, which created fake traffic jams and accidents and could also *track* real users.
  - Defence: phones prove co-location to each other (a WiFi challenge, effective to about 80 m). A proximity graph plus SybilRank then detects Sybils (AUC above 0.98 against a single-gateway attacker, in simulation).
- **Useful for us:** **The most relevant threat model.** Someone could mass-review a street as "safe", for example a business owner, or as "unsafe", for example to stigmatise a community. It also warns about **privacy**: a safety app that reveals where women are walking is itself dangerous. Never expose live user positions or per-user trails.

### 4.6 Zhu, Cao — "APPLAUS: A Privacy-Preserving Location Proof Updating System for Location-Based Services"
- **Venue / year:** IEEE INFOCOM 2011.
- **URL:** https://pure.psu.edu/en/publications/applaus-a-privacy-preserving-location-proof-updating-system-for-l/
- **Useful for us:** Nearby Bluetooth devices co-sign "location proofs" under rotating pseudonyms. It is a research-grade path to proving a reviewer was actually on the street without the server learning their identity. This is probably beyond v1 but worth knowing.

### 4.7 Yang, Xia, Shin, Hua, Mao, Zhong — "A Comprehensive Study of Trajectory Forgery and Detection in Location-Based Services"
- **Venue / year:** *IEEE Transactions on Mobile Computing* 23(4), 2024 (extends ICDCS 2022).
- **URL:** https://ylmao.github.io/papers/trajectoryTMC.pdf
- **Result:** Adversarially generated fake GPS trajectories **fooled the authors' LSTM detector and commercial SDKs**. Cross-checking reported WiFi and cellular signal strengths against crowdsourced reference maps detected forgeries with more than 94% accuracy in urban areas.
- **Useful for us:** **GPS-trace plausibility checks alone are not enough** against a determined attacker. Layer them: map-matched trace, plausible walking speed, sensor noise and pedometer consistency, OS integrity attestation (Play Integrity / App Attest), and optionally WiFi scan consistency. For v1, the realistic goal is to make abuse *expensive*, not impossible.

### 4.8 Mukherjee, Venkataraman, Liu, Glance — "What Yelp Fake Review Filter Might Be Doing?"
- **Venue / year:** ICWSM 2013.
- **URL:** https://ojs.aaai.org/index.php/ICWSM/article/view/14389
- **Result:** On real Yelp-filtered reviews, **behavioural features beat text features** for spam detection. Behavioural features include burstiness, rating deviation, reviewer activity and the share of extreme ratings.
- **Useful for us:** Build anomaly features on reviewer behaviour, such as many reviews in a short window, all extreme ratings, or reviews clustered on one street from new accounts. Do this rather than relying only on NLP of review text.

---

## 5. How these papers measured "safer" (evaluation methods)

| Method | Used by | Strength | Pitfall |
|---|---|---|---|
| **Risk exposure along route from the same crime data used for weights** (count of incidents within a buffer, or Σ r(e)) | Theron & Breetzke 2024; CROWDSAFE 2011 (qualitative); Galbrun 2014 (as objective) | Cheap | **Circular.** It measures how well the optimiser minimised its own objective, not real safety. |
| **Local average distance from crime points** | SafeRoute 2018 | Cheap, captures small hotspots | Still in-sample unless the crimes are from a later period |
| **Pareto-front quality** (area ratio of approximate vs. exact front; number of paths; runtime) | Galbrun 2014/2016 | Good for algorithm engineering | Says nothing about real-world safety |
| **Alternative-set quality** (sharing, stretch, local optimality; totalDistance, averageDistance, decisionEdges) | Abraham 2010; Dees/Bader 2010–11; Chondrogiannis 2018/2020; Paraskevopoulos 2013 | Standard, reproducible | Assumes length is the only cost |
| **Hold-out prediction** (remove records, predict them; or fit on year t and test on year t+1) | Mata et al. 2016 (about 75%) | Tests whether the risk model generalises | Requires enough incident data |
| **User ratings of shown routes** (1–5 Likert; split by locals and non-locals) | Li et al. 2020 (n = 520); Quercia 2014 (n = 30 + 54) | Captures perceived quality | Small n; Google's routes used different data; novelty effects |
| **Revealed preference / discrete choice** (which route people actually take; willingness to pay or detour) | Borker 2021 | The best evidence of value to users | Needs real route-choice data |
| **Causal designs** (RCT, staggered rollout, seasonal natural experiment) | Chalfin 2022; Garg 2025; Tompson & Bowers 2013; Fotios 2019 | Gold standard for *factors* | Not routing evaluations; they tell us which features matter |
| **Perception audits as ground truth** | Safetipin; Jagori; Kapoor 2020; Tony 2025 | India-specific, gendered | Measures perception, not incidents |
| **No evaluation / demo only** | Kaur 2021; Rishe 2024; Toda-Puiuelet 2025; CROWDSAFE 2011 | n/a | Most "safe routing" papers fall here. **This is a gap we can fill.** |

**Recommended evaluation stack for our app:**
1. **Algorithmic:** For each OD pair in a benchmark set of about 2,000 Delhi pairs stratified by distance (copying Galbrun's 1 km distance bands), report:
   - stretch of each route vs. the fastest
   - pairwise overlap θ
   - decision points per km
   - runtime percentiles (p50, p95)
2. **Out-of-sample risk:** Build the risk layer from data before date T. Measure how many *later* incidents fall within 50 m of each route type, using Safecity reports after T and news-geocoded incidents after T. Normalise per km and per route-hour.
3. **Perception ground truth:** Correlate our edge scores with Safetipin audit points, or our own audit sample, on held-out streets. Report Spearman ρ by day and night.
4. **Online:** Track the share of users choosing each colour. Compare post-journey "felt safe" ratings by route colour, controlling for time of day. A/B test weight sets. Watch for *harm signals*: SOS triggers and "felt unsafe" ratings on green routes.

---

## 6. Design decisions for our app

The evidence-strength tags below are my judgement: **[strong]** means causal or meta-analytic evidence; **[moderate]** means consistent observational evidence or Indian audit evidence; **[weak]** means theory, a single study or my extrapolation.

### 6.1 Edge risk model

Define a per-edge, time-dependent risk score in [0, 1]:

$$\rho_e(t) = \operatorname{clip}_{[0,1]}\Big(\sum_k w_k(t)\,f_{e,k}(t)\Big)$$

where each feature f_{e,k} is scaled so that 1 means bad. Then fold in the crowd layer with Bayesian shrinkage (§6.5).

Path cost for routing:

$$C_\lambda(P) = \sum_{e\in P} \ell_e\,\big(1 + \lambda\,\rho_e(t)\big) \;+\; \mu \max_{e\in P}\rho_e(t)\cdot \mathbb{1}[\rho_e(t) > \tau]$$

- The sum term is Galbrun's TOTAL-PATHS idea expressed as *length-weighted exposure*. A 20 m bad segment costs less than a 400 m bad stretch.
- The max term is a **bottleneck penalty**, after Galbrun's MAX-PATHS. One deserted underpass or unlit park cut-through can make an otherwise good route bad, and women's audit data (§2.1) point to exactly these spot hazards.
- For the green route, if an alternative exists within the stretch cap, treat edges with ρ > τ_hard as **forbidden**.

**Features and suggested starting weights.** These are priors to be learned later, not validated values.

| Feature f_{e,k} (1 = bad) | Night w_k | Day w_k | Evidence | Notes |
|---|---|---|---|---|
| **Lighting deficit** (no lamps, broken, far from footpath, *discontinuous*) | 0.25 | 0.03 | Crime [strong but mostly property]; perception [strong]; walking [strong] | Score uniformity and continuity, not brightness (Monash/Arup 2019). Sources: OSM `lit=*`, Safetipin dark-spots data, VIIRS night-lights (coarse), user reports, MCD/PWD complaints. |
| **Deserted / low activity** (expected foot traffic for this hour, corrected for darkness) | 0.20 | 0.25 | Perception [strong in India]; crime [moderate] | Make it **non-monotonic**: deserted is bad, moderate is best, extreme crush (bus stops, markets at peak) is mildly bad for groping risk [weak]. Down-weight daytime footfall estimates after dark, more so on unlit edges (Fotios 2019). |
| **No open "help points" nearby** (open pharmacy, hospital, clinic, general store, restaurant, metro station, petrol pump within about 50–100 m) | 0.20 | 0.15 | Reassurance [moderate]; crime [mixed, sign depends on facility type] | Gate strictly on **open now** (Haberman & Ratcliffe 2015). Use positive weights only for "guardian" POIs. Give **liquor shops and bars a small negative contribution** (crime attractors). Add women's toilets and 24h pharmacies as high-value night POIs. |
| **No police / security / govt presence** (police station, PCR van point, guarded govt building within about 150 m) | 0.10 | 0.07 | Perception [moderate: Jagori, Tony 2025]; crime [not reviewed here] | Police stations are fixed and always "open", so don't over-weight. 55% of Delhi points have no security at night, so this feature has signal there. |
| **Low gender usage** (share of women and families observed) | 0.10 | 0.10 | Perception [moderate: Safetipin, Kapoor 2020] | Hard to observe. Proxies: crowd reviews ("other women around?"), Safetipin data, schools and colleges and women's PGs nearby. Start at a lower weight if the data is sparse. |
| **Poor visibility / blank frontage** (boundary walls, flyovers, underpasses, parks, vacant land) | 0.10 | 0.05 | Perception [moderate]; crime [moderate: vacant land, Rosenthal & Urrego frontage] | From OSM: `landuse`, `barrier=wall`, `tunnel=yes`, `bridge`, park polygons. Residential frontage counts as positive (Anderson et al. 2013). |
| **Poor walkpath / traffic hazard** (no footpath, fast arterial crossing) | 0.05 | 0.10 | Delhi pedestrian study [moderate] | Matters especially for the **child** persona. |
| **Recorded incidents** (Safecity, geocoded news, police-station-level FIR prior) | 0.15 | 0.15 | Actual risk [moderate, but biased by under-reporting] | Smooth with KDE at about 100–150 m bandwidth. Decay with a half-life of about 12 months. Weight by severity (groping or stalking > comments). Normalise by footfall where possible (Galbrun's suggestion) so busy markets are not automatically red. |

Night weights sum to more than 1 on purpose. Normalise them after you pick the final feature set. The *relative* order is the recommendation, not the exact numbers.

**Honest caveats:**
- No study validates a combined weighting for women's street safety. The table is built from evidence about single factors.
- The strongest *crime* evidence (lighting, darkness) comes from the US and UK and is mostly about robbery and property crime.
- The strongest *India* evidence is about **perception** (Safetipin, Jagori, Borker, Tony). For a women's safety app that is legitimate, because avoidance and fear are the problem being solved. But we should not claim the route is "statistically safer from assault".
- Plan to **learn the weights**. Once post-journey ratings arrive, fit a logistic or ordinal regression of "felt unsafe on segment" on the features, separately for day and night. Then move the priors toward the fitted values, after Toda-Puiuelet 2025 and Quercia 2014.

### 6.2 Time-of-day effects

- **Use astronomical darkness, not clock time.** Compute sunset and civil dusk for the date in Delhi, and treat dusk as a transition zone of about 30 minutes:

  $$\text{dark}(t) \in [0,1], \qquad w_k(t) = (1-\text{dark}(t))\,w_k^{\text{day}} + \text{dark}(t)\,w_k^{\text{night}}$$

- **Apply a darkness multiplier on the incident layer.** Start at about ×1.5 at night, between the Glasgow (×1.2) and London (×2.6) robbery estimates. Fit it to Delhi data when available; Garg's police-station-day data shows what such data looks like. [moderate]
- **Busyness must be hour-specific.** A Chandni Chowk lane is packed at 18:00 and empty at 23:00. Use hour-of-week footfall profiles (from Popular Times-style data, our own app traces and POI opening hours as a proxy). Apply the extra unlit-street emptying effect from Fotios 2019. [strong for the direction]
- **Opening hours drive the help-point feature.** Pull them from OSM `opening_hours` or Google Places. When hours are unknown, assume closed after 22:00 except 24/7 categories (hospital, police, some pharmacies, petrol pumps). Show "open now" on the map so users can check it.
- **Daytime is not "safe mode".** Harassment reports peak around 13:00 and 18:00 in Safecity data, and buses and crowded transit are the top sites (Jagori). Keep the incident and gender-usage features active in daytime.
- **Season:** Delhi winter fog and an earlier sunset (about 17:30) mean commutes home happen in darkness for months. The darkness model handles this automatically if it is driven by sunset.

### 6.3 Producing 4 *distinct* routes

This is the main algorithmic risk. Naive approaches (Yen top-4, or four λ values) often return routes that differ by a block or two, especially on Delhi's grid-like colonies.

**Recommended pipeline:**

1. **Candidate generation**, roughly 20–40 candidates in under 200 ms on a Delhi walking graph with contraction hierarchies or CH-free bidirectional A*:
   - (a) **λ-sweep / convex hull** (Galbrun Sum-Recursive): run with λ ∈ {0, λ_hull…, λ_max} on C_λ, which gives the length-vs-exposure hull.
   - (b) **Penalty iterations** (Dees/Bader): after each accepted route, multiply its edges by k ≈ 1.4 and add a rejoin penalty.
   - (c) **Via-node / plateau candidates** (Abraham; Paraskevopoulos) for natural-looking alternatives.
2. **Admissibility filter** (Abraham et al.) on every candidate:
   - stretch ≤ cap(colour), using the caps below
   - locally optimal sub-paths (T-test with α ≈ 0.25 on *risk-weighted* cost), so no loop-de-loops
   - no U-turns, and no more than about 1.5 decision points per 100 m
3. **Selection with explicit dissimilarity** (kSPwLO-style): choose 4 routes that span the trade-off while keeping pairwise overlap low:
   - **Dark red** = fastest (λ = 0).
   - **Green** = minimum exposure subject to ℓ(P) ≤ (1 + ε_g)·ℓ(P_fast) and no edges with ρ > τ_hard.
   - **Orange and yellow** = the two candidates whose (stretch, exposure) points best fill the gaps on the hull. Greedily choose points that maximise the minimum distance to already-chosen points in the normalised (Δlength, Δexposure) plane, subject to the overlap constraint:

  $$\mathrm{Sim}(P_i,P_j) = \frac{\ell(P_i\cap P_j)}{\min(\ell(P_i),\ell(P_j))} \le \theta, \quad \theta \approx 0.6\text{–}0.7$$

4. **Fallbacks:**
   - If fewer than 4 routes pass, relax θ toward 0.8 before relaxing stretch.
   - If routes still collapse, for example on a very short trip or in a dense lane network, **show fewer routes and say why** ("Only 2 meaningfully different routes for this trip"). Never pad with near-duplicates; Li et al. 2020 showed users notice them.
   - If even the green route has high max-risk, say so honestly ("No well-lit option; consider an auto or cab").
5. **Rank and colour by *measured* exposure**, not by generation order. Compute each route's final

  $$R(P) = \frac{\sum_e \ell_e\rho_e}{\sum_e \ell_e}$$

   and its max-risk segment. Display both: "mostly well-lit; one dark 120 m stretch near X".

**Stretch caps**, grounded in willingness-to-detour evidence:
- Borker found Delhi women accept about +40% travel time for a one-SD safer route.
- Galbrun's safest routes were about 1.5× the shortest.
- Kaur et al. used a +10% budget; Quercia's routes were +12%.
- Suggested caps: **green ≤ 1.5×** the fastest length, or **1.6× at night**, plus an absolute cap of about +15 minutes of walking. **Yellow ≈ ≤1.25×. Orange ≈ ≤1.12×.**
- Let users change "maximum extra walking" in settings, as CROWDSAFE's β slider and Rishe's triangle did.

**Personas:** The *child* mode should raise the traffic-hazard and walkpath weights, lower the tolerance for crossing arterials, and use tighter absolute caps, because children walk slower and over shorter distances.

### 6.4 Data sources for Delhi (cold start)

- **Graph:** OSM walking network with `highway=footway|path|pedestrian|residential|…`; `lit`, `sidewalk`, `tunnel`, `bridge`, `barrier`.
- **Lighting:** OSM `lit` (sparse in Delhi); Safetipin dark-spot data (licence it); VIIRS night-lights as a coarse fill; MCD/PWD streetlight complaints; our own reviews.
- **POIs and hours:** OSM and Google Places for pharmacies, hospitals, clinics, shops, police and metro stations. Hours from `opening_hours`.
- **Incidents:** Safecity (needs a Red Dot Foundation agreement); geoparsed news (Sharma 2015, Kaur 2021 approach); a police-station-level prior from published Delhi Police or NCRB data.
- **Validation:** Safetipin audit points; a small field audit by our team using the Safetipin 9-parameter rubric on about 200 segments, split across day and night.

### 6.5 Crowdsourced reviews and the minimum-review threshold

**Unit of aggregation.** Per-edge review counts will be tiny. Aggregate to **segment clusters of about 100–200 m** (merge consecutive OSM edges on the same street), and keep separate day and night buckets.

**Scoring rule.** Bayesian shrinkage towards the model prior, with a hard influence threshold. Let y_i ∈ [0, 1] be the unsafe-ness of review i, with weight v_i (reliability × recency):

$$\hat\rho^{\text{crowd}}_c = \frac{C\cdot\rho^{\text{model}}_c + \sum_i v_i\,y_i}{C + \sum_i v_i}, \qquad v_i = \text{rel}_i \cdot 2^{-\Delta t_i/h}$$

The final edge risk blends the model and crowd estimates only once enough independent reviewers exist:

$$\rho_e = \begin{cases}\rho^{\text{model}}_e & n^{\text{uniq}}_c < n_{\min}\\[2pt] \hat\rho^{\text{crowd}}_c & n^{\text{uniq}}_c \ge n_{\min}\end{cases}$$

**Recommended parameters** [weak: no paper derives these for safety; they are engineering judgement anchored on the cited methods]:
- **n_min = 5 distinct verified users**, per cluster per time bucket, within the last 180 days. Below 5, a single bad-faith actor plus a few friends could flip a segment. Above about 10, most Delhi segments would never qualify in year one.
- **Prior strength C ≈ 5.** With exactly 5 reviews, the crowd and the model each carry about half the weight. At 20 reviews the crowd carries about 80%.
- **Asymmetric safety rule.** Allow *negative* signals to act sooner: n_min = 3 for raising risk, with the increase capped at +0.2, for example. Require n_min ≥ 8 to *lower* risk below the model prior. Missing a real danger costs much more than an unnecessary detour. Equivalently, use the Wilson *upper* bound on P(unsafe) for warnings and the Wilson *lower* bound on P(safe) for bonuses.
- **Recency half-life h ≈ 90 days**, after Jøsang's forgetting factor. Delhi conditions change: lights get fixed, construction starts, vendors move. Severe incident reports (groping, stalking, following) should decay more slowly, with a half-life of about 365 days.
- **Reliability rel_i:** start at 1. Update with Dawid–Skene or Beta reputation once data exists. Cap any single user's influence on one cluster at one review per 7 days.

**What counts as "verified"** (layered, after the Ghost Riders and trajectory-forgery findings):
1. Phone-OTP account, with account age above about 7 days before reviews count.
2. **The review is tied to a completed journey.** The map-matched GPS trace must actually traverse the cluster, at walking speed (about 0.5–2.5 m/s), with plausible GPS noise and pedometer step count.
3. Device integrity attestation (Play Integrity / App Attest). One device = one reviewer.
4. Behavioural anomaly flags (Mukherjee 2013): bursts of reviews, new accounts clustered on one street, all-extreme ratings, many reviews from the same IP or device.
5. Later, optionally: co-location proofs between users (Wang 2016, APPLAUS 2011) and WiFi-scan consistency (Yang 2024).

**Ask structured questions.** Do not use only a 1–5 star score. Ask questions that map onto Safetipin parameters, for example "Was it well lit?", "Were other women around?", "Were shops open?" and "Did anything happen?". Add an optional free-text incident field and classify it with a Safecity-style model (Karlekar & Bansal 2018). Structured answers give us labelled training data to learn the feature weights in §6.1.

### 6.6 Ethics, privacy and framing

- **Stigmatisation risk.** Incident-density and "deserted" maps can paint whole low-income or minority neighbourhoods red. Examples in our sources include Jamia Nagar and Bawana, which are Safetipin study sites. Normalise incidents by footfall. Show risk at street level, not neighbourhood level. Never publish a neighbourhood "danger score". Roy et al. 2022 found affluent gated areas can be the scarier ones for women.
- **Perception ≠ incident risk** (Abraham 2025, UCL 2021). Keep the two layers separate internally, and be transparent in the UI about what drives a route's colour.
- **Do not over-claim** (Weiss 2016). Use "lower-risk route" or "more lit and active route", not "safe route".
- **Location privacy** (Wang 2016). Never show live users. Aggregate reviews with a delay and in coarse buckets. Delete raw GPS traces after verification, keeping only the cluster IDs traversed.

### 6.7 Where evidence is weakest, so we should test early

1. Whether open shops reduce *harassment and assault* risk, as opposed to just making people *feel* safer. The criminology evidence is mixed and facility-dependent.
2. The shape of the busyness curve. Is a crowded bus stop or market better or worse than a moderately busy street for groping risk?
3. Transfer of US and UK lighting effect sizes to Delhi, where streetlight quality, maintenance and land use differ.
4. Whether 4 routes is the right number. Li et al. 2020 typically showed 3 per technique, and decision fatigue on mobile is real. Consider A/B testing 3 against 4.
5. Whether *n_min = 5* gives enough coverage in practice. Monitor the percentage of segments with n ≥ n_min, by ward and by time bucket.

---

## 7. Paper / source index (quick reference)

| # | Short ref | Year | Venue | Topic |
|---|---|---|---|---|
| 1 | Galbrun, Pelechrinis, Terzi | 2014/2016 | UrbComp / Information Systems | Bi-objective safe paths |
| 2 | Levy et al. (SafeRoute) | 2018 | arXiv | RL safe routing |
| 3 | Shah et al. (CROWDSAFE) | 2011 | ACM SIGSPATIAL | Crowd + official crime routing |
| 4 | Kaur, Goyal, Gunturi et al. | 2021 | IEEE MDM | Delhi safe routing, arc orienteering |
| 5 | Sharma et al. | 2015 | NAACL SRW | News-crime NLP routing (India) |
| 6 | Abraham, Delling, Goldberg, Werneck | 2010 | SEA | Via-node alternatives, admissibility |
| 7 | Dees, Geisberger, Sanders, Bader | 2010/11 | arXiv / TAPAS | Penalty method, alternative graphs |
| 8 | Paraskevopoulos, Zaroliagis | 2013 | ATMOS | Improved penalty / plateau |
| 9 | Li, Cheema, Lu, Ali, Toosi | 2020 | arXiv / TKDE | User study of alternative routes |
| 10 | Chondrogiannis et al. | 2018/2020 | SIGSPATIAL / VLDBJ | k dissimilar shortest paths |
| 11 | Yen | 1971 | Management Science | k shortest loopless paths |
| 12 | Martins; Salzman et al. | 1984; 2025 | EJOR; arXiv | Bi-objective / multi-objective search |
| 13 | Quercia, Schifanella, Aiello | 2014 | ACM Hypertext | Perception-based routing |
| 14 | Theron, Breetzke | 2024 | J. Transport Security | Facility proxies, Global South |
| 15 | Rishe, Sadjadi, Adjouadi | 2024 | IPSI Trans. | Crime-type weighting |
| 16 | Mata et al. | 2016 | Mobile Information Systems | Time-indexed crowd risk, Mexico City |
| 17 | Toda-Puiuelet, Trifan | 2025 | womENcourage | Women's night routing, learned re-ranker |
| 18 | Safetipin Delhi report | ~2017 | Report | 9 audit parameters, Delhi stats |
| 19 | Viswanath, Basu | 2015 | Gender & Development | SafetiPin method |
| 20 | Karlekar, Bansal | 2018 | EMNLP | Safecity harassment classification |
| 21 | Borker | 2021 | World Bank WP 9731 | Delhi women's willingness to detour |
| 22 | Jagori / UN Women | 2010/2016 | Reports | Delhi baseline, vendors, police |
| 23 | Kapoor et al. (FIA / Safetipin) | 2020 | FIA Research Series | Last-mile, gender usage |
| 24 | Joshi, Bailey | 2023 | J. Transport Geography | Delhi Metro women's strategies |
| 25 | Tony, Tiwari et al. | 2025 | IATSS Research | Delhi pedestrian perception, vendors |
| 26 | Garg | 2025 | Warwick JMP / SIOE | Metro opening −29% harassment |
| 27 | Roy et al. | 2022 | J. Urban Affairs | Kolkata visibility |
| 28 | Tanner, Kalms et al.; Monash XYX / Arup | 2020; 2019 | IDS Bulletin; report | Crowdmaps; lighting quality > brightness |
| 29 | Nayak, Benazeer | 2017 | J. EASTS | Delhi fear in transport |
| 30 | Weiss | 2016 | Intersect | Apps don't prove safety |
| 31 | Chalfin, Hansen, Lerner, Parker | 2022 | J. Quant. Criminology | Lighting RCT NYC |
| 32 | Welsh, Farrington | 2008 | Campbell Syst. Rev. | Lighting meta-analysis (−21%) |
| 33 | Welsh, Farrington, Douglas | 2021/22 | Brå / CPP | Updated meta-analysis (−14%, violent n.s.) |
| 34 | Tompson, Bowers | 2013 | JRCD | Darkness ×2.6 robbery |
| 35 | Fotios, Uttley, Fox | 2019 | LR&T | Darkness reduces walking, more on unlit routes |
| 36 | Fotios, Unwin | 2013 | CIE Centenary | Access to help ≈ or > lighting |
| 37 | Jacobs | 1961 | Book | Eyes on the street |
| 38 | Cohen, Felson | 1979 | ASR | Routine activity / guardianship |
| 39 | Brantingham, Brantingham | 1995 | EJCPR | Crime generators / attractors |
| 40 | Haberman, Ratcliffe | 2015 | Criminology | Facility effects depend on open hours |
| 41 | Humphrey et al. | 2017 | arXiv / EPB | Longer open hours → less crime |
| 42 | Rosenthal, Urrego | 2021 | WP (AEA) | Retail concentration, frontage |
| 43 | Anderson, MacDonald et al. | 2013 | U. Penn Law Review | Mixed-use vs commercial zoning |
| 44 | Cozens, Saville, Hillier | 2005 | Property Management | CPTED review |
| 45 | Abraham, Kang, Ceccato et al. | 2025 | Annals AAG | Perceived safety vs crime mismatch |
| 46 | Naik et al. (Streetscore) | 2014 | CVPRW | Image-based perceived safety |
| 47 | Wilson / Miller | 1927 / blog | — | Wilson lower bound |
| 48 | Jøsang, Ismail; Miller | 2002 | Bled eCommerce | Beta reputation, forgetting, discounting |
| 49 | Dawid, Skene | 1979 | JRSS-C | Rater reliability (EM) |
| 50 | Yu et al. (SybilGuard) | 2006 | SIGCOMM | Sybil defence |
| 51 | Wang et al. (Ghost Riders) | 2016 | MobiSys | Sybil attacks on Waze |
| 52 | Zhu, Cao (APPLAUS) | 2011 | INFOCOM | Location proofs |
| 53 | Yang et al. | 2024 | IEEE TMC | GPS trajectory forgery and detection |
| 54 | Mukherjee et al. | 2013 | ICWSM | Behavioural fake-review detection |

**Not found / unverified:** I could not pin down a specific "Kim et al." crime-aware pedestrian routing paper. The searches returned Korean lighting and CCTV studies, for example Kim, Lee & Kim 2023 in *Urban Planning* 8(2), a Busan streetlight simulation of nighttime blind spots, but no routing paper. If the team has a specific Kim et al. citation in mind, it should be checked separately. Full texts for Viswanath & Basu 2015, Nayak & Benazeer 2017, Cozens 2005 and Tony et al. 2025 were not opened; those summaries are based on abstracts or news reports.
