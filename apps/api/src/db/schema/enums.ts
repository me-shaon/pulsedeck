import { pgEnum } from 'drizzle-orm/pg-core';

/**
 * Postgres enums shared across the schema.
 *
 * `report_severity` mirrors `severitySchema` from `@pulsedeck/schema`
 * (`info | warning | critical`) so the stored column and the wire contract can
 * never drift. The two role/scope enums are PulseDeck-internal (not part of the
 * agent wire contract) and live only here.
 */

/** Workspace membership roles (PRD "Members" + RBAC matrix). */
export const memberRole = pgEnum('member_role', ['owner', 'admin', 'editor', 'viewer']);

/** Source write scope (PRD "Source Write Scope"). */
export const sourceScope = pgEnum('source_scope', ['workspace', 'category', 'stream']);

/** Report + alert severity — must match `@pulsedeck/schema` `severitySchema`. */
export const reportSeverity = pgEnum('report_severity', ['info', 'warning', 'critical']);
