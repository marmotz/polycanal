import { action, type Client, type Interceptor, input } from '@polycanal/core';
import { describe, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { rest } from './binding.js';
import type { HttpRequest, HttpResponse } from './http.js';

describe('REST contracts', () => {
  it('checks path parameters against the input', () => {
    action({ transport: rest.get('/users/:id'), input: input({ id: z.string() }), output: z.void() });
    action({ transport: rest.get('/users/:id'), input: z.object({ id: z.string() }), output: z.void() });
    action({
      transport: rest.get('/users/:id'),
      input: input({ userId: { source: 'path', alias: 'id', schema: z.string() } }),
      output: z.void(),
    });

    // @ts-expect-error "id" is missing
    action({ transport: rest.get('/users/:id'), input: input({ userId: z.string() }), output: z.void() });
    // @ts-expect-error no input at all
    action({ transport: rest.get('/users/:id'), output: z.void() });
    // @ts-expect-error "tenant" is not a path parameter
    action({
      transport: rest.get('/users/:id'),
      input: input({ id: z.string(), tenant: { source: 'path', schema: z.string() } }),
      output: z.void(),
    });
    action({
      transport: rest.get('/x'),
      // @ts-expect-error "cookie" is not a REST source
      input: input({ id: { source: 'cookie', schema: z.string() } }),
      output: z.void(),
    });
  });

  it('types per-call interceptors with HttpRequest and HttpResponse', () => {
    const contract = { get: action({ transport: rest.get('/x'), output: z.string() }) };
    const server = {} as Client<typeof contract>;
    const interceptor: Interceptor<HttpRequest, HttpResponse> = (request, next) => next(request);

    expectTypeOf(server.get).toBeCallableWith(undefined, { interceptors: [interceptor] });
  });
});
