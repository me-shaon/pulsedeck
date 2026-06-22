import { eq, sql } from 'drizzle-orm';
import { and } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { categories, id, streams, type Category, type Stream } from '../db/index.js';

/**
 * Manual category/stream management (operator-driven structure). Mirrors the
 * source service's shape: multi-step DB logic lives here so routes stay thin.
 *
 * Slugs are the permanent routing key agents push to; these functions set names
 * with `labelSource: 'user'` so a later agent push (which only ever sends a
 * slug) can never overwrite an operator-chosen label. Autocreate in
 * `ingestion.ts` is the `labelSource: 'auto'` counterpart.
 */

export type StructureError = 'slug_exists' | 'not_found' | 'bad_order';

/** Slugify a display name: lowercase, non-alphanumerics → single hyphen, trim. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/** Confirm a category belongs to the workspace; returns it or null. */
async function loadCategory(db: Db, workspaceId: string, categoryId: string) {
  const [row] = await db
    .select()
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.workspaceId, workspaceId)))
    .limit(1);
  return row ?? null;
}

/** Confirm a stream belongs to the workspace (via its category); returns it or null. */
async function loadStream(db: Db, workspaceId: string, streamId: string) {
  const [row] = await db
    .select({ stream: streams })
    .from(streams)
    .innerJoin(categories, eq(categories.id, streams.categoryId))
    .where(and(eq(streams.id, streamId), eq(categories.workspaceId, workspaceId)))
    .limit(1);
  return row?.stream ?? null;
}

/** Next position within a workspace: max(position)+1, 0 when empty. */
async function nextCategoryPosition(db: Db, workspaceId: string): Promise<number> {
  const [row] = await db
    .select({ max: sql<number | null>`max(${categories.position})` })
    .from(categories)
    .where(eq(categories.workspaceId, workspaceId));
  return (row?.max ?? -1) + 1;
}

async function nextStreamPosition(db: Db, categoryId: string): Promise<number> {
  const [row] = await db
    .select({ max: sql<number | null>`max(${streams.position})` })
    .from(streams)
    .where(eq(streams.categoryId, categoryId));
  return (row?.max ?? -1) + 1;
}

export interface CreateCategoryInput {
  workspaceId: string;
  name: string;
  slug?: string;
  position?: number;
}

export async function createCategory(
  db: Db,
  input: CreateCategoryInput,
): Promise<{ category: Category } | { error: StructureError }> {
  const slug = input.slug?.trim() ? slugify(input.slug) : slugify(input.name);
  // An empty slug (name had no alphanumerics) is unusable as a routing key.
  if (!slug) return { error: 'slug_exists' };
  const position = input.position ?? (await nextCategoryPosition(db, input.workspaceId));

  const inserted = await db
    .insert(categories)
    .values({
      id: id('cat'),
      workspaceId: input.workspaceId,
      name: input.name,
      slug,
      labelSource: 'user',
      position,
    })
    .onConflictDoNothing({ target: [categories.workspaceId, categories.slug] })
    .returning();

  if (inserted.length === 0) return { error: 'slug_exists' };
  return { category: inserted[0] };
}

export interface CreateStreamInput {
  workspaceId: string;
  categoryId: string;
  name: string;
  slug?: string;
  position?: number;
}

export async function createStream(
  db: Db,
  input: CreateStreamInput,
): Promise<{ stream: Stream } | { error: StructureError }> {
  const category = await loadCategory(db, input.workspaceId, input.categoryId);
  if (!category) return { error: 'not_found' };

  const slug = input.slug?.trim() ? slugify(input.slug) : slugify(input.name);
  if (!slug) return { error: 'slug_exists' };
  const position = input.position ?? (await nextStreamPosition(db, input.categoryId));

  const inserted = await db
    .insert(streams)
    .values({
      id: id('stm'),
      categoryId: input.categoryId,
      name: input.name,
      slug,
      labelSource: 'user',
      position,
    })
    .onConflictDoNothing({ target: [streams.categoryId, streams.slug] })
    .returning();
  if (inserted.length === 0) return { error: 'slug_exists' };
  return { stream: inserted[0] };
}

export async function renameCategory(
  db: Db,
  workspaceId: string,
  categoryId: string,
  name: string,
): Promise<{ category: Category } | { error: StructureError }> {
  const existing = await loadCategory(db, workspaceId, categoryId);
  if (!existing) return { error: 'not_found' };
  const [row] = await db
    .update(categories)
    .set({ name, labelSource: 'user' })
    .where(eq(categories.id, categoryId))
    .returning();
  return { category: row };
}

export async function renameStream(
  db: Db,
  workspaceId: string,
  streamId: string,
  name: string,
): Promise<{ stream: Stream } | { error: StructureError }> {
  const existing = await loadStream(db, workspaceId, streamId);
  if (!existing) return { error: 'not_found' };
  const [row] = await db
    .update(streams)
    .set({ name, labelSource: 'user' })
    .where(eq(streams.id, streamId))
    .returning();
  return { stream: row };
}

export async function deleteCategory(
  db: Db,
  workspaceId: string,
  categoryId: string,
): Promise<{ ok: true } | { error: StructureError }> {
  const existing = await loadCategory(db, workspaceId, categoryId);
  if (!existing) return { error: 'not_found' };
  // FK cascade removes streams and their reports.
  await db.delete(categories).where(eq(categories.id, categoryId));
  return { ok: true };
}

export async function deleteStream(
  db: Db,
  workspaceId: string,
  streamId: string,
): Promise<{ ok: true } | { error: StructureError }> {
  const existing = await loadStream(db, workspaceId, streamId);
  if (!existing) return { error: 'not_found' };
  // FK cascade removes the stream's reports.
  await db.delete(streams).where(eq(streams.id, streamId));
  return { ok: true };
}

/** Set position = index for the given ordered ids; all must be in the workspace. */
export async function reorderCategories(
  db: Db,
  workspaceId: string,
  ids: string[],
): Promise<{ ok: true } | { error: StructureError }> {
  const rows = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.workspaceId, workspaceId));
  const owned = new Set(rows.map((r) => r.id));
  if (ids.length === 0 || !ids.every((i) => owned.has(i))) return { error: 'bad_order' };
  await db.transaction(async (tx) => {
    for (let i = 0; i < ids.length; i++) {
      await tx.update(categories).set({ position: i }).where(eq(categories.id, ids[i]));
    }
  });
  return { ok: true };
}

/** Set position = index for streams within a category; all must belong to it. */
export async function reorderStreams(
  db: Db,
  workspaceId: string,
  categoryId: string,
  ids: string[],
): Promise<{ ok: true } | { error: StructureError }> {
  const category = await loadCategory(db, workspaceId, categoryId);
  if (!category) return { error: 'not_found' };
  const rows = await db
    .select({ id: streams.id })
    .from(streams)
    .where(eq(streams.categoryId, categoryId));
  const owned = new Set(rows.map((r) => r.id));
  if (ids.length === 0 || !ids.every((i) => owned.has(i))) return { error: 'bad_order' };
  await db.transaction(async (tx) => {
    for (let i = 0; i < ids.length; i++) {
      await tx.update(streams).set({ position: i }).where(eq(streams.id, ids[i]));
    }
  });
  return { ok: true };
}
