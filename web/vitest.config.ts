import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * Component proof for the WebUI. Deliberately separate from `vite.config.ts`:
 * the dev config reads `CONFIG_PATH` and TLS material at load time, and tests
 * must not need an authored root.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['src/test-setup.ts'],
  },
});
