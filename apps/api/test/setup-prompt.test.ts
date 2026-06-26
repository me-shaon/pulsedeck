import { describe, expect, it } from 'vitest';
import { buildDestinationSetupPrompt } from '../src/services/sources.js';

describe('buildDestinationSetupPrompt', () => {
  const base = 'https://pd.example';
  const tok = 'reg_abc';

  it('stream-level pins both slugs', () => {
    const p = buildDestinationSetupPrompt(
      base,
      tok,
      { categorySlug: 'infra', streamSlug: 'system-health' },
      { statusStreamSlug: 'uptime-bot' },
    );
    expect(p).toContain('"category": { "slug": "infra" }');
    expect(p).toContain('"stream":   { "slug": "system-health" }');
    expect(p).toContain(tok);
    expect(p).not.toContain('<category slug>');
  });

  it('category-level pins category, guides stream choice', () => {
    const p = buildDestinationSetupPrompt(
      base,
      tok,
      { categorySlug: 'infra' },
      { statusStreamSlug: 'uptime-bot' },
    );
    expect(p).toContain('"category": { "slug": "infra" }');
    expect(p).toContain('choose or create a stream');
    expect(p).not.toContain('<category slug>');
  });

  it('routes status to the agent-updates lane and weaves in the task', () => {
    const p = buildDestinationSetupPrompt(
      base,
      tok,
      { categorySlug: 'infra', streamSlug: 'system-health' },
      { statusStreamSlug: 'uptime-bot', task: 'Ping these URLs every 5m' },
    );
    expect(p).toContain('YOUR TASK');
    expect(p).toContain('Ping these URLs every 5m');
    expect(p).toContain('category "agent-updates", stream "uptime-bot"');
    expect(p).toContain('AGENT STATUS');
  });

  it('omits the task section when no task is given', () => {
    const p = buildDestinationSetupPrompt(
      base,
      tok,
      { categorySlug: 'infra' },
      { statusStreamSlug: 'uptime-bot' },
    );
    expect(p).not.toContain('YOUR TASK');
    expect(p).toContain('AGENT STATUS');
  });
});
