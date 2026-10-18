import assert from 'node:assert/strict';
import { generateKeyPairSync, verify, constants, createHash } from 'node:crypto';
import { test } from 'node:test';

import { parsePrivateKey, pemToDer, KeyFormatError } from '../src/kalshi/der.js';
import { sha256 } from '../src/kalshi/sha256.js';
import { createSigner } from '../src/kalshi/signer.js';

const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
const ed = generateKeyPairSync('ed25519');
const pkcs1Pem = rsa.privateKey.export({ type: 'pkcs1', format: 'pem' });
const pkcs8Pem = rsa.privateKey.export({ type: 'pkcs8', format: 'pem' });
const edPem = ed.privateKey.export({ type: 'pkcs8', format: 'pem' });

const message = '1703123456789GET/trade-api/v2/portfolio/balance';

function verifyRsa(sigB64) {
  return verify('sha256', Buffer.from(message), {
    key: rsa.publicKey,
    padding: constants.RSA_PKCS1_PSS_PADDING,
    saltLength: 32,
  }, Buffer.from(sigB64, 'base64'));
}

test('sha256 matches node for assorted lengths', () => {
  for (const len of [0, 1, 55, 56, 63, 64, 65, 1000]) {
    const data = new Uint8Array(len).map((_, i) => (i * 31) & 0xff);
    assert.equal(Buffer.from(sha256(data)).toString('hex'), createHash('sha256').update(data).digest('hex'));
  }
});

for (const [label, pem] of [['PKCS#1', pkcs1Pem], ['PKCS#8', pkcs8Pem]]) {
  test(`RSA ${label} via WebCrypto verifies with salt length 32`, async () => {
    const signer = await createSigner(pem);
    assert.equal(signer.type, 'rsa');
    assert.equal(signer.engine, 'webcrypto');
    assert.ok(verifyRsa(await signer.sign(message)));
  });

  test(`RSA ${label} via pure-JS fallback verifies with salt length 32`, async () => {
    const signer = await createSigner(pem, { subtle: undefined });
    assert.equal(signer.engine, 'js');
    assert.ok(verifyRsa(await signer.sign(message)));
  });
}

test('Ed25519 signs via WebCrypto and fallback', async () => {
  for (const [subtle, engine] of [[globalThis.crypto.subtle, 'webcrypto'], [undefined, 'js']]) {
    const signer = await createSigner(edPem, { subtle });
    assert.equal(signer.type, 'ed25519');
    assert.equal(signer.engine, engine);
    const sig = Buffer.from(await signer.sign(message), 'base64');
    assert.ok(verify(null, Buffer.from(message), ed.publicKey, sig));
  }
});

test('accepts keys pasted with literal \\n or without PEM armour', async () => {
  const escaped = pkcs1Pem.trim().replace(/\n/g, '\\n');
  assert.ok(verifyRsa(await (await createSigner(escaped)).sign(message)));
  const bare = pkcs8Pem.replace(/-----[^-]+-----/g, '');
  assert.equal(parsePrivateKey(bare).type, 'rsa');
});

test('rejects public keys, encrypted keys and junk with friendly errors', () => {
  const pub = rsa.publicKey.export({ type: 'spki', format: 'pem' });
  assert.throws(() => parsePrivateKey(pub), /public key/);
  assert.throws(() => pemToDer('-----BEGIN ENCRYPTED PRIVATE KEY-----\nAAAA\n-----END ENCRYPTED PRIVATE KEY-----'), /password/);
  assert.throws(() => parsePrivateKey('hello world'), KeyFormatError);
  assert.throws(() => parsePrivateKey('QUJD'), KeyFormatError);
  assert.throws(() => parsePrivateKey(''), KeyFormatError);
});
