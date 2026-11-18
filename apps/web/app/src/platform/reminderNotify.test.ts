import { describe, expect, it, vi } from 'vitest';
import { createReminderNotifier } from './reminderNotify';

describe('createReminderNotifier (plan T4)', () => {
  it('fires one notification per reminder frame', async () => {
    const notify = vi.fn().mockResolvedValue(true);
    const notifier = createReminderNotifier(notify);

    await notifier({ bookmarkId: 'bm-1', title: 'Guide' });

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith({ title: 'Reminder: Guide' });
  });

  it('is idempotent per bookmark — reconnect replays do not double-notify', async () => {
    const notify = vi.fn().mockResolvedValue(true);
    const notifier = createReminderNotifier(notify);
    const frame = { bookmarkId: 'bm-1', title: 'Guide' };

    expect(await notifier(frame)).toBe(true);
    expect(await notifier(frame)).toBe(false);
    expect(await notifier(frame)).toBe(false);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('uses the fallback title when the frame carries none', async () => {
    const notify = vi.fn().mockResolvedValue(true);
    const notifier = createReminderNotifier(notify);

    await notifier({ bookmarkId: 'bm-2', title: null });

    expect(notify).toHaveBeenCalledWith({ title: 'Bookmark reminder due' });
  });

  it('tracks different bookmarks independently', async () => {
    const notify = vi.fn().mockResolvedValue(true);
    const notifier = createReminderNotifier(notify);

    await notifier({ bookmarkId: 'bm-1', title: 'A' });
    await notifier({ bookmarkId: 'bm-2', title: 'B' });

    expect(notify).toHaveBeenCalledTimes(2);
  });
});
