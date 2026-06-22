import type {
  Account,
  AgentInstructions,
  AlertItem,
  AuthConfig,
  CountBucket,
  CountScope,
  CreatedInvite,
  CreatedSource,
  DashboardFull,
  DashboardLayout,
  DashboardListResult,
  Invite,
  Member,
  MetricLatest,
  MetricSeries,
  ReissuedToken,
  ReportCountResult,
  ReportDetailResponse,
  ReportFilters,
  ReportPage,
  Role,
  RotatedKey,
  Source,
  SourceScope,
  Tree,
  TreeCategory,
  TreeStream,
  WidgetRange,
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
    const payload = (data ?? {}) as {
      error?: string;
      message?: string;
      issues?: Array<{ message?: string }>;
    };
    let message = payload.message ?? payload.error ?? `Request failed (${res.status}).`;
    // Surface Zod-style validation feedback (422) so callers can show it inline
    // instead of the opaque `validation_failed` code.
    if (!payload.message && Array.isArray(payload.issues)) {
      const detail = payload.issues.map((i) => i?.message).filter((m): m is string => Boolean(m));
      if (detail.length > 0) message = detail.join('; ');
    }
    const code = typeof payload.error === 'string' ? payload.error : undefined;
    throw new ApiError(res.status, message, code);
  }

  return data as T;
}

// --- Auth / setup --------------------------------------------------------

export const getAuthConfig = (signal?: AbortSignal) =>
  request<AuthConfig>('/auth/config', { signal });

/** The caller's billing account (limits + usage). OSS → all limits null. */
export const getAccount = (signal?: AbortSignal) => request<Account>('/account', { signal });

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

// --- Structure (manual category/stream management) -----------------------

export const createCategory = (wsId: string, input: { name: string; slug?: string }) =>
  request<{ category: TreeCategory }>(`/workspaces/${wsId}/categories`, {
    method: 'POST',
    body: input,
  });

export const renameCategory = (wsId: string, categoryId: string, name: string) =>
  request<{ category: TreeCategory }>(`/workspaces/${wsId}/categories/${categoryId}`, {
    method: 'PATCH',
    body: { name },
  });

export const deleteCategory = (wsId: string, categoryId: string) =>
  request<void>(`/workspaces/${wsId}/categories/${categoryId}`, { method: 'DELETE' });

export const reorderCategories = (wsId: string, ids: string[]) =>
  request<{ ok: true }>(`/workspaces/${wsId}/categories/reorder`, {
    method: 'PATCH',
    body: { ids },
  });

export const createStream = (
  wsId: string,
  categoryId: string,
  input: { name: string; slug?: string },
) =>
  request<{ stream: TreeStream }>(`/workspaces/${wsId}/categories/${categoryId}/streams`, {
    method: 'POST',
    body: input,
  });

export const renameStream = (wsId: string, streamId: string, name: string) =>
  request<{ stream: TreeStream }>(`/workspaces/${wsId}/streams/${streamId}`, {
    method: 'PATCH',
    body: { name },
  });

export const deleteStream = (wsId: string, streamId: string) =>
  request<void>(`/workspaces/${wsId}/streams/${streamId}`, { method: 'DELETE' });

export const reorderStreams = (wsId: string, categoryId: string, ids: string[]) =>
  request<{ ok: true }>(`/workspaces/${wsId}/categories/${categoryId}/streams/reorder`, {
    method: 'PATCH',
    body: { ids },
  });

export const getStreamInstructions = (wsId: string, streamId: string, sourceId: string) =>
  request<AgentInstructions>(`/workspaces/${wsId}/streams/${streamId}/agent-instructions`, {
    query: { sourceId },
  });

export const getCategoryInstructions = (wsId: string, categoryId: string, sourceId: string) =>
  request<AgentInstructions>(`/workspaces/${wsId}/categories/${categoryId}/agent-instructions`, {
    query: { sourceId },
  });

// --- Dashboards ----------------------------------------------------------

export const listDashboards = (wsId: string, signal?: AbortSignal) =>
  request<DashboardListResult>(`/workspaces/${wsId}/dashboards`, { signal });

export const getDashboard = (wsId: string, dashId: string, signal?: AbortSignal) =>
  request<{ dashboard: DashboardFull }>(`/workspaces/${wsId}/dashboards/${dashId}`, { signal });

export const createDashboard = (
  wsId: string,
  input: { name: string; icon?: string | null; layout?: DashboardLayout },
) =>
  request<{ dashboard: DashboardFull }>(`/workspaces/${wsId}/dashboards`, {
    method: 'POST',
    body: input,
  });

export const updateDashboard = (
  wsId: string,
  dashId: string,
  input: { name?: string; icon?: string | null; layout?: DashboardLayout; position?: number },
) =>
  request<{ dashboard: DashboardFull }>(`/workspaces/${wsId}/dashboards/${dashId}`, {
    method: 'PATCH',
    body: input,
  });

export const setDefaultDashboard = (wsId: string, dashId: string) =>
  request<{ dashboard: DashboardFull }>(`/workspaces/${wsId}/dashboards/${dashId}/default`, {
    method: 'POST',
  });

export const deleteDashboard = (wsId: string, dashId: string) =>
  request<void>(`/workspaces/${wsId}/dashboards/${dashId}`, { method: 'DELETE' });

// --- Widget data ---------------------------------------------------------

export const getMetricLatest = (
  wsId: string,
  streamId: string,
  metricKey: string,
  signal?: AbortSignal,
) =>
  request<MetricLatest>(
    `/workspaces/${wsId}/streams/${streamId}/metrics/${encodeURIComponent(metricKey)}/latest`,
    { signal },
  );

export const getMetricSeries = (
  wsId: string,
  streamId: string,
  metricKey: string,
  range?: WidgetRange,
  signal?: AbortSignal,
) =>
  request<MetricSeries>(
    `/workspaces/${wsId}/streams/${streamId}/metrics/${encodeURIComponent(metricKey)}/series`,
    { query: { range }, signal },
  );

export const getReportCount = (
  wsId: string,
  opts: { scope: CountScope; targetId: string; bucket?: CountBucket; range?: WidgetRange },
  signal?: AbortSignal,
) =>
  request<ReportCountResult>(`/workspaces/${wsId}/reports/count`, {
    query: { scope: opts.scope, targetId: opts.targetId, bucket: opts.bucket, range: opts.range },
    signal,
  });

export const getAlertFeed = (
  wsId: string,
  categoryId: string,
  limit?: number,
  signal?: AbortSignal,
) =>
  request<{ alerts: AlertItem[] }>(`/workspaces/${wsId}/categories/${categoryId}/alerts`, {
    query: { limit },
    signal,
  });
