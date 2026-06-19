import { describe, it, expect } from 'vitest';
import { schemaInfo, getSchemaInfo, BLOCK_TYPES, LIMITS, SCHEMA_VERSION } from '../src/index.js';

describe('schemaInfo descriptor', () => {
  it('is plain JSON-serializable', () => {
    expect(() => JSON.stringify(schemaInfo)).not.toThrow();
  });

  it('reports the current version and limits', () => {
    expect(schemaInfo.version).toBe(SCHEMA_VERSION);
    expect(schemaInfo.limits).toEqual(LIMITS);
  });

  it('describes all 8 block types', () => {
    const described = schemaInfo.blocks.map((b) => b.type).sort();
    expect(described).toEqual([...BLOCK_TYPES].sort());
  });

  it('lists every canonical enum', () => {
    expect(Object.keys(schemaInfo.enums).sort()).toEqual(
      ['chart_variant', 'column_type', 'format', 'sentiment', 'severity', 'status', 'trend'].sort(),
    );
    expect(schemaInfo.enums.severity).toEqual(['info', 'warning', 'critical']);
  });

  it('marks metric required fields correctly', () => {
    const metric = schemaInfo.blocks.find((b) => b.type === 'metric');
    const required = metric?.fields
      .filter((f) => f.required)
      .map((f) => f.name)
      .sort();
    expect(required).toEqual(['id', 'key', 'label', 'type', 'value'].sort());
  });

  it('getSchemaInfo returns the descriptor', () => {
    expect(getSchemaInfo()).toBe(schemaInfo);
  });
});
