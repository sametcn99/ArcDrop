import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { syncEngine } from '../api/sync-engine';
import { useAuthStore } from '../stores/authStore';
import { useLibraryStore } from '../stores/libraryStore';
import { useSyncStore } from '../stores/syncStore';
import { useUiStore } from '../stores/uiStore';
import { server } from './msw/server';
import { installFakeWebSocket, type FakeWebSocketController } from './ws/fake-ws';

configure({
  asyncUtilTimeout: 3000,
});

export let testFakeWsController: FakeWebSocketController;

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  testFakeWsController = installFakeWebSocket(true);
});

beforeEach(() => {
  testFakeWsController.reset();
});

afterEach(() => {
  syncEngine.stop();
  server.resetHandlers();
  cleanup();
  testFakeWsController.reset();
  useAuthStore.getState().reset();
  useSyncStore.getState().reset();
  useLibraryStore.getState().reset();
  useUiStore.getState().reset();
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.useRealTimers();
});

afterAll(() => {
  syncEngine.stop();
  testFakeWsController.restore();
  server.close();
});

if (typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}
