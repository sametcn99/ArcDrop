// Badge feedback state machine — the background service worker is the single
// writer (both the popup save flows and the quick-save command route through
// it). States: saving (…) → saved (✓, auto-clear) / failed (!, auto-clear).

export type BadgeState = 'saving' | 'saved' | 'failed' | 'idle';

export interface BadgeWriter {
  setBadgeText(details: { text: string; tabId?: number }): Promise<void> | void;
  setBadgeBackgroundColor(details: { color: string; tabId?: number }): Promise<void> | void;
}

/** M3 semantic tones, mirrored from shared/theme.ts semantic palette. */
const STATE_COLORS: Record<Exclude<BadgeState, 'idle'>, string> = {
  saving: '#49454F',
  saved: '#146C2E',
  failed: '#B3261E',
};

const STATE_TEXT: Record<Exclude<BadgeState, 'idle'>, string> = {
  saving: '…',
  saved: '✓',
  failed: '!',
};

export interface BadgeManager {
  show(state: Exclude<BadgeState, 'idle'>, tabId?: number): void;
  clear(tabId?: number): void;
}

export function createBadgeManager(
  writer: BadgeWriter,
  options: { autoClearMs?: number } = {},
): BadgeManager {
  const autoClearMs = options.autoClearMs ?? 2000;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const cancelTimer = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return {
    show(state, tabId) {
      cancelTimer();
      void writer.setBadgeBackgroundColor({ color: STATE_COLORS[state], tabId });
      void writer.setBadgeText({ text: STATE_TEXT[state], tabId });
      if (state !== 'saving') {
        timer = setTimeout(() => {
          timer = null;
          void writer.setBadgeText({ text: '', tabId });
        }, autoClearMs);
      }
    },
    clear(tabId) {
      cancelTimer();
      void writer.setBadgeText({ text: '', tabId });
    },
  };
}

export function chromeBadgeWriter(): BadgeWriter {
  return chrome.action;
}
