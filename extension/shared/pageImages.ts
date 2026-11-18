// Collects metadata candidates from the ACTIVE page. This function must stay
// fully self-contained (no imports, no closure references): it is serialized
// by chrome.scripting.executeScript and evaluated inside the page.

export interface PageMetaCandidates {
  ogTitle: string | null;
  ogDescription: string | null;
  ogImage: string | null;
  /** http(s) <img> sources, de-duplicated, document order, capped. */
  images: string[];
}

export function collectPageMeta(): PageMetaCandidates {
  const readMeta = (property: string): string | null => {
    const element = document.querySelector<HTMLMetaElement>(
      `meta[property="${property}"], meta[name="${property}"]`,
    );
    const content = element?.getAttribute('content')?.trim();
    return content ? content : null;
  };

  const absolute = (value: string): string | null => {
    try {
      const parsed = new URL(value, document.baseURI);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
      return parsed.toString();
    } catch {
      return null;
    }
  };

  const seen = new Set<string>();
  const images: string[] = [];
  const limit = 10;
  for (const image of Array.from(document.images)) {
    if (images.length >= limit) break;
    const source = image.currentSrc || image.src;
    if (!source) continue;
    const resolved = absolute(source);
    if (!resolved || seen.has(resolved)) continue;
    seen.add(resolved);
    images.push(resolved);
  }

  const ogImageRaw = readMeta('og:image');

  return {
    ogTitle: readMeta('og:title'),
    ogDescription: readMeta('og:description') ?? readMeta('description'),
    ogImage: ogImageRaw ? absolute(ogImageRaw) : null,
    images,
  };
}
