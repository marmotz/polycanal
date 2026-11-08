import { action, createClient, defineContract, type Interceptor, input, isPolycanalError } from '@polycanal/core';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { rest } from './binding.js';
import { fetchRest } from './fetch.js';
import { type HttpRequest, type HttpResponse, withHeaders } from './http.js';

const contract = defineContract({
  auth: {
    login: action({
      transport: rest.post('/auth/login'),
      input: z.object({ email: z.string(), password: z.string() }),
      output: z.object({ token: z.string() }),
      errors: { 401: z.object({ reason: z.string() }) },
    }),
  },
  households: {
    get: action({
      transport: rest.get('/households/:id'),
      input: input({ id: z.string() }),
      output: z.object({ id: z.string(), name: z.string() }),
    }),
    remove: action({
      transport: rest.delete('/households/:id', { status: 204 }),
      input: input({ id: z.string() }),
      output: z.void(),
    }),
  },
});

function fakeFetch(handler: (url: string, init: RequestInit) => Response) {
  return vi.fn<typeof fetch>(async (url, init) => handler(String(url), init ?? {}));
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

describe('fetchRest()', () => {
  it('calls fetch with the built request and returns the validated response', async () => {
    const fetchMock = fakeFetch(() => json({ token: 't' }));
    const server = createClient(contract, {
      drivers: [fetchRest({ baseUrl: 'https://api.test', fetch: fetchMock, credentials: 'include' })],
    });

    await expect(server.auth.login({ email: 'ada@example.com', password: 'pw' })).resolves.toEqual({ token: 't' });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://api.test/auth/login');
    expect(init).toMatchObject({
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: '{"email":"ada@example.com","password":"pw"}',
      credentials: 'include',
    });
  });

  it('passes the abort signal', async () => {
    const fetchMock = fakeFetch(() => json({ id: 'h1', name: 'Home' }));
    const server = createClient(contract, { drivers: [fetchRest({ fetch: fetchMock })] });
    const controller = new AbortController();

    await server.households.get({ id: 'h1' }, { signal: controller.signal });

    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  });

  it('maps error statuses to server errors with validated bodies', async () => {
    const server = createClient(contract, {
      drivers: [fetchRest({ fetch: fakeFetch(() => json({ reason: 'bad password' }, 401)) })],
    });

    const error = await server.auth.login({ email: 'a', password: 'b' }).catch((caught: unknown) => caught);

    expect(isPolycanalError(error, { kind: 'server', key: 401 })).toBe(true);
    expect(error).toMatchObject({ data: { reason: 'bad password' }, response: { status: 401 } });
  });

  it('honors the success status of the binding', async () => {
    const empty = createClient(contract, {
      drivers: [fetchRest({ fetch: fakeFetch(() => new Response(null, { status: 204 })) })],
    });
    const ok = createClient(contract, { drivers: [fetchRest({ fetch: fakeFetch(() => json({}, 200)) })] });

    await expect(empty.households.remove({ id: 'h1' })).resolves.toBeUndefined();
    await expect(ok.households.remove({ id: 'h1' })).rejects.toMatchObject({ kind: 'server', key: '200' });
  });

  it('keeps bodies of another content type as text', async () => {
    const server = createClient(contract, {
      drivers: [
        fetchRest({
          fetch: fakeFetch(
            () => new Response('Bad gateway', { status: 502, headers: { 'content-type': 'text/plain' } }),
          ),
        }),
      ],
    });

    await expect(server.households.get({ id: 'h1' })).rejects.toMatchObject({
      kind: 'server',
      key: '502',
      data: 'Bad gateway',
    });
  });

  it('reports undecodable bodies as transport errors', async () => {
    const server = createClient(contract, {
      drivers: [
        fetchRest({ fetch: fakeFetch(() => new Response('{', { headers: { 'content-type': 'application/json' } })) }),
      ],
    });

    const error = await server.households.get({ id: 'h1' }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ kind: 'transport' });
    expect((error as Error).cause).toBeInstanceOf(TypeError);
    expect(((error as Error).cause as Error).message).toBe('response body is not valid application/json (status 200)');
  });

  it('reports network failures as transport errors', async () => {
    const server = createClient(contract, {
      drivers: [
        fetchRest({
          fetch: vi.fn<typeof fetch>(() => Promise.reject(new TypeError('fetch failed'))),
        }),
      ],
    });

    await expect(server.households.get({ id: 'h1' })).rejects.toMatchObject({
      kind: 'transport',
      message: 'households.get: could not send the request',
    });
  });

  it('adds static and computed driver headers', async () => {
    const fetchMock = fakeFetch(() => json({ id: 'h1', name: 'Home' }));
    let token = 'a';
    const server = createClient(contract, {
      drivers: [fetchRest({ fetch: fetchMock, headers: () => ({ Authorization: `Bearer ${token}` }) })],
    });

    await server.households.get({ id: 'h1' });
    token = 'b';
    await server.households.get({ id: 'h1' });

    expect(
      fetchMock.mock.calls.map(([, init]) => (init?.headers as Record<string, string> | undefined)?.authorization),
    ).toEqual(['Bearer a', 'Bearer b']);
  });

  it('runs typed interceptors that can refresh a token and replay', async () => {
    const fetchMock = fakeFetch((_, init) =>
      (init.headers as Record<string, string>).authorization === 'Bearer fresh'
        ? json({ id: 'h1', name: 'Home' })
        : json({}, 401),
    );
    const refresh: Interceptor<HttpRequest, HttpResponse> = async (request, next) => {
      const response = await next(withHeaders(request, { Authorization: 'Bearer stale' }));

      return response.status === 401 ? next(withHeaders(request, { Authorization: 'Bearer fresh' })) : response;
    };
    const server = createClient(contract, { drivers: [fetchRest({ fetch: fetchMock, interceptors: [refresh] })] });

    await expect(server.households.get({ id: 'h1' })).resolves.toEqual({ id: 'h1', name: 'Home' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('uses the codec of the operation', async () => {
    const upper = {
      contentType: 'text/x-upper',
      encode: (value: unknown) => String(value).toUpperCase(),
      decode: (text: string) => text.toLowerCase(),
    };
    const shout = defineContract({
      shout: action({
        transport: rest.post('/shout'),
        input: input({ text: { source: 'body', root: true, schema: z.string() } }),
        output: z.string(),
        codec: upper,
      }),
    });
    const fetchMock = fakeFetch(() => new Response('HELLO', { headers: { 'content-type': 'text/x-upper' } }));
    const server = createClient(shout, { drivers: [fetchRest({ fetch: fetchMock })] });

    await expect(server.shout({ text: 'hello' })).resolves.toBe('hello');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      body: 'HELLO',
      headers: { 'content-type': 'text/x-upper', accept: 'text/x-upper' },
    });
  });
});
