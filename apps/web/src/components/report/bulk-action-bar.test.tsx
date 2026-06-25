import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderWithProviders as render } from '@/test/render';
import { BulkActionBar } from './bulk-action-bar';
import { archiveReports, deleteReports, unarchiveReports } from '@/lib/api';

/**
 * Behavior of the bulk action bar: every action (archive, unarchive, delete) is
 * gated behind a confirm dialog; the primary action flips by scope; confirming
 * calls the matching API with the selected ids and clears the selection.
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

/** Click a toolbar button, then confirm the resulting dialog by its action label. */
async function actAndConfirm(toolbarLabel: RegExp, confirmLabel: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: toolbarLabel }));
  const dialog = await screen.findByRole('dialog');
  await user.click(within(dialog).getByRole('button', { name: confirmLabel }));
}

it('archives the selected ids after confirmation (active scope)', async () => {
  const onClear = vi.fn();
  render(<BulkActionBar wsId="ws_1" ids={IDS} scope="active" onClear={onClear} />);

  expect(screen.getByText('2 selected')).toBeInTheDocument();
  await actAndConfirm(/archive/i, 'Archive');

  await waitFor(() => expect(archiveMock).toHaveBeenCalledWith('ws_1', IDS));
  expect(unarchiveMock).not.toHaveBeenCalled();
  await waitFor(() => expect(onClear).toHaveBeenCalled());
});

it('does not call the API until the dialog is confirmed', async () => {
  const user = userEvent.setup();
  render(<BulkActionBar wsId="ws_1" ids={IDS} scope="active" onClear={vi.fn()} />);

  await user.click(screen.getByRole('button', { name: /archive/i }));
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
  expect(archiveMock).not.toHaveBeenCalled(); // confirm pending
});

it('shows Unarchive (not Archive) in the archived view and calls unarchive', async () => {
  render(<BulkActionBar wsId="ws_1" ids={IDS} scope="archived" onClear={vi.fn()} />);

  expect(screen.queryByRole('button', { name: /^archive$/i })).not.toBeInTheDocument();
  await actAndConfirm(/unarchive/i, 'Unarchive');

  await waitFor(() => expect(unarchiveMock).toHaveBeenCalledWith('ws_1', IDS));
  expect(archiveMock).not.toHaveBeenCalled();
});

it('deletes only after confirming the destructive dialog', async () => {
  const onClear = vi.fn();
  render(<BulkActionBar wsId="ws_1" ids={IDS} scope="active" onClear={onClear} />);

  await actAndConfirm(/delete/i, 'Delete');

  await waitFor(() => expect(deleteMock).toHaveBeenCalledWith('ws_1', IDS));
  await waitFor(() => expect(onClear).toHaveBeenCalled());
});
