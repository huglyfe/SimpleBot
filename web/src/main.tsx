import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.js';
import { AuthGate } from './auth.js';
import { PrivacyGate } from './privacy.js';
import { AppUpdate } from './pwa.js';
import { initTheme } from './theme/theme.js';
import './styles/app.css';

initTheme();

const root = document.querySelector('#root');
if (!root) throw new Error('missing application root');

createRoot(root).render(
  <StrictMode>
    <PrivacyGate>
      <AppUpdate />
      <AuthGate>
        <App />
      </AuthGate>
    </PrivacyGate>
  </StrictMode>,
);
