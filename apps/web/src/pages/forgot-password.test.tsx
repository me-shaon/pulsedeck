import type { ReactNode } from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders as render } from '@/test/render';
import { ForgotPasswordPage } from './forgot-password';
import { requestPasswordReset } from '@/lib/auth-client';
import { getAuthConfig } from '@/lib/api';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...rest }: { to: string; children: ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/lib/auth-client', () => ({ requestPasswordReset: vi.fn() }));
vi.mock('@/lib/api', () => ({ getAuthConfig: vi.fn() }));

const requestPasswordResetMock = vi.mocked(requestPasswordReset);
const getAuthConfigMock = vi.mocked(getAuthConfig);

function configWith(emailConfigured: boolean) {
  return {
    githubEnabled: false,
    setupRequired: false,
    signupMode: 'setup' as const,
    billingEnabled: false,
    emailConfigured,
  };
}

beforeEach(() => {
  requestPasswordResetMock.mockReset().mockResolvedValue({ error: null } as never);
  getAuthConfigMock.mockReset().mockResolvedValue(configWith(true));
});

afterEach(() => vi.clearAllTimers());

async function submitEmail(email: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Email'), email);
  await user.click(screen.getByRole('button', { name: /send reset link/i }));
}

describe('ForgotPasswordPage', () => {
  it('requests a reset with the /reset-password redirect and shows a generic confirmation', async () => {
    render(<ForgotPasswordPage />);
    await submitEmail('user@example.com');

    await waitFor(() =>
      expect(requestPasswordResetMock).toHaveBeenCalledWith({
        email: 'user@example.com',
        redirectTo: '/reset-password',
      }),
    );
    expect(screen.getByText(/if that email exists/i)).toBeInTheDocument();
  });

  it('warns that email is not configured when emailConfigured is false', async () => {
    getAuthConfigMock.mockResolvedValue(configWith(false));
    render(<ForgotPasswordPage />);
    expect(await screen.findByText(/email.*not configured/i)).toBeInTheDocument();
  });

  it('does not warn when email is configured', async () => {
    render(<ForgotPasswordPage />);
    await waitFor(() => expect(getAuthConfigMock).toHaveBeenCalled());
    expect(screen.queryByText(/email.*not configured/i)).toBeNull();
  });
});
