import { and, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { Db } from '../db/index.js';
import { workspaceMembers } from '../db/schema/index.js';
import type { Auth, AuthUser } from './auth.js';
import { can, type Action, type Role } from './rbac.js';

/**
 * Bridge between Fastify and better-auth, which speaks the WHATWG
 * `Request`/`Response` API. We adapt Fastify requests both ways:
 *   - mount the better-auth handler at `/api/auth/*` (sign-in/up, OAuth, etc.)
 *   - resolve the current session for our own `/api/v1` routes via preHandlers.
 *
 * Request decorations (`request.user`, `request.workspaceRole`) are populated by
 * the preHandlers below so route handlers read them directly.
 */

declare module 'fastify' {
  interface FastifyRequest {
    /** The authenticated user, set by `requireAuth`. Null until then. */
    user: AuthUser | null;
    /** The user's role in the target workspace, set by `requireWorkspaceRole`. */
    workspaceRole: Role | null;
  }
}

/** Convert Fastify's incoming headers into a WHATWG `Headers` instance. */
export function toHeaders(request: FastifyRequest): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else {
      headers.append(key, value);
    }
  }
  return headers;
}

/**
 * Convert a Fastify request into a WHATWG `Request` for `auth.handler`. Fastify
 * has already parsed JSON bodies, so we re-serialize the parsed body; GET/HEAD
 * carry no body.
 */
export function toWebRequest(request: FastifyRequest): Request {
  const host = request.headers.host ?? 'localhost';
  const protocol = (request.headers['x-forwarded-proto'] as string | undefined) ?? request.protocol;
  const url = new URL(request.url, `${protocol}://${host}`);

  const headers = toHeaders(request);
  // We re-serialize the parsed body, so the original framing headers no longer
  // describe it — drop them to avoid a length/encoding mismatch.
  headers.delete('content-length');
  headers.delete('transfer-encoding');

  const init: RequestInit = { method: request.method, headers };

  if (request.method !== 'GET' && request.method !== 'HEAD' && request.body != null) {
    init.body = typeof request.body === 'string' ? request.body : JSON.stringify(request.body);
  }

  return new Request(url, init);
}

/**
 * Mount the better-auth handler on a Fastify catch-all under `/api/auth/*`.
 *
 * Multiple `Set-Cookie` headers are preserved via `Headers.getSetCookie()` —
 * iterating with `forEach` would otherwise fold them into one comma-joined
 * value and break session cookies.
 */
export function registerAuthHandler(app: FastifyInstance, auth: Auth): void {
  app.route({
    method: ['GET', 'POST'],
    url: '/api/auth/*',
    async handler(request, reply) {
      const response = await auth.handler(toWebRequest(request));

      reply.status(response.status);

      const setCookies = response.headers.getSetCookie?.() ?? [];
      if (setCookies.length > 0) {
        reply.header('set-cookie', setCookies);
      }
      response.headers.forEach((value, key) => {
        if (key.toLowerCase() === 'set-cookie') return;
        reply.header(key, value);
      });

      const text = await response.text();
      return reply.send(text.length > 0 ? text : null);
    },
  });
}

/**
 * preHandler: resolve the better-auth session and set `request.user`.
 * Responds 401 and halts the chain when there is no valid session.
 */
export function makeRequireAuth(auth: Auth): preHandlerHookHandler {
  return async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
    const session = await auth.api.getSession({ headers: toHeaders(request) });
    if (!session?.user) {
      await reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    request.user = session.user;
  };
}

/** Read the workspace id from common route param names (`:id` / `:workspaceId`). */
function workspaceIdParam(request: FastifyRequest): string | undefined {
  const params = request.params as Record<string, string | undefined>;
  return params.workspaceId ?? params.id;
}

/**
 * preHandler factory: require that the authenticated user is a member of the
 * target workspace AND that their role may perform `action`.
 *
 * Must run after `requireAuth`. Response policy:
 *   - 401 if somehow unauthenticated (defensive; `requireAuth` should precede).
 *   - 404 if the user is NOT a member — we deliberately do not distinguish
 *     "workspace doesn't exist" from "you're not in it", so a non-member cannot
 *     probe which workspace ids exist (enumeration defense).
 *   - 403 if the user is a member but their role lacks `action`.
 * On success sets `request.workspaceRole`.
 */
export function makeRequireWorkspaceRole(db: Db, action: Action): preHandlerHookHandler {
  return async function requireWorkspaceRole(request: FastifyRequest, reply: FastifyReply) {
    const user = request.user;
    if (!user) {
      await reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const workspaceId = workspaceIdParam(request);
    if (!workspaceId) {
      await reply.code(400).send({ error: 'Missing workspace id' });
      return;
    }

    const rows = await db
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(
        and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, user.id)),
      )
      .limit(1);

    const membership = rows[0];
    if (!membership) {
      // Non-member: hide existence (see policy note above).
      await reply.code(404).send({ error: 'Workspace not found' });
      return;
    }

    if (!can(membership.role, action)) {
      await reply.code(403).send({ error: 'Forbidden' });
      return;
    }

    request.workspaceRole = membership.role;
  };
}
