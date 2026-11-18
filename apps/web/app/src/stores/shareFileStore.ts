import { create } from 'zustand';

interface ShareFileState {
  /** A file received through the Android ACTION_SEND share flow (plan T4). */
  pendingFile: File | null;
  setPendingFile: (file: File) => void;
  clearPendingFile: () => void;
}

/**
 * Hands a share-received file from the boot-time share-target stream (in
 * AppProviders) to the library view, which opens the upload dialog with it
 * preselected. Cleared as soon as the dialog consumes the file.
 */
export const useShareFileStore = create<ShareFileState>((set) => ({
  pendingFile: null,
  setPendingFile: (file) => set({ pendingFile: file }),
  clearPendingFile: () => set({ pendingFile: null }),
}));
