import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
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
  server: { port: 5173, strictPort: false },
  test: {
    include: ['src/**/*.test.ts', 'tools/**/*.test.ts'],
    environment: 'node',
  },
} as any);
