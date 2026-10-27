import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthGate } from './auth.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AuthGate', () => {
  it('keeps the pairing action present and disabled while exchange is pending', async () => {
    let finishExchange: (() => void) | undefined;
    const exchange = new Promise<Response>((resolve) => {
      finishExchange = () =>
        resolve(
          new Response(
            JSON.stringify({
              authenticated: true,
              expiresAt: '2026-08-18T12:00:00.000Z',
            }),
            { headers: { 'content-type': 'application/json' } },
          ),
        );
    });
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ loginEnabled: true, authenticated: false }),
            { headers: { 'content-type': 'application/json' } },
          ),
        )
        .mockReturnValueOnce(exchange),
    );

    render(
      <AuthGate>
        <p>Private application</p>
      </AuthGate>,
    );
    const user = userEvent.setup();
    await user.type(
      await screen.findByLabelText('Pairing code or owner key'),
      'credential',
    );
    await user.click(screen.getByRole('button', { name: 'Pair' }));

    expect(screen.getByRole('button', { name: 'Pairing…' })).toBeDisabled();

    finishExchange?.();
    expect(await screen.findByText('Private application')).toBeInTheDocument();
  });
});

it('bounds an unreachable initial status read and shows Retry', async () => {
  const timeout = new AbortController();
  const timeoutSpy = vi
    .spyOn(AbortSignal, 'timeout')
    .mockReturnValue(timeout.signal);
  let requestSignal: AbortSignal | undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (_path: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          requestSignal = init.signal ?? undefined;
          requestSignal?.addEventListener('abort', () =>
            reject(new DOMException('Timed out', 'TimeoutError')),
          );
        }),
    ),
  );
  const { unmount } = render(
    <AuthGate>
      <p>Private application</p>
    </AuthGate>,
  );
  expect(timeoutSpy).toHaveBeenCalledWith(10_000);
  timeout.abort(new DOMException('Timed out', 'TimeoutError'));
  expect(await screen.findByRole('button', { name: 'Retry' })).toBeVisible();
  expect(screen.queryByText('Private application')).not.toBeInTheDocument();
  unmount();
  timeoutSpy.mockRestore();
});
