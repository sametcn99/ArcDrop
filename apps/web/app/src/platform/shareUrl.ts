/**
 * Share/deep-link URL helpers (plan T3). Mirrors the Rust plugin extraction
 * as a defensive second pass — the plugin already extracts, but shared text
 * reaching the web layer unextracted must still resolve to one URL.
 */

/** Extracts the FIRST http(s) URL from a shared text payload; null if none. */
export function extractFirstUrl(text: string): string | null {
  const lower = text.toLowerCase();
  const start = lower.indexOf('http');
  if (start === -1) {
    return null;
  }
  const rest = text.slice(start);
  const end = rest.search(/[ \t\n\r"'<>)]/);
  const candidate = (end === -1 ? rest : rest.slice(0, end)).trim().replace(/[.,;!?]+$/, '');
  return /^https?:\/\//i.test(candidate) ? candidate : null;
}

/**
 * Parses an `arcdrop://add?url=…` deep link into the target URL; null for
 * other schemes or links without an http(s) url parameter.
 */
export function parseQuickAddDeepLink(link: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(link);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'arcdrop:') {
    return null;
  }
  const target = parsed.searchParams.get('url');
  if (!target || !/^https?:\/\//i.test(target)) {
    return null;
  }
  return target;
}
