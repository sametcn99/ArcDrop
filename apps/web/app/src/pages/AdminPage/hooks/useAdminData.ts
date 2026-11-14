import { useCallback, useEffect, useRef, useState } from 'react';
import { adminApi } from '../../../api/endpoints/admin';
import { settingsApi } from '../../../api/endpoints/settings';
import type { AuditLogEntry, AuditLogFilters } from '../../../api/schemas/admin';
import type { Settings } from '../../../api/schemas/settings';
import type { User } from '../../../api/schemas/auth';
import { toApiError } from '../../../api/schemas/problem';

export interface AdminUsersState {
  users: User[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useAdminUsers(): AdminUsersState {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hasLoadedRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const next = await adminApi.listUsers();
      setUsers(next);
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
    adminApi
      .listUsers()
      .then((next) => {
        if (!cancelled) {
          setUsers(next);
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

  return { users, loading, error, refresh };
}

export interface AdminSettingsState {
  settings: Settings | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

export function useAdminSettings(): AdminSettingsState {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hasLoadedRef = useRef(false);

  const reload = useCallback(async () => {
    try {
      const next = await settingsApi.get();
      setSettings(next);
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
    settingsApi
      .get()
      .then((next) => {
        if (!cancelled) {
          setSettings(next);
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

  return { settings, loading, error, reload };
}

export interface AuditLogState {
  entries: AuditLogEntry[];
  totalCount: number;
  page: number;
  pageSize: number;
  loading: boolean;
  error: string | null;
  fetchPage: (filters: AuditLogFilters) => Promise<void>;
}

export function useAuditLog(): AuditLogState {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hasLoadedRef = useRef(false);

  const fetchPage = useCallback(async (filters: AuditLogFilters = {}) => {
    try {
      const result = await adminApi.listAuditLogs(filters);
      setEntries(result.items);
      setTotalCount(result.totalCount);
      setPage(result.page);
      setPageSize(result.pageSize);
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
    adminApi
      .listAuditLogs({})
      .then((result) => {
        if (!cancelled) {
          setEntries(result.items);
          setTotalCount(result.totalCount);
          setPage(result.page);
          setPageSize(result.pageSize);
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

  return { entries, totalCount, page, pageSize, loading, error, fetchPage };
}
