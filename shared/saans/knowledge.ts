// Saans knowledge base: short, checked notes the assistant answers from. Every note
// names where its numbers come from, so the model can cite them and we never ask it
// to invent figures. Notes are grouped into topic clusters; retrieval (retrieve.ts)
// first finds the cluster a question belongs to, then the best notes inside it.

export type Cluster = 'outdoor' | 'indoor' | 'health' | 'swaps' | 'city';

export interface Note {
  id: string;
  cluster: Cluster;
  title: string;
  text: string;
  /** extra words people use for this topic (English, Hindi, Hinglish) */
  tags: string;
  source: string;
}

export const CLUSTERS: Record<Cluster, { label: string; icon: string }> = {
  outdoor: { label: 'Going out', icon: 'walk' },
  indoor: { label: 'At home', icon: 'home' },
  health: { label: 'Family health', icon: 'health' },
  swaps: { label: 'Cleaner swaps', icon: 'leaf' },
  city: { label: 'Delhi air', icon: 'wind' },
};

export const NOTES: Note[] = [
  // ---------------- outdoor
  {
    id: 'timing', cluster: 'outdoor', title: 'Pick the cleanest hours',
    text: 'Air in Delhi changes a lot through the day. In winter the worst hours are usually late night to early morning, when cold air traps smoke near the ground; the air is often cleanest in the early afternoon when the ground warms and the air mixes. Move walks, play and errands to the cleanest window in the forecast.',
    tags: 'time when best hour morning walk evening subah shaam kab bahar jaana schedule routine plan day',
    source: 'Boundary-layer mixing; CAMS hourly forecast',
  },
  {
    id: 'morning-walk', cluster: 'outdoor', title: 'Winter morning walks',
    text: 'The habit of an early-morning walk is often the worst choice in Delhi winters: PM2.5 is frequently highest between about 5 and 9 am. On Poor or worse days, walk later in the day, walk indoors (a mall, a covered corridor) or keep it short.',
    tags: 'morning walk jogging park subah ki sair winter sardi exercise',
    source: 'CPCB hourly data patterns; temperature inversion',
  },
  {
    id: 'exercise', cluster: 'outdoor', title: 'Exercise on bad-air days',
    text: 'Hard exercise makes you breathe several times more air per minute, so you take in far more particles. On Poor days move intense workouts indoors or into the cleanest hours; on Very Poor or Severe days keep exercise light and indoors. Avoid running beside busy roads at any AQI.',
    tags: 'gym run running cycling yoga workout sports cricket football khelna exercise breathing rate',
    source: 'US EPA Exposure Factors Handbook (breathing rates by activity)',
  },
  {
    id: 'mask', cluster: 'outdoor', title: 'Masks that work',
    text: 'A well-fitted N95 (or FFP2/KN95) mask filters at least 95% of fine particles; cloth and loose surgical masks let much of PM2.5 through around the edges. Fit matters more than brand: it should seal at the nose and chin. Replace it when it is dirty, damp or hard to breathe through. Masks are not advised for children under 2.',
    tags: 'mask n95 kn95 ffp2 surgical cloth face cover filter which mask bachche ke liye',
    source: 'NIOSH N95 standard; WHO guidance',
  },
  {
    id: 'quiet-streets', cluster: 'outdoor', title: 'Quieter streets, cleaner air',
    text: 'Traffic exhaust is strongest on and right beside busy roads and fades within roughly 100–200 m. Walking or cycling one street back from a main road, or through a park, can noticeably cut what you breathe. SafeRaah\'s "Cleanest air" route does this for you.',
    tags: 'route road street side lane gali main road traffic exhaust smoke route choose cleanest',
    source: 'Near-road pollution gradient studies (US EPA, HEI)',
  },
  {
    id: 'commute-mode', cluster: 'outdoor', title: 'How you travel changes what you breathe',
    text: 'People on two-wheelers, in open autos and walking along traffic breathe the exhaust stream directly. Metro coaches are filtered and air-conditioned, so riders usually breathe less PM2.5 than on the road. In a car, keep windows up and use recirculation in heavy traffic, and change the cabin filter on time.',
    tags: 'metro auto bus car scooty bike two wheeler commute office school travel safar cab',
    source: 'Delhi commuter-exposure studies (IIT Delhi and others)',
  },
  {
    id: 'school-run', cluster: 'outdoor', title: 'School runs and outdoor play',
    text: 'Children breathe more air for their body size and play close to the ground and to exhaust pipes. On Very Poor or Severe days keep outdoor play short, use quieter streets for the school run, and avoid waiting next to idling buses and cars at the gate.',
    tags: 'school children kids bachche play ground playground pick up drop school bus',
    source: 'WHO: children and air pollution',
  },

  // ---------------- indoor
  {
    id: 'purifier-size', cluster: 'indoor', title: 'How big a purifier you need',
    text: 'Size a purifier by its CADR (clean air delivery rate). For smoky city air aim for about 5 air changes an hour: CADR in m³/h ≈ room floor area (m²) × ceiling height (m) × 5. A 12 m² bedroom with a 3 m ceiling needs about 180 m³/h. Run it with doors and windows shut, on a medium setting all night, and keep it where air can flow around it.',
    tags: 'air purifier filter hepa cadr size room bedroom kitchen kitna bada which purifier buy machine',
    source: 'AHAM CADR standard; US EPA guide to air cleaners',
  },
  {
    id: 'purifier-care', cluster: 'indoor', title: 'Purifiers: filters and pitfalls',
    text: 'Use a true HEPA (H13) filter and replace it as the maker says (often every 6–12 months in Delhi). Avoid "ionizer" or "ozone" purifiers: ozone irritates the lungs. Plants and salt lamps do not replace a purifier.',
    tags: 'hepa filter change ozone ionizer purifier maintenance replace',
    source: 'US EPA: ozone generators; CARB',
  },
  {
    id: 'diy-filter', cluster: 'indoor', title: 'A low-cost fan filter',
    text: 'If a purifier is too costly, a box or table fan with a fine filter (MERV-13 or HEPA sheet) taped to its back cleans a small room surprisingly well. Seal the edges so air goes through the filter, and switch it off when you leave the room.',
    tags: 'cheap budget diy fan filter sasta jugaad homemade corsi rosenthal box',
    source: 'Corsi–Rosenthal box studies',
  },
  {
    id: 'ventilate', cluster: 'indoor', title: 'When to open the windows',
    text: 'On bad days keep windows mostly shut, but do not seal the house all day: open them for 10–15 minutes during the cleanest hour of the forecast to let out cooking fumes and stale air (a purifier does not remove carbon dioxide or gases).',
    tags: 'window open close khidki darwaza ventilation fresh air stale co2 suffocation band',
    source: 'Indoor air quality guidance (ASHRAE, WHO)',
  },
  {
    id: 'cooking', cluster: 'indoor', title: 'Cooking smoke',
    text: 'Frying, tadka and roasting at high heat can push kitchen PM2.5 far above the outdoor level for a while. Use a chimney or exhaust fan that vents outside, cover pans, keep the kitchen window open while cooking even on bad days, and keep children out of the kitchen during frying. LPG and induction are far cleaner than wood, coal or kerosene.',
    tags: 'cooking kitchen tadka frying gas lpg chulha smoke chimney exhaust khana banana roti tawa',
    source: 'WHO household air pollution fact sheet',
  },
  {
    id: 'incense', cluster: 'indoor', title: 'Incense, coils and candles',
    text: 'Agarbatti, dhoop, mosquito coils and candles release a lot of fine smoke indoors. Studies have found one mosquito coil can give off as much fine particle mass as dozens of cigarettes. Use them less, near an open window, or switch to electric repellents and diyas without smoke.',
    tags: 'agarbatti dhoop incense mosquito coil candle diya puja smoke hawan machchar',
    source: 'Liu et al., Environmental Health Perspectives 2003',
  },
  {
    id: 'cleaning', cluster: 'indoor', title: 'Clean without stirring dust',
    text: 'Dry sweeping with a jhadu throws fine dust back into the air. Wet-mop floors and wipe surfaces with a damp cloth, vacuum with a HEPA filter if you have one, and leave shoes at the door.',
    tags: 'jhadu pocha mop sweep cleaning dust dusting safai vacuum shoes',
    source: 'Indoor dust resuspension studies',
  },
  {
    id: 'plants', cluster: 'indoor', title: 'Do house plants clean the air?',
    text: 'Not measurably at room scale: a 2019 review estimated you would need between 10 and 1,000 plants per square metre to match normal ventilation. Keep plants because you like them, but rely on a purifier or filtered fan for particles.',
    tags: 'plants money plant snake plant tulsi areca palm nasa ped paudhe',
    source: 'Cummings & Waring, J. Exposure Science 2019',
  },
  {
    id: 'smoking', cluster: 'indoor', title: 'No smoking indoors',
    text: 'Tobacco smoke indoors is one of the largest sources of fine particles in a home, and it lingers for hours. Keep homes and cars smoke-free, especially with children, elders or anyone with asthma.',
    tags: 'cigarette smoking beedi hookah tobacco smoke indoors car',
    source: 'WHO tobacco fact sheet',
  },

  // ---------------- health
  {
    id: 'children', cluster: 'health', title: 'Children',
    text: 'Children breathe faster and their lungs are still growing, so the same air does them more harm. Keep them indoors in a purified room on Severe days, plan play for the cleanest hours, and use a well-fitted child-size N95 only for children old enough to wear it properly.',
    tags: 'children kids baby bachche toddler school lungs growth',
    source: 'WHO: Air pollution and child health (2018)',
  },
  {
    id: 'elders', cluster: 'health', title: 'Elders and heart or lung conditions',
    text: 'Older people and anyone with heart disease, COPD or diabetes are more affected by fine particles. On Poor or worse days they should avoid exertion outdoors, keep usual medicines at hand, and sleep in the purified room.',
    tags: 'elderly old parents dadi nani grandparents heart copd bp diabetes',
    source: 'WHO air quality guidelines 2021',
  },
  {
    id: 'asthma', cluster: 'health', title: 'Asthma',
    text: 'Follow your written asthma action plan, carry the reliever inhaler, and take preventer medicine as prescribed (do not stop it on good days without your doctor). Bad-air days, smoke and dust are common triggers.',
    tags: 'asthma inhaler wheezing breathless dama saans phoolna allergy',
    source: 'Global Initiative for Asthma (GINA)',
  },
  {
    id: 'pregnancy', cluster: 'health', title: 'Pregnancy',
    text: 'High exposure to fine particles during pregnancy is linked to low birth weight and early birth. Reduce time outdoors on bad days, use a purifier in the bedroom, avoid smoke at home and in the kitchen, and talk to your doctor about any breathing trouble.',
    tags: 'pregnant pregnancy expecting mother baby garbh',
    source: 'Lancet Planetary Health and WHO reviews',
  },
  {
    id: 'symptoms', cluster: 'health', title: 'When to see a doctor',
    text: 'Itchy eyes, sore throat and a light cough are common on bad days. Get medical help for breathlessness that does not settle with rest, chest pain or tightness, blue lips, or wheezing in a child. In an emergency call 112.',
    tags: 'cough khansi throat gala eyes aankh jalan breathless chest pain doctor emergency headache',
    source: 'General medical guidance',
  },

  // ---------------- swaps
  {
    id: 'co2-modes', cluster: 'swaps', title: 'Carbon per kilometre, by travel mode',
    text: 'Rough averages per person per km: a petrol car with one person about 0.17 kg CO₂, a two-wheeler about 0.05 kg, a shared CNG auto about 0.07 kg, a full CNG bus about 0.04 kg, Delhi Metro about 0.03 kg, walking or cycling zero. Sharing a car with 3 people cuts each person\'s share to about a third.',
    tags: 'co2 carbon emission footprint car metro bus scooty cycle walk km per kilometre climate',
    source: 'IPCC/ICCT averages; Delhi Metro sustainability reports (rounded)',
  },
  {
    id: 'idling', cluster: 'swaps', title: 'Engine off at red lights',
    text: 'An idling engine burns fuel and puts out exhaust while going nowhere. Delhi\'s "Red Light On, Gaadi Off" campaign asks drivers to switch off at long signals and jams. Also skip idling outside schools and homes.',
    tags: 'red light signal idling engine off gaadi band traffic jam fuel petrol diesel',
    source: 'Delhi Government campaign',
  },
  {
    id: 'puc', cluster: 'swaps', title: 'Keep the vehicle tuned',
    text: 'A valid Pollution Under Control (PUC) certificate is required by law in Delhi, and a serviced engine with correct tyre pressure burns less fuel and smokes less. A car or bike that leaves visible smoke needs repair.',
    tags: 'puc certificate vehicle service tyre pressure smoke petrol diesel challan',
    source: 'Central Motor Vehicles Rules; Delhi Transport Dept.',
  },
  {
    id: 'burning', cluster: 'swaps', title: 'Never burn garbage or leaves',
    text: 'Open burning of garbage, leaves and plastic is banned in Delhi and gives off thick, toxic smoke right where people live. Compost leaves and kitchen waste instead, give dry waste to the collector, and report burning you see (SafeRaah\'s report button, or the Green Delhi app).',
    tags: 'garbage burning kooda jalana leaves plastic fire compost waste report green delhi',
    source: 'NGT orders; Delhi Pollution Control Committee',
  },
  {
    id: 'cooking-fuel', cluster: 'swaps', title: 'Cleaner cooking fuel',
    text: 'Moving from wood, coal or kerosene to LPG or induction removes most cooking smoke from the home. Induction has no flame at all, and a pressure cooker or lid cuts cooking time and fuel.',
    tags: 'induction lpg gas chulha wood coal kerosene fuel cooker cooking swap',
    source: 'WHO household energy guidance',
  },
  {
    id: 'crackers', cluster: 'swaps', title: 'Festivals without firecrackers',
    text: 'Firecrackers send PM2.5 soaring in a few hours on Diwali and weddings, and they are banned in Delhi. Celebrate with diyas, lights and music instead.',
    tags: 'diwali firecrackers patakhe wedding baraat festival celebration',
    source: 'Supreme Court and DPCC orders',
  },
  {
    id: 'electricity', cluster: 'swaps', title: 'Use power wisely',
    text: 'Much of the region\'s power still comes from coal. LED bulbs, setting the AC to 24–26 °C and switching off appliances at the wall all cut emissions and the electricity bill.',
    tags: 'electricity power led ac bijli bill energy save coal',
    source: 'Bureau of Energy Efficiency',
  },

  // ---------------- city
  {
    id: 'aqi-scale', cluster: 'city', title: 'What the AQI numbers mean',
    text: 'India\'s National AQI runs from 0 to 500: Good 0–50, Satisfactory 51–100, Moderate 101–200, Poor 201–300, Very Poor 301–400, Severe 401–500. It is set by the worst pollutant; in Delhi that is usually PM2.5. The WHO guideline for PM2.5 is 15 µg/m³ over a day; India\'s standard is 60 µg/m³.',
    tags: 'aqi meaning number scale level index good poor severe pm2.5 pm10 kya hai',
    source: 'CPCB National AQI (2014); WHO AQG 2021',
  },
  {
    id: 'grap', cluster: 'city', title: 'GRAP: Delhi\'s pollution emergency stages',
    text: 'The Commission for Air Quality Management triggers the Graded Response Action Plan by AQI: Stage I (Poor), Stage II (Very Poor), Stage III (Severe) and Stage IV (Severe+). Higher stages add bans on construction, some diesel vehicles and, at Stage IV, can move schools online.',
    tags: 'grap stage ban construction school closed odd even caqm rules restriction',
    source: 'CAQM Graded Response Action Plan',
  },
  {
    id: 'season', cluster: 'city', title: 'Why winter is worst',
    text: 'From October to January, crop-stubble smoke from neighbouring states, festival fireworks, low winds and cold air near the ground pile up on top of Delhi\'s everyday traffic, dust and industry. Monsoon months usually have the cleanest air.',
    tags: 'winter november october stubble parali season why delhi pollution cause reason',
    source: 'SAFAR / IITM source apportionment',
  },
  {
    id: 'sources', cluster: 'city', title: 'Where Delhi\'s pollution comes from',
    text: 'Vehicles, road and construction dust, industry, waste burning and the three big landfills (Ghazipur, Bhalswa, Okhla) all add to Delhi\'s air. Near industrial estates and landfills the air is usually worse than the city average, which is why SafeRaah steers clean-air routes away from them.',
    tags: 'source cause industry factory landfill ghazipur bhalswa okhla dust traffic why',
    source: 'IIT Kanpur source apportionment (2016); DPCC',
  },
  {
    id: 'data', cluster: 'city', title: 'Where SafeRaah\'s air numbers come from',
    text: 'The city reading and the hourly forecast come from the Copernicus CAMS model (through Open-Meteo, or Google\'s Air Quality API when the server has it). These describe an area several kilometres wide. SafeRaah then estimates street-level differences from road type, industrial land and landfills, so route numbers are estimates, not measurements.',
    tags: 'data source accurate accuracy model cams forecast how calculate estimate',
    source: 'Copernicus Atmosphere Monitoring Service',
  },
];
