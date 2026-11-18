// ArcDrop embedded-app bridge (E3). Classic script — runs during page parse,
// BEFORE the web app bundle is injected (the embed build strips the app's
// script tags; this file injects them after the vault is hydrated).
//
// Contract (three contexts, ONE session):
// - chrome.storage.local {vault} is the single source of truth for
//   baseUrl / tokens / user. The background auth broker owns ALL refresh
//   rotations (single-flight) — popup, app page and worker share it.
// - localStorage is the web client's synchronous facade: hydrated from the
//   vault before boot, mirrored from vault changes, and app-side writes
//   (onboarding address, app-initiated login) are forwarded into the vault.
// - window.fetch is patched so API calls carry a broker-issued access token
//   and the client's own POST /auth/refresh is answered from broker state —
//   the client never rotates on its own, so no second session can appear.
// MV3 CSP forbids inline scripts: keep this an external file, no eval.

/* global window document chrome Storage Headers Response URL */

(function () {
  'use strict';

  var VAULT_KEY = 'vault';
  var BASE_KEY = 'arcdrop.baseUrl';
  var REFRESH_KEY = 'arcdrop.refreshToken';
  var THEME_KEY = 'arcdrop.theme';
  var PALETTE_KEY = 'arcdrop.palette';

  var appConfig = { scripts: [], styles: [] };
  try {
    var marker = document.querySelector('script[data-arcdrop-app]');
    if (marker) {
      var parsed = JSON.parse(marker.getAttribute('data-arcdrop-app') || '{}');
      if (parsed && typeof parsed === 'object') {
        appConfig.scripts = Array.isArray(parsed.scripts) ? parsed.scripts : [];
        appConfig.styles = Array.isArray(parsed.styles) ? parsed.styles : [];
      }
    }
  } catch {
    // Malformed marker — the page still boots; the app scripts simply never
    // get injected.
  }

  // ---- tiny vault facade ------------------------------------------------

  function readVault() {
    return chrome.storage.local.get(VAULT_KEY).then(function (stored) {
      return stored[VAULT_KEY] || null;
    });
  }

  /** Settings-only patch (theme keys forwarded from the app facade). */
  function writeVaultSettings(settingsPatch) {
    return readVault().then(function (vault) {
      var next = Object.assign({}, vault || {}, {
        settings: Object.assign({}, (vault && vault.settings) || {}, settingsPatch),
        version: 1,
      });
      var payload = {};
      payload[VAULT_KEY] = next;
      return chrome.storage.local.set(payload);
    });
  }

  function sendAuth(message) {
    return chrome.runtime.sendMessage(message).then(function (response) {
      if (!response || response.ok !== true) {
        var error = new Error(
          response && response.message ? response.message : 'ArcDrop auth broker failed',
        );
        error.code = response && response.code ? response.code : 'BROKER_FAILURE';
        throw error;
      }
      return response;
    });
  }

  function normalizeBaseUrl(raw) {
    var trimmed = String(raw == null ? '' : raw).trim();
    if (trimmed.length === 0) return null;
    var hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed);
    var url;
    try {
      url = new URL(hasScheme ? trimmed : 'https://' + trimmed);
    } catch {
      return null;
    }
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.hostname.length === 0) {
      return null;
    }
    var path = url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '');
    return url.protocol + '//' + url.host + path;
  }

  // ---- localStorage facade (hydration + mirror + write forwarding) ------

  var originalSetItem = Storage.prototype.setItem;
  var originalRemoveItem = Storage.prototype.removeItem;

  function setFacade(key, value) {
    if (value === null || value === undefined) {
      originalRemoveItem.call(window.localStorage, key);
    } else {
      originalSetItem.call(window.localStorage, key, String(value));
    }
  }

  function hydrateFacade(vault) {
    if (vault && vault.baseUrl) setFacade(BASE_KEY, vault.baseUrl);
    if (vault && vault.refreshToken) setFacade(REFRESH_KEY, vault.refreshToken);
    if (vault && vault.settings) {
      // Theme keys shared with the web app's ThemeController: 'system' is an
      // extension-only value — the facade stays keyless for system mode.
      var mode = vault.settings.themeMode;
      setFacade(THEME_KEY, mode === 'light' || mode === 'dark' ? mode : null);
      setFacade(PALETTE_KEY, vault.settings.themePaletteId || null);
    }
  }

  function mirrorFromVault() {
    chrome.storage.onChanged.addListener(function (changes, areaName) {
      if (areaName !== 'local' || !changes[VAULT_KEY]) return;
      var change = changes[VAULT_KEY];
      var vault = change && change.newValue;
      if (!vault) return;
      setFacade(BASE_KEY, vault.baseUrl || null);
      setFacade(REFRESH_KEY, vault.refreshToken || null);
      if (vault.settings) {
        var mode = vault.settings.themeMode;
        setFacade(THEME_KEY, mode === 'light' || mode === 'dark' ? mode : null);
        setFacade(PALETTE_KEY, vault.settings.themePaletteId || null);
      }
    });
  }

  function forwardFacadeWrites() {
    Storage.prototype.setItem = function (key, value) {
      originalSetItem.call(this, key, String(value));
      if (this !== window.localStorage) return;
      var stringValue = String(value);
      if (key === BASE_KEY) {
        var normalized = normalizeBaseUrl(stringValue);
        if (normalized) {
          void writeVaultSettings({ baseUrl: normalized });
        }
      } else if (key === REFRESH_KEY && stringValue.length > 0) {
        // App-initiated login inside the embedded page — adopt the session
        // into the vault (validated by one broker-owned refresh round-trip).
        void sendAuth({ type: 'auth/ingest-session', refreshToken: stringValue }).catch(
          function () {
            /* invalid token — the vault keeps its previous session */
          },
        );
      } else if (key === THEME_KEY && (stringValue === 'light' || stringValue === 'dark')) {
        void writeVaultSettings({ themeMode: stringValue });
      } else if (key === PALETTE_KEY && stringValue.length > 0) {
        void writeVaultSettings({ themePaletteId: stringValue });
      }
    };
    // Deliberately NOT forwarding removeItem/clear: the web app drops its
    // facade on failed restores (e.g. server briefly unreachable) — the
    // vault session stays valid, so the popup keeps working and the next
    // page load re-hydrates the facade.
  }

  // ---- fetch patch (broker-owned tokens + synthetic refresh) ------------

  var originalFetch = window.fetch.bind(window);

  function apiPrefixOf(vault) {
    if (!vault || !vault.baseUrl) return null;
    return String(vault.baseUrl).replace(/\/+$/, '') + '/api/v1';
  }

  function brokerSession() {
    return sendAuth({ type: 'auth/access-token' }).then(function (response) {
      if (response.kind !== 'access-token') {
        throw new Error('Unexpected access-token response');
      }
      return response;
    });
  }

  function withAuthorization(init, token) {
    var headers = new Headers(init && init.headers ? init.headers : undefined);
    headers.set('Authorization', 'Bearer ' + token);
    return Object.assign({}, init || {}, { headers: headers });
  }

  function isRefreshCall(url, init) {
    var method = ((init && init.method) || 'GET').toUpperCase();
    return method === 'POST' && /\/api\/v1\/auth\/refresh$/.test(url);
  }

  function jsonResponse(status, body) {
    return new Response(JSON.stringify(body), {
      status: status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  function sessionExpiredResponse() {
    return jsonResponse(401, {
      type: 'https://arcdrop.dev/problems/unauthorized',
      title: 'Session expired',
      status: 401,
      code: 'SESSION_EXPIRED',
      detail: 'Your session expired. Please sign in again.',
    });
  }

  function patchFetch() {
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : input && input.url ? input.url : String(input);
      var method = ((init && init.method) || 'GET').toUpperCase();
      return readVault().then(function (vault) {
        var prefix = apiPrefixOf(vault);
        if (!prefix || url.indexOf(prefix) !== 0) {
          return originalFetch(input, init);
        }

        // The client's own rotation call is answered from broker state —
        // no network refresh ever happens outside the background worker.
        if (method === 'POST' && isRefreshCall(url)) {
          return brokerSession().then(
            function (session) {
              return jsonResponse(201, {
                user: session.user,
                accessToken: session.accessToken,
                refreshToken: session.refreshToken,
              });
            },
            function () {
              return sessionExpiredResponse();
            },
          );
        }

        return brokerSession().then(
          function (session) {
            return originalFetch(url, withAuthorization(init, session.accessToken)).then(
              function (response) {
                if (response.status !== 401) return response;
                // The token rotated mid-flight — the broker re-issues
                // (refreshing if needed) and the call retries once.
                return brokerSession().then(
                  function (fresh) {
                    if (fresh.accessToken === session.accessToken) return response;
                    return originalFetch(url, withAuthorization(init, fresh.accessToken));
                  },
                  function () {
                    return sessionExpiredResponse();
                  },
                );
              },
            );
          },
          function () {
            // No live session — let the request run unauthenticated; the
            // client's 401 handling shows its own sign-in flow.
            return originalFetch(input, init);
          },
        );
      });
    };
  }

  // ---- app script injection --------------------------------------------

  function injectApp() {
    appConfig.styles.forEach(function (href) {
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      document.head.appendChild(link);
    });
    appConfig.scripts.forEach(function (src) {
      var script = document.createElement('script');
      script.type = 'module';
      script.src = src;
      document.body.appendChild(script);
    });
  }

  var ready = readVault().then(function (vault) {
    hydrateFacade(vault);
    mirrorFromVault();
    forwardFacadeWrites();
    patchFetch();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      void ready.then(injectApp);
    });
  } else {
    void ready.then(injectApp);
  }
})();
