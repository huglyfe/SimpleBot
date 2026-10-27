import { updateTrace, type AttemptEvent } from '@simplebot/shared';
import type { LiveAttempt } from '../components/transcript/MessageRow.js';

/** Preserve every event in order, publishing the live overlay at frame cadence. */
export function livePresentation(
  initial: LiveAttempt,
  publish: (next: LiveAttempt) => void,
) {
  let current = initial;
  let frame: number | null = null;
  function cancel(): void {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  }
  function flush(): void {
    if (frame === null) return;
    cancel();
    publish(current);
  }
  return {
    update(event: AttemptEvent): void {
      if (event.type === 'text_delta') {
        if (event.delta === '') return;
        current = { ...current, text: current.text + event.delta };
      } else {
        const trace = updateTrace(current.trace, event);
        if (trace === current.trace) return;
        current = { ...current, trace };
      }
      frame ??= requestAnimationFrame(flush);
    },
    flush,
    cancel,
  };
}
