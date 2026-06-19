/**
 * Schema barrel — re-exports every table, enum, relation, and inferred type.
 * `drizzle.config.ts` points here, and `createDrizzle(sql)` passes the
 * namespace import of this module as the Drizzle `schema` for typed queries.
 */

export * from './enums.js';
export * from './columns.js';
export * from './users.js';
export * from './workspaces.js';
export * from './categories.js';
export * from './streams.js';
export * from './sources.js';
export * from './reports.js';
export * from './report-metrics.js';
export * from './dashboards.js';
export * from './relations.js';
