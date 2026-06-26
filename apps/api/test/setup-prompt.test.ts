import { describe, expect, it } from 'vitest';
import { buildDestinationSetupPrompt, buildSetupPrompt } from '../src/services/sources.js';

describe('buildSetupPrompt', () => {
  it('routes status to the agent-updates lane and includes the status section', () => {
    const p = buildSetupPrompt('https://pd.example', 'reg_xyz', 'uptime-bot');
    expect(p).toContain('category "agent-updates", stream "uptime-bot"');
    expect(p).toContain('AGENT STATUS');
    expect(p).toContain('reg_xyz');
    // Generic prompt still leaves the findings destination for the agent.
    expect(p).toContain('<category slug>');
  });
});

describe('buildDestinationSetupPrompt (task brief)', () => {
  it('stream-level routes findings to the pinned category/stream', () => {
    const p = buildDestinationSetupPrompt({ categorySlug: 'infra', streamSlug: 'system-health' });
    expect(p).toContain('category "infra", stream "system-health"');
    expect(p).toContain('REMEMBER THIS ROUTING');
  });

  it('category-level pins category, guides stream choice', () => {
    const p = buildDestinationSetupPrompt({ categorySlug: 'infra' });
    expect(p).toContain('category "infra"');
    expect(p).toContain('choose or create a stream');
  });

  it('weaves in the task when provided', () => {
    const p = buildDestinationSetupPrompt(
      { categorySlug: 'infra', streamSlug: 'system-health' },
      { task: 'Ping these URLs every 5m' },
    );
    expect(p).toContain('YOUR TASK');
    expect(p).toContain('Ping these URLs every 5m');
  });

  it('omits the task section when no task is given', () => {
    const p = buildDestinationSetupPrompt({ categorySlug: 'infra' });
    expect(p).not.toContain('YOUR TASK');
  });

  it('is a brief — excludes the onboarding protocol, status lane, and schema', () => {
    const p = buildDestinationSetupPrompt(
      { categorySlug: 'infra', streamSlug: 'system-health' },
      { task: 'do a thing' },
    );
    expect(p).not.toContain('STEP 1');
    expect(p).not.toContain('REGISTRATION_TOKEN');
    expect(p).not.toContain('agent-updates');
    expect(p).not.toContain('AGENT STATUS');
    expect(p).not.toContain('SCHEMA VERSION');
  });
});
