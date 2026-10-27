import { useState, type ReactElement } from 'react';

import { purgeOtherLogins } from '../../api.js';
import { useAuth } from '../../auth.js';
import { PrivacySettings } from '../../privacy.js';
import { ConfirmDialog } from '../primitives/ConfirmDialog.js';
import { Section } from './Section.js';

export function LoginManagement(): ReactElement | null {
  const auth = useAuth();
  const [confirmPurge, setConfirmPurge] = useState(false);
  return (
    <Section title="Login management">
      <PrivacySettings />
      {auth.authenticated ? (
        <div className="login-actions">
          <button
            type="button"
            className="ui-button is-danger"
            onClick={() => void auth.logout()}
          >
            Log out
          </button>
          <button
            type="button"
            className="ui-button is-danger"
            onClick={() => {
              setConfirmPurge(true);
            }}
          >
            Purge other logins
          </button>
        </div>
      ) : null}
      {confirmPurge ? (
        <ConfirmDialog
          title="Revoke other browser logins?"
          body="Other browsers will be logged out. This browser stays logged in."
          confirmLabel="Purge"
          destructive
          onConfirm={async () => {
            await purgeOtherLogins();
            setConfirmPurge(false);
          }}
          onCancel={() => setConfirmPurge(false)}
        />
      ) : null}
    </Section>
  );
}
