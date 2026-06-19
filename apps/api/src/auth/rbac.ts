/**
 * Workspace-level RBAC (PRD permission matrix).
 *
 * A member holds exactly one role per workspace. `can(role, action)` is the
 * single source of truth for "may this role perform this action"; the Fastify
 * preHandler in `src/auth/fastify.ts` resolves a request's role and calls it.
 *
 * PRD matrix (Owner ⊇ Admin ⊇ Editor ⊇ Viewer for the gated actions):
 *
 *   | Action                      | Owner | Admin | Editor | Viewer |
 *   |-----------------------------|:-----:|:-----:|:------:|:------:|
 *   | Delete workspace            |   ✓   |   —   |   —    |   —    |
 *   | Manage users                |   ✓   |   ✓   |   —    |   —    |
 *   | Manage sources              |   ✓   |   ✓   |   —    |   —    |
 *   | Create categories/streams   |   ✓   |   ✓   |   ✓    |   —    |
 *   | Build dashboards            |   ✓   |   ✓   |   ✓    |   —    |
 *   | View reports                |   ✓   |   ✓   |   ✓    |   ✓    |
 */

/** Workspace membership role (mirrors the `member_role` Postgres enum). */
export type Role = 'owner' | 'admin' | 'editor' | 'viewer';

/** Every RBAC-gated action. `<resource>:<verb>` keeps call sites self-documenting. */
export type Action =
  | 'workspace:delete'
  | 'members:manage'
  | 'sources:manage'
  | 'categories:create'
  | 'streams:create'
  | 'dashboards:build'
  | 'reports:view';

/**
 * Action → roles allowed to perform it. Listing the allowed roles (rather than
 * a numeric rank) keeps the table a faithful, line-by-line copy of the PRD
 * matrix and tolerates future non-hierarchical exceptions.
 */
const POLICY: Record<Action, readonly Role[]> = {
  'workspace:delete': ['owner'],
  'members:manage': ['owner', 'admin'],
  'sources:manage': ['owner', 'admin'],
  'categories:create': ['owner', 'admin', 'editor'],
  'streams:create': ['owner', 'admin', 'editor'],
  'dashboards:build': ['owner', 'admin', 'editor'],
  'reports:view': ['owner', 'admin', 'editor', 'viewer'],
};

/** True when `role` is permitted to perform `action` per the PRD matrix. */
export function can(role: Role, action: Action): boolean {
  // `?? []` is an explicit default-deny for an unknown action (unreachable while
  // `action` is typed, but fails closed rather than throwing if it ever isn't).
  return (POLICY[action] ?? []).includes(role);
}

/** Privilege ordering, used only to cap which role a granter may hand out. */
const ROLE_RANK: Record<Role, number> = { owner: 3, admin: 2, editor: 1, viewer: 0 };

/**
 * Whether a member holding `granterRole` may assign or invite `targetRole`.
 * A granter can never hand out a role above their own — this stops an Admin
 * (who holds `members:manage`) from minting or promoting an Owner and thereby
 * escalating past every Owner-only action.
 */
export function canGrantRole(granterRole: Role, targetRole: Role): boolean {
  return ROLE_RANK[targetRole] <= ROLE_RANK[granterRole];
}

/**
 * Assertion form of {@link can}. Throws when denied; returns void when allowed.
 * Handy for service-layer call sites that prefer exceptions to branching.
 */
export function requireRole(role: Role, action: Action): void {
  if (!can(role, action)) {
    throw new Error(`Role "${role}" is not permitted to perform "${action}"`);
  }
}
