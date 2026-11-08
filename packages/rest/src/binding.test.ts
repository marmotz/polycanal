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
      body: undefined,
      response: undefined,
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

  it('keeps the body and response options as plain data', () => {
    const binding = rest.post('/photos', { body: 'multipart', response: 'blob' });

    expect(binding.body).toBe('multipart');
    expect(binding.response).toBe('blob');
    expect(rest.get('/photos/:id', { response: 'blob' }).response).toBe('blob');
  });

  it('rejects a multipart body on GET and DELETE, and unknown options', () => {
    expect(() => rest.get('/x', { body: 'multipart' })).toThrow('rest: GET "/x" cannot send a multipart body');
    expect(() => rest.delete('/x', { body: 'multipart' })).toThrow('rest: DELETE "/x" cannot send a multipart body');
    expect(() => rest.post('/x', { body: 'xml' as 'multipart' })).toThrow('unknown body encoding "xml"');
    expect(() => rest.get('/x', { response: 'stream' as 'blob' })).toThrow('unknown response kind "stream"');
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
