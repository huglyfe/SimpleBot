import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { AppUpdate } from './pwa.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

test('an update already installing when registration resolves becomes visible without another updatefound event', async () => {
  vi.stubEnv('PROD', true);
  const installing = new EventTarget();
  const registration = Object.assign(new EventTarget(), {
    installing,
    waiting: null as EventTarget | null,
  });
  const subscribe = vi.spyOn(registration, 'addEventListener');
  const register = vi.fn().mockResolvedValue(registration);
  vi.stubGlobal('navigator', {
    serviceWorker: { controller: {}, register },
  });
  const { unmount } = render(<AppUpdate />);
  await waitFor(() => expect(register).toHaveBeenCalledOnce());
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  act(() => {
    registration.waiting = installing;
    installing.dispatchEvent(new Event('statechange'));
  });
  expect(
    screen.getByRole('alertdialog', { name: 'Update available' }),
  ).toBeVisible();
  const options = subscribe.mock.calls[0]?.[2];
  if (typeof options !== 'object' || options.signal === undefined)
    throw new Error('Update listeners must have an abort signal');
  expect(options.signal.aborted).toBe(false);
  unmount();
  expect(options.signal.aborted).toBe(true);
});

test('registration completing after unmount does not attach listeners', async () => {
  vi.stubEnv('PROD', true);
  const registration = Object.assign(new EventTarget(), {
    installing: null,
    waiting: null,
  });
  const subscribe = vi.spyOn(registration, 'addEventListener');
  const result = Promise.withResolvers<typeof registration>();
  vi.stubGlobal('navigator', {
    serviceWorker: { controller: {}, register: () => result.promise },
  });
  const { unmount } = render(<AppUpdate />);
  unmount();
  await act(async () => result.resolve(registration));
  expect(subscribe).not.toHaveBeenCalled();
});
