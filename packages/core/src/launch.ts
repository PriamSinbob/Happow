import type { HappowConfig } from './config.js';

/** One thing that stands between the app and a public launch (M13 §7). */
export interface LaunchItem {
  id: string;
  /** "block": must be done before launch; "check": worth a look, not blocking. */
  level: 'block' | 'check';
  text: string;
}

const PERSONAL_MAIL = /@(gmail|googlemail|outlook|hotmail|yahoo|wp|o2|onet|interia)\./i;

/**
 * What config says is still unfinished for a public launch. Pure: the script reads the files,
 * this decides. `wrangler` is the text of wrangler.jsonc, for the previews check.
 */
export function launchItems(c: HappowConfig, now: Date, wrangler = ''): LaunchItem[] {
  const out: LaunchItem[] = [];
  const add = (id: string, level: LaunchItem['level'], text: string) =>
    out.push({ id, level, text });
  const { legal, site, auth, email, analytics } = c.app;

  if (!legal.operator)
    add(
      'operator',
      'block',
      'legal.operator: the controller named in the terms and privacy policy',
    );
  if (!legal.address) add('address', 'block', "legal.address: the operator's postal address");
  if (!legal.contactEmail)
    add('contact', 'block', 'legal.contactEmail: the takedown and data contact');
  else if (PERSONAL_MAIL.test(legal.contactEmail))
    add(
      'contact',
      'block',
      `legal.contactEmail is a personal mailbox (${legal.contactEmail}): use one on the app's domain`,
    );
  if (/\.workers\.dev$/.test(new URL(site.url).hostname))
    add(
      'domain',
      'block',
      `site.url is on workers.dev (${site.url}): register the domain and point it at the Worker`,
    );
  if (/draft|interim/i.test(legal.termsVersion))
    add(
      'terms',
      'block',
      `legal.termsVersion "${legal.termsVersion}": the legal texts are drafts; have them reviewed, then set a final version`,
    );
  if (auth.emailDelivery === 'manual')
    add(
      'codes',
      'block',
      'auth.emailDelivery is "manual": codes are mailed by hand; switch to "app" once email works',
    );
  if (auth.emailDelivery === 'app' && email.provider === 'none')
    add('codes', 'block', 'auth.emailDelivery is "app" but email.provider is "none"');
  if (email.provider === 'none' || !email.from)
    add('email', 'block', 'email.provider / email.from: no sender yet (sign-in codes, alerts)');
  for (const s of c.sources)
    if (s.enabled && s.beforeLaunch) add(`source:${s.id}`, 'block', `${s.name}: ${s.beforeLaunch}`);
  const promo = c.plans.earlyAccess;
  if (promo && new Date(`${promo.until}T23:59:59Z`) >= now)
    add('earlyAccess', 'check', `earlyAccess gives everyone ${promo.plan} until ${promo.until}`);
  if (!analytics.plausibleDomain)
    add('analytics', 'check', 'analytics.plausibleDomain is not set: no visit counts');
  // A preview that ran the cron would ingest and send notifications from a branch.
  const previews =
    /"previews"\s*:\s*\{([^}]*)\}/.exec(wrangler.replace(/\/\/.*$/gm, ''))?.[1] ?? '';
  if (/"triggers"/.test(previews))
    add(
      'previews',
      'block',
      'wrangler.jsonc gives previews Cron Triggers: remove "triggers" under "previews"',
    );
  return out;
}
