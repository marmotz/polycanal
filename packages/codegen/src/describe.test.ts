import { action, defineContract, input, VOID_KEYWORD } from '@polycanal/core';
import { rest } from '@polycanal/rest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { acceptsUndefined, describeContract, describeSchema } from './describe.js';

describe('describeContract()', () => {
  it('describes inputs from the input side and outputs from the output side', () => {
    const description = describeContract(
      defineContract({
        search: action({
          transport: rest.get('/search'),
          input: input({ q: z.string(), page: z.number().default(1), tags: z.array(z.string()).optional() }),
          output: z.object({ page: z.number().default(1) }),
          errors: { 400: z.object({ message: z.string() }) },
        }),
        ping: action({ transport: rest.post('/ping'), input: z.object({ at: z.string() }), output: z.void() }),
      }),
    );
    const [search, ping] = description.operations;

    expect(search).toMatchObject({
      family: 'action',
      path: ['search'],
      binding: { driver: 'rest', method: 'GET', path: '/search' },
      input: {
        kind: 'fields',
        fields: [
          { name: 'q', required: true, schema: { type: 'string' } },
          { name: 'page', required: false, schema: { type: 'number', default: 1 } },
          { name: 'tags', required: false },
        ],
      },
      output: { required: ['page'] },
      errors: { 400: { type: 'object' } },
    });
    expect(ping).toMatchObject({
      input: { kind: 'schema', schema: { type: 'object' } },
      output: { [VOID_KEYWORD]: true },
    });
  });

  it('keeps sources, aliases and root fields', () => {
    const [operation] = describeContract({
      op: action({
        transport: rest.post('/x/:id'),
        input: input({
          id: { source: 'path', schema: z.string() },
          to: { source: 'body', alias: 'id', schema: z.string() },
          items: { source: 'query', root: true, schema: z.object({ a: z.string() }) },
        }),
        output: z.void(),
      }),
    }).operations;

    expect(operation?.family === 'action' && operation.input).toMatchObject({
      fields: [
        { name: 'id', source: 'path' },
        { name: 'to', source: 'body', alias: 'id' },
        { name: 'items', source: 'query', root: true },
      ],
    });
  });

  it('fails with the location on schemas without JSON Schema support', () => {
    const opaque = {
      '~standard': { version: 1 as const, vendor: 'custom', validate: (value: unknown) => ({ value }) },
    };

    expect(() => describeContract({ op: action({ transport: rest.get('/x'), output: opaque }) })).toThrow(
      'op output: the schema cannot be converted to JSON Schema',
    );
    expect(() => describeSchema(opaque, 'input', 'somewhere')).toThrow('somewhere: the schema cannot be converted');
  });

  it('detects optional schemas', () => {
    expect(acceptsUndefined(z.string().optional())).toBe(true);
    expect(acceptsUndefined(z.number().default(1))).toBe(true);
    expect(acceptsUndefined(z.string())).toBe(false);
  });
});
