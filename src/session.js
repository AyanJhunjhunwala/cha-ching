import { KalshiClient } from './kalshi/client.js';
import { createSigner } from './kalshi/signer.js';
import { send } from './kalshi/transport.js';

/** Builds a signed client and proves the key works by reading the balance. */
export async function connect({ keyId, pem, env }) {
  const signer = await createSigner(pem);
  const client = new KalshiClient({ keyId: keyId.trim(), signer, env, send });
  const balanceCents = await client.getBalanceCents();
  return { client, env, balanceCents };
}
