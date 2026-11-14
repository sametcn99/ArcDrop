interface LocationState {
  from?: {
    pathname?: string;
    search?: string;
  };
}

export function resolveRedirectTarget(state: unknown, fallback = '/'): string {
  const typed = state as LocationState | null | undefined;
  const pathname = typed?.from?.pathname;
  if (!pathname || !pathname.startsWith('/') || pathname.startsWith('//')) {
    return fallback;
  }
  const search = typeof typed?.from?.search === 'string' ? typed.from.search : '';
  return `${pathname}${search}`;
}
