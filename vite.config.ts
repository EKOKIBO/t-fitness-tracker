import react from '@vitejs/plugin-react';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/**
 * Injects built hashed JS/CSS bundle paths into dist/sw.js so the PWA works
 * completely offline from the very first install—even without Vite PWA plugin peers.
 */
function offlineSwPrecachePlugin(): Plugin {
  return {
    name: 't-offline-sw-precache',
    apply: 'build',
    writeBundle(options, bundle) {
      const outDir = options.dir || resolve(process.cwd(), 'dist');
      const swPath = resolve(outDir, 'sw.js');
      try {
        let swCode = readFileSync(swPath, 'utf-8');
        const assetFiles = Object.keys(bundle)
          .filter(
            (file) =>
              !file.endsWith('.map') && file !== 'sw.js' && file !== 'index.html'
          )
          .map((file) => `'/${file}'`);
        const buildHash = Date.now().toString(36);
        swCode = swCode
          .replace('__BUILD_HASH__', buildHash)
          .replace('/* __PRECACHE_ASSETS__ */', assetFiles.join(',\n  '));
        writeFileSync(swPath, swCode, 'utf-8');
      } catch {
        // Ignore if sw.js isn't emitted
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), offlineSwPrecachePlugin()],
  server: {
    host: true,
    port: 5173,
  },
});
