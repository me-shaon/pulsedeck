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
