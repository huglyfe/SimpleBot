import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { flushSync } from 'react-dom';
import { PRODUCT_NAME, CLIENT_NAMESPACE } from '@simplebot/shared';
import { DialogsSuspended } from './lib/focus.js';
import { ConfirmDialog } from './components/primitives/ConfirmDialog.js';
import { setSpeechPlaybackBlocked } from './components/transcript/speech-playback.js';

const PIN_KEY = `${CLIENT_NAMESPACE}:privacy-pin`;
const GRACE_MS = 30_000;
const PrivacyContext = createContext<{
  enabled: boolean;
  lock: () => void;
  save: (current: string, next: string | null) => Promise<void>;
} | null>(null);

async function digest(pin: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pin),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: new TextEncoder().encode(salt),
      iterations: 100_000,
    },
    key,
    256,
  );
  return Array.from(new Uint8Array(bits), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

async function matches(pin: string, saved: string): Promise<boolean> {
  const [salt, hash] = saved.split(':');
  if (saved === 'unavailable')
    throw new Error(
      'Local storage is unavailable. Allow site storage and reload.',
    );
  return (
    salt !== undefined &&
    hash !== undefined &&
    /^[0-9]{6}$/u.test(pin) &&
    (await digest(pin, salt)) === hash
  );
}

function readPin(): string | null {
  try {
    return localStorage.getItem(PIN_KEY);
  } catch {
    return 'unavailable';
  } // Never silently unlock when storage cannot be read.
}

/**
 * CLIENT-SIDE privacy screen for casual viewing, including installed PWAs.
 * Browser controls can bypass it; that is an accepted product boundary.
 * Pairing establishes the server login cookie that authorizes private APIs.
 * This gate neither authenticates requests nor encrypts conversation data.
 */
export function PrivacyGate({ children }: { children: ReactNode }) {
  const [saved, setSaved] = useState(readPin);
  const [locked, setLocked] = useState(saved !== null);
  const [opened, setOpened] = useState(saved === null);
  const [covered, setCovered] = useState(false);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const hiddenAt = useRef<number | null>(null);
  const unlockEpoch = useRef(0);
  const obscured = saved !== null && (locked || covered);

  useLayoutEffect(() => {
    setSpeechPlaybackBlocked(obscured);
    if (obscured) dialog.current?.showModal();
    else dialog.current?.close();
    return () => setSpeechPlaybackBlocked(false);
  }, [obscured]);

  useEffect(() => {
    function hide() {
      if (saved === null) return;
      unlockEpoch.current += 1;
      hiddenAt.current ??= Date.now();
      flushSync(() => {
        setCovered(true);
        setPin('');
        setError(null);
      });
    }
    function resume() {
      if (document.hidden) return;
      const started = hiddenAt.current;
      hiddenAt.current = null;
      flushSync(() => {
        if (started !== null && Date.now() - started >= GRACE_MS)
          setLocked(true);
        setCovered(false);
      });
    }
    function visibility() {
      if (document.hidden) hide();
      else resume();
    }
    function storage(event: StorageEvent) {
      if (event.key !== PIN_KEY && event.key !== null) return;
      unlockEpoch.current += 1;
      const next = readPin();
      setSaved(next);
      setLocked(next !== null);
      if (next === null) setOpened(true);
      setPin('');
    }
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', hide);
    window.addEventListener('pageshow', resume);
    window.addEventListener('storage', storage);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('pageshow', resume);
      window.removeEventListener('storage', storage);
    };
  }, [saved]);

  async function unlock() {
    if (saved === null || pending) return;
    dialog.current?.querySelector('input')?.focus();
    const epoch = unlockEpoch.current;
    setPending(true);
    setError(null);
    try {
      if (!(await matches(pin, saved))) throw new Error('Incorrect PIN.');
      // A changed preference or backgrounded window cannot finish an old unlock.
      if (
        epoch !== unlockEpoch.current ||
        readPin() !== saved ||
        document.hidden
      )
        return;
      setOpened(true);
      setLocked(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not unlock.');
    } finally {
      setPending(false);
      setPin('');
    }
  }

  return (
    <PrivacyContext.Provider
      value={{
        enabled: saved !== null,
        lock() {
          unlockEpoch.current += 1;
          setPin('');
          setError(null);
          setLocked(true);
        },
        async save(current, next) {
          if (saved !== null && !(await matches(current, saved)))
            throw new Error('Incorrect current PIN.');
          if (next !== null && !/^[0-9]{6}$/u.test(next))
            throw new Error('Use exactly six digits.');
          const salt = crypto.randomUUID();
          const value =
            next === null ? null : `${salt}:${await digest(next, salt)}`;
          if (readPin() !== saved)
            throw new Error(
              'PIN settings changed in another window. Open settings again.',
            );
          if (value === null) localStorage.removeItem(PIN_KEY);
          else localStorage.setItem(PIN_KEY, value);
          setSaved(value);
          setLocked(false);
        },
      }}
    >
      <DialogsSuspended value={obscured}>
        {opened ? children : null}
      </DialogsSuspended>
      <dialog
        ref={dialog}
        className="privacy-screen"
        aria-labelledby="privacy-title"
        onCancel={(event) => event.preventDefault()}
      >
        <form
          className="auth-card"
          onSubmit={(event) => {
            event.preventDefault();
            void unlock();
          }}
        >
          <h1 id="privacy-title">{PRODUCT_NAME} is locked</h1>
          <label htmlFor="unlock-pin">Privacy PIN</label>
          <input
            id="unlock-pin"
            type="password"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            autoComplete="off"
            value={pin}
            onChange={(event) => setPin(event.target.value)}
            required
            readOnly={pending}
          />
          {error === null ? null : (
            <p className="ui-hint is-error" role="alert">
              {error}
            </p>
          )}
          <button className="ui-button is-primary" disabled={pending}>
            {pending ? 'Unlocking…' : 'Unlock'}
          </button>
          <p className="ui-hint">
            Forgot your PIN? Clear this app’s site data and pair again. This
            also removes local preferences and offline assets.
          </p>
        </form>
      </dialog>
    </PrivacyContext.Provider>
  );
}

export function PrivacySettings() {
  const privacy = useContext(PrivacyContext);
  const [action, setAction] = useState<'set' | 'remove' | null>(null);
  const [pins, setPins] = useState({ current: '', next: '', repeat: '' });
  if (privacy === null) return null;
  function edit(nextAction: 'set' | 'remove') {
    setPins({ current: '', next: '', repeat: '' });
    setAction(nextAction);
  }
  async function save() {
    if (privacy === null) return;
    if (action === 'set' && pins.next !== pins.repeat)
      throw new Error('The new PINs do not match.');
    await privacy.save(pins.current, action === 'remove' ? null : pins.next);
    setAction(null);
    setPins({ current: '', next: '', repeat: '' });
  }
  return (
    <>
      <div className="login-actions">
        {privacy.enabled ? (
          <button type="button" className="ui-button" onClick={privacy.lock}>
            Lock now
          </button>
        ) : null}
        <button type="button" className="ui-button" onClick={() => edit('set')}>
          {privacy.enabled ? 'Change privacy PIN' : 'Set privacy PIN'}
        </button>
        {privacy.enabled ? (
          <button
            type="button"
            className="ui-button is-danger"
            onClick={() => edit('remove')}
          >
            Remove privacy PIN
          </button>
        ) : null}
      </div>
      {action === null ? null : (
        <ConfirmDialog
          title={
            action === 'remove' ? 'Remove privacy PIN?' : 'Set privacy PIN'
          }
          confirmLabel={
            action === 'remove' ? 'Remove privacy PIN' : 'Save privacy PIN'
          }
          pendingLabel="Saving…"
          destructive={action === 'remove'}
          initialFocus="first-field"
          onCancel={() => setAction(null)}
          onConfirm={save}
          body={
            <div className="pin-fields">
              {(
                [
                  ['current', 'Current PIN'],
                  ['next', 'New PIN'],
                  ['repeat', 'Repeat new PIN'],
                ] satisfies [keyof typeof pins, string][]
              ).map(([key, label]) =>
                (key === 'current' ? privacy.enabled : action === 'set') ? (
                  <label key={key}>
                    {label}
                    <input
                      type="password"
                      inputMode="numeric"
                      maxLength={6}
                      autoComplete="off"
                      value={pins[key]}
                      onChange={(event) =>
                        setPins({ ...pins, [key]: event.target.value })
                      }
                    />
                  </label>
                ) : null,
              )}
              {action === 'remove' ? (
                <p>This app will open without a privacy PIN.</p>
              ) : null}
            </div>
          }
        />
      )}
    </>
  );
}
