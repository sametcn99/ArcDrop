import { platform } from './index';

export interface ReminderFrameLike {
  /** The reminder's bookmark — one active reminder per bookmark. */
  bookmarkId: string;
  title: string | null;
}

/**
 * Creates a foreground reminder notifier (plan T4): fires ONE local
 * notification per reminder bookmark. The delivery dedup set guards against
 * double notifications from reconnect replays or StrictMode remounts — the
 * server already fires each reminder frame exactly once (M14's `remindedAt`
 * prevents refires).
 */
export function createReminderNotifier(notify: typeof platform.notify) {
  const delivered = new Set<string>();
  return async (frame: ReminderFrameLike): Promise<boolean> => {
    const key = `reminder:${frame.bookmarkId}`;
    if (delivered.has(key)) {
      return false;
    }
    delivered.add(key);
    return notify({
      title: frame.title ? `Reminder: ${frame.title}` : 'Bookmark reminder due',
    });
  };
}

/** App-wide instance used by the sync engine's reminder-frame handler. */
export const notifyReminderFrame = createReminderNotifier(platform.notify);
