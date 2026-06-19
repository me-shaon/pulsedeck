import { describe, it, expect } from 'vitest';
import { SCHEMA_VERSION } from '../src/index.js';

describe('schema package', () => {
  it('exposes the wire-contract version', () => {
    expect(SCHEMA_VERSION).toBe('1.0');
  });
});
