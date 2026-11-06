// Optional server-side SMS. In India, bulk/app SMS needs TRAI DLT registration
// (entity + sender ID + approved templates), so this is OFF by default and the
// app falls back to pre-filled sms:/WhatsApp links sent from the user's own phone.
//
// To enable Twilio:   SMS_PROVIDER=twilio TWILIO_SID=… TWILIO_TOKEN=… TWILIO_FROM=+1…
// To use a webhook:    SMS_PROVIDER=webhook SMS_WEBHOOK_URL=https://… (receives {to, message})

export function smsConfigured(): boolean {
  const p = process.env.SMS_PROVIDER;
  if (p === 'twilio') return !!(process.env.TWILIO_SID && process.env.TWILIO_TOKEN && process.env.TWILIO_FROM);
  if (p === 'webhook') return !!process.env.SMS_WEBHOOK_URL;
  return false;
}

export function normalizeIndianPhone(raw: string): string | null {
  const d = raw.replace(/[^\d+]/g, '');
  if (/^\+\d{10,15}$/.test(d)) return d;
  const digits = d.replace(/\D/g, '');
  if (/^[6-9]\d{9}$/.test(digits)) return '+91' + digits;
  if (/^0[6-9]\d{9}$/.test(digits)) return '+91' + digits.slice(1);
  if (/^91[6-9]\d{9}$/.test(digits)) return '+' + digits;
  return null;
}

export async function sendSms(to: string, message: string): Promise<boolean> {
  const phone = normalizeIndianPhone(to);
  if (!phone || !smsConfigured()) return false;
  try {
    if (process.env.SMS_PROVIDER === 'twilio') {
      const sid = process.env.TWILIO_SID!;
      const auth = Buffer.from(`${sid}:${process.env.TWILIO_TOKEN}`).toString('base64');
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: 'POST',
        headers: { authorization: `Basic ${auth}`, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ To: phone, From: process.env.TWILIO_FROM!, Body: message }),
      });
      return r.ok;
    }
    const r = await fetch(process.env.SMS_WEBHOOK_URL!, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to: phone, message }),
    });
    return r.ok;
  } catch {
    return false;
  }
}
