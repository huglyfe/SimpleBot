import { useEffect, useState } from 'react';
import { ConfirmDialog } from './components/primitives/ConfirmDialog.js';

/** Offer each page visit an update; only this window opts into reload. */
export function AppUpdate() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
    const listeners = new AbortController();
    const { signal } = listeners;
    void navigator.serviceWorker
      .register('/sw.js', { type: 'module', updateViaCache: 'none' })
      .then((registration) => {
        if (signal.aborted) return;
        function ready() {
          if (
            navigator.serviceWorker.controller !== null &&
            registration.waiting !== null
          )
            setWaiting(registration.waiting);
        }
        function watchInstalling() {
          registration.installing?.addEventListener('statechange', ready, {
            signal,
          });
          ready();
        }
        watchInstalling();
        registration.addEventListener('updatefound', watchInstalling, {
          signal,
        });
      })
      .catch(() => {
        /* Online use still works if installation is unavailable. */
      });
    return () => listeners.abort();
  }, []);

  if (waiting === null || dismissed) return null;
  return (
    <ConfirmDialog
      title="Update available"
      body="Reload to update. Unsent drafts and unsaved edits will be lost. Running replies will continue."
      cancelLabel="Later"
      confirmLabel="Update and reload"
      pendingLabel="Updating…"
      onCancel={() => setDismissed(true)}
      onConfirm={async () => {
        if (waiting.state !== 'activated') {
          await new Promise<void>((resolve) => {
            navigator.serviceWorker.addEventListener(
              'controllerchange',
              () => resolve(),
              { once: true },
            );
            waiting.postMessage('activate');
          });
        }
        window.location.reload();
      }}
    />
  );
}
