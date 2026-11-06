import { defineConfig } from 'vite';

export default defineConfig({
  root: 'web',
  base: './',
  publicDir: 'public',
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 1500 },
  worker: { format: 'es' },
  server: { proxy: { '/api': 'http://localhost:8787' } },
});
