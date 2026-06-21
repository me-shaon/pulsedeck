import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders as render } from '@/test/render';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginPage } from './login';
import { signIn } from '@/lib/auth-client';
import { invalidateAuth } from '@/lib/guards';
import { getAuthConfig } from '@/lib/api';

/**
 * Component tests for the sign-in screen. Same shared `invalidateAuth` →
 * `navigate` success path as setup, so it carried the same latent stale-cache
 * risk; these lock the happy path, the bad-credentials path, and the
 * post-login redirect target.
 */

const navigate = vi.fn();
const search = vi.fn<() => { redirect?: string }>(() => ({}));
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  useSearch: () => search(),
}));

vi.mock('@/lib/auth-client', () => ({ signIn: { email: vi.fn(), social: vi.fn() } }));
vi.mock('@/lib/guards', () => ({ invalidateAuth: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/api', () => ({ getAuthConfig: vi.fn() }));

const signInEmail = vi.mocked(signIn.email);
const invalidateAuthMock = vi.mocked(invalidateAuth);
const getAuthConfigMock = vi.mocked(getAuthConfig);

async function signInWith(email: string, password: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Email'), email);
  await user.type(screen.getByLabelText('Password'), password);
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
}

beforeEach(() => {
  navigate.mockReset();
  search.mockReset().mockReturnValue({});
  signInEmail.mockReset();
  invalidateAuthMock.mockClear();
  getAuthConfigMock.mockReset().mockResolvedValue({ githubEnabled: false, setupRequired: false });
});

afterEach(() => vi.clearAllTimers());

describe('LoginPage', () => {
  it('shows the server error and does not navigate on bad credentials', async () => {
    signInEmail.mockResolvedValue({ error: { message: 'Invalid email or password.' } } as Awaited<
      ReturnType<typeof signIn.email>
    >);

    render(<LoginPage />);
    await signInWith('a@b.com', 'wrongpass');

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Invalid email or password.'),
    );
    expect(invalidateAuthMock).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('on success: refreshes auth cache then navigates home', async () => {
    signInEmail.mockResolvedValue({ error: null } as Awaited<ReturnType<typeof signIn.email>>);

    render(<LoginPage />);
    await signInWith('a@b.com', 'supersecret1');

    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/' }));
    expect(invalidateAuthMock).toHaveBeenCalled();
    expect(invalidateAuthMock.mock.invocationCallOrder[0]).toBeLessThan(
      navigate.mock.invocationCallOrder[0],
    );
  });

  it('honours the ?redirect target after sign-in', async () => {
    search.mockReturnValue({ redirect: '/w/acme/settings' });
    signInEmail.mockResolvedValue({ error: null } as Awaited<ReturnType<typeof signIn.email>>);

    render(<LoginPage />);
    await signInWith('a@b.com', 'supersecret1');

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({ to: '/w/acme/settings' }),
    );
  });

  it('hides the GitHub button when GitHub is disabled', async () => {
    render(<LoginPage />);
    // Wait for the config query to settle, then assert the button is absent.
    await waitFor(() => expect(getAuthConfigMock).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /Continue with GitHub/i })).toBeNull();
  });

  it('shows the GitHub button when GitHub is enabled', async () => {
    getAuthConfigMock.mockResolvedValue({ githubEnabled: true, setupRequired: false });
    render(<LoginPage />);
    expect(
      await screen.findByRole('button', { name: /Continue with GitHub/i }),
    ).toBeInTheDocument();
  });
});
