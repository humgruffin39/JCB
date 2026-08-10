import { generateKeyPairSync, randomBytes } from 'node:crypto';

function ed25519Pair(): { readonly privateKey: string; readonly publicKey: string } {
  return generateKeyPairSync('ed25519', {
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
}

const edge = ed25519Pair();
const manifest = ed25519Pair();
const secrets = {
  SESSION_SECRET: randomBytes(32).toString('base64'),
  TIMELINE_MASTER_SECRET: randomBytes(32).toString('base64'),
  RESULT_MASTER_SECRET: randomBytes(32).toString('base64'),
  EDGE_TOKEN_PRIVATE_KEY: edge.privateKey,
  EDGE_TOKEN_PUBLIC_KEY: edge.publicKey,
  MANIFEST_PRIVATE_KEY: manifest.privateKey,
  MANIFEST_PUBLIC_KEY: manifest.publicKey,
};

const output = process.argv.includes('--dotenv')
  ? Object.entries(secrets)
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join('\n')
  : JSON.stringify(secrets, null, 2);

process.stdout.write(`${output}\n`);
