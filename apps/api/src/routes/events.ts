import type { FastifyInstance } from 'fastify';
import { makeRequireAuth, makeRequireWorkspaceRole } from '../auth/fastify.js';
import type { Realtime, RealtimeLifecycleEvent, RealtimeReportEvent } from '../events/realtime.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** Realtime fan-out layer (decorated in `buildServer`). */
    realtime: Realtime;
    /** Master switch for the SSE endpoint (env `SSE_ENABLED`, default true). */
    sseEnabled: boolean;
  }
}

// Heartbeat comment cadence. Comfortably under common proxy/idle timeouts (~60s)
// so connections survive nginx/Cloudflare buffering windows.
const HEARTBEAT_MS = 25_000;

/**
 * SSE endpoint (PRD §7). Live report stream for one workspace.
 *
 *   GET /api/v1/workspaces/:id/events
 *
 * Gated by session auth + workspace membership (`reports:view`), identical to the
 * read APIs — a non-member 404s at the preHandler, hiding existence.
 *
 * Policy: the endpoint is ALWAYS registered. When `SSE_ENABLED` is false it 503s,
 * so the client falls back to polling (the Polling tier). Redis is orthogonal —
 * it only fans events across replicas (handled inside `app.realtime`); SSE works
 * single-instance with no Redis.
 *
 * Streaming uses Fastify v5's `reply.hijack()` to take ownership of the socket,
 * then writes the raw `text/event-stream` protocol to `reply.raw`. The connection
 * subscribes to `app.realtime` on open and UNSUBSCRIBES on every close path
 * (client close, request error, write error) so listeners never leak. Events are
 * filtered to the connection's workspace, so one workspace never sees another's.
 */
export async function eventRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app;
  const requireAuth = makeRequireAuth(app.auth);
  const viewGate = [requireAuth, makeRequireWorkspaceRole(db, 'reports:view')];

  app.get('/api/v1/workspaces/:id/events', { preHandler: viewGate }, (request, reply) => {
    const { id: workspaceId } = request.params as { id: string };

    // SSE turned off → tell the client to poll instead. Send a normal reply.
    if (!app.sseEnabled) {
      reply
        .code(503)
        .send({ error: 'sse_disabled', message: 'Realtime SSE is disabled; use polling.' });
      return reply;
    }

    const raw = reply.raw;
    // Take over the socket: Fastify will not attempt to serialize/send a reply.
    reply.hijack();

    raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Disable proxy buffering (nginx) so events flush immediately.
      'X-Accel-Buffering': 'no',
    });
    // Open the stream and push headers to the client now.
    raw.write(': connected\n\n');
    if (typeof raw.flushHeaders === 'function') raw.flushHeaders();

    let open = true;
    let unsubscribe: () => void = () => {};
    let unsubscribeLifecycle: () => void = () => {};
    let heartbeat: ReturnType<typeof setInterval> | null = null;

    const cleanup = (): void => {
      if (!open) return;
      open = false;
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = null;
      // Remove the realtime subscriptions — the critical no-leak guarantee.
      unsubscribe();
      unsubscribeLifecycle();
      try {
        raw.end();
      } catch {
        // socket already torn down — nothing to do.
      }
    };

    const send = (event: RealtimeReportEvent): void => {
      if (!open) return;
      // Workspace isolation: never write another workspace's events.
      if (event.workspaceId !== workspaceId) return;
      try {
        raw.write(`id: ${event.reportId}\nevent: report\ndata: ${JSON.stringify(event)}\n\n`);
      } catch {
        cleanup();
      }
    };

    // Archive/unarchive/delete: one frame per bulk op, named `report-<kind>` so
    // the client can invalidate the affected stream's report lists.
    const sendLifecycle = (event: RealtimeLifecycleEvent): void => {
      if (!open) return;
      if (event.workspaceId !== workspaceId) return;
      try {
        raw.write(`event: report-${event.kind}\ndata: ${JSON.stringify(event)}\n\n`);
      } catch {
        cleanup();
      }
    };

    unsubscribe = app.realtime.onReportIngested(send);
    unsubscribeLifecycle = app.realtime.onReportLifecycle(sendLifecycle);

    heartbeat = setInterval(() => {
      if (!open) return;
      try {
        raw.write(`: ${Date.now()}\n\n`);
      } catch {
        cleanup();
      }
    }, HEARTBEAT_MS);
    // Don't keep the event loop (or graceful shutdown) alive for the heartbeat.
    if (typeof heartbeat.unref === 'function') heartbeat.unref();

    // Every disconnect path runs cleanup exactly once (guarded by `open`).
    request.raw.on('close', cleanup);
    request.raw.on('error', cleanup);
    raw.on('error', cleanup);

    return reply;
  });
}
