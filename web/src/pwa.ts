/**
 * Install the shell worker and follow its updates. A new build activates as
 * soon as it is cached, and a page it takes over reloads onto it, so a client
 * never keeps running against a newer server. The first install takes control
 * of a fresh page that is already current, so only that takeover skips the
 * reload.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const worker = navigator.serviceWorker;
  let controlled = worker.controller !== null;
  worker.addEventListener('controllerchange', () => {
    if (controlled) window.location.reload();
    controlled = true;
  });
  worker
    .register('/sw.js', { type: 'module', updateViaCache: 'none' })
    .catch(() => {
      /* Online use still works if installation is unavailable. */
    });
}
