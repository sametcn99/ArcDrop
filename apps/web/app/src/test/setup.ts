import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { syncEngine } from '../api/sync-engine';
import { useAuthStore } from '../stores/authStore';
import { useLibraryStore } from '../stores/libraryStore';
import { useNotificationsStore } from '../stores/notificationsStore';
import { useSyncStore } from '../stores/syncStore';
import { useUiStore } from '../stores/uiStore';
import { server } from './msw/server';
import { installFakeWebSocket, type FakeWebSocketController } from './ws/fake-ws';

configure({
  asyncUtilTimeout: 15_000,
});

export let testFakeWsController: FakeWebSocketController;

async function flushPendingTeardownWork(): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

async function readBlobBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') {
    return new Uint8Array(await blob.arrayBuffer());
  }
  return new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(new Uint8Array(reader.result as ArrayBuffer));
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error('Failed to read Blob bytes'));
    };
    reader.readAsArrayBuffer(blob);
  });
}

/**
 * Vitest's jsdom compat layer (`makeCompatFormData`) strips filenames from File
 * entries when bridging `window.FormData` into native `Request`. Encoding
 * `FormData` bodies into a standard `multipart/form-data` payload before MSW's
 * FetchInterceptor constructs `new Request(...)` preserves file names and MIME
 * types faithfully in tests without altering production code.
 */
async function encodeMultipartFormData(formData: FormData): Promise<{
  body: Uint8Array;
  contentType: string;
}> {
  const boundary = `----ArcDropTestBoundary${Math.random().toString(36).slice(2)}`;
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];

  for (const [key, value] of formData.entries()) {
    const escapedKey = key.replace(/"/g, '\\"');
    if (typeof value === 'string') {
      const header =
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="${escapedKey}"\r\n\r\n` +
        `${value}\r\n`;
      chunks.push(encoder.encode(header));
    } else {
      const fileName =
        'name' in value && typeof value.name === 'string' && value.name.length > 0
          ? value.name.replace(/"/g, '\\"')
          : 'blob';
      const mimeType = value.type || 'application/octet-stream';
      const header =
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="${escapedKey}"; filename="${fileName}"\r\n` +
        `Content-Type: ${mimeType}\r\n\r\n`;
      chunks.push(encoder.encode(header));
      chunks.push(await readBlobBytes(value));
      chunks.push(encoder.encode('\r\n'));
    }
  }

  chunks.push(encoder.encode(`--${boundary}--\r\n`));

  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const body = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return {
    body,
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

let restoreFormDataFetchPatch: (() => void) | null = null;

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });

  const mswPatchedFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (init?.body instanceof FormData) {
      const encoded = await encodeMultipartFormData(init.body);
      const headers = new Headers(init.headers);
      headers.set('Content-Type', encoded.contentType);
      return mswPatchedFetch(input, {
        ...init,
        headers,
        body: encoded.body as unknown as BodyInit,
      });
    }
    return mswPatchedFetch(input, init);
  };
  restoreFormDataFetchPatch = () => {
    globalThis.fetch = mswPatchedFetch;
  };

  testFakeWsController = installFakeWebSocket(true);
});

beforeEach(() => {
  testFakeWsController.reset();
});

afterEach(async () => {
  cleanup();
  syncEngine.stop();
  testFakeWsController.reset();
  vi.clearAllTimers();
  vi.useRealTimers();
  await flushPendingTeardownWork();
  server.resetHandlers();
  useAuthStore.getState().reset();
  useSyncStore.getState().reset();
  useLibraryStore.getState().reset();
  useNotificationsStore.getState().reset();
  useUiStore.getState().reset();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterAll(async () => {
  syncEngine.stop();
  await flushPendingTeardownWork();
  testFakeWsController.restore();
  restoreFormDataFetchPatch?.();
  restoreFormDataFetchPatch = null;
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
