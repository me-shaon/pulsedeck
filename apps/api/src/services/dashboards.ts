import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DashboardLayout, DashboardWidget } from '../dashboards/layout-schema.js';
import { normalizeLayout } from '../dashboards/layout-schema.js';
import type { Db } from '../db/index.js';
import { categories, dashboards, id, streams, type Dashboard } from '../db/index.js';

/**
 * Dashboard CRUD + the "exactly one default per workspace" invariant (PRD
 * "Dashboards & Navigation"). The HTTP layer (`routes/dashboards.ts`) stays thin;
 * all correctness — slug derivation, the default invariant across
 * create/set-default/delete, and cross-workspace reference validation — lives
 * here in one testable place.
 *
 * The one-default invariant is upheld with transactions:
 *   - create  : the FIRST dashboard in a workspace is born `is_default`.
 *   - default : clear every other flag then set this one, atomically.
 *   - delete  : if the deleted row was default, promote the lowest-position
 *               survivor, atomically — so a non-empty workspace always has
 *               exactly one default.
 *
 * Workspace scoping is structural: every read/write is keyed on
 * `workspace_id = :workspaceId` (and references are checked to belong to the
 * workspace), so a foreign dashboard is neither addressable nor mutable.
 */

/** A Drizzle transaction handle (the argument to `db.transaction`). */
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Lowercase, hyphenated slug stem from a free-text name. */
function slugStem(name: string): string {
  const stem = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return stem || 'dashboard';
}

/**
 * Derive a slug unique within the workspace: try the clean stem first, then
 * append a short random suffix on collision. Checked inside the create
 * transaction; the `(workspace_id, slug)` unique index is the final backstop.
 */
async function deriveUniqueSlug(tx: Tx, workspaceId: string, name: string): Promise<string> {
  const stem = slugStem(name);
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = attempt === 0 ? stem : `${stem}-${nanoid(6).toLowerCase()}`;
    const [clash] = await tx
      .select({ id: dashboards.id })
      .from(dashboards)
      .where(and(eq(dashboards.workspaceId, workspaceId), eq(dashboards.slug, candidate)))
      .limit(1);
    if (!clash) return candidate;
  }
  // Astronomically unlikely fall-through — guarantee uniqueness with a long suffix.
  return `${stem}-${nanoid(12).toLowerCase()}`;
}

/** Public list item — the lightweight sidebar/listing shape (no layout). */
export interface DashboardListItem {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  position: number;
  isDefault: boolean;
}

/** Full dashboard incl. the normalized, validated layout. */
export interface DashboardFull extends DashboardListItem {
  workspaceId: string;
  layout: DashboardLayout;
  createdAt: string;
}

function toFull(row: Dashboard): DashboardFull {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    slug: row.slug,
    icon: row.icon,
    position: row.position,
    isDefault: row.isDefault,
    layout: normalizeLayout(row.layout),
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * The dashboard list (ordered by position, then createdAt as a stable
 * tiebreak), plus the default's id and the Overview-fallback marker.
 *
 * Overview fallback (PRD: "On a fresh workspace with no custom dashboards, a
 * system Overview is shown so the landing page is never blank"): when the
 * workspace has ZERO dashboards we return `isOverviewFallback: true` and a null
 * `defaultDashboardId`. The UI composes the Overview from existing endpoints
 * (recent reports + connected agents) — we do not synthesize a fake dashboard
 * row. Invariant: dashboards present → exactly one `isDefault`; none → Overview.
 */
export interface DashboardListResult {
  dashboards: DashboardListItem[];
  defaultDashboardId: string | null;
  isOverviewFallback: boolean;
}

export async function listDashboards(db: Db, workspaceId: string): Promise<DashboardListResult> {
  const rows = await db
    .select({
      id: dashboards.id,
      name: dashboards.name,
      slug: dashboards.slug,
      icon: dashboards.icon,
      position: dashboards.position,
      isDefault: dashboards.isDefault,
    })
    .from(dashboards)
    .where(eq(dashboards.workspaceId, workspaceId))
    .orderBy(asc(dashboards.position), asc(dashboards.createdAt));

  const def = rows.find((r) => r.isDefault) ?? null;
  return {
    dashboards: rows,
    defaultDashboardId: def?.id ?? null,
    isOverviewFallback: rows.length === 0,
  };
}

/** Fetch one dashboard scoped to the workspace (null → caller 404s). */
export async function getDashboard(
  db: Db,
  workspaceId: string,
  dashId: string,
): Promise<DashboardFull | null> {
  const [row] = await db
    .select()
    .from(dashboards)
    .where(and(eq(dashboards.id, dashId), eq(dashboards.workspaceId, workspaceId)))
    .limit(1);
  return row ? toFull(row) : null;
}

export interface CreateDashboardInput {
  name: string;
  icon?: string | null;
  layout: DashboardLayout;
}

/**
 * Create a dashboard appended at the end (`max(position) + 1`). The FIRST
 * dashboard in a workspace is automatically `is_default`. Runs in a transaction
 * so the position/default decision is consistent with concurrent creates.
 */
export async function createDashboard(
  db: Db,
  workspaceId: string,
  input: CreateDashboardInput,
): Promise<DashboardFull> {
  const row = await db.transaction(async (tx) => {
    const [agg] = await tx
      .select({
        count: sql<number>`count(*)::int`,
        maxPos: sql<number>`coalesce(max(${dashboards.position}), -1)::int`,
      })
      .from(dashboards)
      .where(eq(dashboards.workspaceId, workspaceId));

    const isDefault = agg.count === 0;
    const position = agg.maxPos + 1;
    const slug = await deriveUniqueSlug(tx, workspaceId, input.name);

    const [created] = await tx
      .insert(dashboards)
      .values({
        id: id('dsh'),
        workspaceId,
        name: input.name,
        slug,
        icon: input.icon ?? null,
        position,
        isDefault,
        layout: input.layout,
      })
      .returning();
    return created as Dashboard;
  });
  return toFull(row);
}

export interface UpdateDashboardInput {
  name?: string;
  icon?: string | null;
  layout?: DashboardLayout;
  position?: number;
}

/**
 * Patch name/icon/layout/position. Returns the updated dashboard, or null when
 * it isn't in this workspace (caller 404s). Does not touch the default flag —
 * that goes through {@link setDefaultDashboard} to keep the invariant atomic.
 */
export async function updateDashboard(
  db: Db,
  workspaceId: string,
  dashId: string,
  input: UpdateDashboardInput,
): Promise<DashboardFull | null> {
  const patch: Partial<typeof dashboards.$inferInsert> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.icon !== undefined) patch.icon = input.icon;
  if (input.layout !== undefined) patch.layout = input.layout;
  if (input.position !== undefined) patch.position = input.position;

  if (Object.keys(patch).length === 0) {
    return getDashboard(db, workspaceId, dashId);
  }

  const [row] = await db
    .update(dashboards)
    .set(patch)
    .where(and(eq(dashboards.id, dashId), eq(dashboards.workspaceId, workspaceId)))
    .returning();
  return row ? toFull(row as Dashboard) : null;
}

/** Outcome of a default/delete mutation so the route can map a clean 404. */
export type MutationResult = 'ok' | 'not_found';

/**
 * Mark `dashId` the workspace default, clearing the flag on every other
 * dashboard — atomically, so exactly one default survives. Returns `not_found`
 * if the dashboard isn't in this workspace.
 */
export async function setDefaultDashboard(
  db: Db,
  workspaceId: string,
  dashId: string,
): Promise<MutationResult> {
  return db.transaction(async (tx) => {
    const [target] = await tx
      .select({ id: dashboards.id })
      .from(dashboards)
      .where(and(eq(dashboards.id, dashId), eq(dashboards.workspaceId, workspaceId)))
      .limit(1);
    if (!target) return 'not_found';

    // Clear all others first, then set this one — two scoped UPDATEs in one txn
    // guarantee the "exactly one default" invariant even under a concurrent flip.
    await tx
      .update(dashboards)
      .set({ isDefault: false })
      .where(and(eq(dashboards.workspaceId, workspaceId), eq(dashboards.isDefault, true)));
    await tx.update(dashboards).set({ isDefault: true }).where(eq(dashboards.id, dashId));
    return 'ok';
  });
}

/**
 * Delete a dashboard. If it was the default, promote the lowest-position
 * survivor to default so a non-empty workspace always keeps exactly one default.
 * Atomic. Returns `not_found` if it isn't in this workspace.
 */
export async function deleteDashboard(
  db: Db,
  workspaceId: string,
  dashId: string,
): Promise<MutationResult> {
  return db.transaction(async (tx) => {
    const [target] = await tx
      .select({ id: dashboards.id, isDefault: dashboards.isDefault })
      .from(dashboards)
      .where(and(eq(dashboards.id, dashId), eq(dashboards.workspaceId, workspaceId)))
      .limit(1);
    if (!target) return 'not_found';

    await tx.delete(dashboards).where(eq(dashboards.id, dashId));

    if (target.isDefault) {
      const [next] = await tx
        .select({ id: dashboards.id })
        .from(dashboards)
        .where(eq(dashboards.workspaceId, workspaceId))
        .orderBy(asc(dashboards.position), asc(dashboards.createdAt))
        .limit(1);
      if (next) {
        await tx.update(dashboards).set({ isDefault: true }).where(eq(dashboards.id, next.id));
      }
    }
    return 'ok';
  });
}

/** An id reference inside a widget config, tagged with which entity it must be. */
interface LayoutRef {
  kind: 'stream' | 'category';
  refId: string;
}

/**
 * Collect every entity id a layout's widgets reference, tagged stream/category.
 * Cross-workspace defense lives at write time: each id is then verified to
 * belong to the workspace (see {@link validateLayoutReferences}), so a crafted
 * config can never aim a widget at another workspace's stream/category.
 */
export function collectLayoutRefs(layout: DashboardLayout): LayoutRef[] {
  const refs: LayoutRef[] = [];
  for (const w of layout.widgets) {
    refs.push(...refsForWidget(w));
  }
  return refs;
}

function refsForWidget(w: DashboardWidget): LayoutRef[] {
  switch (w.type) {
    case 'stream_feed':
    case 'metric':
    case 'chart':
      return [{ kind: 'stream', refId: w.config.streamId }];
    case 'alert_feed':
      return [{ kind: 'category', refId: w.config.categoryId }];
    case 'report_count':
      return [
        { kind: w.config.scope === 'category' ? 'category' : 'stream', refId: w.config.targetId },
      ];
  }
}

/**
 * Verify every stream/category a layout references belongs to `workspaceId`.
 * Returns the list of offending ids (empty when all are in-workspace); the route
 * maps a non-empty result to a 422 so a widget can never point at another
 * workspace's data. Two batched `IN` queries — no per-ref round-trip.
 */
export async function validateLayoutReferences(
  db: Db,
  workspaceId: string,
  layout: DashboardLayout,
): Promise<string[]> {
  const refs = collectLayoutRefs(layout);
  if (refs.length === 0) return [];

  const streamIds = [...new Set(refs.filter((r) => r.kind === 'stream').map((r) => r.refId))];
  const categoryIds = [...new Set(refs.filter((r) => r.kind === 'category').map((r) => r.refId))];

  const validStreams = new Set<string>();
  if (streamIds.length > 0) {
    const rows = await db
      .select({ id: streams.id })
      .from(streams)
      .innerJoin(categories, eq(categories.id, streams.categoryId))
      .where(and(eq(categories.workspaceId, workspaceId), inArray(streams.id, streamIds)));
    for (const r of rows) validStreams.add(r.id);
  }

  const validCategories = new Set<string>();
  if (categoryIds.length > 0) {
    const rows = await db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.workspaceId, workspaceId), inArray(categories.id, categoryIds)));
    for (const r of rows) validCategories.add(r.id);
  }

  const invalid: string[] = [];
  for (const ref of streamIds) if (!validStreams.has(ref)) invalid.push(ref);
  for (const ref of categoryIds) if (!validCategories.has(ref)) invalid.push(ref);
  return invalid;
}
