import { defineConfig } from 'vite';

// In the browser, requests go through this same-origin proxy so CORS never
// gets in the way. The iPhone and desktop builds call Kalshi directly.
const kalshiProxy = (target, prefix) => ({
  target,
  changeOrigin: true,
  rewrite: (path) => path.replace(prefix, ''),
});

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    target: ['es2022', 'safari15'],
  },
  server: {
    proxy: {
      '/kalshi/live': kalshiProxy('https://external-api.kalshi.com', /^\/kalshi\/live/),
      '/kalshi/demo': kalshiProxy('https://demo-api.kalshi.co', /^\/kalshi\/demo/),
    },
  },
});
