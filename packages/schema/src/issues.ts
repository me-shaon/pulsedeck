import type { ZodError } from 'zod';
import { reportSchema, type Report } from './report.js';

/**
 * Validation feedback helpers (PRD "Validation Feedback").
 *
 * Maps a {@link ZodError} into the `issues[]` shape agents receive in a 422
 * response: `{ path: "blocks[0].value", message: "..." }`.
 */

export interface Issue {
  /** Dot/bracket path to the offending field, e.g. `blocks[0].value`. */
  path: string;
  /** Human-readable description of the problem. */
  message: string;
}

/** Format a Zod path array as dot/bracket notation (`blocks[0].value`). */
export function formatPath(path: ReadonlyArray<string | number>): string {
  let out = '';
  for (const segment of path) {
    if (typeof segment === 'number') {
      out += `[${segment}]`;
    } else if (out === '') {
      out = segment;
    } else {
      out += `.${segment}`;
    }
  }
  return out;
}

/** Convert a {@link ZodError} into the wire `issues[]` array. */
export function toIssues(error: ZodError): Issue[] {
  return error.issues.map((issue) => ({
    path: formatPath(issue.path),
    message: issue.message,
  }));
}

export type ValidateResult = { success: true; data: Report } | { success: false; issues: Issue[] };

/**
 * Validate an unknown payload against the report schema, returning either the
 * parsed {@link Report} or the structured {@link Issue} list for a 422 response.
 */
export function validateReport(payload: unknown): ValidateResult {
  const result = reportSchema.safeParse(payload);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, issues: toIssues(result.error) };
}
