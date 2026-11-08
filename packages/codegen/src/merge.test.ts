import { rest } from '@polycanal/rest';
import { describe, expect, it } from 'vitest';
import type { ContractDescription } from './description.js';
import { mergeDescriptions } from './merge.js';

const op = (path: string[], binding = rest.get(`/${path.join('/')}`), output: boolean = true) =>
  ({ family: 'action', path, binding, output }) as const;

describe('mergeDescriptions()', () => {
  it('adds discovered operations missing from the config', () => {
    const config: ContractDescription = { operations: [op(['a'])] };
    const discovered: ContractDescription = { operations: [op(['b'])], schemas: { s: true } };

    expect(mergeDescriptions(config, discovered)).toEqual({
      description: { operations: [op(['a']), op(['b'])], schemas: { s: true } },
      conflicts: [],
    });
  });

  it('keeps the config operation and reports a different binding under the same id', () => {
    const config: ContractDescription = { operations: [op(['users', 'get'], rest.get('/users/:id'))] };
    const discovered: ContractDescription = { operations: [op(['users', 'get'], rest.get('/v2/users/:id'), false)] };
    const result = mergeDescriptions(config, discovered);

    expect(result.description.operations).toEqual(config.operations);
    expect(result.conflicts).toEqual([
      { operation: 'users.get', reason: 'config declares GET /users/:id, discovered GET /v2/users/:id' },
    ]);
  });

  it('accepts the same operation described identically by both sides', () => {
    const config: ContractDescription = { operations: [op(['users', 'get'], rest.get('/users/:id'))] };

    expect(mergeDescriptions(config, config).conflicts).toEqual([]);
  });

  it('reports a route discovered under another id', () => {
    const config: ContractDescription = { operations: [op(['users', 'get'], rest.get('/users/:id'))] };
    const discovered: ContractDescription = { operations: [op(['users', 'find'], rest.get('/users/:id'))] };
    const result = mergeDescriptions(config, discovered);

    expect(result.description.operations).toHaveLength(1);
    expect(result.conflicts).toEqual([
      { operation: 'users.get', reason: 'GET /users/:id is also discovered as "users.find"' },
    ]);
  });

  it('lets config schemas win', () => {
    expect(
      mergeDescriptions({ operations: [], schemas: { s: false } }, { operations: [], schemas: { s: true } }).description
        .schemas,
    ).toEqual({
      s: false,
    });
  });
});
