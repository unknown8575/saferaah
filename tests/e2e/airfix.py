"""Fake Open-Meteo air-quality responses for tests (the sandbox has no internet)."""
import datetime, json, math


def openmeteo_body(base_pm=190.0):
    ist = datetime.timezone(datetime.timedelta(hours=5, minutes=30))
    day = datetime.datetime.now(ist).replace(hour=0, minute=0, second=0, microsecond=0)
    times, p25, p10 = [], [], []
    for i in range(48):
        t = day + datetime.timedelta(hours=i)
        # Delhi winter shape: worst ~6 am, cleanest ~3 pm
        v = base_pm * (1 + 0.45 * math.cos((t.hour - 6) / 24 * 2 * math.pi)) + 8 * math.sin(i)
        times.append(t.strftime('%Y-%m-%dT%H:00')); p25.append(round(v, 1)); p10.append(round(v * 1.7, 1))
    now = datetime.datetime.now(ist).hour
    return json.dumps({'utc_offset_seconds': 19800, 'timezone': 'Asia/Kolkata',
                       'current': {'time': times[now], 'pm2_5': p25[now], 'pm10': p10[now]},
                       'hourly': {'time': times, 'pm2_5': p25, 'pm10': p10}})


def install(ctx_or_page, base_pm=190.0):
    ctx_or_page.route('**/air-quality-api.open-meteo.com/**',
                      lambda route: route.fulfill(status=200, content_type='application/json', body=openmeteo_body(base_pm),
                                                  headers={'access-control-allow-origin': '*'}))
