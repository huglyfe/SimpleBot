import { afterEach, expect, it, vi } from 'vitest';
import type { AttemptEventPayload } from '@simplebot/shared';
import { livePresentation } from './live-presentation.js';

afterEach(() => vi.unstubAllGlobals());

function fixture() {
  let frame: FrameRequestCallback | undefined;
  const request = vi.fn((callback: FrameRequestCallback) => {
    frame = callback;
    return 1;
  });
  const cancel = vi.fn(() => {
    frame = undefined;
  });
  vi.stubGlobal('requestAnimationFrame', request);
  vi.stubGlobal('cancelAnimationFrame', cancel);
  const publish = vi.fn();
  const presentation = livePresentation(
    { positionId: 'p', variantId: 'v', text: '', trace: [] },
    publish,
  );
  return {
    presentation,
    publish,
    request,
    cancel,
    paint: () => frame?.(0),
    event: (event: AttemptEventPayload) =>
      presentation.update({
        ...event,
        attemptId: 'a',
        at: '2026-09-26T12:00:00.000Z',
      }),
  };
}

it('publishes a burst once while preserving text and reasoning/tool order', () => {
  const f = fixture();
  for (let i = 0; i < 1000; i++)
    f.event({ type: 'text_delta', delta: String(i) });
  f.event({ type: 'thinking_delta', delta: 'Before' });
  f.event({
    type: 'tool_call',
    id: 'tool',
    name: 'read',
    arguments: { path: 'a' },
  });
  f.event({
    type: 'tool_result',
    id: 'tool',
    name: 'read',
    result: 'result',
    isError: false,
  });
  f.event({ type: 'thinking_delta', delta: 'After' });
  expect(f.request).toHaveBeenCalledTimes(1);
  expect(f.publish).not.toHaveBeenCalled();
  f.paint();
  expect(f.publish).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      text: Array.from({ length: 1000 }, (_, i) => String(i)).join(''),
      trace: [
        { type: 'reasoning', text: 'Before' },
        expect.objectContaining({ type: 'tool', id: 'tool', result: 'result' }),
        { type: 'reasoning', text: 'After' },
      ],
    }),
  );
  f.presentation.flush();
  expect(f.publish).toHaveBeenCalledTimes(1);
});

it('flushes the final delta even before a frame and cancels detached overlays', () => {
  const f = fixture();
  f.event({ type: 'text_delta', delta: 'Final' });
  f.presentation.flush();
  f.paint();
  expect(f.publish).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ text: 'Final' }),
  );
  f.event({ type: 'text_delta', delta: ' discarded' });
  f.presentation.cancel();
  f.paint();
  f.presentation.flush();
  expect(f.publish).toHaveBeenCalledTimes(1);
});
