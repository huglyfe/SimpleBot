import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { transformWithOxc, type Plugin } from 'vite';

/** One build owns the shell and its worker; no hand-maintained asset versions. */
export function pwa(): Plugin {
  return {
    name: 'simplebot-pwa',
    apply: 'build',
    enforce: 'post',
    async generateBundle(_options, bundle) {
      if (bundle['index.html'] === undefined)
        throw new Error(
          'PWA generation must run after the entry HTML is emitted.',
        );
      const assets = Object.keys(bundle)
        .filter((name) => !name.endsWith('.map'))
        .map((name) => `/${name}`);
      assets.push(
        '/icon-192.png',
        '/icon-512.png',
        '/apple-touch-icon.png',
        '/manifest.webmanifest',
      );
      const worker = await readFile(
        new URL('./pwa/worker.ts', import.meta.url),
        'utf8',
      );
      const hash = createHash('sha256').update(worker);
      for (const entry of Object.values(bundle))
        hash.update(entry.type === 'chunk' ? entry.code : entry.source);
      for (const path of assets.filter((path) => !bundle[path.slice(1)]))
        hash.update(
          await readFile(new URL(`./public${path}`, import.meta.url)),
        );
      const build = { revision: hash.digest('hex').slice(0, 16), assets };
      const { code } = await transformWithOxc(worker, 'worker.ts');
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: `const BUILD = ${JSON.stringify(build)};\n${code}`,
      });
    },
  };
}
