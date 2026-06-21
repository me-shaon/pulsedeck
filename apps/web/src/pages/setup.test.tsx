import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders as render } from '@/test/render';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SetupPage } from './setup';
import { ApiError, setup as setupApi } from '@/lib/api';
import { invalidateAuth } from '@/lib/guards';

/**
 * Component tests for the first-run setup wizard — the screen where the
 * "stuck Creating account…" bug surfaced. We mock the network seam (`setup`),
 * the post-success cache refresh (`invalidateAuth`), and routing (`navigate`),
 * then assert the submit flow drives them in the right order and renders the
 * right inline feedback.
 */

const navigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
}));

// Keep the real ApiError class (the page does `err instanceof ApiError`); only
// the network call is stubbed.
vi.mock('@/lib/api', async (orig) => {
  const actual = await orig<typeof import('@/lib/api')>();
  return { ...actual, setup: vi.fn() };
});

vi.mock('@/lib/guards', () => ({ invalidateAuth: vi.fn().mockResolvedValue(undefined) }));

const setupMock = vi.mocked(setupApi);
const invalidateAuthMock = vi.mocked(invalidateAuth);

async function fillValidForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Name'), 'Ahmed Shamim');
  await user.type(screen.getByLabelText('Email'), 'ahmed@test.com');
  await user.type(screen.getByLabelText(/Password/i), 'supersecret1');
}

beforeEach(() => {
  navigate.mockReset();
  setupMock.mockReset();
  invalidateAuthMock.mockClear();
});

afterEach(() => vi.clearAllTimers());

describe('SetupPage', () => {
  it('rejects a password under 8 chars client-side without calling the API', async () => {
    const user = userEvent.setup();
    render(<SetupPage />);

    await user.type(screen.getByLabelText('Name'), 'Ahmed');
    await user.type(screen.getByLabelText('Email'), 'ahmed@test.com');
    await user.type(screen.getByLabelText(/Password/i), 'short');
    await user.click(screen.getByRole('button', { name: 'Create admin account' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Password must be at least 8 characters.');
    expect(setupMock).not.toHaveBeenCalled();
  });

  it('on success: creates the account, refreshes auth cache, then navigates home', async () => {
    setupMock.mockResolvedValue({
      user: { id: 'u1', email: 'ahmed@test.com', name: 'Ahmed Shamim' },
      workspace: { id: 'ws_1', name: "Ahmed Shamim's Workspace", slug: 'ahmed' },
    } as Awaited<ReturnType<typeof setupApi>>);

    const user = userEvent.setup();
    render(<SetupPage />);
    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: 'Create admin account' }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/' }));
    expect(setupMock).toHaveBeenCalledWith({
      name: 'Ahmed Shamim',
      email: 'ahmed@test.com',
      password: 'supersecret1',
    });
    // Order matters: cache must be refreshed BEFORE navigating (the bug).
    expect(invalidateAuthMock).toHaveBeenCalled();
    expect(invalidateAuthMock.mock.invocationCallOrder[0]).toBeLessThan(
      navigate.mock.invocationCallOrder[0],
    );
  });

  it('shows the disabled "Creating account…" label while the request is in flight', async () => {
    let resolve!: (v: Awaited<ReturnType<typeof setupApi>>) => void;
    setupMock.mockReturnValue(new Promise((r) => (resolve = r)));

    const user = userEvent.setup();
    render(<SetupPage />);
    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: 'Create admin account' }));

    const btn = screen.getByRole('button', { name: 'Creating account…' });
    expect(btn).toBeDisabled();
    expect(navigate).not.toHaveBeenCalled();

    resolve({
      user: { id: 'u1', email: 'ahmed@test.com', name: 'Ahmed Shamim' },
      workspace: { id: 'ws_1', name: 'W', slug: 'w' },
    } as Awaited<ReturnType<typeof setupApi>>);
    await waitFor(() => expect(navigate).toHaveBeenCalled());
  });

  it('surfaces a 409 as the "already completed" message and does not navigate immediately', async () => {
    setupMock.mockRejectedValue(new ApiError(409, 'Setup has already been completed'));

    const user = userEvent.setup();
    render(<SetupPage />);
    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: 'Create admin account' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Setup has already been completed. Redirecting to sign in…',
      ),
    );
    expect(navigate).not.toHaveBeenCalled();
    // The submit lock is released so the form is recoverable.
    expect(screen.getByRole('button', { name: 'Create admin account' })).toBeEnabled();
  });

  it('surfaces a generic failure message and re-enables the form', async () => {
    setupMock.mockRejectedValue(new Error('Network error — could not reach the server.'));

    const user = userEvent.setup();
    render(<SetupPage />);
    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: 'Create admin account' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Network error — could not reach the server.',
      ),
    );
    expect(navigate).not.toHaveBeenCalled();
  });
});
