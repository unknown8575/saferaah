import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'in.saferaah.app',
  appName: 'SafeRaah',
  webDir: 'web/dist',
  android: { allowMixedContent: false },
  plugins: {
    LocalNotifications: { iconColor: '#2e2a78' },
  },
};

export default config;
