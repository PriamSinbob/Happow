import { intervalMs, type HappowConfig, type Region, type Source } from '@happow/core';

/**
 * Scheduling rules shared by the ingest run (which sources to fetch now) and the Cloudflare Cron
 * Trigger (whether to start an ingest run at all). Pure functions only: the Worker imports this
 * module, so it must not pull in Postgres or Node APIs.
 */

/** Grace so a cron tick that fires a few minutes early still counts as due. */
export const SCHEDULE_SLACK_MS = 5 * 60_000;

/**
 * Whether a source should be fetched now. `aheadMs` lets a run that is starting anyway take a
 * source that would come due soon (at most half its interval early), so sources settle into a
 * few shared runs a day instead of one run each (the dispatcher itself asks with no ahead).
 */
export function isDue(source: Source, lastSuccess: Date | null, now: Date, aheadMs = 0): boolean {
  if (!source.schedule) return false;
  if (!lastSuccess) return true;
  const interval = intervalMs(source.schedule);
  const early = Math.max(SCHEDULE_SLACK_MS, Math.min(aheadMs, interval / 2));
  return now.getTime() - lastSuccess.getTime() >= interval - early;
}

/** Every (region, source) pair the config enables, in sources.json order. */
export function plannedRuns(
  config: Pick<HappowConfig, 'regions' | 'sources'>,
): { region: Region; source: Source }[] {
  return config.regions.flatMap((region) =>
    config.sources
      .filter(
        (s) => s.enabled && s.regionIds.includes(region.id) && region.enabledSources.includes(s.id),
      )
      .map((source) => ({ region, source })),
  );
}

/** One row of `source_runs`, as the dispatcher reads it. */
export interface RunRecord {
  sourceId: string;
  regionId: string;
  startedAt: Date;
  status: 'running' | 'ok' | 'failed' | 'skipped';
}

/** How long the dispatcher waits before trying a source again after a non-success. */
export interface DispatchPolicy {
  /** A run that skipped a source (missing secrets) is not retried for this long. */
  skippedBackoffHours: number;
  /** A failed source is retried after this long, or after its own interval if that is shorter. */
  failedRetryMinutes: number;
  /** A run still marked "running" after this long is treated as dead. */
  runningTimeoutMinutes: number;
}

/**
 * `source@region` pairs that justify starting an ingest run now. A pair is due when its last
 * success is older than its schedule (same rule as the run itself), unless the latest attempt
 * says that starting again now would be wasted: still running, skipped for missing secrets, or
 * failed a moment ago. Keeps a frequent cron from burning CI minutes on sources that cannot run.
 */
export function dueForDispatch(
  config: Pick<HappowConfig, 'regions' | 'sources'>,
  runs: readonly RunRecord[],
  now: Date,
  policy: DispatchPolicy,
): string[] {
  const due: string[] = [];
  for (const { region, source } of plannedRuns(config)) {
    if (!source.schedule) continue;
    const mine = runs
      .filter((r) => r.sourceId === source.id && r.regionId === region.id)
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
    const lastOk = mine.find((r) => r.status === 'ok')?.startedAt ?? null;
    if (!isDue(source, lastOk, now)) continue;
    const last = mine[0];
    if (last) {
      const ageMs = now.getTime() - last.startedAt.getTime();
      const wait =
        last.status === 'running'
          ? policy.runningTimeoutMinutes * 60_000
          : last.status === 'skipped'
            ? policy.skippedBackoffHours * 3_600_000
            : last.status === 'failed'
              ? Math.min(intervalMs(source.schedule), policy.failedRetryMinutes * 60_000)
              : 0;
      if (ageMs < wait) continue;
    }
    due.push(`${source.id}@${region.id}`);
  }
  return due;
}

/** How far back the dispatcher must read `source_runs` to apply every rule above. */
export function dispatchLookbackMs(
  config: Pick<HappowConfig, 'regions' | 'sources'>,
  policy: DispatchPolicy,
): number {
  const longest = Math.max(
    0,
    ...plannedRuns(config).map(({ source }) => (source.schedule ? intervalMs(source.schedule) : 0)),
  );
  return Math.max(longest, policy.skippedBackoffHours * 3_600_000) + 3_600_000;
}
