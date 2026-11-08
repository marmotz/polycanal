import { type JsonSchema, toJsonSchema, VOID_KEYWORD } from '@polycanal/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { zodDriver } from './index.js';

const context = {
  resolveRef: (ref: string) => `${ref.split('/').pop()}Schema`,
  isLazyRef: (ref: string) => ref.endsWith('/Node'),
};

const code = (schema: JsonSchema) => zodDriver.generate(schema, context).code;

/** Evaluates generated code with the real Zod, to check its behavior and not only its text. */
function evaluate(schema: JsonSchema): z.ZodType {
  return new Function('z', `return ${code(schema)};`)(z) as z.ZodType;
}

describe('zodDriver.generate()', () => {
  it('imports z from zod', () => {
    expect(zodDriver.generate({ type: 'string' }, context).imports).toEqual([{ from: 'zod', names: ['z'] }]);
  });

  it.each<[string, JsonSchema, string]>([
    ['true', true, 'z.unknown()'],
    ['false', false, 'z.never()'],
    ['an empty schema', {}, 'z.unknown()'],
    ['void', { [VOID_KEYWORD]: true }, 'z.void()'],
    ['a boolean', { type: 'boolean' }, 'z.boolean()'],
    ['null', { type: 'null' }, 'z.null()'],
    ['a string with bounds', { type: 'string', minLength: 1, maxLength: 3 }, 'z.string().min(1).max(3)'],
    ['a pattern', { type: 'string', pattern: "^a'b$" }, "z.string().regex(new RegExp('^a\\'b$'))"],
    ['a format', { type: 'string', format: 'email', pattern: '^x$' }, 'z.email()'],
    ['a date-time', { type: 'string', format: 'date-time' }, 'z.iso.datetime()'],
    ['an unknown format', { type: 'string', format: 'hostname' }, 'z.string()'],
    [
      'an integer without the safe bounds',
      { type: 'integer', minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER },
      'z.number().int()',
    ],
    [
      'a bounded number',
      { type: 'number', minimum: 0, exclusiveMaximum: 1, multipleOf: 0.5 },
      'z.number().min(0).lt(1).multipleOf(0.5)',
    ],
    ['a const', { const: 'a' }, "z.literal('a')"],
    ['a null const', { const: null }, 'z.null()'],
    ['a string enum', { enum: ['admin', 'member'] }, "z.enum(['admin', 'member'])"],
    ['a mixed enum', { enum: [1, 'a', null] }, "z.union([z.literal(1), z.literal('a'), z.null()])"],
    ['a single value enum', { enum: [3] }, 'z.literal(3)'],
    ['a type list', { type: ['string', 'null'] }, 'z.string().nullable()'],
    ['a multi-type list', { type: ['string', 'number'] }, 'z.union([z.string(), z.number()])'],
    ['an OpenAPI 3.0 nullable', { type: 'string', nullable: true }, 'z.string().nullable()'],
    ['an anyOf with null', { anyOf: [{ type: 'string' }, { type: 'null' }] }, 'z.string().nullable()'],
    ['a oneOf', { oneOf: [{ type: 'string' }, { type: 'number' }] }, 'z.union([z.string(), z.number()])'],
    [
      'an allOf',
      { allOf: [{ $ref: '#/components/schemas/A' }, { $ref: '#/components/schemas/B' }] },
      'z.intersection(ASchema, BSchema)',
    ],
    ['a ref', { $ref: '#/components/schemas/User' }, 'UserSchema'],
    ['a lazy ref', { $ref: '#/components/schemas/Node' }, 'z.lazy(() => NodeSchema)'],
    ['an array', { type: 'array', items: { type: 'string' }, minItems: 1 }, 'z.array(z.string()).min(1)'],
    ['an array without items', { type: 'array' }, 'z.array(z.unknown())'],
    [
      'a tuple',
      { type: 'array', prefixItems: [{ type: 'string' }, { type: 'number' }] },
      'z.tuple([z.string(), z.number()])',
    ],
    ['a record', { type: 'object', additionalProperties: { type: 'number' } }, 'z.record(z.string(), z.number())'],
    ['an empty object', { type: 'object', properties: {}, additionalProperties: false }, 'z.object({})'],
    ['a default', { type: 'integer', default: 1 }, 'z.number().int().default(1)'],
  ])('generates %s', (_, schema, expected) => {
    expect(code(schema)).toBe(expected);
  });

  it('generates multi-line objects with optional and quoted keys', () => {
    expect(
      code({
        type: 'object',
        properties: {
          id: { type: 'string' },
          'x-tenant': { type: 'string' },
          page: { type: 'integer', default: 1 },
          address: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
        },
        required: ['id'],
        additionalProperties: false,
      }),
    ).toBe(
      [
        'z.object({',
        '  id: z.string(),',
        "  'x-tenant': z.string().optional(),",
        '  page: z.number().int().default(1),',
        '  address: z.object({',
        '    city: z.string(),',
        '  }).optional(),',
        '})',
      ].join('\n'),
    );
  });

  it('generates catchall for typed additional properties', () => {
    expect(
      code({ properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: { type: 'number' } }),
    ).toBe('z.object({\n  id: z.string(),\n}).catchall(z.number())');
  });

  it('wraps long unions on several lines', () => {
    expect(code({ anyOf: Array.from({ length: 6 }, (_, index) => ({ const: `value-number-${index}` })) })).toContain(
      "z.union([\n  z.literal('value-number-0'),\n",
    );
  });

  it('makes generated code optional', () => {
    expect(zodDriver.optional({ code: 'z.string()', imports: [] })).toEqual({
      code: 'z.string().optional()',
      imports: [],
    });
  });

  it('round-trips Zod schemas through JSON Schema', () => {
    const original = z.object({
      id: z.uuid(),
      email: z.email(),
      role: z.enum(['admin', 'member']),
      age: z.number().int().min(0),
      tags: z.array(z.string()).optional(),
      nickname: z.string().nullable(),
    });
    const generated = evaluate(toJsonSchema(original, 'output') as JsonSchema);
    const valid = {
      id: '0b8a7b8e-4c2f-4c8e-9a35-2f1f3d5c6b7a',
      email: 'ada@example.com',
      role: 'admin',
      age: 36,
      nickname: null,
    };

    expect(generated.safeParse(valid).success).toBe(true);
    expect(generated.safeParse({ ...valid, role: 'owner' }).success).toBe(false);
    expect(generated.safeParse({ ...valid, email: 'nope' }).success).toBe(false);
    expect(generated.safeParse({ ...valid, age: 1.5 }).success).toBe(false);
    expect(generated.safeParse({ ...valid, nickname: undefined }).success).toBe(false);
  });

  it('keeps input defaults when generating from the input side', () => {
    const generated = evaluate(toJsonSchema(z.object({ page: z.number().int().default(1) }), 'input') as JsonSchema);

    expect(generated.parse({})).toEqual({ page: 1 });
  });
});
