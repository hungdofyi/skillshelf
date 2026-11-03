import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const API_TARGET = 'http://127.0.0.1:4317';

// SSE (/api/events, job logs) must not be buffered or timed out by the proxy.
const proxy = {
  '/api': { target: API_TARGET, changeOrigin: false, ws: false },
  '/mcp': { target: API_TARGET, changeOrigin: false },
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // 127.0.0.1 explicitly: Vite's default "localhost" can bind IPv6-only, which some browsers don't reach.
  server: { host: '127.0.0.1', port: 5317, strictPort: true, proxy },
  preview: { host: '127.0.0.1', port: 5317, proxy },
});
