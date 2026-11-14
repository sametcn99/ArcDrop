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

function indexOfSubarray(haystack: Uint8Array, needle: Uint8Array, fromIndex = 0): number {
  const limit = haystack.length - needle.length;
  outer: for (let i = Math.max(0, fromIndex); i <= limit; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) {
        continue outer;
      }
    }
    return i;
  }
  return -1;
}

function parseMultipartToFormData(buffer: ArrayBuffer, contentType: string): FormData {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  const boundary = boundaryMatch?.[1] ?? boundaryMatch?.[2];
  if (!boundary) {
    throw new TypeError(`Missing multipart boundary in Content-Type: ${contentType}`);
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder('utf-8');
  const bytes = new Uint8Array(buffer);
  const delimiter = encoder.encode(`--${boundary}`);
  const crlfDelimiter = encoder.encode(`\r\n--${boundary}`);
  const headerSeparator = encoder.encode('\r\n\r\n');

  const result = new FormData();
  let cursor = indexOfSubarray(bytes, delimiter, 0);
  if (cursor === -1) {
    return result;
  }

  while (cursor !== -1) {
    const afterDelimiter = cursor + delimiter.length;
    if (bytes[afterDelimiter] === 0x2d && bytes[afterDelimiter + 1] === 0x2d) {
      break;
    }

    const partHeaderStart =
      bytes[afterDelimiter] === 0x0d && bytes[afterDelimiter + 1] === 0x0a
        ? afterDelimiter + 2
        : afterDelimiter;
    const headerEnd = indexOfSubarray(bytes, headerSeparator, partHeaderStart);
    if (headerEnd === -1) {
      break;
    }

    const rawHeaders = decoder.decode(bytes.subarray(partHeaderStart, headerEnd));
    const bodyStart = headerEnd + headerSeparator.length;
    const nextDelimiter = indexOfSubarray(bytes, crlfDelimiter, bodyStart);
    if (nextDelimiter === -1) {
      break;
    }

    const partBytes = bytes.slice(bodyStart, nextDelimiter);

    let fieldName: string | null = null;
    let fileName: string | undefined;
    let partContentType = 'application/octet-stream';

    for (const line of rawHeaders.split(/\r\n/)) {
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue;
      const headerKey = line.slice(0, colonIdx).trim().toLowerCase();
      const headerVal = line.slice(colonIdx + 1).trim();

      if (headerKey === 'content-disposition') {
        const nameMatch = /\bname="([^"]*)"/i.exec(headerVal);
        if (nameMatch?.[1] !== undefined) {
          fieldName = nameMatch[1];
        }
        const fileMatch = /\bfilename="([^"]*)"/i.exec(headerVal);
        if (fileMatch?.[1] !== undefined) {
          fileName = fileMatch[1];
        }
      } else if (headerKey === 'content-type') {
        partContentType = headerVal;
      }
    }

    if (fieldName !== null) {
      if (fileName !== undefined) {
        result.append(fieldName, new File([partBytes], fileName, { type: partContentType }));
      } else {
        result.append(fieldName, decoder.decode(partBytes));
      }
    }

    cursor = nextDelimiter + 2;
  }

  return result;
}

/**
 * Vitest's jsdom compat layer (`makeCompatFormData`) strips filenames from File
 * entries when bridging `window.FormData` into native `Request`, and Node's
 * undici `Request.prototype.formData()` asserts against `globalThis.File`
 * (`webidl.is.File`) when Vitest replaces `globalThis.File` with jsdom's `File`.
 * Handling both sides in test setup keeps `FormData` round-trips identical
 * across Bun and Node without altering production code.
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

let restoreFormDataTestPatches: (() => void) | null = null;

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

  const origRequestFormData = Request.prototype.formData;
  Request.prototype.formData = async function patchedFormData(this: Request): Promise<FormData> {
    const contentType = this.headers.get('content-type') ?? '';
    if (/^multipart\/form-data/i.test(contentType)) {
      const buffer = await this.arrayBuffer();
      return parseMultipartToFormData(buffer, contentType);
    }
    return origRequestFormData.call(this);
  };

  restoreFormDataTestPatches = () => {
    globalThis.fetch = mswPatchedFetch;
    Request.prototype.formData = origRequestFormData;
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
  restoreFormDataTestPatches?.();
  restoreFormDataTestPatches = null;
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
