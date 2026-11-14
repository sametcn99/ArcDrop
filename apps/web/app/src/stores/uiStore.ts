import { create } from 'zustand';

export type SnackbarSeverity = 'success' | 'info' | 'warning' | 'error';

export interface SnackbarMessage {
  id: string;
  message: string;
  severity: SnackbarSeverity;
  autoHideDuration?: number;
}

export interface EnqueueSnackbarInput {
  message: string;
  severity?: SnackbarSeverity;
  autoHideDuration?: number;
}

export interface ActiveDialog {
  id: string;
  payload?: unknown;
}

export interface UiState {
  snackbars: SnackbarMessage[];
  activeDialog: ActiveDialog | null;
  enqueueSnackbar: (input: string | EnqueueSnackbarInput) => string;
  dismissSnackbar: (id: string) => void;
  clearSnackbars: () => void;
  openDialog: (id: string, payload?: unknown) => void;
  closeDialog: () => void;
  reset: () => void;
}

let nextSnackbarSeq = 0;

function createSnackbarId(): string {
  nextSnackbarSeq += 1;
  return `snackbar-${nextSnackbarSeq}`;
}

export const useUiStore = create<UiState>((set) => ({
  snackbars: [],
  activeDialog: null,

  enqueueSnackbar(input) {
    const normalized: EnqueueSnackbarInput = typeof input === 'string' ? { message: input } : input;
    const id = createSnackbarId();
    const item: SnackbarMessage = {
      id,
      message: normalized.message,
      severity: normalized.severity ?? 'info',
      autoHideDuration: normalized.autoHideDuration,
    };
    set((state) => ({
      snackbars: [...state.snackbars, item],
    }));
    return id;
  },

  dismissSnackbar(id) {
    set((state) => ({
      snackbars: state.snackbars.filter((item) => item.id !== id),
    }));
  },

  clearSnackbars() {
    set({ snackbars: [] });
  },

  openDialog(id, payload) {
    set({ activeDialog: { id, payload } });
  },

  closeDialog() {
    set({ activeDialog: null });
  },

  reset() {
    set({ snackbars: [], activeDialog: null });
  },
}));
