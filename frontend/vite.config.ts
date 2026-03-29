import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      // Proxy all API calls to avoid CORS in development
      '/api/v1/auth':         { target: 'http://localhost:3001', changeOrigin: true },
      '/api/v1/users':        { target: 'http://localhost:3002', changeOrigin: true },
      '/api/v1/scoring':      { target: 'http://localhost:3003', changeOrigin: true },
      '/api/v1/ventures':     { target: 'http://localhost:3006', changeOrigin: true },
      '/api/v1/bankability':  { target: 'http://localhost:3005', changeOrigin: true },
      '/api/v1/scout':        { target: 'http://localhost:3007', changeOrigin: true },
      '/api/v1/billing':      { target: 'http://localhost:3008', changeOrigin: true },
      '/api/v1/marketplace':  { target: 'http://localhost:3008', changeOrigin: true },
      '/api/v1/score-api':    { target: 'http://localhost:3008', changeOrigin: true },
      '/api/v1/lenders':      { target: 'http://localhost:3008', changeOrigin: true },
      '/api/v1/notifications':{ target: 'http://localhost:3010', changeOrigin: true },
      '/api/v1/analytics':    { target: 'http://localhost:3011', changeOrigin: true },
      '/api/v1/admin':        { target: 'http://localhost:3012', changeOrigin: true },
      '/api/v1/investors':    { target: 'http://localhost:3013', changeOrigin: true },
      '/api/v1/providers':    { target: 'http://localhost:3013', changeOrigin: true },
      '/api/v1/universities': { target: 'http://localhost:3013', changeOrigin: true },
      '/api/v1/acxm':         { target: 'http://localhost:3014', changeOrigin: true },
      '/api/v1/compliance':   { target: 'http://localhost:3015', changeOrigin: true },
      '/api/v1/search':       { target: 'http://localhost:3017', changeOrigin: true },
      '/api/v1/reports':      { target: 'http://localhost:3018', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor:  ['react', 'react-dom', 'react-router-dom'],
          query:   ['@tanstack/react-query'],
          charts:  ['chart.js', 'react-chartjs-2'],
          socket:  ['socket.io-client'],
        },
      },
    },
  },
  define: {
    // Enforce light mode at build time
    __DARK_MODE_ENABLED__: false,
  },
});
