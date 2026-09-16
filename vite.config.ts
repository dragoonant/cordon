import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  // Relative, so the built bundle resolves its own assets against whatever
  // path it's served from. GitHub Pages serves this repo at /cordon/, where
  // Vite's default root-absolute '/assets/...' URLs 404 into a black screen.
  // Runtime-built asset URLs go through src/assetUrl.ts for the same reason.
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@sim': fileURLToPath(new URL('./src/sim', import.meta.url)),
      '@render': fileURLToPath(new URL('./src/render', import.meta.url)),
      '@ui': fileURLToPath(new URL('./src/ui', import.meta.url)),
      '@data': fileURLToPath(new URL('./src/data', import.meta.url)),
      '@save': fileURLToPath(new URL('./src/save', import.meta.url)),
      '@audio': fileURLToPath(new URL('./src/audio', import.meta.url)),
    },
  },
  // Honor the port the harness assigns (PORT); fall back to Vite's default
  // for a plain `npm run dev`. Not strict, so a busy port just increments.
  server: { port: Number(process.env.PORT) || 5173, strictPort: false },
  test: {
    include: ['src/**/*.test.ts', 'tools/**/*.test.ts'],
    environment: 'node',
  },
} as any);
