import react from '@vitejs/plugin-react';
import { pwa } from './pwa.js';
import { defineConfig, type ServerOptions } from 'vite';
import { readFileSync } from 'node:fs';
import { cp, mkdir } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '..');

/**
 * Only the development server reads the operator's root. A build produces the
 * same static client whatever that root says, and `config.json` and the TLS
 * pair are runtime data that a fresh checkout or CI does not have — reading
 * them at config load made `vite build` fail before it started.
 */
function developmentServer(): ServerOptions {
  const configPath = resolve(
    process.env.CONFIG_PATH ?? resolve(repositoryRoot, 'config.json'),
  );
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
    application?: { loginEnabled?: boolean };
  };
  const loginEnabled = config.application?.loginEnabled ?? true;
  const tlsCertPath = resolve(
    process.env.TLS_CERT_PATH ?? resolve(repositoryRoot, 'data/tls/cert.pem'),
  );
  const tlsKeyPath = resolve(
    process.env.TLS_KEY_PATH ?? resolve(repositoryRoot, 'data/tls/key.pem'),
  );
  return {
    host: '127.0.0.1',
    port: 5173,
    ...(loginEnabled
      ? {
          https: {
            cert: readFileSync(tlsCertPath),
            key: readFileSync(tlsKeyPath),
          },
        }
      : {}),
    proxy: {
      '/api': {
        target:
          process.env.SIMPLEBOT_API_TARGET ??
          `${loginEnabled ? 'https' : 'http'}://127.0.0.1:${
            process.env.SIMPLEBOT_PORT ?? '3000'
          }`,
        secure: false,
      },
    },
  };
}

export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    pwa(),
    {
      name: 'bundled-notices',
      async closeBundle() {
        const target = resolve(import.meta.dirname, 'dist/legal');
        await mkdir(target, { recursive: true });
        for (const name of [
          'LICENSE',
          'NOTICE',
          'legal/THIRD-PARTY-NOTICES.txt',
        ])
          await cp(
            resolve(repositoryRoot, name),
            resolve(target, basename(name)),
          );
      },
    },
  ],
  ...(command === 'serve' ? { server: developmentServer() } : {}),
}));
