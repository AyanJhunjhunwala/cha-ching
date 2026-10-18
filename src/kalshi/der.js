// Minimal DER/PEM handling: just enough to read the private keys Kalshi hands
// out (RSA as PKCS#1 or PKCS#8, Ed25519 as PKCS#8) without any dependency.

const OID_RSA = '2a864886f70d010101'; // 1.2.840.113549.1.1.1 rsaEncryption
const OID_ED25519 = '2b6570'; // 1.3.101.112

export class KeyFormatError extends Error {
  constructor(message) {
    super(message);
    this.name = 'KeyFormatError';
  }
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/** Accepts a PEM block (or bare base64 body) and returns the DER bytes. */
export function pemToDer(text) {
  if (typeof text !== 'string' || !text.trim()) throw new KeyFormatError('Paste your private key.');
  // Keys copied out of JSON/env files often carry literal "\n" sequences.
  const normalized = text.replace(/\\n/g, '\n').trim();
  if (/ENCRYPTED PRIVATE KEY|Proc-Type: 4,ENCRYPTED/.test(normalized)) {
    throw new KeyFormatError('This key is password-protected. Export it without a passphrase.');
  }
  if (/BEGIN (PUBLIC KEY|RSA PUBLIC KEY|CERTIFICATE)/.test(normalized)) {
    throw new KeyFormatError('That is a public key. Paste the private key Kalshi gave you.');
  }
  const body = normalized.replace(/-----(BEGIN|END)[^-]*-----/g, '').replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body)) {
    throw new KeyFormatError("That doesn't look like a private key file.");
  }
  try {
    return base64ToBytes(body);
  } catch {
    throw new KeyFormatError("That doesn't look like a private key file.");
  }
}

function readTlv(bytes, offset) {
  if (offset + 2 > bytes.length) throw new KeyFormatError('Private key is truncated.');
  const tag = bytes[offset];
  let len = bytes[offset + 1];
  let start = offset + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n === 0 || n > 4) throw new KeyFormatError('Unsupported key encoding.');
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + bytes[start + i];
    start += n;
  }
  const end = start + len;
  if (end > bytes.length) throw new KeyFormatError('Private key is truncated.');
  return { tag, start, end, value: bytes.subarray(start, end) };
}

function readChildren(bytes, tlv) {
  const out = [];
  let pos = tlv.start;
  while (pos < tlv.end) {
    const child = readTlv(bytes, pos);
    out.push(child);
    pos = child.end;
  }
  return out;
}

function toBigInt(bytes) {
  return bytes.length ? BigInt('0x' + hex(bytes)) : 0n;
}

function parsePkcs1(der) {
  const seq = readTlv(der, 0);
  const f = readChildren(der, seq);
  if (seq.tag !== 0x30 || f.length < 9 || f.some((x, i) => i < 9 && x.tag !== 0x02)) {
    throw new KeyFormatError('Unrecognized RSA private key.');
  }
  const [, n, e, d, p, q, dp, dq, qi] = f.map((x) => toBigInt(x.value));
  return { n, e, d, p, q, dp, dq, qi };
}

function encodeLength(len) {
  if (len < 0x80) return [len];
  const out = [];
  while (len > 0) {
    out.unshift(len & 0xff);
    len >>= 8;
  }
  return [0x80 | out.length, ...out];
}

function tlv(tag, content) {
  const len = encodeLength(content.length);
  const out = new Uint8Array(1 + len.length + content.length);
  out[0] = tag;
  out.set(len, 1);
  out.set(content, 1 + len.length);
  return out;
}

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

/** WebCrypto only imports PKCS#8, so wrap a PKCS#1 RSA key in one. */
export function wrapRsaPkcs1(pkcs1) {
  const version = Uint8Array.of(0x02, 0x01, 0x00);
  const algId = tlv(0x30, concat(tlv(0x06, Uint8Array.from(OID_RSA.match(/../g), (h) => parseInt(h, 16))), Uint8Array.of(0x05, 0x00)));
  return tlv(0x30, concat(version, algId, tlv(0x04, pkcs1)));
}

/**
 * @returns {{type:'rsa', pkcs8:Uint8Array, rsa:object} | {type:'ed25519', pkcs8:Uint8Array, seed:Uint8Array}}
 */
export function parsePrivateKey(text) {
  const der = pemToDer(text);
  let top, fields;
  try {
    top = readTlv(der, 0);
    fields = readChildren(der, top);
  } catch (err) {
    if (err instanceof KeyFormatError) throw err;
    throw new KeyFormatError("That doesn't look like a private key file.");
  }
  if (top.tag !== 0x30 || fields.length < 3 || fields[0].tag !== 0x02) {
    throw new KeyFormatError("That doesn't look like a private key file.");
  }

  // PKCS#1 RSAPrivateKey: SEQUENCE { version, n, e, d, ... } — all INTEGERs.
  if (fields[1].tag === 0x02) {
    return { type: 'rsa', pkcs8: wrapRsaPkcs1(der), rsa: parsePkcs1(der) };
  }

  // PKCS#8 PrivateKeyInfo: SEQUENCE { version, AlgorithmIdentifier, OCTET STRING }.
  if (fields[1].tag !== 0x30 || fields[2].tag !== 0x04) {
    throw new KeyFormatError('Unrecognized private key format.');
  }
  const [oid] = readChildren(der, fields[1]);
  const oidHex = oid && oid.tag === 0x06 ? hex(oid.value) : '';
  const inner = fields[2].value;

  if (oidHex === OID_RSA) {
    return { type: 'rsa', pkcs8: der.subarray(0, top.end), rsa: parsePkcs1(inner) };
  }
  if (oidHex === OID_ED25519) {
    const seed = readTlv(inner, 0);
    if (seed.tag !== 0x04 || seed.value.length !== 32) throw new KeyFormatError('Unrecognized Ed25519 private key.');
    return { type: 'ed25519', pkcs8: der.subarray(0, top.end), seed: seed.value.slice() };
  }
  throw new KeyFormatError('Unsupported key type. Kalshi keys are RSA or Ed25519.');
}
