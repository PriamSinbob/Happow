import type { AppConfig, HappowConfig, Region } from '@happow/core';

/**
 * GET /api/config: what an app needs to draw Happow, from the same files the server reads.
 * A native app reads this instead of bundling config, so a new city, category, plan or colour
 * reaches installed apps without a release. Server-only parts (ingest, extraction, sources,
 * moderation thresholds) are left out.
 */

/** Sections of app.json only the server uses. */
const SERVER_ONLY = [
  'ingest',
  'extraction',
  'dedup',
  'confidence',
  'osm',
  'venues',
  'metrics',
  'geocoding',
  'email',
] as const satisfies readonly (keyof AppConfig)[];

export type ClientAppConfig = Omit<AppConfig, (typeof SERVER_ONLY)[number]> & {
  /** How a poster photo is shrunk on the phone before autofill reads it. */
  extraction: { photo: AppConfig['extraction']['photo'] };
  /** Whether email is on (follow alerts by email). */
  email: { provider: AppConfig['email']['provider'] };
};

export type ClientRegion = Omit<Region, 'enabledSources' | 'seedFile' | 'seedPlacesFile'>;

export interface ClientConfig {
  app: ClientAppConfig;
  regions: ClientRegion[];
  categories: HappowConfig['categories'];
  map: HappowConfig['map'];
  theme: HappowConfig['theme'];
  plans: HappowConfig['plans'];
  seasons: HappowConfig['seasons'];
}

export function clientConfig(config: HappowConfig): ClientConfig {
  const app = { ...config.app } as Partial<AppConfig>;
  for (const key of SERVER_ONLY) delete app[key];
  return {
    app: {
      ...(app as Omit<AppConfig, (typeof SERVER_ONLY)[number]>),
      extraction: { photo: config.app.extraction.photo },
      email: { provider: config.app.email.provider },
    },
    regions: config.regions.map(
      ({ enabledSources: _s, seedFile: _f, seedPlacesFile: _p, ...r }) => r,
    ),
    categories: config.categories,
    map: config.map,
    theme: config.theme,
    plans: config.plans,
    seasons: config.seasons,
  };
}

/** "1.4.0" < "1.10.0": numeric, part by part. */
export function versionBelow(version: string, min: string): boolean {
  const a = version.split('.').map(Number);
  const b = min.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (!Number.isFinite(x)) return false;
    if (x !== y) return x < y;
  }
  return false;
}

/**
 * The files that let the installed apps open the site's links (Android App Links, iOS Universal
 * Links), at /.well-known/. Null while the app's ids are not in config: nothing is published.
 */
export function appLinkFile(config: HappowConfig, path: string): object | null {
  const { android, ios, linkPaths } = config.app.native;
  if (path === '/.well-known/assetlinks.json' && android.package && android.sha256.length)
    return [
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: android.package,
          sha256_cert_fingerprints: android.sha256,
        },
      },
    ];
  if (path === '/.well-known/apple-app-site-association' && ios.appId)
    return {
      applinks: {
        details: [{ appIDs: [ios.appId], components: linkPaths.map((p) => ({ '/': p })) }],
      },
    };
  return null;
}
