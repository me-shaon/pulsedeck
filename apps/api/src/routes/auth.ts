import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { isGithubEnabled } from '../auth/auth.js';
import { isSetupRequired, provisionFirstAdmin, SetupAlreadyCompletedError } from '../auth/setup.js';

/**
 * Public auth-adjacent endpoints (no session required):
 *   - GET  /api/v1/auth/config — what the login/setup screens need to render.
 *   - POST /api/v1/setup        — first-run admin creation, self-disabling.
 *
 * The better-auth sign-in/sign-up/OAuth endpoints themselves live under
 * `/api/auth/*` (mounted in `buildServer`), not here.
 */

const SetupBody = z.object({
  name: z.string().min(1, 'name is required').max(120),
  email: z.string().email(),
  password: z.string().min(8, 'password must be at least 8 characters').max(256),
});

export async function authRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Tells the (future) frontend whether to show the GitHub button and whether
   * to route the user into the first-run setup wizard. Safe to call anonymously.
   */
  app.get('/api/v1/auth/config', async (_request, reply) => {
    return reply.send({
      githubEnabled: isGithubEnabled(app.authEnv),
      setupRequired: await isSetupRequired(app.db),
      // Deployment capabilities the web renders off (no `if (cloud)` forks).
      signupMode: app.runtime.signupMode,
      billingEnabled: app.runtime.billingEnabled,
    });
  });

  /**
   * Create the first admin + their Owner workspace. Allowed only while setup is
   * required (zero users). Once a user exists this returns 409 so the endpoint
   * cannot be used to mint additional privileged accounts.
   */
  app.post('/api/v1/setup', async (request, reply) => {
    if (!(await isSetupRequired(app.db))) {
      return reply.code(409).send({ error: 'Setup has already been completed' });
    }

    const parsed = SetupBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request', issues: parsed.error.issues });
    }

    let provisioned;
    try {
      provisioned = await provisionFirstAdmin(app.db, app.sql, app.auth, parsed.data);
    } catch (err) {
      // Lost the first-run race to a concurrent request — setup is now done.
      if (err instanceof SetupAlreadyCompletedError) {
        return reply.code(409).send({ error: 'Setup has already been completed' });
      }
      throw err;
    }
    const { userId, workspace, headers } = provisioned;

    // Forward better-auth's session cookie so the new admin is logged in.
    const setCookies = headers.getSetCookie?.() ?? [];
    if (setCookies.length > 0) {
      reply.header('set-cookie', setCookies);
    }

    return reply.code(201).send({
      user: { id: userId, email: parsed.data.email, name: parsed.data.name },
      workspace: { id: workspace.id, name: workspace.name, slug: workspace.slug },
    });
  });
}
