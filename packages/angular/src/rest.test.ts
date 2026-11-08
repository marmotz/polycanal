import { HttpClient, type HttpInterceptorFn, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { action, createClient, defineContract, input, isPolycanalError } from '@polycanal/core';
import { rest } from '@polycanal/rest';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { angularRest, injectAngularRest } from './rest.js';

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
  },
});

const tenant: HttpInterceptorFn = (request, next) => next(request.clone({ setHeaders: { 'X-Tenant': 't1' } }));

function setup(options: Parameters<typeof angularRest>[1] = {}) {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(withInterceptors([tenant])), provideHttpClientTesting()],
  });

  return {
    server: createClient(contract, {
      drivers: [angularRest(TestBed.inject(HttpClient), { baseUrl: '/api', ...options })],
    }),
    backend: TestBed.inject(HttpTestingController),
  };
}

afterEach(() => TestBed.inject(HttpTestingController).verify());

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

  it('sends the encoded body with its content type', async () => {
    const { server, backend } = setup({ withCredentials: true });

    const pending = server.households.rename({ id: 'h1', name: 'Home' });
    await flushMicrotasks();
    const request = backend.expectOne('/api/households/h1');
    request.flush('', { status: 204, statusText: 'No Content' });

    await expect(pending).resolves.toBeUndefined();
    expect(request.request.body).toBe('{"name":"Home"}');
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
