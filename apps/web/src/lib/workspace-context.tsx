import { createContext, useContext, type ReactNode } from 'react';
import type { Role, Workspace } from './api-types';

interface WorkspaceContextValue {
  workspace: Workspace;
  role: Role | undefined;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

/** Provides the resolved current workspace to the shell + workspace screens. */
export function WorkspaceProvider({
  workspace,
  role,
  children,
}: {
  workspace: Workspace;
  role: Role | undefined;
  children: ReactNode;
}) {
  return (
    <WorkspaceContext.Provider value={{ workspace, role }}>{children}</WorkspaceContext.Provider>
  );
}

export function useCurrentWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useCurrentWorkspace must be used within a WorkspaceProvider');
  return ctx;
}

/** Permission helper mirroring the API's workspace RBAC table. */
export function canManage(role: Role | undefined): boolean {
  return role === 'owner' || role === 'admin';
}

/**
 * Whether the current role may build dashboards (`dashboards:build` →
 * Owner/Admin/Editor; Viewer is read-only). The API enforces this too — this
 * just hides the edit affordances so a Viewer never sees a control that 403s.
 */
export function canBuildDashboards(role: Role | undefined): boolean {
  return role === 'owner' || role === 'admin' || role === 'editor';
}

/**
 * Whether the current role may manage categories/streams (`categories:create` /
 * `streams:create` → Owner/Admin/Editor). Copying agent instructions is gated
 * separately by {@link canManage} since it mints a registration token.
 */
export function canManageStructure(role: Role | undefined): boolean {
  return role === 'owner' || role === 'admin' || role === 'editor';
}

/**
 * Whether the current role may archive/unarchive/hard-delete reports
 * (`reports:manage` → Owner/Admin/Editor; Viewer is read-only). The API enforces
 * this too — this hides the bulk controls so a Viewer never sees a 403 action.
 */
export function canManageReports(role: Role | undefined): boolean {
  return role === 'owner' || role === 'admin' || role === 'editor';
}
