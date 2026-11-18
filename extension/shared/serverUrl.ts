// Server address normalization for the extension setup flow.
// Vaultwarden-style: accept scheme-less input ("myserver.me") and default to
// https, strip trailing slashes, and keep an optional path suffix so
// reverse-proxy deployments (https://host/arcdrop) work.

export type NormalizeServerUrlResult =
  | { ok: true; url: string; origin: string }
  | { ok: false; reason: 'empty' | 'invalid' | 'unsupported-scheme' };

/**
 * Normalizes a user-entered server address.
 * Returns the stored base URL (no trailing slash) plus the origin used for
 * the runtime host-permission request and the permission grant pattern.
 */
export function normalizeServerUrl(input: string): NormalizeServerUrlResult {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: 'empty' };
  }

  const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed);
  let url: URL;
  try {
    url = new URL(hasScheme ? trimmed : `https://${trimmed}`);
  } catch {
    return { ok: false, reason: 'invalid' };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'unsupported-scheme' };
  }
  if (url.hostname.length === 0) {
    return { ok: false, reason: 'invalid' };
  }

  const path = url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '');
  return { ok: true, url: `${url.protocol}//${url.host}${path}`, origin: url.origin };
}
