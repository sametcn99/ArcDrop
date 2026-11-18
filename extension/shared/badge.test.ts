import { describe, expect, it } from 'bun:test';
import { createBadgeManager, type BadgeWriter } from './badge';

function fakeWriter() {
  const calls: Array<{ method: string; text?: string; color?: string; tabId?: number }> = [];
  const writer: BadgeWriter = {
    setBadgeText: (details) => {
      calls.push({ method: 'text', text: details.text, tabId: details.tabId });
    },
    setBadgeBackgroundColor: (details) => {
      calls.push({ method: 'color', color: details.color, tabId: details.tabId });
    },
  };
  return { writer, calls };
}

describe('badge manager', () => {
  it('saving shows the spinner glyph without an auto-clear timer', async () => {
    const { writer, calls } = fakeWriter();
    const badge = createBadgeManager(writer, { autoClearMs: 10 });
    badge.show('saving', 7);
    expect(
      calls.some((call) => call.method === 'text' && call.text === '…' && call.tabId === 7),
    ).toBe(true);
    await Bun.sleep(30);
    expect(
      calls.some((call) => call.method === 'text' && call.text === '' && call.tabId === 7),
    ).toBe(false);
  });

  it('saved shows the check and auto-clears', async () => {
    const { writer, calls } = fakeWriter();
    const badge = createBadgeManager(writer, { autoClearMs: 10 });
    badge.show('saved');
    expect(calls.some((call) => call.method === 'text' && call.text === '✓')).toBe(true);
    await Bun.sleep(40);
    expect(
      calls.some((call) => call.method === 'text' && call.text === '' && call.tabId === undefined),
    ).toBe(true);
  });

  it('failed uses the error color and a later show cancels the previous timer', async () => {
    const { writer, calls } = fakeWriter();
    const badge = createBadgeManager(writer, { autoClearMs: 10 });
    badge.show('failed', 3);
    expect(calls.some((call) => call.method === 'color' && call.color === '#B3261E')).toBe(true);
    // Restart the timer with 'saving' (no auto-clear) — no empty text afterwards.
    badge.show('saving', 3);
    await Bun.sleep(40);
    expect(calls.filter((call) => call.method === 'text' && call.text === '')).toHaveLength(0);
  });

  it('clear resets immediately', () => {
    const { writer, calls } = fakeWriter();
    const badge = createBadgeManager(writer);
    badge.show('saved');
    badge.clear();
    expect(calls[calls.length - 1]).toMatchObject({ method: 'text', text: '' });
  });
});
