import { useEffect, useRef, useState, type RefObject } from 'react';

/**
 * Observes an element's content width via ResizeObserver.
 *
 * Returns 0 while the element is unmounted and when ResizeObserver is
 * unavailable (jsdom) — callers must treat 0 as "unknown", not "narrow".
 */
export function useElementWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') {
      return undefined;
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setWidth(entry.contentRect.width);
      }
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  return [ref, width];
}
