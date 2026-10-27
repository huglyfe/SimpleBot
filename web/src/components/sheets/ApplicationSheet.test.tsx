import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ApplicationSheet } from './ApplicationSheet.js';

describe('ApplicationSheet', () => {
  it('selects a searchable timezone while saving its IANA identifier', async () => {
    const user = userEvent.setup();
    const patch = vi.fn().mockResolvedValue(undefined);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ApplicationSheet
          value={{
            application: {
              timezone: 'UTC',
              loginEnabled: true,
            },
          }}
          patch={patch}
          version="0.10.0"
          appearance="system"
          onAppearanceChange={vi.fn()}
        />
      </QueryClientProvider>,
    );

    const timezone = screen.getByRole('button', { name: 'Timezone' });
    expect(timezone).toHaveTextContent('UTC');
    await user.click(timezone);
    await user.type(
      screen.getByRole('searchbox', { name: 'Search timezone' }),
      'New York',
    );
    await user.click(
      screen.getByRole('button', {
        name: /New York.*America\/New_York/u,
      }),
    );

    expect(patch).toHaveBeenCalledWith(
      'application',
      expect.objectContaining({ timezone: 'America/New_York' }),
    );
  });
  it('finds browser login expiry by session and allows disabling it', async () => {
    const user = userEvent.setup();
    const patch = vi.fn().mockResolvedValue(undefined);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ApplicationSheet
          value={{ application: {} }}
          patch={patch}
          version="0.10.0"
          appearance="system"
          onAppearanceChange={vi.fn()}
        />
      </QueryClientProvider>,
    );
    expect(
      screen.queryByLabelText('Browser login expiry (days)'),
    ).not.toBeInTheDocument();
    await user.type(
      screen.getByRole('searchbox', { name: 'Find a setting' }),
      'session',
    );
    const expiry = screen.getByLabelText('Browser login expiry (days)');
    expect(expiry).toHaveValue(30);
    fireEvent.change(expiry, { target: { value: '0' } });
    expect(patch).toHaveBeenLastCalledWith('application', {
      browserLoginExpiryDays: 0,
    });
  });
});
