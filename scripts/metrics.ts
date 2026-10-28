/**
 * `pnpm metrics [region] [--at <ISO time>] [--save]` prints the M12 metrics
 * (docs/milestones/M12-more-events.md §1). `--save` also stores the week's row in metrics_weekly
 * if the week has none yet; the Worker's cron does that every week.
 */
import { getRegion, loadConfig } from '@happow/core';
import { withClient } from './db.js';

const config = loadConfig();
const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i < 0 ? undefined : (args.splice(i, name === '--save' ? 1 : 2)[1] ?? '');
};
const save = flag('--save') !== undefined;
const atArg = flag('--at');
const at = atArg ? new Date(atArg) : new Date();
if (Number.isNaN(at.getTime())) throw new Error(`--at: not a time: ${atArg}`);
const region = getRegion(config, args[0] ?? config.app.defaultRegion);
const evening = config.app.metrics.eveningFromHour;

await withClient(async (db) => {
  const { m } = (
    await db.query<{ m: Record<string, unknown> }>('select m12_metrics($1, $2, $3) m', [
      region.id,
      at,
      evening,
    ])
  ).rows[0]!;
  console.log(JSON.stringify(m, null, 2));
  if (save) {
    const { saved } = (
      await db.query<{ saved: boolean }>('select metrics_save($1, $2, $3) saved', [
        region.id,
        at,
        evening,
      ])
    ).rows[0]!;
    console.log(saved ? 'saved for this week' : 'this week already has a row; nothing saved');
  }
});
