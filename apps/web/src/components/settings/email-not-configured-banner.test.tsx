import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders as render } from '@/test/render';
import { EmailNotConfiguredBanner } from './email-not-configured-banner';
import { getAuthConfig } from '@/lib/api';

vi.mock('@/lib/api', () => ({ getAuthConfig: vi.fn() }));
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

beforeEach(() => getAuthConfigMock.mockReset());
afterEach(() => vi.clearAllTimers());

describe('EmailNotConfiguredBanner', () => {
  it('warns admins, naming the affected features, when email is unconfigured', async () => {
    getAuthConfigMock.mockResolvedValue(configWith(false));
    render(<EmailNotConfiguredBanner manage />);

    expect(await screen.findByText(/email is not configured/i)).toBeInTheDocument();
    expect(screen.getByText(/password reset/i)).toBeInTheDocument();
    expect(screen.getByText(/invite/i)).toBeInTheDocument();
    expect(screen.getByText(/SMTP_/)).toBeInTheDocument();
  });

  it('renders nothing when email is configured', async () => {
    getAuthConfigMock.mockResolvedValue(configWith(true));
    const { container } = render(<EmailNotConfiguredBanner manage />);
    await waitFor(() => expect(getAuthConfigMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for non-admins even when unconfigured', async () => {
    getAuthConfigMock.mockResolvedValue(configWith(false));
    const { container } = render(<EmailNotConfiguredBanner manage={false} />);
    // Non-admins shouldn't see infra config guidance.
    expect(container).toBeEmptyDOMElement();
  });
});
