// What people type → which kinds of places they mean, and what is "similar" when that
// exact kind is not nearby. Kinds are OpenStreetMap types (amenity/shop/leisure values).

import type { PoiCat } from './places.ts';

export interface Intent {
  /** shown as "<title> near you" */
  title: string;
  /** singular, for "No gym mapped nearby" */
  one: string;
  exact: string[];
  similar: string[];
  /** words and spellings people type, English and common Hinglish */
  words: string[];
}

export const INTENTS: Intent[] = [
  { title: 'Gyms', one: 'gym', exact: ['fitness_centre'], similar: ['sports_centre', 'swimming_pool', 'stadium', 'pitch', 'sports', 'nutrition_supplements', 'dance'],
    words: ['gym', 'gymnasium', 'fitness', 'workout', 'crossfit', 'yoga', 'zumba', 'exercise', 'kasrat'] },
  { title: 'Grocery stores', one: 'grocery store', exact: ['supermarket', 'convenience', 'general', 'greengrocer'], similar: ['dairy', 'department_store', 'marketplace', 'mall', 'butcher', 'bakery'],
    words: ['grocery', 'groceries', 'kirana', 'kiryana', 'general store', 'supermarket', 'mart', 'provision', 'vegetable', 'sabzi', 'fruits', 'ration', 'store'] },
  { title: 'Medical stores', one: 'medical store', exact: ['pharmacy', 'chemist'], similar: ['clinic', 'doctors', 'hospital'],
    words: ['medical', 'medicine', 'chemist', 'pharmacy', 'dawai', 'dawa', 'medicines'] },
  { title: 'Salons and parlours', one: 'salon', exact: ['hairdresser', 'beauty'], similar: ['cosmetics', 'massage', 'perfumery', 'tattoo'],
    words: ['salon', 'saloon', 'parlour', 'parlor', 'barber', 'haircut', 'hair cut', 'beauty', 'spa', 'nail', 'makeup', 'threading'] },
  { title: 'Cafés', one: 'café', exact: ['cafe', 'tea'], similar: ['bakery', 'ice_cream', 'fast_food', 'restaurant', 'pastry'],
    words: ['cafe', 'café', 'coffee', 'chai', 'tea', 'starbucks', 'ccd', 'barista'] },
  { title: 'Restaurants', one: 'restaurant', exact: ['restaurant', 'fast_food', 'food_court'], similar: ['cafe', 'bakery', 'ice_cream', 'bar'],
    words: ['restaurant', 'food', 'eat', 'dinner', 'lunch', 'breakfast', 'dhaba', 'khana', 'biryani', 'pizza', 'burger', 'momos', 'chinese', 'thali', 'mcdonald', 'kfc', 'domino'] },
  { title: 'Bakeries and sweet shops', one: 'bakery', exact: ['bakery', 'pastry', 'confectionery'], similar: ['cafe', 'ice_cream', 'dairy'],
    words: ['bakery', 'cake', 'pastry', 'sweets', 'sweet shop', 'mithai', 'halwai', 'bread'] },
  { title: 'Ice cream', one: 'ice cream shop', exact: ['ice_cream'], similar: ['cafe', 'bakery', 'confectionery'], words: ['ice cream', 'icecream', 'kulfi', 'gelato'] },
  { title: 'ATMs and banks', one: 'ATM', exact: ['atm', 'bank'], similar: ['bureau_de_change', 'post_office'], words: ['atm', 'bank', 'cash', 'withdraw', 'money'] },
  { title: 'Clothes shops', one: 'clothes shop', exact: ['clothes', 'boutique', 'fabric'], similar: ['tailor', 'shoes', 'bag', 'fashion_accessories', 'department_store', 'mall'],
    words: ['clothes', 'clothing', 'garment', 'kapde', 'kurti', 'saree', 'jeans', 'shirt', 'dress', 'boutique', 'fashion', 'apparel'] },
  { title: 'Shoe shops', one: 'shoe shop', exact: ['shoes'], similar: ['clothes', 'bag', 'sports', 'mall', 'department_store'], words: ['shoe', 'shoes', 'footwear', 'chappal', 'sandal', 'sneaker'] },
  { title: 'Mobile shops', one: 'mobile shop', exact: ['mobile_phone', 'telecommunication'], similar: ['electronics', 'computer', 'electronics_repair'],
    words: ['mobile', 'phone', 'recharge', 'sim', 'smartphone', 'charger', 'airtel', 'jio'] },
  { title: 'Electronics', one: 'electronics shop', exact: ['electronics', 'computer', 'appliance', 'electronics_repair'], similar: ['mobile_phone', 'electrical', 'hardware'],
    words: ['electronics', 'laptop', 'computer', 'tv', 'appliance', 'repair'] },
  { title: 'Stationery and print shops', one: 'stationery shop', exact: ['stationery', 'copyshop'], similar: ['books', 'gift'],
    words: ['stationery', 'stationary', 'xerox', 'photocopy', 'print', 'printout', 'pen', 'notebook'] },
  { title: 'Book shops', one: 'book shop', exact: ['books'], similar: ['stationery', 'library'], words: ['book', 'books', 'bookstore', 'kitab'] },
  { title: 'Jewellers', one: 'jeweller', exact: ['jewelry'], similar: ['watches', 'fashion_accessories', 'gift'], words: ['jewel', 'jewellery', 'jewelry', 'gold', 'silver', 'sunar', 'ring'] },
  { title: 'Opticians', one: 'optician', exact: ['optician'], similar: ['clinic', 'doctors'], words: ['optician', 'glasses', 'spectacles', 'chashma', 'lens', 'eye'] },
  { title: 'Clinics and doctors', one: 'clinic', exact: ['clinic', 'doctors', 'dentist'], similar: ['hospital', 'pharmacy', 'laboratory'],
    words: ['doctor', 'clinic', 'dentist', 'dental', 'physician', 'lab', 'pathology', 'test'] },
  { title: 'Hospitals', one: 'hospital', exact: ['hospital'], similar: ['clinic', 'doctors', 'blood_bank'], words: ['hospital', 'emergency', 'aiims', 'nursing home'] },
  { title: 'Malls and markets', one: 'mall', exact: ['mall', 'marketplace', 'department_store'], similar: ['supermarket', 'clothes', 'cinema'],
    words: ['mall', 'market', 'bazaar', 'bazar', 'shopping', 'complex'] },
  { title: 'Petrol pumps', one: 'petrol pump', exact: ['fuel'], similar: ['charging_station', 'car_repair'], words: ['petrol', 'diesel', 'cng', 'fuel', 'pump', 'gas station'] },
  { title: 'EV charging', one: 'charging station', exact: ['charging_station'], similar: ['fuel'], words: ['ev', 'charging', 'charger station', 'electric vehicle'] },
  { title: 'Public toilets', one: 'toilet', exact: ['toilets'], similar: ['mall', 'fuel', 'station'], words: ['toilet', 'washroom', 'restroom', 'bathroom', 'loo', 'sulabh'] },
  { title: 'Bus stops', one: 'bus stop', exact: ['bus_stop', 'bus_station'], similar: ['station'], words: ['bus', 'bus stop', 'dtc'] },
  { title: 'Metro stations', one: 'metro station', exact: ['station'], similar: ['bus_station', 'bus_stop'], words: ['metro', 'station', 'railway', 'train'] },
  { title: 'Police', one: 'police station', exact: ['police'], similar: ['government', 'fire_station'], words: ['police', 'thana', 'chowki', 'pcr'] },
  { title: 'Hotels and stays', one: 'hotel', exact: ['hotel', 'guest_house', 'hostel'], similar: ['restaurant'], words: ['hotel', 'stay', 'room', 'lodge', 'hostel', 'pg', 'guest house', 'oyo'] },
  { title: 'Cinemas', one: 'cinema', exact: ['cinema', 'theatre'], similar: ['mall', 'events_venue', 'arts_centre'], words: ['cinema', 'movie', 'film', 'pvr', 'inox', 'theatre', 'theater'] },
  { title: 'Parks', one: 'park', exact: ['park', 'garden', 'playground'], similar: ['pitch', 'sports_centre'], words: ['park', 'garden', 'playground', 'walk'] },
  { title: 'Laundry and dry cleaning', one: 'laundry', exact: ['laundry', 'dry_cleaning'], similar: ['tailor'], words: ['laundry', 'dry clean', 'dryclean', 'iron', 'press', 'dhobi'] },
  { title: 'Tailors', one: 'tailor', exact: ['tailor'], similar: ['clothes', 'fabric', 'boutique'], words: ['tailor', 'darzi', 'stitching', 'alteration'] },
  { title: 'Hardware shops', one: 'hardware shop', exact: ['hardware', 'electrical', 'paint', 'doityourself'], similar: ['houseware', 'furniture'], words: ['hardware', 'electrical', 'paint', 'plumber', 'tools'] },
  { title: 'Car and bike repair', one: 'mechanic', exact: ['car_repair', 'motorcycle_repair', 'tyres', 'car_parts'], similar: ['fuel', 'car', 'motorcycle'],
    words: ['mechanic', 'garage', 'puncture', 'tyre', 'tire', 'service centre', 'car repair', 'bike repair'] },
  { title: 'Pet shops and vets', one: 'pet shop', exact: ['pet', 'veterinary'], similar: [], words: ['pet', 'vet', 'veterinary', 'dog food', 'animal'] },
  { title: 'Post offices', one: 'post office', exact: ['post_office'], similar: ['courier', 'bank'], words: ['post', 'post office', 'courier', 'speed post'] },
  { title: 'Places of worship', one: 'place of worship', exact: ['place_of_worship'], similar: [], words: ['temple', 'mandir', 'mosque', 'masjid', 'gurudwara', 'gurdwara', 'church'] },
  { title: 'Schools and colleges', one: 'school', exact: ['school', 'college', 'university', 'educational_institution'], similar: ['kindergarten', 'prep_school', 'library'],
    words: ['school', 'college', 'university', 'coaching', 'institute', 'tuition'] },
  { title: 'Libraries', one: 'library', exact: ['library'], similar: ['books', 'community_centre'], words: ['library', 'reading room'] },
  { title: 'Florists and gift shops', one: 'florist', exact: ['florist', 'gift'], similar: ['toys', 'confectionery'], words: ['flower', 'florist', 'gift', 'bouquet'] },
  { title: 'Furniture', one: 'furniture shop', exact: ['furniture', 'interior_decoration', 'bed'], similar: ['houseware', 'hardware'], words: ['furniture', 'sofa', 'mattress', 'decor'] },
  { title: 'Liquor shops and bars', one: 'liquor shop', exact: ['alcohol', 'bar', 'pub', 'beverages'], similar: [], words: ['liquor', 'wine', 'beer', 'theka', 'bar', 'pub', 'daaru', 'alcohol'] },
  { title: 'Parking', one: 'parking', exact: ['parking'], similar: [], words: ['parking'] },
  { title: 'Shops', one: 'shop', exact: ['convenience', 'general', 'supermarket', 'clothes', 'mobile_phone', 'electronics', 'department_store', 'variety_store', 'gift', 'stationery'],
    similar: ['mall', 'marketplace'], words: ['shop', 'shops', 'dukaan', 'dukan', 'store'] },
];

const LABELS: Record<string, string> = {
  fitness_centre: 'Gym', sports_centre: 'Sports centre', swimming_pool: 'Swimming pool', stadium: 'Stadium', pitch: 'Sports ground', sports: 'Sports shop',
  nutrition_supplements: 'Supplements shop', dance: 'Dance studio', supermarket: 'Supermarket', convenience: 'Grocery store', general: 'General store',
  greengrocer: 'Fruits & vegetables', dairy: 'Dairy', department_store: 'Department store', marketplace: 'Market', mall: 'Mall', butcher: 'Meat shop',
  bakery: 'Bakery', pharmacy: 'Medical store', chemist: 'Chemist', clinic: 'Clinic', doctors: 'Doctor', dentist: 'Dentist', hospital: 'Hospital',
  hairdresser: 'Salon', beauty: 'Beauty parlour', cosmetics: 'Cosmetics', massage: 'Spa', perfumery: 'Perfumes', tattoo: 'Tattoo studio',
  cafe: 'Café', tea: 'Tea shop', ice_cream: 'Ice cream', fast_food: 'Fast food', restaurant: 'Restaurant', food_court: 'Food court', pastry: 'Pastry shop',
  confectionery: 'Sweet shop', bar: 'Bar', pub: 'Pub', alcohol: 'Liquor shop', beverages: 'Drinks shop', atm: 'ATM', bank: 'Bank', bureau_de_change: 'Money exchange',
  post_office: 'Post office', clothes: 'Clothes shop', boutique: 'Boutique', fabric: 'Fabric shop', tailor: 'Tailor', shoes: 'Shoe shop', bag: 'Bag shop',
  fashion_accessories: 'Accessories', mobile_phone: 'Mobile shop', telecommunication: 'Telecom shop', electronics: 'Electronics', computer: 'Computer shop',
  appliance: 'Appliances', electronics_repair: 'Electronics repair', electrical: 'Electrical shop', hardware: 'Hardware shop', stationery: 'Stationery',
  copyshop: 'Print & copy', books: 'Book shop', library: 'Library', jewelry: 'Jeweller', watches: 'Watch shop', gift: 'Gift shop', optician: 'Optician',
  laboratory: 'Lab', blood_bank: 'Blood bank', fuel: 'Petrol pump', charging_station: 'EV charging', car_repair: 'Car repair', motorcycle_repair: 'Bike repair',
  tyres: 'Tyre shop', car_parts: 'Car parts', car: 'Car dealer', motorcycle: 'Bike dealer', toilets: 'Public toilet', bus_stop: 'Bus stop',
  bus_station: 'Bus station', station: 'Metro / rail station', police: 'Police', government: 'Government office', fire_station: 'Fire station',
  hotel: 'Hotel', guest_house: 'Guest house', hostel: 'Hostel', cinema: 'Cinema', theatre: 'Theatre', events_venue: 'Event venue', arts_centre: 'Arts centre',
  park: 'Park', garden: 'Garden', playground: 'Playground', laundry: 'Laundry', dry_cleaning: 'Dry cleaner', paint: 'Paint shop', doityourself: 'DIY store',
  houseware: 'Household goods', furniture: 'Furniture', interior_decoration: 'Interior decor', bed: 'Mattress shop', pet: 'Pet shop', veterinary: 'Vet',
  courier: 'Courier', place_of_worship: 'Place of worship', school: 'School', college: 'College', university: 'University',
  educational_institution: 'Institute', kindergarten: 'Kindergarten', prep_school: 'Coaching centre', florist: 'Florist', toys: 'Toy shop',
  community_centre: 'Community centre', parking: 'Parking', variety_store: 'Variety store', attraction: 'Attraction', monument: 'Monument', museum: 'Museum',
};
export function kindLabel(sub: string): string {
  return LABELS[sub] ?? sub.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

/** Closest safety category, so open/closed and default opening hours work for every kind. */
export function kindCat(sub: string): PoiCat {
  if (['police'].includes(sub)) return 'police';
  if (['hospital'].includes(sub)) return 'hospital';
  if (['clinic', 'doctors', 'dentist', 'laboratory', 'blood_bank', 'veterinary'].includes(sub)) return 'clinic';
  if (['pharmacy', 'chemist'].includes(sub)) return 'pharmacy';
  if (['station', 'bus_station'].includes(sub)) return 'station';
  if (['fuel', 'charging_station'].includes(sub)) return 'fuel';
  if (['atm'].includes(sub)) return 'atm';
  if (['bank', 'bureau_de_change'].includes(sub)) return 'bank';
  if (['government', 'post_office', 'fire_station'].includes(sub)) return 'govt';
  if (['hotel', 'guest_house', 'hostel'].includes(sub)) return 'hotel';
  if (['alcohol', 'bar', 'pub', 'beverages'].includes(sub)) return 'liquor';
  if (['place_of_worship'].includes(sub)) return 'worship';
  if (['restaurant', 'fast_food', 'cafe', 'tea', 'ice_cream', 'bakery', 'pastry', 'confectionery', 'food_court'].includes(sub)) return 'food';
  return 'shop';
}

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * What kind of place the person is typing about, if any. Matches whole words and
 * prefixes of 3+ letters ("gy" no, "gym" yes, "groc" yes), and a mapped type name.
 */
export function matchIntent(query: string, knownSubs?: Set<string>): Intent | null {
  const q = norm(query);
  if (q.length < 3) return null;
  let best: { intent: Intent; score: number } | null = null;
  for (const intent of INTENTS) {
    for (const w of intent.words) {
      const ww = norm(w);
      let score = 0;
      if (q === ww) score = 3;
      else if (ww.startsWith(q) && q.length >= 3) score = 2 + q.length / ww.length / 2;
      else if (q.split(' ').some((t) => t === ww) || (` ${q} `).includes(` ${ww} `)) score = 1.5;
      if (score && (!best || score > best.score)) best = { intent, score };
    }
  }
  if (best) return best.intent;
  // a mapped type typed directly, e.g. "tattoo", "florist"
  if (knownSubs) {
    const t = q.replace(/ /g, '_');
    for (const s of knownSubs) {
      if (s === t || (t.length >= 4 && s.startsWith(t)) || norm(kindLabel(s)) === q) {
        return { title: `${kindLabel(s)}s`, one: kindLabel(s).toLowerCase(), exact: [s], similar: [], words: [] };
      }
    }
  }
  return null;
}
