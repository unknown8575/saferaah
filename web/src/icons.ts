// Line icons (Lucide, ISC licence) drawn as inline SVG, so they stay crisp, take the
// text colour, and look the same on every phone — unlike emoji.
import {
  createElement, Search, Menu, Layers, LocateFixed, Navigation, TriangleAlert, ShieldCheck, Hospital, Stethoscope, Pill,
  TrainFront, Fuel, ShoppingBag, Utensils, Landmark, Wine, Moon, UserX, ShieldAlert, Footprints, Dog, Volume2, VolumeX, X,
  ChevronLeft, ChevronRight, ArrowUpDown, Bike, Car, CarTaxiFront, MapPin, Users, CircleHelp, Phone, Share, Star, Check,
  ArrowUp, CornerUpLeft, CornerUpRight, ArrowUpLeft, ArrowUpRight, ArrowDownLeft, ArrowDownRight, Undo2, Flag, Clock, Sun,
  Siren, Trees, Store, School, Building2, Lock, Lightbulb, Construction, Eye, BedDouble, Map as MapIcon, Bus, Sparkles,
  Dumbbell, Coffee, Scissors, ShoppingCart, Shirt, Smartphone, Croissant, IceCreamCone, Banknote, BookOpen, Gem, Glasses, Film,
  Toilet, SquareParking, WashingMachine, Wrench, PawPrint, Mail, GraduationCap, Library, Flower2, Sofa, Beer, Laptop, Printer,
  Hammer, Plug, Pizza, Church, Hotel,
  type IconNode,
} from 'lucide';

const ICONS: Record<string, IconNode> = {
  search: Search, menu: Menu, layers: Layers, locate: LocateFixed, navigate: Navigation, alert: TriangleAlert,
  police: ShieldCheck, hospital: Hospital, clinic: Stethoscope, pharmacy: Pill, station: TrainFront, fuel: Fuel,
  shop: ShoppingBag, food: Utensils, govt: Landmark, liquor: Wine, hotel: BedDouble, bus: Bus,
  dark: Moon, deserted: UserX, harassment: ShieldAlert, drunk: Wine, followed: Footprints, dogs: Dog, patrol: Siren,
  voice: Volume2, mute: VolumeX, close: X, back: ChevronLeft, next: ChevronRight, swap: ArrowUpDown,
  walk: Footprints, twowheeler: Bike, auto: CarTaxiFront, car: Car, pin: MapPin, contacts: Users, help: CircleHelp,
  phone: Phone, share: Share, star: Star, check: Check, clock: Clock, sun: Sun, moon: Moon, lock: Lock, map: MapIcon,
  park: Trees, market: Store, school: School, office: Building2, landmark: Landmark, street: MapIcon, place: MapPin,
  lit: Lightbulb, works: Construction, seen: Eye, sparkle: Sparkles,
  gym: Dumbbell, cafe: Coffee, salon: Scissors, grocery: ShoppingCart, clothes: Shirt, mobile: Smartphone, bakery: Croissant,
  icecream: IceCreamCone, money: Banknote, books: BookOpen, jewel: Gem, optician: Glasses, cinema: Film, toilet: Toilet,
  parking: SquareParking, laundry: WashingMachine, repair: Wrench, pet: PawPrint, post: Mail, education: GraduationCap,
  library: Library, flower: Flower2, furniture: Sofa, bar: Beer, laptop: Laptop, print: Printer, hardware: Hammer, ev: Plug,
  restaurant: Pizza, worship: Church, stay: Hotel,
  // turn arrows
  start: ArrowUp, straight: ArrowUp, slight_left: ArrowUpLeft, left: CornerUpLeft, sharp_left: ArrowDownLeft,
  slight_right: ArrowUpRight, right: CornerUpRight, sharp_right: ArrowDownRight, uturn: Undo2, arrive: Flag,
};

export function icon(name: string, size = 20, stroke = 1.9): SVGElement {
  const node = ICONS[name] ?? MapPin;
  const el = createElement(node) as unknown as SVGElement;
  el.setAttribute('width', String(size));
  el.setAttribute('height', String(size));
  el.setAttribute('stroke-width', String(stroke));
  el.setAttribute('aria-hidden', 'true');
  el.classList.add('ic');
  return el;
}

/** The icon to use for a map place category or search result type. */
export function placeIcon(kind: string): string {
  const map: Record<string, string> = {
    police: 'police', hospital: 'hospital', clinic: 'clinic', pharmacy: 'pharmacy', station: 'station', fuel: 'fuel',
    shop: 'shop', food: 'food', govt: 'govt', liquor: 'liquor', hotel: 'hotel', bus_station: 'bus', bus: 'bus',
    park: 'park', market: 'market', school: 'school', office: 'office', landmark: 'landmark', street: 'street',
  };
  return map[kind] ?? 'place';
}

export const REPORT_ICON: Record<string, string> = {
  dark: 'dark', deserted: 'deserted', harassment: 'harassment', drunk: 'drunk', followed: 'followed', dogs: 'dogs', police: 'patrol',
};

/** Icon for a precise place type (gym, cafe, salon…). */
export function subIcon(sub: string): string {
  const m: Record<string, string> = {
    fitness_centre: 'gym', sports_centre: 'gym', swimming_pool: 'gym', stadium: 'gym', pitch: 'park', sports: 'gym', dance: 'gym',
    supermarket: 'grocery', convenience: 'grocery', general: 'grocery', greengrocer: 'grocery', dairy: 'grocery', department_store: 'shop',
    marketplace: 'market', mall: 'market', butcher: 'grocery', variety_store: 'shop',
    cafe: 'cafe', tea: 'cafe', restaurant: 'restaurant', fast_food: 'restaurant', food_court: 'restaurant', bakery: 'bakery', pastry: 'bakery',
    confectionery: 'bakery', ice_cream: 'icecream', bar: 'bar', pub: 'bar', alcohol: 'liquor', beverages: 'bar',
    hairdresser: 'salon', beauty: 'salon', cosmetics: 'salon', massage: 'salon', perfumery: 'salon', tattoo: 'salon',
    pharmacy: 'pharmacy', chemist: 'pharmacy', clinic: 'clinic', doctors: 'clinic', dentist: 'clinic', laboratory: 'clinic', blood_bank: 'hospital', hospital: 'hospital',
    atm: 'money', bank: 'money', bureau_de_change: 'money', post_office: 'post', courier: 'post',
    clothes: 'clothes', boutique: 'clothes', fabric: 'clothes', tailor: 'clothes', shoes: 'clothes', bag: 'shop', fashion_accessories: 'jewel',
    mobile_phone: 'mobile', telecommunication: 'mobile', electronics: 'laptop', computer: 'laptop', appliance: 'laptop', electronics_repair: 'repair',
    electrical: 'hardware', hardware: 'hardware', paint: 'hardware', doityourself: 'hardware', stationery: 'print', copyshop: 'print', books: 'books',
    library: 'library', jewelry: 'jewel', watches: 'jewel', gift: 'flower', florist: 'flower', toys: 'shop', optician: 'optician',
    fuel: 'fuel', charging_station: 'ev', car_repair: 'repair', motorcycle_repair: 'repair', tyres: 'repair', car_parts: 'repair',
    toilets: 'toilet', bus_stop: 'bus', bus_station: 'bus', station: 'station', parking: 'parking', police: 'police', government: 'govt',
    fire_station: 'patrol', hotel: 'stay', guest_house: 'stay', hostel: 'stay', cinema: 'cinema', theatre: 'cinema', park: 'park', garden: 'park',
    playground: 'park', laundry: 'laundry', dry_cleaning: 'laundry', pet: 'pet', veterinary: 'pet', place_of_worship: 'worship',
    school: 'education', college: 'education', university: 'education', educational_institution: 'education', kindergarten: 'education', prep_school: 'education',
    furniture: 'furniture', interior_decoration: 'furniture', bed: 'furniture', houseware: 'shop',
  };
  return m[sub] ?? 'shop';
}

