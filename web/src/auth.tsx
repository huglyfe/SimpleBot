import {
  AUTH_REQUIRED_EVENT,
  PRODUCT_NAME,
  PRODUCT_SLUG,
} from '@simplebot/shared';
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type SyntheticEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { errorMessage } from './lib/errorMessage.js';
import { getAuthStatus, pairBrowser, logoutBrowser } from './api.js';

const AuthContext = createContext({
  loginEnabled: false,
  authenticated: false,
  async logout(): Promise<void> {
    throw new Error('Authentication context is unavailable');
  },
});

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthGate({ children }: { children: ReactNode }): ReactElement {
  const [status, setStatus] = useState<
    { loginEnabled: boolean; authenticated: boolean } | 'loading' | 'failed'
  >('loading');

  useEffect(() => {
    const controller = new AbortController();
    void getAuthStatus(controller.signal).then(
      (value) => !controller.signal.aborted && setStatus(value),
      () => !controller.signal.aborted && setStatus('failed'),
    );
    const required = () =>
      setStatus({ loginEnabled: true, authenticated: false });
    window.addEventListener(AUTH_REQUIRED_EVENT, required);
    return () => {
      controller.abort();
      window.removeEventListener(AUTH_REQUIRED_EVENT, required);
    };
  }, []);

  if (status === 'loading') return <AuthPage>Loading…</AuthPage>;
  if (status === 'failed') {
    return (
      <AuthPage>
        <p>
          Could not reach {PRODUCT_NAME}. Check your connection and that your
          server is running.
        </p>
        <button
          type="button"
          className="ui-button"
          onClick={() => window.location.reload()}
        >
          Retry
        </button>
      </AuthPage>
    );
  }
  if (status.loginEnabled && !status.authenticated) {
    return (
      <Login onDone={() => setStatus({ ...status, authenticated: true })} />
    );
  }
  return (
    <AuthContext.Provider
      value={{
        loginEnabled: status.loginEnabled,
        authenticated: status.authenticated,
        async logout() {
          await logoutBrowser();
          setStatus({ loginEnabled: true, authenticated: false });
        },
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const [credential, setCredential] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: SyntheticEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await pairBrowser(credential);
      setCredential('');
      onDone();
    } catch (caught) {
      setError(errorMessage(caught, 'Pairing failed'));
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="auth-page">
      <form className="auth-card" onSubmit={(event) => void submit(event)}>
        <div className="brand-mark" aria-hidden="true">
          {PRODUCT_NAME.slice(0, 1)}
        </div>
        <h1>Pair this browser</h1>
        <p>
          Run <code>{PRODUCT_SLUG} pair</code> on the {PRODUCT_NAME} host, then
          enter the code or owner key.
        </p>
        <label htmlFor="credential">Pairing code or owner key</label>
        <input
          id="credential"
          type="password"
          autoFocus
          autoComplete="one-time-code"
          maxLength={128}
          value={credential}
          onChange={(event) => setCredential(event.target.value)}
        />
        {error === null ? null : (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button
          className="ui-button is-primary"
          disabled={pending || credential.trim() === ''}
        >
          {pending ? 'Pairing…' : 'Pair'}
        </button>
      </form>
    </main>
  );
}

function AuthPage({ children }: { children: ReactNode }) {
  return (
    <main className="auth-page">
      <div className="auth-card">{children}</div>
    </main>
  );
}
