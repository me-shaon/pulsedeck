import { describe, it, expect } from 'vitest';
import type { ZodObject, ZodRawShape } from 'zod';
import {
  schemaInfo,
  getSchemaInfo,
  blockSchemasByType,
  BLOCK_TYPES,
  LIMITS,
  SCHEMA_VERSION,
} from '../src/index.js';

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

  // Drift guard: the hand-authored descriptor must match the real Zod schema for
  // every block — same field names, same required/optional flags. Adding a field
  // to a block schema without updating the descriptor fails here.
  it.each([...BLOCK_TYPES])('descriptor fields match the Zod schema for %s', (type) => {
    const described = schemaInfo.blocks.find((b) => b.type === type);
    expect(described, `descriptor missing block ${type}`).toBeDefined();

    const shape = (blockSchemasByType[type] as ZodObject<ZodRawShape>).shape;
    const schemaFields = Object.keys(shape).sort();
    const describedFields = described!.fields.map((f) => f.name).sort();
    expect(describedFields).toEqual(schemaFields);

    for (const field of described!.fields) {
      const required = !shape[field.name].isOptional();
      expect(field.required, `${type}.${field.name} required mismatch`).toBe(required);
    }
  });

  // Enum arrays in the descriptor are derived from the Zod enums, so they match
  // exactly — but assert the wiring so a future hand-edit can't silently diverge.
  it('enum values match the canonical enums', () => {
    expect(schemaInfo.enums.severity).toEqual(['info', 'warning', 'critical']);
    expect(schemaInfo.enums.status).toEqual(['healthy', 'degraded', 'down', 'unknown']);
    expect(schemaInfo.enums.column_type).toEqual(['string', 'number', 'date']);
  });

  it('getSchemaInfo returns the descriptor', () => {
    expect(getSchemaInfo()).toBe(schemaInfo);
  });
});
