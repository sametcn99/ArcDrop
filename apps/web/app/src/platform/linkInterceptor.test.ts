import { afterEach, describe, expect, it, vi } from 'vitest';
import { installExternalLinkInterceptor } from './linkInterceptor';
import type { PlatformAdapter } from './types';

function fakeAdapter(isTauri: boolean): PlatformAdapter {
  return {
    isTauri,
    getFetch: () => (input, init) => fetch(input, init),
    openExternal: vi.fn(),
    onBackButton: () => () => {},
    share: async () => false,
    resolveDeviceLabel: async () => null,
  };
}

function clickAnchor(href: string, init: MouseEventInit = {}): MouseEvent {
  const anchor = document.createElement('a');
  anchor.href = href;
  document.body.appendChild(anchor);
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, ...init });
  anchor.dispatchEvent(event);
  anchor.remove();
  return event;
}

describe('external link interceptor (plan T2)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('routes external http(s) anchor clicks to openExternal inside Tauri', () => {
    const adapter = fakeAdapter(true);
    const uninstall = installExternalLinkInterceptor(adapter);

    const event = clickAnchor('https://example.com/article');

    expect(event.defaultPrevented).toBe(true);
    expect(adapter.openExternal).toHaveBeenCalledWith('https://example.com/article');
    uninstall();
  });

  it('leaves same-origin navigation untouched', () => {
    const adapter = fakeAdapter(true);
    const uninstall = installExternalLinkInterceptor(adapter);

    const event = clickAnchor('http://localhost:3000/settings');

    expect(event.defaultPrevented).toBe(false);
    expect(adapter.openExternal).not.toHaveBeenCalled();
    uninstall();
  });

  it('leaves blob/data downloads untouched (synthetic download anchor)', () => {
    const adapter = fakeAdapter(true);
    const uninstall = installExternalLinkInterceptor(adapter);

    const event = clickAnchor('blob:http://localhost:3000/9c3f');

    expect(event.defaultPrevented).toBe(false);
    expect(adapter.openExternal).not.toHaveBeenCalled();
    uninstall();
  });

  it('keeps modified clicks (ctrl/cmd/shift) on their native path', () => {
    const adapter = fakeAdapter(true);
    const uninstall = installExternalLinkInterceptor(adapter);

    const ctrlEvent = clickAnchor('https://example.com/article', { ctrlKey: true });
    const shiftEvent = clickAnchor('https://example.com/article', { shiftKey: true });

    expect(ctrlEvent.defaultPrevented).toBe(false);
    expect(shiftEvent.defaultPrevented).toBe(false);
    expect(adapter.openExternal).not.toHaveBeenCalled();
    uninstall();
  });

  it('is a no-op outside Tauri (browser keeps native anchor behavior)', () => {
    const adapter = fakeAdapter(false);
    const uninstall = installExternalLinkInterceptor(adapter);

    const event = clickAnchor('https://example.com/article');

    expect(event.defaultPrevented).toBe(false);
    expect(adapter.openExternal).not.toHaveBeenCalled();
    uninstall();
  });

  it('stops intercepting after the uninstaller runs', () => {
    const adapter = fakeAdapter(true);
    const uninstall = installExternalLinkInterceptor(adapter);
    uninstall();

    const event = clickAnchor('https://example.com/article');

    expect(event.defaultPrevented).toBe(false);
    expect(adapter.openExternal).not.toHaveBeenCalled();
  });
});
