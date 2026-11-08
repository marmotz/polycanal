import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { StandardSchemaV1 } from './schema.js';
import { toJsonSchema, VOID_KEYWORD } from './validation.js';

describe('toJsonSchema()', () => {
  const schema = z.object({ id: z.string(), page: z.number().int().default(1) });

  it('converts through Standard JSON Schema, without the $schema keyword', () => {
    const output = toJsonSchema(schema, 'output');

    expect(output).toMatchObject({ type: 'object', required: ['id', 'page'] });
    expect(output).not.toHaveProperty('$schema');
  });

  it('distinguishes the input and output sides', () => {
    expect(toJsonSchema(schema, 'input')).toMatchObject({ required: ['id'] });
  });

  it('converts a void schema to the void marker', () => {
    expect(toJsonSchema(z.void(), 'output')).toEqual({ [VOID_KEYWORD]: true });
    expect(toJsonSchema(z.undefined(), 'output')).toEqual({ [VOID_KEYWORD]: true });
  });

  it('returns undefined for schemas without JSON Schema support', () => {
    const opaque: StandardSchemaV1<string> = {
      '~standard': { version: 1, vendor: 'custom', validate: (value) => ({ value: String(value) }) },
    };

    expect(toJsonSchema(opaque, 'output')).toBeUndefined();
  });
});
