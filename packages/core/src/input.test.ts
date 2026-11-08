import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ContractDefinitionError } from './errors.js';
import { input, isInputDefinition } from './input.js';
import type { StandardSchemaV1 } from './schema.js';

async function validate(schema: StandardSchemaV1, value: unknown) {
  return schema['~standard'].validate(value);
}

describe('input()', () => {
  it('normalizes shorthand and descriptor fields', () => {
    const definition = input({
      householdId: z.string(),
      userId: { source: 'path', schema: z.string() },
      toUserId: { source: 'body', alias: 'userId', schema: z.string() },
      members: { source: 'query', root: true, schema: z.array(z.string()) },
    });

    expect(definition.kind).toBe('input');
    expect(isInputDefinition(definition)).toBe(true);
    expect(definition.fields.map(({ schema: _, ...field }) => field)).toEqual([
      { name: 'householdId', wireName: 'householdId', source: undefined, root: false },
      { name: 'userId', wireName: 'userId', source: 'path', root: false },
      { name: 'toUserId', wireName: 'userId', source: 'body', root: false },
      { name: 'members', wireName: 'members', source: 'query', root: true },
    ]);
  });

  it('is a Standard Schema validating the whole call object', async () => {
    const definition = input({
      id: z.string(),
      page: z.number().int().default(1),
      search: z.string().optional(),
    });

    expect(await validate(definition, { id: 'p1', extra: true })).toEqual({ value: { id: 'p1', page: 1 } });
    expect(await validate(definition, { id: 'p1', page: 2, search: 'ada' })).toEqual({
      value: { id: 'p1', page: 2, search: 'ada' },
    });
  });

  it('prefixes issue paths with the field name', async () => {
    const definition = input({
      id: z.string(),
      filter: { source: 'query', schema: z.object({ role: z.enum(['admin', 'member']) }) },
    });

    const result = await validate(definition, { id: 1, filter: { role: 'owner' } });

    expect(result.issues?.map((issue) => issue.path)).toEqual([['id'], ['filter', 'role']]);
  });

  it('rejects values that are not objects', async () => {
    const definition = input({ id: z.string() });

    for (const value of [null, 'id', ['id'], 42]) {
      expect(await validate(definition, value)).toEqual({ issues: [{ message: 'Expected an object' }] });
    }
  });

  it('validates synchronously when every field schema is synchronous', () => {
    const definition = input({ id: z.string() });

    expect(definition['~standard'].validate({ id: 'a' })).toEqual({ value: { id: 'a' } });
  });

  it('supports asynchronous field schemas', async () => {
    const definition = input({
      id: z.string().refine(async (value) => value.startsWith('u'), 'unknown id'),
    });

    const pending = definition['~standard'].validate({ id: 'x1' });

    expect(pending).toBeInstanceOf(Promise);
    expect((await pending).issues?.[0]).toMatchObject({ message: 'unknown id', path: ['id'] });
  });

  it.each([
    ['an empty field name', { '': z.string() }, 'input field names must not be empty'],
    ['a field that is not a schema', { id: 'string' }, 'must be a Standard Schema or a { schema } descriptor'],
    ['a descriptor without schema', { id: { source: 'path' } }, 'must be a Standard Schema or a { schema } descriptor'],
    ['an empty source', { id: { source: '', schema: z.string() } }, 'has an invalid source'],
    ['an empty alias', { id: { alias: '', schema: z.string() } }, 'has an invalid alias'],
    ['a root field without source', { id: { root: true, schema: z.string() } }, 'must declare its source'],
    [
      'a root field sharing its source',
      {
        items: { source: 'body', root: true, schema: z.array(z.string()) },
        id: { source: 'body', schema: z.string() },
      },
      'is the root of source "body"',
    ],
    [
      'two fields with the same wire name in a source',
      {
        userId: { source: 'body', schema: z.string() },
        toUserId: { source: 'body', alias: 'userId', schema: z.string() },
      },
      'both map to "userId" in source "body"',
    ],
  ])('rejects %s', (_, fields, message) => {
    expect(() => input(fields as never)).toThrow(ContractDefinitionError);
    expect(() => input(fields as never)).toThrow(message);
  });

  it('accepts the same wire name in different sources', () => {
    expect(() =>
      input({
        userId: { source: 'path', schema: z.string() },
        toUserId: { source: 'body', alias: 'userId', schema: z.string() },
      }),
    ).not.toThrow();
  });
});
