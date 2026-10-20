import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import mapConfig from '../../config/map.json';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const tileHosts = [mapConfig.styleUrl, ...mapConfig.fallbackRaster.tiles].map(
  (u) => new URL(u).host,
);

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repoRoot, 'VITE_');
  const apiHost = env.VITE_SUPABASE_URL ? new URL(env.VITE_SUPABASE_URL).host : null;
  return {
    envDir: repoRoot,
    server: { fs: { allow: [repoRoot] } },
    build: {
      chunkSizeWarningLimit: 1100,
      rollupOptions: {
        output: {
          // MapLibre changes rarely; keep it in its own long-cached chunk.
          manualChunks: (id) => (id.includes('maplibre-gl') ? 'maplibre' : undefined),
        },
      },
    },
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icons/favicon.svg', 'icons/apple-touch-icon.png'],
        manifest: {
          name: 'Happow — Happening Now',
          short_name: 'Happow',
          description: 'Everything happening near you, now.',
          lang: 'pl',
          theme_color: '#0f172a',
          background_color: '#f8fafc',
          display: 'standalone',
          orientation: 'portrait',
          start_url: '/',
          icons: [
            { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            {
              src: 'icons/icon-maskable-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
          maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
          runtimeCaching: [
            {
              urlPattern: ({ url }) => tileHosts.includes(url.host),
              handler: 'CacheFirst',
              options: {
                cacheName: 'map-tiles',
                expiration: { maxEntries: 2000, maxAgeSeconds: 7 * 24 * 3600 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            ...(apiHost
              ? [
                  {
                    urlPattern: ({ url }: { url: URL }) => url.host === apiHost,
                    handler: 'NetworkFirst' as const,
                    options: {
                      cacheName: 'api',
                      networkTimeoutSeconds: 5,
                      expiration: { maxEntries: 50, maxAgeSeconds: 24 * 3600 },
                    },
                  },
                ]
              : []),
          ],
        },
      }),
    ],
    test: { environment: 'jsdom' },
  };
});
