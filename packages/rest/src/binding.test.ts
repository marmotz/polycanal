import { describe, expect, expectTypeOf, it } from 'vitest';
import { isRestBinding, type PathParams, pathParams, rest } from './binding.js';

describe('rest bindings', () => {
  it('describes the method, the path and the path parameters', () => {
    const binding = rest.patch('/households/:householdId/members/:userId');

    expect(binding).toEqual({
      driver: 'rest',
      family: 'action',
      sources: ['path', 'query', 'body', 'header'],
      method: 'PATCH',
      path: '/households/:householdId/members/:userId',
      status: undefined,
      requires: { householdId: 'path', userId: 'path' },
    });
    expect(isRestBinding(binding)).toBe(true);
    expect(isRestBinding({ driver: 'ws' })).toBe(false);
  });

  it.each([
    ['get', 'GET'],
    ['post', 'POST'],
    ['put', 'PUT'],
    ['patch', 'PATCH'],
    ['delete', 'DELETE'],
  ] as const)('rest.%s() binds %s', (factory, method) => {
    expect(rest[factory]('/x').method).toBe(method);
  });

  it('normalizes the success status option', () => {
    expect(rest.post('/x', { status: 201 }).status).toEqual([201]);
    expect(rest.post('/x', { status: [200, 204] }).status).toEqual([200, 204]);
  });

  it('rejects paths without leading slash and invalid parameters', () => {
    expect(() => rest.get('users')).toThrow('rest: path "users" must start with "/"');
    expect(() => rest.get('/users/:')).toThrow('invalid path parameter ":"');
    expect(() => rest.get('/users/:id-x')).toThrow('invalid path parameter ":id-x"');
  });

  it('extracts path parameters', () => {
    expect(pathParams('/a/:b/c/:d')).toEqual(['b', 'd']);
    expect(pathParams('/')).toEqual([]);
  });

  it('types the path parameters', () => {
    expectTypeOf<PathParams<'/households/:householdId/members/:userId'>>().toEqualTypeOf<'householdId' | 'userId'>();
    expectTypeOf<PathParams<'/households'>>().toEqualTypeOf<never>();
    expectTypeOf(rest.get('/users/:id').requires).toEqualTypeOf<{ readonly id: 'path' }>();
  });
});
