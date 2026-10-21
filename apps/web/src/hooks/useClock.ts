import { useEffect, useState } from 'react';

/**
 * The current time, updated once a minute on the minute and never while the app is hidden (no
 * timers in the background). Coming back to the app updates it at once. Only labels and local
 * filtering depend on it; it never triggers a download by itself.
 */
export function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      const d = new Date();
      const untilNextMinute = 60_000 - (d.getSeconds() * 1000 + d.getMilliseconds());
      timer = setTimeout(tick, untilNextMinute + 50);
    };
    const tick = () => {
      setNow(new Date());
      schedule();
    };
    const onVisibility = () => {
      clearTimeout(timer);
      if (document.visibilityState !== 'visible') return;
      setNow(new Date());
      schedule();
    };
    if (document.visibilityState === 'visible') schedule();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);
  return now;
}
