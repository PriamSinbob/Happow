import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import mapConfig from '../../config/map.json';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const tileHosts = [mapConfig.styleUrl, ...mapConfig.fallbackRaster.tiles].map(
  (u) => new URL(u).host,
);

/**
 * Serves /api/* in `vite dev` with the same handler as the Cloudflare Pages Function, reading the
 * server secrets from the repo's .env (never exposed to the client bundle).
 */
function devApi(mode: string): Plugin {
  return {
    name: 'happow-dev-api',
    configureServer(server: ViteDevServer) {
      const env = loadEnv(mode, repoRoot, '');
      let api: ((req: Request) => Promise<Response>) | null = null;
      server.middlewares.use('/api', async (req, res) => {
        try {
          if (!api) {
            const mod = await server.ssrLoadModule('@happow/api');
            api = mod.createApi(env) as (req: Request) => Promise<Response>;
          }
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c as Buffer);
          const headers = new Headers();
          for (const [k, v] of Object.entries(req.headers))
            if (typeof v === 'string') headers.set(k, v);
          const response = await api(
            new Request(`http://localhost/api${req.url}`, {
              method: req.method,
              headers,
              body:
                req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(chunks),
            }),
          );
          res.statusCode = response.status;
          response.headers.forEach((v, k) => res.setHeader(k, v));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (err) {
          console.error(err);
          res.statusCode = 500;
          res.end('{"error":"server_error"}');
        }
      });
    },
  };
}

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
      devApi(mode),
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
            {
              // Area snapshots: the network (and its HTTP cache / 304s) first, the last copy
              // offline.
              urlPattern: ({ url }: { url: URL }) => url.pathname === '/api/area',
              handler: 'NetworkFirst' as const,
              options: {
                cacheName: 'area',
                networkTimeoutSeconds: 8,
                expiration: { maxEntries: 10, maxAgeSeconds: 24 * 3600 },
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
