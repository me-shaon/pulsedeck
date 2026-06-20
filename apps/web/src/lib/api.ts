import type {
  AuthConfig,
  CreatedInvite,
  CreatedSource,
  Invite,
  Member,
  ReissuedToken,
  ReportDetailResponse,
  ReportFilters,
  ReportPage,
  Role,
  RotatedKey,
  Source,
  SourceScope,
  Tree,
  Workspace,
  WorkspaceListItem,
} from './api-types';

/**
 * Typed API client. A thin `fetch` wrapper that:
 *  - is same-origin (`/api`) with `credentials: 'include'` so the better-auth
 *    session cookie rides along,
 *  - parses JSON and throws a structured {@link ApiError} on non-2xx,
 *  - exposes one function per endpoint the dashboard consumes.
 */

const BASE = '/api/v1';

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  /** Treated as query params; undefined/empty values are dropped. */
  query?: Record<string, string | number | string[] | undefined>;
}

function buildQuery(query?: RequestOptions['query']): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      params.set(key, value.join(','));
    } else {
      params.set(key, String(value));
    }
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal, query } = options;
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}${buildQuery(query)}`, {
      method,
      credentials: 'include',
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch {
    throw new ApiError(0, 'Network error — could not reach the server.', 'network');
  }

  if (res.status === 204) return undefined as T;

  let data: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    const payload = (data ?? {}) as { error?: string; message?: string };
    const message = payload.message ?? payload.error ?? `Request failed (${res.status}).`;
    const code = typeof payload.error === 'string' ? payload.error : undefined;
    throw new ApiError(res.status, message, code);
  }

  return data as T;
}

// --- Auth / setup --------------------------------------------------------

export const getAuthConfig = (signal?: AbortSignal) =>
  request<AuthConfig>('/auth/config', { signal });

export const setup = (input: { name: string; email: string; password: string }) =>
  request<{ user: { id: string; email: string; name: string }; workspace: Workspace }>('/setup', {
    method: 'POST',
    body: input,
  });

export const acceptInvite = (token: string) =>
  request<{ workspaceId: string; role: Role }>('/invites/accept', {
    method: 'POST',
    body: { token },
  });

// --- Workspaces ----------------------------------------------------------

export const listWorkspaces = (signal?: AbortSignal) =>
  request<{ workspaces: WorkspaceListItem[] }>('/workspaces', { signal });

export const getWorkspace = (id: string, signal?: AbortSignal) =>
  request<{ workspace: Workspace; role: Role }>(`/workspaces/${id}`, { signal });

export const createWorkspace = (name: string) =>
  request<{ workspace: Workspace }>('/workspaces', { method: 'POST', body: { name } });

// --- Members / invites ---------------------------------------------------

export const listMembers = (wsId: string, signal?: AbortSignal) =>
  request<{ members: Member[] }>(`/workspaces/${wsId}/members`, { signal });

export const updateMemberRole = (wsId: string, userId: string, role: Role) =>
  request<{ userId: string; role: Role }>(`/workspaces/${wsId}/members/${userId}`, {
    method: 'PATCH',
    body: { role },
  });

export const removeMember = (wsId: string, userId: string) =>
  request<void>(`/workspaces/${wsId}/members/${userId}`, { method: 'DELETE' });

export const listInvites = (wsId: string, signal?: AbortSignal) =>
  request<{ invites: Invite[] }>(`/workspaces/${wsId}/invites`, { signal });

export const createInvite = (
  wsId: string,
  input: { role: Role; email?: string; expiresInHours?: number },
) =>
  request<{ invite: CreatedInvite }>(`/workspaces/${wsId}/invites`, {
    method: 'POST',
    body: input,
  });

// --- Sources -------------------------------------------------------------

export const listSources = (wsId: string, signal?: AbortSignal) =>
  request<{ sources: Source[] }>(`/workspaces/${wsId}/sources`, { signal });

export const createSource = (
  wsId: string,
  input: { name: string; scope?: SourceScope; allowStreamAutocreate?: boolean },
) => request<CreatedSource>(`/workspaces/${wsId}/sources`, { method: 'POST', body: input });

export const reissueToken = (wsId: string, sourceId: string) =>
  request<ReissuedToken>(`/workspaces/${wsId}/sources/${sourceId}/tokens`, {
    method: 'POST',
  });

export const rotateKey = (wsId: string, sourceId: string) =>
  request<RotatedKey>(`/workspaces/${wsId}/sources/${sourceId}/rotate`, { method: 'POST' });

export const revokeSource = (wsId: string, sourceId: string) =>
  request<void>(`/workspaces/${wsId}/sources/${sourceId}/revoke`, { method: 'POST' });

// --- Reports / tree ------------------------------------------------------

function filterQuery(filters: ReportFilters, limit?: number, cursor?: string) {
  return {
    limit,
    cursor,
    q: filters.q,
    category: filters.category,
    stream: filters.stream,
    source: filters.source,
    severity: filters.severity,
    tags: filters.tags,
    from: filters.from,
    to: filters.to,
  };
}

export const listReports = (
  wsId: string,
  filters: ReportFilters = {},
  cursor?: string,
  limit = 25,
  signal?: AbortSignal,
) =>
  request<ReportPage>(`/workspaces/${wsId}/reports`, {
    query: filterQuery(filters, limit, cursor),
    signal,
  });

export const listStreamReports = (
  wsId: string,
  streamId: string,
  filters: ReportFilters = {},
  cursor?: string,
  limit = 25,
  signal?: AbortSignal,
) =>
  request<ReportPage>(`/workspaces/${wsId}/streams/${streamId}/reports`, {
    query: filterQuery(filters, limit, cursor),
    signal,
  });

export const getReport = (wsId: string, reportId: string, signal?: AbortSignal) =>
  request<ReportDetailResponse>(`/workspaces/${wsId}/reports/${reportId}`, { signal });

export const getTree = (wsId: string, signal?: AbortSignal) =>
  request<Tree>(`/workspaces/${wsId}/tree`, { signal });
