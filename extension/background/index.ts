// ArcDrop background service worker.
// - E1: auth broker — server auth calls, single-flight token refresh, vault.
// - E2: library broker — bookmark/collection/tag operations, quick-save,
//       badge feedback; commands.onCommand('quick-save').
// - E4 adds context menus and tab workflows.

import { createAuthBroker } from './authBroker';
import { createLibraryBroker } from './libraryBroker';

const authBroker = createAuthBroker({ area: chrome.storage.local });
const libraryBroker = createLibraryBroker({
  area: chrome.storage.local,
  getAccessToken: authBroker.getValidAccessToken,
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.info('[ArcDrop] installed — connect your server from the popup.');
  }
});

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  const type =
    typeof message === 'object' && message !== null
      ? (message as { type?: unknown })['type']
      : undefined;
  const isLibrary = typeof type === 'string' && type.startsWith('library/');
  const handle = isLibrary
    ? libraryBroker.handleMessage(message)
    : authBroker.handleMessage(message);
  void handle.then(sendResponse).catch((error: unknown) => {
    sendResponse({
      ok: false,
      code: 'BROKER_CRASH',
      message: error instanceof Error ? error.message : 'Unexpected broker failure.',
    });
  });
  // Keep the channel open for the async sendResponse above.
  return true;
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== 'quick-save') {
    return;
  }
  void libraryBroker.quickSaveActiveTab().catch((error: unknown) => {
    console.warn('[ArcDrop] quick-save failed:', error instanceof Error ? error.message : error);
  });
});
