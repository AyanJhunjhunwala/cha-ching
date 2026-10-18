// Sends HTTP requests straight from the device to Kalshi — there is no server
// in between. Each runtime needs a different path around browser CORS rules:
//   iPhone (Capacitor): native HTTP via CapacitorHttp
//   Desktop (Electron): main process via the preload bridge
//   Browser (vite dev): same-origin proxy configured in vite.config.js

import { Capacitor, CapacitorHttp } from '@capacitor/core';

export const HOSTS = {
  live: 'https://external-api.kalshi.com',
  demo: 'https://demo-api.kalshi.co',
};

function parseBody(data) {
  if (typeof data !== 'string') return data ?? null;
  if (!data) return null;
  try {
    return JSON.parse(data);
  } catch {
    return data;
  }
}

/**
 * @param {{env:'live'|'demo', method:string, path:string, query?:object, headers:object, body?:object}} req
 *   `path` is the full API path, e.g. "/trade-api/v2/portfolio/balance".
 * @returns {Promise<{status:number, data:any}>}
 */
export async function send({ env, method, path, query, headers, body }) {
  const qs = query ? new URLSearchParams(Object.entries(query).filter(([, v]) => v != null && v !== '')).toString() : '';
  const suffix = path + (qs ? `?${qs}` : '');
  const json = body === undefined ? undefined : JSON.stringify(body);

  if (typeof window !== 'undefined' && window.chaching?.request) {
    const res = await window.chaching.request({ url: HOSTS[env] + suffix, method, headers, body: json });
    return { status: res.status, data: parseBody(res.data) };
  }

  if (Capacitor.isNativePlatform()) {
    const res = await CapacitorHttp.request({
      url: HOSTS[env] + suffix,
      method,
      headers,
      data: body,
      connectTimeout: 10000,
      readTimeout: 15000,
    });
    return { status: res.status, data: parseBody(res.data) };
  }

  const res = await fetch(`/kalshi/${env}${suffix}`, { method, headers, body: json });
  return { status: res.status, data: parseBody(await res.text()) };
}
