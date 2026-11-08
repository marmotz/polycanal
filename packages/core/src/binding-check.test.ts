import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { restPath } from './__fixtures__/bindings.js';
import { action } from './definition.js';
import { ContractDefinitionError } from './errors.js';
import { input } from './input.js';

describe('fields required by a binding', () => {
  it('accepts a required field left to the default rules or with the required source', () => {
    expect(() =>
      action({
        transport: restPath('PATCH', '/households/:householdId/members/:userId'),
        input: input({
          householdId: z.string(),
          userId: { source: 'path', schema: z.string() },
          role: z.string(),
        }),
        output: z.void(),
      }),
    ).not.toThrow();
  });

  it('matches required fields by wire name', () => {
    expect(() =>
      action({
        transport: restPath('GET', '/users/:id'),
        input: input({ userId: { source: 'path', alias: 'id', schema: z.string() } }),
        output: z.void(),
      }),
    ).not.toThrow();
  });

  it('accepts a plain object schema, only checked at compile time', () => {
    expect(() =>
      action({ transport: restPath('GET', '/users/:id'), input: z.object({ id: z.string() }), output: z.void() }),
    ).not.toThrow();
  });

  it('checks the keys of a plain object schema at compile time only', () => {
    const create = () =>
      // @ts-expect-error the object schema has no "id" key
      action({ transport: restPath('GET', '/users/:id'), input: z.object({ userId: z.string() }), output: z.void() });

    expect(create).not.toThrow();
  });

  it('rejects an action without input', () => {
    // @ts-expect-error the binding requires an "id" field
    const create = () => action({ transport: restPath('GET', '/users/:id'), output: z.void() });

    expect(create).toThrow(ContractDefinitionError);
    expect(create).toThrow('binding requires the input fields "id"');
  });

  it('rejects a missing required field', () => {
    const create = () =>
      // @ts-expect-error the "id" field is missing
      action({
        transport: restPath('GET', '/users/:id'),
        input: input({ userId: z.string() }),
        output: z.void(),
      });

    expect(create).toThrow('input is missing the field "id" (source "path") required by driver "test-rest"');
  });

  it('rejects a required field mapped to another source', () => {
    const create = () =>
      // @ts-expect-error "id" must go to the path
      action({
        transport: restPath('GET', '/users/:id'),
        input: input({ id: { source: 'query', schema: z.string() } }),
        output: z.void(),
      });

    expect(create).toThrow('input is missing the field "id"');
  });

  it('rejects an explicit field in a closed source that the binding does not expect', () => {
    const create = () =>
      // @ts-expect-error "tenant" is not a path parameter
      action({
        transport: restPath('GET', '/users/:id'),
        input: input({ id: z.string(), tenant: { source: 'path', schema: z.string() } }),
        output: z.void(),
      });

    expect(create).toThrow(
      'input field "tenant" uses source "path" but "tenant" is not expected by driver "test-rest"',
    );
  });
});
