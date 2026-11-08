import {
  HttpClient,
  HttpContext,
  HttpContextToken,
  type HttpInterceptorFn,
  HttpResponse,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { action, type Codec, createClient, defineContract, input, isPolycanalError } from '@polycanal/core';
import { rest } from '@polycanal/rest';
import { tap } from 'rxjs';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { angularRest, injectAngularRest } from './rest.js';

const csv: Codec = { contentType: 'text/csv', encode: (value) => JSON.stringify(value), decode: (text) => text };

const contract = defineContract({
  households: {
    get: action({
      transport: rest.get('/households/:id'),
      input: input({ id: z.string(), expand: z.boolean().optional() }),
      output: z.object({ id: z.string(), name: z.string() }),
      errors: { 404: z.object({ message: z.string() }) },
    }),
    rename: action({
      transport: rest.patch('/households/:id'),
      input: input({ id: z.string(), name: z.string() }),
      output: z.void(),
    }),
    note: action({
      transport: rest.get('/households/:id/note'),
      input: input({ id: z.string() }),
      output: z.unknown(),
    }),
    export: action({
      transport: rest.post('/households/:id/export'),
      input: input({ id: z.string(), format: z.string() }),
      output: z.string(),
      codec: csv,
    }),
  },
});

/** Context token read by an application interceptor. */
const TRACE = new HttpContextToken<string>(() => 'none');

/** What the application's Angular interceptors saw, request and response bodies included. */
const seen: { body: unknown; trace: string; response: unknown }[] = [];
const recorder: HttpInterceptorFn = (request, next) => {
  const entry = { body: request.body, trace: request.context.get(TRACE), response: undefined as unknown };
  seen.push(entry);

  return next(request).pipe(
    tap({
      next: (event) => {
        if (event instanceof HttpResponse) {
          entry.response = event.body;
        }
      },
      error: (error: unknown) => {
        entry.response = (error as { error: unknown }).error;
      },
    }),
  );
};

const tenant: HttpInterceptorFn = (request, next) => next(request.clone({ setHeaders: { 'X-Tenant': 't1' } }));

function setup(options: Parameters<typeof angularRest>[1] = {}) {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(withInterceptors([tenant, recorder])), provideHttpClientTesting()],
  });

  return {
    server: createClient(contract, {
      drivers: [angularRest(TestBed.inject(HttpClient), { baseUrl: '/api', ...options })],
    }),
    backend: TestBed.inject(HttpTestingController),
  };
}

afterEach(() => {
  TestBed.inject(HttpTestingController).verify();
  seen.length = 0;
});

/** Lets the client validate the input and hand the request to HttpClient. */
const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve));

describe('angularRest()', () => {
  it('sends through HttpClient, Angular interceptors included', async () => {
    const { server, backend } = setup();

    const pending = server.households.get({ id: 'h1', expand: true });
    await flushMicrotasks();
    const request = backend.expectOne('/api/households/h1?expand=true');
    request.flush('{"id":"h1","name":"Home","extra":1}', { headers: { 'Content-Type': 'application/json' } });

    await expect(pending).resolves.toEqual({ id: 'h1', name: 'Home' });
    expect(request.request.method).toBe('GET');
    expect(request.request.headers.get('X-Tenant')).toBe('t1');
    expect(request.request.headers.get('accept')).toBe('application/json');
    expect(request.request.withCredentials).toBe(false);
  });

  it('sends a JSON body as a value, with its content type', async () => {
    const { server, backend } = setup({ withCredentials: true });

    const pending = server.households.rename({ id: 'h1', name: 'Home' });
    await flushMicrotasks();
    const request = backend.expectOne('/api/households/h1');
    request.flush('', { status: 204, statusText: 'No Content' });

    await expect(pending).resolves.toBeUndefined();
    expect(request.request.body).toEqual({ name: 'Home' });
    expect(request.request.headers.get('content-type')).toBe('application/json');
    expect(request.request.withCredentials).toBe(true);
  });

  it('turns HTTP error responses into server errors', async () => {
    const { server, backend } = setup();

    const pending = server.households.get({ id: 'h2' }).catch((error: unknown) => error);
    await flushMicrotasks();
    backend.expectOne('/api/households/h2').flush('{"message":"not found"}', {
      status: 404,
      statusText: 'Not Found',
      headers: { 'content-type': 'application/json' },
    });

    const error = await pending;
    expect(isPolycanalError(error, { kind: 'server', key: 404 })).toBe(true);
    expect(error).toMatchObject({ data: { message: 'not found' } });
  });

  it('lets Angular interceptors see JSON bodies as values, as with a direct HttpClient call', async () => {
    const { server, backend } = setup();

    const renamed = server.households.rename({ id: 'h1', name: 'Home' });
    await flushMicrotasks();
    backend.expectOne('/api/households/h1').flush(null, { status: 204, statusText: 'No Content' });
    await renamed;

    const read = server.households.get({ id: 'h1' });
    await flushMicrotasks();
    backend.expectOne('/api/households/h1').flush({ id: 'h1', name: 'Home' });
    await read;

    const missing = server.households.get({ id: 'h2' }).catch(() => undefined);
    await flushMicrotasks();
    backend.expectOne('/api/households/h2').flush({ message: 'not found' }, { status: 404, statusText: 'Not Found' });
    await missing;

    expect(seen.map(({ body, response }) => ({ body, response }))).toEqual([
      { body: { name: 'Home' }, response: null },
      { body: null, response: { id: 'h1', name: 'Home' } },
      { body: null, response: { message: 'not found' } },
    ]);
  });

  it('keeps a JSON null apart from an empty body', async () => {
    const { server, backend } = setup();

    const pending = server.households.note({ id: 'h1' });
    await flushMicrotasks();
    backend
      .expectOne('/api/households/h1/note')
      .flush(null, { status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' } });
    await expect(pending).resolves.toBeNull();

    const empty = server.households.note({ id: 'h1' });
    await flushMicrotasks();
    backend.expectOne('/api/households/h1/note').flush(null, { status: 200, statusText: 'OK' });
    await expect(empty).resolves.toBeUndefined();
  });

  it('keeps a 2xx body that is not JSON as text', async () => {
    const { server, backend } = setup();

    const pending = server.households.note({ id: 'h1' });
    await flushMicrotasks();
    backend.expectOne('/api/households/h1/note').flush('<p>hello</p>', { headers: { 'content-type': 'text/html' } });

    await expect(pending).resolves.toBe('<p>hello</p>');
  });

  it('exchanges text with HttpClient for another codec', async () => {
    const { server, backend } = setup();

    const pending = server.households.export({ id: 'h1', format: 'csv' });
    await flushMicrotasks();
    const request = backend.expectOne('/api/households/h1/export');
    expect(request.request.body).toBe('{"format":"csv"}');
    expect(request.request.responseType).toBe('text');
    request.flush('a,b', { headers: { 'content-type': 'text/csv' } });

    await expect(pending).resolves.toBe('a,b');
  });

  it('gives each request the HttpContext built from its call', async () => {
    const { server, backend } = setup({
      httpContext: (call) =>
        call.operation.id === 'households.get'
          ? new HttpContext().set(TRACE, `${call.operation.id}:${String(call.context.tag)}`)
          : undefined,
    });

    const read = server.households.get({ id: 'h1' }, { context: { tag: 't1' } });
    await flushMicrotasks();
    backend.expectOne('/api/households/h1').flush({ id: 'h1', name: 'Home' });
    await read;

    const renamed = server.households.rename({ id: 'h1', name: 'Home' });
    await flushMicrotasks();
    backend.expectOne('/api/households/h1').flush(null, { status: 204, statusText: 'No Content' });
    await renamed;

    expect(seen.map(({ trace }) => trace)).toEqual(['households.get:t1', 'none']);
  });

  it('turns network failures into transport errors', async () => {
    const { server, backend } = setup();

    const pending = server.households.get({ id: 'h3' }).catch((error: unknown) => error);
    await flushMicrotasks();
    backend.expectOne('/api/households/h3').error(new ProgressEvent('error'));

    expect(await pending).toMatchObject({ kind: 'transport' });
  });

  it('cancels the HttpClient request on abort', async () => {
    const { server, backend } = setup();
    const controller = new AbortController();

    const pending = server.households.get({ id: 'h4' }, { signal: controller.signal }).catch((error: unknown) => error);
    await flushMicrotasks();
    const request = backend.expectOne('/api/households/h4');
    controller.abort();

    expect(await pending).toMatchObject({ kind: 'transport' });
    expect(request.cancelled).toBe(true);
  });

  it('can be created from the injection context', () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });

    expect(TestBed.runInInjectionContext(() => injectAngularRest()).name).toBe('rest');
  });
});
