import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders as render } from '@/test/render';
import { BulkActionBar } from './bulk-action-bar';
import { archiveReports, deleteReports, unarchiveReports } from '@/lib/api';

/**
 * Behavior of the bulk action bar: the primary action flips by scope
 * (Archive vs. Unarchive), delete is gated behind a confirm dialog, and each
 * action calls the matching API with the selected ids and clears the selection.
 */
vi.mock('@/lib/api', () => ({
  archiveReports: vi.fn(),
  unarchiveReports: vi.fn(),
  deleteReports: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const archiveMock = vi.mocked(archiveReports);
const unarchiveMock = vi.mocked(unarchiveReports);
const deleteMock = vi.mocked(deleteReports);

beforeEach(() => {
  archiveMock.mockReset().mockResolvedValue({ affected: 2 });
  unarchiveMock.mockReset().mockResolvedValue({ affected: 2 });
  deleteMock.mockReset().mockResolvedValue({ affected: 2 });
});
afterEach(() => vi.clearAllMocks());

const IDS = ['r1', 'r2'];

it('archives the selected ids and clears the selection (active scope)', async () => {
  const onClear = vi.fn();
  const user = userEvent.setup();
  render(<BulkActionBar wsId="ws_1" ids={IDS} scope="active" onClear={onClear} />);

  expect(screen.getByText('2 selected')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /archive/i }));

  await waitFor(() => expect(archiveMock).toHaveBeenCalledWith('ws_1', IDS));
  expect(unarchiveMock).not.toHaveBeenCalled();
  await waitFor(() => expect(onClear).toHaveBeenCalled());
});

it('shows Unarchive (not Archive) in the archived view and calls unarchive', async () => {
  const onClear = vi.fn();
  const user = userEvent.setup();
  render(<BulkActionBar wsId="ws_1" ids={IDS} scope="archived" onClear={onClear} />);

  expect(screen.queryByRole('button', { name: /^archive$/i })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /unarchive/i }));

  await waitFor(() => expect(unarchiveMock).toHaveBeenCalledWith('ws_1', IDS));
  expect(archiveMock).not.toHaveBeenCalled();
});

describe('delete confirmation', () => {
  it('opens a confirm dialog and only deletes after confirming', async () => {
    const onClear = vi.fn();
    const user = userEvent.setup();
    render(<BulkActionBar wsId="ws_1" ids={IDS} scope="active" onClear={onClear} />);

    await user.click(screen.getByRole('button', { name: /delete/i }));
    // Confirm dialog appears; nothing deleted yet.
    expect(await screen.findByText('Delete 2 reports?')).toBeInTheDocument();
    expect(deleteMock).not.toHaveBeenCalled();

    // Confirm — the dialog's Delete button.
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith('ws_1', IDS));
    await waitFor(() => expect(onClear).toHaveBeenCalled());
  });
});
