// ArcDrop background service worker.
// - E1: hosts the auth broker (message router) — the single point for
//   server auth calls, token refresh and vault writes.
// - E2 wires quick-save + badge feedback; E4 adds context menus.

import { createAuthBroker } from './authBroker';

const broker = createAuthBroker({ area: chrome.storage.local });

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.info('[ArcDrop] installed — connect your server from the popup.');
  }
});

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  void broker
    .handleMessage(message)
    .then(sendResponse)
    .catch((error: unknown) => {
      sendResponse({
        ok: false,
        code: 'BROKER_CRASH',
        message: error instanceof Error ? error.message : 'Unexpected broker failure.',
      });
    });
  // Keep the channel open for the async sendResponse above.
  return true;
});
