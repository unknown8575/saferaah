// Line icons (Lucide, ISC licence) drawn as inline SVG, so they stay crisp, take the
// text colour, and look the same on every phone — unlike emoji.
import {
  createElement, Search, Menu, Layers, LocateFixed, Navigation, TriangleAlert, ShieldCheck, Hospital, Stethoscope, Pill,
  TrainFront, Fuel, ShoppingBag, Utensils, Landmark, Wine, Moon, UserX, ShieldAlert, Footprints, Dog, Volume2, VolumeX, X,
  ChevronLeft, ChevronRight, ArrowUpDown, Bike, Car, CarTaxiFront, MapPin, Users, CircleHelp, Phone, Share, Star, Check,
  ArrowUp, CornerUpLeft, CornerUpRight, ArrowUpLeft, ArrowUpRight, ArrowDownLeft, ArrowDownRight, Undo2, Flag, Clock, Sun,
  Siren, Trees, Store, School, Building2, Lock, Lightbulb, Construction, Eye, BedDouble, Map as MapIcon, Bus, Sparkles,
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
