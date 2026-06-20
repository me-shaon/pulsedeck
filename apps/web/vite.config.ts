import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

// In dev the API runs on its own port (default 3001). It is same-origin in prod
// (nginx serves the SPA and proxies /api), so we mirror that here by proxying
// /api → the API server, keeping cookies/credentials first-party.
const API_TARGET = process.env.VITE_API_PROXY ?? 'http://localhost:3001';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
      },
    },
  },
});
