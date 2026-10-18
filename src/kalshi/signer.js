// Signs Kalshi request strings on-device. Kalshi API keys are either RSA
// (RSA-PSS / SHA-256, salt = digest length) or Ed25519. WebCrypto is used when
// the runtime offers it; otherwise we fall back to audited/pure-JS code so the
// app still works in WebViews without crypto.subtle.

import { ed25519 } from '@noble/curves/ed25519.js';
import { parsePrivateKey } from './der.js';
import { rsaPssSign } from './rsa-pss.js';

const encoder = new TextEncoder();

export function bytesToBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

async function webCryptoSigner(parsed, subtle) {
  if (parsed.type === 'rsa') {
    const key = await subtle.importKey('pkcs8', parsed.pkcs8, { name: 'RSA-PSS', hash: 'SHA-256' }, false, ['sign']);
    return async (data) => new Uint8Array(await subtle.sign({ name: 'RSA-PSS', saltLength: 32 }, key, data));
  }
  const key = await subtle.importKey('pkcs8', parsed.pkcs8, { name: 'Ed25519' }, false, ['sign']);
  return async (data) => new Uint8Array(await subtle.sign({ name: 'Ed25519' }, key, data));
}

function jsSigner(parsed) {
  if (parsed.type === 'rsa') return async (data) => rsaPssSign(parsed.rsa, data);
  return async (data) => ed25519.sign(data, parsed.seed);
}

/**
 * @param {string} pemText private key as pasted/imported by the user
 * @returns {Promise<{type:'rsa'|'ed25519', engine:'webcrypto'|'js', sign:(message:string)=>Promise<string>}>}
 */
export async function createSigner(pemText, options = {}) {
  const parsed = parsePrivateKey(pemText);
  const subtle = 'subtle' in options ? options.subtle : globalThis.crypto?.subtle;

  let signBytes = null;
  let engine = 'js';
  if (subtle) {
    try {
      signBytes = await webCryptoSigner(parsed, subtle);
      await signBytes(encoder.encode('probe'));
      engine = 'webcrypto';
    } catch {
      signBytes = null;
    }
  }
  if (!signBytes) signBytes = jsSigner(parsed);

  return {
    type: parsed.type,
    engine,
    async sign(message) {
      return bytesToBase64(await signBytes(encoder.encode(message)));
    },
  };
}
