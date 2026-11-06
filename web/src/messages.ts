// Messages to trusted contacts, sent from the user's own phone via
// pre-filled SMS / WhatsApp links (free, no DLT registration needed).
import type { Contact } from './store.ts';

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent);

export function smsLink(phones: string[], body: string): string {
  const to = phones.join(',');
  // iOS uses "&body=", Android "?body="
  return `sms:${to}${isIOS() ? '&' : '?'}body=${encodeURIComponent(body)}`;
}

export function whatsappLink(phone: string, body: string): string {
  return `https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(body)}`;
}

export function telLink(n: string): string {
  return `tel:${n}`;
}

export function mapsLink(lon: number, lat: number): string {
  return `https://www.openstreetmap.org/?mlat=${lat.toFixed(5)}&mlon=${lon.toFixed(5)}#map=18/${lat.toFixed(5)}/${lon.toFixed(5)}`;
}

export function shareUrl(shareId: string): string {
  // inside the native app the page origin is capacitor://localhost, so links use the server address
  const apiBase = ((import.meta.env.VITE_API_BASE as string | undefined) ?? '').replace(/\/$/, '');
  if (apiBase) return `${apiBase}/?track=${encodeURIComponent(shareId)}`;
  const u = new URL(location.href);
  u.search = `?track=${encodeURIComponent(shareId)}`;
  u.hash = '';
  return u.toString();
}

export function arrivalText(name: string, place: string, time: string): string {
  return `${name || 'I'} reached ${place || 'the destination'} safely at ${time}. (SafeRaah)`;
}

export function startText(name: string, place: string, eta: string, link?: string): string {
  return `${name || 'I'} started a trip to ${place || 'my destination'}, expected by ${eta}.` +
    (link ? ` Follow live: ${link}` : '') + ' (SafeRaah)';
}

export function sosText(name: string, lon: number, lat: number, link?: string): string {
  return `SOS from ${name || 'me'}: I need help. My location: ${mapsLink(lon, lat)}` +
    (link ? ` Live trip: ${link}` : '') + ' Call me or 112 now.';
}

export const HELPLINES = [
  { n: '112', label: 'Emergency (police, ambulance, fire)' },
  { n: '1091', label: 'Women helpline (Delhi Police)' },
  { n: '181', label: 'Women in distress helpline' },
  { n: '1098', label: 'Childline' },
];

export function notifyPhones(contacts: Contact[]): string[] {
  return contacts.filter((c) => c.notify).map((c) => c.phone);
}
