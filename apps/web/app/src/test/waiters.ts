import { screen, waitFor } from '@testing-library/react';
import { expect } from 'vitest';
import { useSyncStore } from '../stores/syncStore';

export async function waitForBootstrapReady(timeout = 30_000): Promise<void> {
  await waitFor(
    () => {
      expect(screen.queryByRole('progressbar', { name: 'Loading view' })).not.toBeInTheDocument();
      expect(useSyncStore.getState().isBootstrapping).toBe(false);
    },
    { timeout },
  );
}

export async function waitForLibraryReady(timeout = 30_000): Promise<void> {
  await waitFor(
    () => {
      expect(screen.queryByRole('progressbar', { name: 'Loading view' })).not.toBeInTheDocument();
      expect(useSyncStore.getState().isBootstrapping).toBe(false);
      expect(screen.queryByTestId('library-loading')).not.toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Library' })).toBeInTheDocument();
    },
    { timeout },
  );
}

export async function waitForCollectionReady(timeout = 30_000): Promise<void> {
  await waitFor(
    () => {
      expect(screen.queryByRole('progressbar', { name: 'Loading view' })).not.toBeInTheDocument();
      expect(useSyncStore.getState().isBootstrapping).toBe(false);
      expect(screen.queryByTestId('collection-loading')).not.toBeInTheDocument();
    },
    { timeout },
  );
}

export async function waitForHealthReady(timeout = 30_000): Promise<void> {
  await waitFor(
    () => {
      expect(screen.queryByRole('progressbar', { name: 'Loading view' })).not.toBeInTheDocument();
      expect(useSyncStore.getState().isBootstrapping).toBe(false);
      expect(screen.queryByTestId('health-loading')).not.toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Library health' })).toBeInTheDocument();
    },
    { timeout },
  );
}

export async function waitForPortabilityReady(timeout = 30_000): Promise<void> {
  await waitFor(
    () => {
      expect(screen.queryByRole('progressbar', { name: 'Loading view' })).not.toBeInTheDocument();
      expect(useSyncStore.getState().isBootstrapping).toBe(false);
      expect(screen.getByRole('heading', { name: 'Import & export' })).toBeInTheDocument();
    },
    { timeout },
  );
}

export async function waitForTrashReady(timeout = 30_000): Promise<void> {
  await waitFor(
    () => {
      expect(screen.queryByRole('progressbar', { name: 'Loading view' })).not.toBeInTheDocument();
      expect(useSyncStore.getState().isBootstrapping).toBe(false);
      expect(screen.queryByTestId('trash-loading')).not.toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Trash' })).toBeInTheDocument();
    },
    { timeout },
  );
}
