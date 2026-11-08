/**
 * What still stands between the app and a public launch (M13 §7), from config and wrangler.jsonc.
 *   pnpm launch:check            exit 1 while anything blocks
 *   pnpm launch:check --report   print only (CI)
 * The owner's steps for each item are in docs/LAUNCH.md.
 */
import { readFileSync } from 'node:fs';
import { launchItems, loadConfig } from '@happow/core';

const wrangler = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
const items = launchItems(loadConfig(), new Date(), wrangler);
const blocks = items.filter((i) => i.level === 'block');
for (const i of items) console.log(`${i.level === 'block' ? '✗' : '·'} ${i.text}`);
console.log(
  blocks.length
    ? `\n${blocks.length} item(s) block a public launch. Steps: docs/LAUNCH.md`
    : '\nNothing in config blocks a public launch.',
);
if (blocks.length && !process.argv.includes('--report')) process.exit(1);
