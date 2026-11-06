// Position sources: real GPS (browser / Capacitor web view) or a simulator
// that walks/drives along the planned route (demo, testing, GIF recording).
import type { Fix } from '../../shared/journey.ts';
import type { LonLat } from '../../shared/geo.ts';
import { haversine } from '../../shared/geo.ts';
import { Capacitor, registerPlugin } from '@capacitor/core';
import type { BackgroundGeolocationPlugin } from '@capacitor-community/background-geolocation';

export interface PositionSource {
  start(onFix: (f: Fix) => void, onError: (msg: string) => void): void;
  stop(): void;
}

/**
 * Inside the Android / iOS app: keeps tracking with the screen locked (foreground
 * service on Android, background location mode on iOS), which a plain web page cannot.
 */
function nativeSource(): PositionSource {
  const BG = registerPlugin<BackgroundGeolocationPlugin>('BackgroundGeolocation');
  let watcher: string | null = null;
  return {
    start(onFix, onError) {
      BG.addWatcher({
        backgroundTitle: 'SafeRaah is watching your journey',
        backgroundMessage: 'We will tell your contacts when you arrive. Open the app for SOS.',
        requestPermissions: true, stale: false, distanceFilter: 5,
      }, (loc, err) => {
        if (err) {
          onError(err.code === 'NOT_AUTHORIZED' ? 'Location permission is off. Turn it on in Settings to track the journey.' : 'Location is not available right now.');
          return;
        }
        if (loc) onFix({ lon: loc.longitude, lat: loc.latitude, acc: loc.accuracy, t: loc.time ?? Date.now() });
      }).then((id) => { watcher = id; });
    },
    stop() { if (watcher) BG.removeWatcher({ id: watcher }); watcher = null; },
  };
}

export function gpsSource(): PositionSource {
  if (Capacitor.isNativePlatform()) return nativeSource();
  return webSource();
}

function webSource(): PositionSource {
  let id: number | null = null;
  return {
    start(onFix, onError) {
      if (!('geolocation' in navigator)) { onError('This device has no location service.'); return; }
      let lastFixAt = Date.now();
      let warnedAt = 0;
      id = navigator.geolocation.watchPosition(
        (p) => {
          lastFixAt = Date.now();
          onFix({ lon: p.coords.longitude, lat: p.coords.latitude, acc: p.coords.accuracy, t: p.timestamp || Date.now() });
        },
        (e) => {
          if (e.code === 1) { onError('Location permission is off. Turn it on to track the journey.'); return; }
          // Slow fixes are normal between tall buildings; only speak up after a full minute
          // without any position, and not more than once a minute.
          const now = Date.now();
          if (now - lastFixAt > 60000 && now - warnedAt > 60000) {
            warnedAt = now;
            onError('No GPS signal for a minute. Your contacts still have your last location.');
          }
        },
        { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 },
      );
    },
    stop() { if (id !== null) navigator.geolocation.clearWatch(id); id = null; },
  };
}

/**
 * Simulated traveller along `route` at `speedMps`, `speedup`× faster than real time.
 * Optional pause (to demo the "Are you OK?" check-in) at a fraction of the route.
 */
export function simulatedSource(route: LonLat[], speedMps: number, speedup = 20,
  pause?: { atFrac: number; seconds: number }): PositionSource {
  let timer: ReturnType<typeof setInterval> | null = null;
  return {
    start(onFix) {
      const cum = [0];
      for (let i = 1; i < route.length; i++) cum.push(cum[i - 1] + haversine(route[i - 1][0], route[i - 1][1], route[i][0], route[i][1]));
      const total = cum[cum.length - 1];
      let simT = Date.now(), dist = 0, paused = 0, pausedDone = false;
      const tickMs = 250;
      const emit = () => {
        let i = 1;
        while (i < cum.length - 1 && cum[i] < dist) i++;
        const seg = cum[i] - cum[i - 1] || 1;
        const f = Math.min(1, Math.max(0, (dist - cum[i - 1]) / seg));
        const lon = route[i - 1][0] + (route[i][0] - route[i - 1][0]) * f;
        const lat = route[i - 1][1] + (route[i][1] - route[i - 1][1]) * f;
        onFix({ lon, lat, acc: 8, t: Math.round(simT) });
      };
      emit();
      timer = setInterval(() => {
        const dtS = (tickMs / 1000) * speedup;
        simT += dtS * 1000;
        if (pause && !pausedDone && dist >= total * pause.atFrac) {
          paused += dtS;
          if (paused >= pause.seconds) pausedDone = true;
        } else {
          dist = Math.min(total, dist + speedMps * dtS);
        }
        emit();
        if (dist >= total) { if (timer) clearInterval(timer); timer = null; }
      }, tickMs);
    },
    stop() { if (timer) clearInterval(timer); timer = null; },
  };
}
