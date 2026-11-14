import { useCallback, useEffect, useRef, useState } from 'react';
import { authApi } from '../../../api/endpoints/auth';
import { tokensApi } from '../../../api/endpoints/tokens';
import type { PersonalAccessToken } from '../../../api/schemas/tokens';
import type { Session } from '../../../api/schemas/auth';
import { toApiError } from '../../../api/schemas/problem';
import { useUiStore } from '../../../stores/uiStore';
import { SETTINGS_PAGE_STRINGS as S } from '../strings';

export interface SessionsState {
  sessions: Session[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useSessions(): SessionsState {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hasLoadedRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const next = await authApi.listSessions();
      setSessions(next);
      setError(null);
    } catch (err) {
      setError(toApiError(err).detail);
    } finally {
      hasLoadedRef.current = true;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (hasLoadedRef.current) return;
    let cancelled = false;
    authApi
      .listSessions()
      .then((next) => {
        if (!cancelled) {
          setSessions(next);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(toApiError(err).detail);
      })
      .finally(() => {
        if (!cancelled) {
          hasLoadedRef.current = true;
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { sessions, loading, error, refresh };
}

export interface RevokeSessionResult {
  ok: boolean;
}

export async function revokeSessionAction(sessionId: string): Promise<RevokeSessionResult> {
  try {
    await authApi.revokeSession(sessionId);
    useUiStore.getState().enqueueSnackbar({
      message: S.security.revokedToast,
      severity: 'success',
    });
    return { ok: true };
  } catch (err) {
    useUiStore.getState().enqueueSnackbar({
      message: toApiError(err).detail,
      severity: 'error',
    });
    return { ok: false };
  }
}

export interface PersonalTokensState {
  tokens: PersonalAccessToken[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function usePersonalTokens(): PersonalTokensState {
  const [tokens, setTokens] = useState<PersonalAccessToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hasLoadedRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const next = await tokensApi.list();
      setTokens(next);
      setError(null);
    } catch (err) {
      setError(toApiError(err).detail);
    } finally {
      hasLoadedRef.current = true;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (hasLoadedRef.current) return;
    let cancelled = false;
    tokensApi
      .list()
      .then((next) => {
        if (!cancelled) {
          setTokens(next);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(toApiError(err).detail);
      })
      .finally(() => {
        if (!cancelled) {
          hasLoadedRef.current = true;
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { tokens, loading, error, refresh };
}
