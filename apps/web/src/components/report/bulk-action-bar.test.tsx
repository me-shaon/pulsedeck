import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderWithProviders as render } from '@/test/render';
import { BulkActionBar } from './bulk-action-bar';
import { archiveReports, deleteReports, unarchiveReports } from '@/lib/api';

/**
 * Behavior of the selection-mode toolbar: every action (archive, unarchive,
 * delete) is gated behind a confirm dialog; the primary action flips by scope;
 * archive/delete are disabled with nothing selected; confirming calls the
 * matching API with the selected ids and exits selection mode.
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

function renderBar(props: Partial<Parameters<typeof BulkActionBar>[0]> = {}) {
  return render(
    <BulkActionBar
      wsId="ws_1"
      ids={IDS}
      scope="active"
      visibleCount={5}
      onSelectAll={vi.fn()}
      onExit={vi.fn()}
      {...props}
    />,
  );
}

/** Click a toolbar button, then confirm the resulting dialog by its action label. */
async function actAndConfirm(toolbarLabel: RegExp, confirmLabel: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: toolbarLabel }));
  const dialog = await screen.findByRole('dialog');
  await user.click(within(dialog).getByRole('button', { name: confirmLabel }));
}

it('archives the selected ids after confirmation, then exits', async () => {
  const onExit = vi.fn();
  renderBar({ onExit });

  expect(screen.getByText('2 selected')).toBeInTheDocument();
  await actAndConfirm(/^archive$/i, 'Archive');

  await waitFor(() => expect(archiveMock).toHaveBeenCalledWith('ws_1', IDS));
  expect(unarchiveMock).not.toHaveBeenCalled();
  await waitFor(() => expect(onExit).toHaveBeenCalled());
});

it('does not call the API until the dialog is confirmed', async () => {
  const user = userEvent.setup();
  renderBar();

  await user.click(screen.getByRole('button', { name: /^archive$/i }));
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
  expect(archiveMock).not.toHaveBeenCalled(); // confirm pending
});

it('shows Unarchive (not Archive) in the archived view and calls unarchive', async () => {
  renderBar({ scope: 'archived' });

  expect(screen.queryByRole('button', { name: /^archive$/i })).not.toBeInTheDocument();
  await actAndConfirm(/unarchive/i, 'Unarchive');

  await waitFor(() => expect(unarchiveMock).toHaveBeenCalledWith('ws_1', IDS));
  expect(archiveMock).not.toHaveBeenCalled();
});

it('deletes only after confirming the destructive dialog, then exits', async () => {
  const onExit = vi.fn();
  renderBar({ onExit });

  await actAndConfirm(/delete/i, 'Delete');

  await waitFor(() => expect(deleteMock).toHaveBeenCalledWith('ws_1', IDS));
  await waitFor(() => expect(onExit).toHaveBeenCalled());
});

it('with nothing selected, archive/delete are disabled but Select all works', async () => {
  const onSelectAll = vi.fn();
  const user = userEvent.setup();
  renderBar({ ids: [], onSelectAll });

  expect(screen.getByText('Select reports')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /^archive$/i })).toBeDisabled();
  expect(screen.getByRole('button', { name: /delete/i })).toBeDisabled();

  await user.click(screen.getByRole('button', { name: /select all/i }));
  expect(onSelectAll).toHaveBeenCalled();
});
