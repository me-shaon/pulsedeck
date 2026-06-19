import { describe, expect, it } from 'vitest';
import { can, requireRole, type Action, type Role } from '../src/auth/rbac.js';
import { isGithubEnabled } from '../src/auth/auth.js';

/**
 * Pure unit tests for the RBAC matrix — no DB, fast. Encodes the PRD table as an
 * independent expectation so a regression in `POLICY` is caught here rather than
 * via an integration test.
 */

const ROLES: Role[] = ['owner', 'admin', 'editor', 'viewer'];

// Expected allow-set per action, transcribed directly from the PRD matrix.
const EXPECTED: Record<Action, Role[]> = {
  'workspace:delete': ['owner'],
  'members:manage': ['owner', 'admin'],
  'sources:manage': ['owner', 'admin'],
  'categories:create': ['owner', 'admin', 'editor'],
  'streams:create': ['owner', 'admin', 'editor'],
  'dashboards:build': ['owner', 'admin', 'editor'],
  'reports:view': ['owner', 'admin', 'editor', 'viewer'],
};

describe('can(role, action) — PRD permission matrix', () => {
  for (const action of Object.keys(EXPECTED) as Action[]) {
    for (const role of ROLES) {
      const allowed = EXPECTED[action].includes(role);
      it(`${role} ${allowed ? 'CAN' : 'CANNOT'} ${action}`, () => {
        expect(can(role, action)).toBe(allowed);
      });
    }
  }
});

describe('requireRole', () => {
  it('returns void when permitted', () => {
    expect(() => requireRole('owner', 'workspace:delete')).not.toThrow();
  });
  it('throws when denied', () => {
    expect(() => requireRole('viewer', 'workspace:delete')).toThrow();
  });
});

describe('isGithubEnabled — opt-in branch', () => {
  it('is false when neither credential is set', () => {
    expect(isGithubEnabled({})).toBe(false);
  });
  it('is false when only one credential is set', () => {
    expect(isGithubEnabled({ GITHUB_CLIENT_ID: 'x' })).toBe(false);
    expect(isGithubEnabled({ GITHUB_CLIENT_SECRET: 'y' })).toBe(false);
  });
  it('is true only when both are set', () => {
    expect(isGithubEnabled({ GITHUB_CLIENT_ID: 'x', GITHUB_CLIENT_SECRET: 'y' })).toBe(true);
  });
});
