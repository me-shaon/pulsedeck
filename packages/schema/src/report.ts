import { z } from 'zod';
import { blockSchema } from './blocks.js';
import { severitySchema } from './enums.js';
import { LIMITS } from './limits.js';
import { SCHEMA_VERSION } from './version.js';

/**
 * Canonical report envelope (PRD "Canonical Report Schema").
 *
 * `blocks` is capped at {@link LIMITS.blocksPerReport}; each block carries its
 * own type-specific limits and cross-field rules (see `blocks.ts`).
 */

/** Inner `report` metadata object. */
export const reportMetaSchema = z.object({
  title: z.string().min(1),
  summary: z.string().optional(),
  severity: severitySchema.optional(),
  occurred_at: z.string().datetime({ offset: true }),
  tags: z.array(z.string()).optional(),
});
export type ReportMeta = z.infer<typeof reportMetaSchema>;

export const reportSchema = z.object({
  version: z.literal(SCHEMA_VERSION),
  workspace: z.string().optional(),
  source: z.object({ id: z.string().min(1) }),
  category: z.object({ slug: z.string().min(1) }),
  stream: z.object({ slug: z.string().min(1) }),
  report: reportMetaSchema,
  blocks: z.array(blockSchema).max(LIMITS.blocksPerReport),
});
export type Report = z.infer<typeof reportSchema>;
