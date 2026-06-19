import { relations } from 'drizzle-orm';
import { categories } from './categories.js';
import { dashboards } from './dashboards.js';
import { reportMetrics } from './report-metrics.js';
import { reports } from './reports.js';
import { sourceCategories, sourceStreams, sources } from './sources.js';
import { streams } from './streams.js';
import { users } from './users.js';
import { workspaceMembers, workspaces } from './workspaces.js';

/**
 * Drizzle `relations()` for typed relational queries (`db.query.*`). Purely a
 * query-builder convenience — these do not emit SQL or alter the migrations.
 */

export const workspacesRelations = relations(workspaces, ({ many }) => ({
  members: many(workspaceMembers),
  sources: many(sources),
  categories: many(categories),
  dashboards: many(dashboards),
}));

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(workspaceMembers),
}));

export const workspaceMembersRelations = relations(workspaceMembers, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [workspaceMembers.workspaceId],
    references: [workspaces.id],
  }),
  user: one(users, { fields: [workspaceMembers.userId], references: [users.id] }),
}));

export const sourcesRelations = relations(sources, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [sources.workspaceId],
    references: [workspaces.id],
  }),
  categories: many(sourceCategories),
  streams: many(sourceStreams),
  reports: many(reports),
}));

export const sourceCategoriesRelations = relations(sourceCategories, ({ one }) => ({
  source: one(sources, { fields: [sourceCategories.sourceId], references: [sources.id] }),
  category: one(categories, {
    fields: [sourceCategories.categoryId],
    references: [categories.id],
  }),
}));

export const sourceStreamsRelations = relations(sourceStreams, ({ one }) => ({
  source: one(sources, { fields: [sourceStreams.sourceId], references: [sources.id] }),
  stream: one(streams, { fields: [sourceStreams.streamId], references: [streams.id] }),
}));

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [categories.workspaceId],
    references: [workspaces.id],
  }),
  streams: many(streams),
  // Reverse of sourcesRelations.categories — "which sources may write here",
  // needed by scope/RBAC checks.
  sourceGrants: many(sourceCategories),
}));

export const streamsRelations = relations(streams, ({ one, many }) => ({
  category: one(categories, {
    fields: [streams.categoryId],
    references: [categories.id],
  }),
  reports: many(reports),
  metrics: many(reportMetrics),
  // Reverse of sourcesRelations.streams — "which sources may write here".
  sourceGrants: many(sourceStreams),
}));

export const reportsRelations = relations(reports, ({ one, many }) => ({
  stream: one(streams, { fields: [reports.streamId], references: [streams.id] }),
  source: one(sources, { fields: [reports.sourceId], references: [sources.id] }),
  metrics: many(reportMetrics),
}));

export const reportMetricsRelations = relations(reportMetrics, ({ one }) => ({
  report: one(reports, { fields: [reportMetrics.reportId], references: [reports.id] }),
  stream: one(streams, { fields: [reportMetrics.streamId], references: [streams.id] }),
}));

export const dashboardsRelations = relations(dashboards, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [dashboards.workspaceId],
    references: [workspaces.id],
  }),
}));
