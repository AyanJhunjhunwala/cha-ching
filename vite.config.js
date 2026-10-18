import { defineConfig } from 'vite';

// In the browser, requests go through this same-origin proxy so CORS never
// gets in the way. The iPhone and desktop builds call Kalshi directly.
const kalshiProxy = (target, prefix) => ({
  target,
  changeOrigin: true,
  rewrite: (path) => path.replace(prefix, ''),
  // Forward like a plain API client, not a browser page on localhost.
  configure: (proxy) => {
    proxy.on('proxyReq', (proxyReq) => {
      proxyReq.removeHeader('origin');
      proxyReq.removeHeader('referer');
    });
  },
});

// WebSocket proxy: the browser can't set headers on a WebSocket, so the app
// passes the signed handshake values as query parameters and this proxy turns
// them back into the KALSHI-ACCESS-* headers Kalshi expects.
const kalshiSocketProxy = (target, prefix) => ({
  target,
  ws: true,
  changeOrigin: true,
  rewrite: (path) => path.replace(prefix, '/trade-api/ws/v2'),
  configure: (proxy) => {
    proxy.on('proxyReqWs', (proxyReq, req) => {
      const params = new URL(req.url, 'http://localhost').searchParams;
      proxyReq.setHeader('KALSHI-ACCESS-KEY', params.get('key') ?? '');
      proxyReq.setHeader('KALSHI-ACCESS-TIMESTAMP', params.get('ts') ?? '');
      proxyReq.setHeader('KALSHI-ACCESS-SIGNATURE', params.get('sig') ?? '');
      proxyReq.removeHeader('origin');
      proxyReq.path = '/trade-api/ws/v2';
    });
  },
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
      '/kalshi-ws/elections': kalshiSocketProxy('https://api.elections.kalshi.com', /^\/kalshi-ws\/elections/),
      '/kalshi-ws/external': kalshiSocketProxy('https://external-api.kalshi.com', /^\/kalshi-ws\/external/),
      '/kalshi-ws/demo': kalshiSocketProxy('https://demo-api.kalshi.co', /^\/kalshi-ws\/demo/),
    },
  },
});
