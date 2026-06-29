import type { ReactNode } from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders as render } from '@/test/render';
import { ResetPasswordPage } from './reset-password';
import { resetPassword } from '@/lib/auth-client';

const navigate = vi.fn();
const search = vi.fn<() => { token?: string }>(() => ({ token: 'tok-123' }));
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  useSearch: () => search(),
  Link: ({ to, children, ...rest }: { to: string; children: ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/lib/auth-client', () => ({ resetPassword: vi.fn() }));

const resetPasswordMock = vi.mocked(resetPassword);

beforeEach(() => {
  navigate.mockReset();
  search.mockReset().mockReturnValue({ token: 'tok-123' });
  resetPasswordMock.mockReset().mockResolvedValue({ error: null } as never);
});

afterEach(() => vi.clearAllTimers());

async function fillAndSubmit(pw: string, confirm: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('New password'), pw);
  await user.type(screen.getByLabelText('Confirm password'), confirm);
  await user.click(screen.getByRole('button', { name: /reset password/i }));
}

describe('ResetPasswordPage', () => {
  it('resets with the token and navigates to /login on success', async () => {
    render(<ResetPasswordPage />);
    await fillAndSubmit('supersecret1', 'supersecret1');

    await waitFor(() =>
      expect(resetPasswordMock).toHaveBeenCalledWith({
        newPassword: 'supersecret1',
        token: 'tok-123',
      }),
    );
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/login' }));
  });

  it('rejects mismatched passwords without calling the API', async () => {
    render(<ResetPasswordPage />);
    await fillAndSubmit('supersecret1', 'different2');

    expect(await screen.findByText(/passwords do not match/i)).toBeInTheDocument();
    expect(resetPasswordMock).not.toHaveBeenCalled();
  });

  it('shows an invalid-link message when the token is missing', () => {
    search.mockReturnValue({});
    render(<ResetPasswordPage />);
    expect(screen.getByText(/invalid or expired/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('New password')).toBeNull();
  });

  it('surfaces a server error and does not navigate', async () => {
    resetPasswordMock.mockResolvedValue({
      error: { message: 'Token expired.' },
    } as never);
    render(<ResetPasswordPage />);
    await fillAndSubmit('supersecret1', 'supersecret1');

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Token expired.'));
    expect(navigate).not.toHaveBeenCalled();
  });
});
