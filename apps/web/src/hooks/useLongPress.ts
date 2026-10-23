import { useEffect, useRef, type MouseEvent } from 'react';

const HOLD_MS = 500;

/**
 * Tap and hold on one button (the map shortcut and the dice, slice G). A hold of 500 ms (or a
 * right-click / the context-menu key) calls `onHold` with `vibrate(6)`; the click that follows a
 * hold is swallowed, so a hold never also counts as a tap.
 */
export function useLongPress(onTap: () => void, onHold: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => cancel, []);
  const hold = () => {
    held.current = true;
    navigator.vibrate?.(6);
    onHold();
  };
  return {
    onPointerDown: () => {
      held.current = false;
      cancel();
      timer.current = setTimeout(hold, HOLD_MS);
    },
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onContextMenu: (e: MouseEvent) => {
      e.preventDefault();
      cancel();
      if (!held.current) hold();
    },
    onClick: () => {
      if (held.current) {
        held.current = false;
        return;
      }
      onTap();
    },
  };
}
