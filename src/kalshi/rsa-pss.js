// Pure-JS RSASSA-PSS (SHA-256, MGF1-SHA-256), per RFC 8017 §8.1 / §9.1.
// Fallback for runtimes where crypto.subtle is unavailable.

import { sha256 } from './sha256.js';

const HLEN = 32;

const bitLength = (n) => n.toString(2).length;

function bytesToBigInt(bytes) {
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex ? BigInt('0x' + hex) : 0n;
}

function bigIntToBytes(n, len) {
  const hex = n.toString(16).padStart(len * 2, '0');
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function modPow(base, exp, mod) {
  let result = 1n;
  base %= mod;
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % mod;
    exp >>= 1n;
    base = (base * base) % mod;
  }
  return result;
}

function mgf1(seed, len) {
  const out = new Uint8Array(len);
  const block = new Uint8Array(seed.length + 4);
  block.set(seed);
  for (let counter = 0, pos = 0; pos < len; counter++, pos += HLEN) {
    block[seed.length] = counter >>> 24;
    block[seed.length + 1] = (counter >>> 16) & 0xff;
    block[seed.length + 2] = (counter >>> 8) & 0xff;
    block[seed.length + 3] = counter & 0xff;
    out.set(sha256(block).subarray(0, Math.min(HLEN, len - pos)), pos);
  }
  return out;
}

export function emsaPssEncode(message, emBits, salt) {
  const emLen = Math.ceil(emBits / 8);
  const sLen = salt.length;
  if (emLen < HLEN + sLen + 2) throw new Error('RSA key is too small');

  const mPrime = new Uint8Array(8 + HLEN + sLen);
  mPrime.set(sha256(message), 8);
  mPrime.set(salt, 8 + HLEN);
  const h = sha256(mPrime);

  const db = new Uint8Array(emLen - HLEN - 1);
  db[emLen - sLen - HLEN - 2] = 0x01;
  db.set(salt, emLen - sLen - HLEN - 1);
  const mask = mgf1(h, db.length);
  for (let i = 0; i < db.length; i++) db[i] ^= mask[i];
  db[0] &= 0xff >>> (8 * emLen - emBits);

  const em = new Uint8Array(emLen);
  em.set(db);
  em.set(h, db.length);
  em[emLen - 1] = 0xbc;
  return em;
}

/**
 * @param {{n:bigint,e:bigint,d:bigint,p:bigint,q:bigint,dp:bigint,dq:bigint,qi:bigint}} key
 * @param {Uint8Array} message
 * @param {Uint8Array} [salt] defaults to 32 random bytes (salt length = digest length, as Kalshi requires)
 */
export function rsaPssSign(key, message, salt = crypto.getRandomValues(new Uint8Array(HLEN))) {
  const modBits = bitLength(key.n);
  const m = bytesToBigInt(emsaPssEncode(message, modBits - 1, salt));

  // CRT is ~4x faster than m^d mod n; verify the result and fall back if the
  // key's CRT parameters are inconsistent.
  const m1 = modPow(m, key.dp, key.p);
  const m2 = modPow(m, key.dq, key.q);
  const h = (key.qi * (((m1 - m2) % key.p) + key.p)) % key.p;
  let s = m2 + h * key.q;
  if (modPow(s, key.e, key.n) !== m) s = modPow(m, key.d, key.n);

  return bigIntToBytes(s, Math.ceil(modBits / 8));
}
