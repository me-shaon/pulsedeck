import { describe, expect, it } from 'vitest';
import { buildDestinationSetupPrompt } from '../src/services/sources.js';

describe('buildDestinationSetupPrompt', () => {
  const base = 'https://pd.example';
  const tok = 'reg_abc';

  it('stream-level pins both slugs', () => {
    const p = buildDestinationSetupPrompt(base, tok, {
      categorySlug: 'infra',
      streamSlug: 'system-health',
    });
    expect(p).toContain('"category": { "slug": "infra" }');
    expect(p).toContain('"stream":   { "slug": "system-health" }');
    expect(p).toContain(tok);
    expect(p).not.toContain('<category slug>');
  });

  it('category-level pins category, guides stream choice', () => {
    const p = buildDestinationSetupPrompt(base, tok, { categorySlug: 'infra' });
    expect(p).toContain('"category": { "slug": "infra" }');
    expect(p).toContain('choose or create a stream');
    expect(p).not.toContain('<category slug>');
  });
});
