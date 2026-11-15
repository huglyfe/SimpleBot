import { afterEach, expect, test, vi } from 'vitest';
import { registerServiceWorker } from './pwa.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function stubWorker(controller: object | null) {
  vi.stubEnv('PROD', true);
  const serviceWorker = Object.assign(new EventTarget(), {
    controller,
    register: vi.fn().mockResolvedValue({}),
  });
  const reload = vi.fn();
  vi.stubGlobal('navigator', { serviceWorker });
  vi.stubGlobal('location', { reload });
  return { serviceWorker, reload };
}

test('a controlled page reloads when a new build takes over', () => {
  const { serviceWorker, reload } = stubWorker({});
  registerServiceWorker();
  expect(serviceWorker.register).toHaveBeenCalledOnce();
  serviceWorker.dispatchEvent(new Event('controllerchange'));
  expect(reload).toHaveBeenCalledOnce();
});

test('the first install does not reload the page it starts controlling, but a later build does', () => {
  const { serviceWorker, reload } = stubWorker(null);
  registerServiceWorker();
  serviceWorker.dispatchEvent(new Event('controllerchange'));
  expect(reload).not.toHaveBeenCalled();
  serviceWorker.dispatchEvent(new Event('controllerchange'));
  expect(reload).toHaveBeenCalledOnce();
});
