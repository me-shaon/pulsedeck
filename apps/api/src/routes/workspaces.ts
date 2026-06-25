import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { canGrantRole } from '../auth/rbac.js';
import { makeRequireAuth, makeRequireWorkspaceRole } from '../auth/fastify.js';
import { id, invites, users, workspaceMembers, workspaces } from '../db/index.js';
import { accountIdForUser } from '../services/accounts.js';
import {
  assertCanAddSeat,
  assertCanAddWorkspace,
  countSeats,
  countWorkspaces,
  getAccountLimits,
} from '../services/limits.js';
import { createWorkspaceWithOwner } from '../services/workspaces.js';

/**
 * Workspace, membership, and invite endpoints under `/api/v1`.
 *
 * Every gated route runs `requireAuth` then `requireWorkspaceRole(action)`; the
 * RBAC action each route requires is annotated inline and enforced by the
 * preHandler (401 unauth, 404 non-member, 403 insufficient role).
 */

const roleEnum = z.enum(['owner', 'admin', 'editor', 'viewer']);

const CreateWorkspaceBody = z.object({ name: z.string().min(1).max(120) });
const ChangeRoleBody = z.object({ role: roleEnum });
const CreateInviteBody = z.object({
  role: roleEnum,
  email: z.string().email().optional(),
  expiresInHours: z
    .number()
    .int()
    .positive()
    .max(24 * 30)
    .optional(),
});
const AcceptInviteBody = z.object({ token: z.string().min(1) });

const DEFAULT_INVITE_TTL_HOURS = 24 * 7;

export async function workspaceRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app;
  const requireAuth = makeRequireAuth(app.auth);
  const gate = (action: Parameters<typeof makeRequireWorkspaceRole>[1]) => [
    requireAuth,
    makeRequireWorkspaceRole(db, action),
  ];

  /** Count owners of a workspace — used to protect the last owner. */
  async function ownerCount(workspaceId: string): Promise<number> {
    const rows = await db
      .select({ userId: workspaceMembers.userId })
      .from(workspaceMembers)
      .where(
        and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.role, 'owner')),
      );
    return rows.length;
  }

  // --- Account --------------------------------------------------------------

  /**
   * The caller's account: limits + current usage. `null` limits mean unlimited
   * (OSS), so the web renders no meters/upgrade prompts; cloud returns real
   * numbers and the same components show usage. Auth only.
   */
  app.get('/api/v1/account', { preHandler: [requireAuth] }, async (request, reply) => {
    const accountId = await accountIdForUser(db, request.user!.id);
    if (!accountId) return reply.code(404).send({ error: 'No account for user' });
    const [limits, workspaceCount, seatCount] = await Promise.all([
      getAccountLimits(db, accountId),
      countWorkspaces(db, accountId),
      countSeats(db, accountId),
    ]);
    return reply.send({
      id: accountId,
      limits,
      usage: { workspaces: workspaceCount, seats: seatCount },
    });
  });

  // --- Workspaces -----------------------------------------------------------

  /** List the caller's workspaces with their role. Auth only (membership-scoped). */
  app.get('/api/v1/workspaces', { preHandler: [requireAuth] }, async (request, reply) => {
    const rows = await db
      .select({
        id: workspaces.id,
        name: workspaces.name,
        slug: workspaces.slug,
        role: workspaceMembers.role,
        createdAt: workspaces.createdAt,
      })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .where(eq(workspaceMembers.userId, request.user!.id));
    return reply.send({ workspaces: rows });
  });

  /** Create a workspace; the caller becomes its Owner. Auth only. */
  app.post('/api/v1/workspaces', { preHandler: [requireAuth] }, async (request, reply) => {
    const parsed = CreateWorkspaceBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request', issues: parsed.error.issues });
    }
    // New workspaces join the caller's existing account; enforce its quota.
    const accountId = await accountIdForUser(db, request.user!.id);
    if (!accountId) return reply.code(403).send({ error: 'No account for user' });
    await assertCanAddWorkspace(db, accountId);
    const workspace = await createWorkspaceWithOwner(
      db,
      request.user!.id,
      parsed.data.name,
      accountId,
    );
    return reply.code(201).send({ workspace });
  });

  /** Get one workspace. Requires `reports:view` (i.e. any member). */
  app.get(
    '/api/v1/workspaces/:id',
    { preHandler: gate('reports:view') },
    async (request, reply) => {
      const { id: workspaceId } = request.params as { id: string };
      const [workspace] = await db
        .select()
        .from(workspaces)
        .where(eq(workspaces.id, workspaceId))
        .limit(1);
      if (!workspace) return reply.code(404).send({ error: 'Workspace not found' });
      return reply.send({ workspace, role: request.workspaceRole });
    },
  );

  /** Delete a workspace. Requires `workspace:delete` (Owner only). */
  app.delete(
    '/api/v1/workspaces/:id',
    { preHandler: gate('workspace:delete') },
    async (request, reply) => {
      const { id: workspaceId } = request.params as { id: string };
      await db.delete(workspaces).where(eq(workspaces.id, workspaceId)); // FKs cascade members/invites
      return reply.code(204).send();
    },
  );

  // --- Members --------------------------------------------------------------

  /** List members. Requires `reports:view` (any member can see the roster). */
  app.get(
    '/api/v1/workspaces/:id/members',
    { preHandler: gate('reports:view') },
    async (request, reply) => {
      const { id: workspaceId } = request.params as { id: string };
      const members = await db
        .select({
          userId: workspaceMembers.userId,
          role: workspaceMembers.role,
          email: users.email,
          name: users.name,
        })
        .from(workspaceMembers)
        .innerJoin(users, eq(users.id, workspaceMembers.userId))
        .where(eq(workspaceMembers.workspaceId, workspaceId));
      return reply.send({ members });
    },
  );

  /** Change a member's role. Requires `members:manage` (Owner/Admin). */
  app.patch(
    '/api/v1/workspaces/:id/members/:userId',
    { preHandler: gate('members:manage') },
    async (request, reply) => {
      const { id: workspaceId, userId } = request.params as { id: string; userId: string };
      const parsed = ChangeRoleBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid request', issues: parsed.error.issues });
      }

      // Cannot promote a member to a role above the caller's own (privilege ceiling).
      if (!canGrantRole(request.workspaceRole!, parsed.data.role)) {
        return reply.code(403).send({ error: 'Cannot grant a role higher than your own' });
      }

      const [target] = await db
        .select({ role: workspaceMembers.role })
        .from(workspaceMembers)
        .where(
          and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)),
        )
        .limit(1);
      if (!target) return reply.code(404).send({ error: 'Member not found' });

      // A caller may only act on members at or below their own rank. Without this
      // an Admin (who holds `members:manage`) could demote an Owner while >1 owner
      // exists, acting on a higher principal. `canGrantRole(caller, target.role)`
      // is the same ceiling used for the granted role above.
      if (!canGrantRole(request.workspaceRole!, target.role)) {
        return reply
          .code(403)
          .send({ error: 'Cannot modify a member whose role is higher than your own' });
      }

      // Never strip the workspace of its last owner.
      if (
        target.role === 'owner' &&
        parsed.data.role !== 'owner' &&
        (await ownerCount(workspaceId)) === 1
      ) {
        return reply.code(400).send({ error: 'Cannot demote the last owner' });
      }

      await db
        .update(workspaceMembers)
        .set({ role: parsed.data.role })
        .where(
          and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)),
        );
      return reply.send({ userId, role: parsed.data.role });
    },
  );

  /** Remove a member. Requires `members:manage` (Owner/Admin). */
  app.delete(
    '/api/v1/workspaces/:id/members/:userId',
    { preHandler: gate('members:manage') },
    async (request, reply) => {
      const { id: workspaceId, userId } = request.params as { id: string; userId: string };

      const [target] = await db
        .select({ role: workspaceMembers.role })
        .from(workspaceMembers)
        .where(
          and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)),
        )
        .limit(1);
      if (!target) return reply.code(404).send({ error: 'Member not found' });

      // Rank ceiling: an Admin cannot remove an Owner (acting on a higher
      // principal). Owners can remove anyone, subject to the last-owner guard.
      if (!canGrantRole(request.workspaceRole!, target.role)) {
        return reply
          .code(403)
          .send({ error: 'Cannot remove a member whose role is higher than your own' });
      }

      if (target.role === 'owner' && (await ownerCount(workspaceId)) === 1) {
        return reply.code(400).send({ error: 'Cannot remove the last owner' });
      }

      await db
        .delete(workspaceMembers)
        .where(
          and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)),
        );
      return reply.code(204).send();
    },
  );

  // --- Invites --------------------------------------------------------------

  /** Create an invite for a role. Requires `members:manage` (Owner/Admin). */
  app.post(
    '/api/v1/workspaces/:id/invites',
    { preHandler: gate('members:manage') },
    async (request, reply) => {
      const { id: workspaceId } = request.params as { id: string };
      const parsed = CreateInviteBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid request', issues: parsed.error.issues });
      }

      // A granter cannot invite a role above their own (e.g. an Admin minting an Owner).
      if (!canGrantRole(request.workspaceRole!, parsed.data.role)) {
        return reply.code(403).send({ error: 'Cannot grant a role higher than your own' });
      }

      const token = nanoid(32);
      const ttlHours = parsed.data.expiresInHours ?? DEFAULT_INVITE_TTL_HOURS;
      const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

      const [invite] = await db
        .insert(invites)
        .values({
          id: id('inv'),
          workspaceId,
          email: parsed.data.email,
          role: parsed.data.role,
          token,
          expiresAt,
          createdBy: request.user!.id,
        })
        .returning();

      const base = app.authEnv.BETTER_AUTH_URL ?? '';
      const inviteUrl = `${base}/invite/${token}`;

      // Hand the invite to the email port. OSS binds the console no-op (nothing
      // sent — the URL below is the delivery channel); cloud binds a real
      // provider. A send failure must not fail invite creation, so it's logged
      // and swallowed — the URL is still returned.
      if (invite.email) {
        await app.email
          .send({
            to: invite.email,
            template: 'workspace-invite',
            data: { inviteUrl, role: invite.role, workspaceId },
          })
          .catch((err) => app.log.error({ err }, 'invite email send failed'));
      }

      return reply.code(201).send({
        invite: {
          id: invite.id,
          role: invite.role,
          email: invite.email,
          token: invite.token,
          expiresAt: invite.expiresAt,
          inviteUrl,
        },
      });
    },
  );

  /** List a workspace's invites. Requires `members:manage` (Owner/Admin). */
  app.get(
    '/api/v1/workspaces/:id/invites',
    { preHandler: gate('members:manage') },
    async (request, reply) => {
      const { id: workspaceId } = request.params as { id: string };
      const rows = await db
        .select({
          id: invites.id,
          role: invites.role,
          email: invites.email,
          expiresAt: invites.expiresAt,
          acceptedAt: invites.acceptedAt,
          createdAt: invites.createdAt,
        })
        .from(invites)
        .where(eq(invites.workspaceId, workspaceId));
      return reply.send({ invites: rows });
    },
  );

  /**
   * Accept an invite token → become a member at the invite's role. Auth only
   * (any signed-in user with a valid token). Unknown → 404, used → 409,
   * expired → 410. Idempotent for an already-member: role is updated in place.
   */
  app.post('/api/v1/invites/accept', { preHandler: [requireAuth] }, async (request, reply) => {
    const parsed = AcceptInviteBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request', issues: parsed.error.issues });
    }

    const [invite] = await db
      .select()
      .from(invites)
      .where(eq(invites.token, parsed.data.token))
      .limit(1);
    if (!invite) return reply.code(404).send({ error: 'Invite not found' });
    if (invite.expiresAt.getTime() < Date.now()) {
      return reply.code(410).send({ error: 'Invite expired' });
    }

    const userId = request.user!.id;
    // Enforce the account's seat quota before consuming the invite. An existing
    // member (re-accept / role change) does not consume a new seat.
    const [target] = await db
      .select({ accountId: workspaces.accountId })
      .from(workspaces)
      .where(eq(workspaces.id, invite.workspaceId))
      .limit(1);
    if (target) await assertCanAddSeat(db, target.accountId, userId);
    // Single-use enforcement is an atomic compare-and-swap: the UPDATE only
    // matches while `accepted_at IS NULL`, so of two concurrent accepts of the
    // same token exactly one consumes it; the loser sees 0 rows → 409. The
    // membership write is gated on winning, all inside one transaction.
    const consumed = await db.transaction(async (tx) => {
      const claimed = await tx
        .update(invites)
        .set({ acceptedAt: new Date() })
        .where(and(eq(invites.id, invite.id), isNull(invites.acceptedAt)))
        .returning({ id: invites.id });
      if (claimed.length === 0) return false;

      await tx
        .insert(workspaceMembers)
        .values({ workspaceId: invite.workspaceId, userId, role: invite.role })
        .onConflictDoUpdate({
          target: [workspaceMembers.workspaceId, workspaceMembers.userId],
          set: { role: invite.role },
        });
      return true;
    });

    if (!consumed) return reply.code(409).send({ error: 'Invite already used' });
    return reply.send({ workspaceId: invite.workspaceId, role: invite.role });
  });
}
