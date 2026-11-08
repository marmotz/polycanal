import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { restLike, wsLike } from './__fixtures__/bindings.js';
import {
  type MemoryHandler,
  type MemoryRequest,
  type MemoryResponse,
  memoryDriver,
} from './__fixtures__/memory-driver.js';
import { createClient } from './client.js';
import { defineContract } from './contract.js';
import { action, event } from './definition.js';
import { PolycanalError } from './errors.js';
import { input } from './input.js';
import type { SchemaValidator, StandardSchemaV1 } from './schema.js';
import type { Interceptor } from './transport.js';

const contract = defineContract({
  auth: {
    login: action({
      transport: restLike('POST', '/auth/login'),
      input: z.object({ email: z.email(), password: z.string() }),
      output: z.object({ token: z.string() }),
      errors: { 401: z.object({ reason: z.string() }) },
    }),
  },
  households: {
    list: action({ transport: restLike('GET', '/households'), output: z.array(z.string()) }),
    analyses: action({
      transport: restLike('GET', '/analyses'),
      input: input({ page: z.number().default(1) }),
      output: z.number(),
    }),
  },
  notifications: event({ transport: wsLike('notification'), receive: z.object({ text: z.string() }) }),
  chat: event({ transport: wsLike('chat'), send: z.object({ text: z.string().min(1) }) }),
});

async function rejection(promise: Promise<unknown>): Promise<PolycanalError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(PolycanalError);

    return error as PolycanalError;
  }

  throw new Error('expected a rejection');
}

function events() {
  const memory = memoryDriver(() => ({ status: 200, body: undefined }), { name: 'test-ws' });

  return { memory, server: createClient(contract, { drivers: [memory.driver] }) };
}

describe('createClient(): actions', () => {
  it('validates the input, sends it and returns the validated response', async () => {
    const memory = memoryDriver(() => ({ status: 200, body: { token: 't', extra: true } }));
    const server = createClient(contract, { drivers: { rest: memory.driver } });

    await expect(server.auth.login({ email: 'ada@example.com', password: 'pw' })).resolves.toEqual({ token: 't' });
    expect(memory.sent).toEqual([
      { operation: 'auth.login', input: { email: 'ada@example.com', password: 'pw' }, headers: {} },
    ]);
  });

  it('sends the argument as given, the server applying defaults and transforms', async () => {
    const memory = memoryDriver(() => ({ status: 200, body: 3 }));
    const server = createClient(contract, { drivers: [memory.driver] });

    await expect(server.households.analyses()).resolves.toBe(3);
    expect(memory.sent[0]?.input).toEqual({});
  });

  it('calls an action without input', async () => {
    const memory = memoryDriver(() => ({ status: 200, body: ['h1'] }));
    const server = createClient(contract, { drivers: [memory.driver] });

    await expect(server.households.list()).resolves.toEqual(['h1']);
    expect(memory.sent[0]?.input).toBeUndefined();
  });

  it('rejects an invalid input without sending anything', async () => {
    const memory = memoryDriver(() => ({ status: 200, body: { token: 't' } }));
    const server = createClient(contract, { drivers: [memory.driver] });

    const error = await rejection(server.auth.login({ email: 'not-an-email', password: 'pw' }));

    expect(error).toMatchObject({ kind: 'input', operation: 'auth.login', driver: 'test-rest' });
    expect(error.message).toBe('auth.login: invalid input');
    expect(error.issues?.[0]?.path).toEqual(['email']);
    expect(memory.sent).toHaveLength(0);
  });

  it('rejects a response that does not match the output schema', async () => {
    const memory = memoryDriver(() => ({ status: 200, body: { token: 42 } }));
    const server = createClient(contract, { drivers: [memory.driver] });

    const error = await rejection(server.auth.login({ email: 'ada@example.com', password: 'pw' }));

    expect(error).toMatchObject({ kind: 'output', response: { status: 200, body: { token: 42 } } });
    expect(error.issues?.[0]?.path).toEqual(['token']);
  });

  it('validates declared error bodies', async () => {
    const memory = memoryDriver(() => ({ status: 401, body: { reason: 'bad password', extra: 1 } }));
    const server = createClient(contract, { drivers: [memory.driver] });

    const error = await rejection(server.auth.login({ email: 'ada@example.com', password: 'pw' }));

    expect(error).toMatchObject({ kind: 'server', key: '401', data: { reason: 'bad password' }, issues: undefined });
    expect(error.message).toBe('auth.login: server error 401');
  });

  it('keeps the raw body of undeclared or invalid error bodies', async () => {
    const memory = memoryDriver(({ operation }) =>
      operation === 'auth.login' ? { status: 401, body: 'nope' } : { status: 500, body: 'boom' },
    );
    const server = createClient(contract, { drivers: [memory.driver] });

    const invalid = await rejection(server.auth.login({ email: 'ada@example.com', password: 'pw' }));
    const undeclared = await rejection(server.households.list());

    expect(invalid).toMatchObject({ kind: 'server', key: '401', data: 'nope' });
    expect(invalid.issues).toHaveLength(1);
    expect(undeclared).toMatchObject({ kind: 'server', key: '500', data: 'boom', issues: undefined });
  });

  it('wraps transport failures', async () => {
    const cause = new TypeError('fetch failed');
    const memory = memoryDriver(() => {
      throw cause;
    });
    const server = createClient(contract, { drivers: [memory.driver] });

    const error = await rejection(server.households.list());

    expect(error).toMatchObject({ kind: 'transport', message: 'households.list: could not send the request' });
    expect(error.cause).toBe(cause);
  });

  it('wraps prepare and read failures', async () => {
    const memory = memoryDriver(() => ({ status: 200, body: [] }));
    const base = memory.driver.action as NonNullable<typeof memory.driver.action>;
    const prepare = createClient(contract, {
      drivers: [{ ...memory.driver, action: { ...base, prepare: () => Promise.reject(new Error('x')) } }],
    });
    const read = createClient(contract, {
      drivers: [{ ...memory.driver, action: { ...base, read: () => Promise.reject(new Error('x')) } }],
    });

    expect(await rejection(prepare.households.list())).toMatchObject({
      kind: 'transport',
      message: 'households.list: could not prepare the request',
    });
    expect(await rejection(read.households.list())).toMatchObject({
      kind: 'transport',
      message: 'households.list: could not read the response',
      response: { status: 200, body: [] },
    });
  });

  it('fails when no driver carries the binding', async () => {
    const server = createClient(contract, { drivers: [] });

    expect(await rejection(server.households.list())).toMatchObject({
      kind: 'transport',
      message: 'households.list: no driver "test-rest" carrying actions was given to createClient()',
    });
  });

  it('passes the signal and the context to the driver', async () => {
    const handler = vi.fn<MemoryHandler>(() => ({ status: 200, body: [] }));
    const server = createClient(contract, { drivers: [memoryDriver(handler).driver] });
    const controller = new AbortController();

    await server.households.list(undefined, { signal: controller.signal, context: { tenant: 't1' } });

    expect(handler.mock.calls[0]?.[1]).toMatchObject({ signal: controller.signal, context: { tenant: 't1' } });
  });

  it('passes the progress callbacks to the driver', async () => {
    const handler = vi.fn<MemoryHandler>(() => ({ status: 200, body: [] }));
    const server = createClient(contract, { drivers: [memoryDriver(handler).driver] });
    const onUploadProgress = vi.fn();
    const onDownloadProgress = vi.fn();

    await server.households.list(undefined, { onUploadProgress, onDownloadProgress });

    const call = handler.mock.calls[0]?.[1];
    expect(call?.onUploadProgress).toBe(onUploadProgress);
    expect(call?.onDownloadProgress).toBe(onDownloadProgress);
  });

  it('leaves the progress callbacks out of the call when not given', async () => {
    const handler = vi.fn<MemoryHandler>(() => ({ status: 200, body: [] }));
    const server = createClient(contract, { drivers: [memoryDriver(handler).driver] });

    await server.households.list();

    const call = handler.mock.calls[0]?.[1];
    expect(call).not.toHaveProperty('onUploadProgress');
    expect(call).not.toHaveProperty('onDownloadProgress');
  });

  it('rejects a malformed contract', () => {
    expect(() => createClient({ broken: 1 } as never, { drivers: [] })).toThrow('broken: expected an action');
  });
});

describe('createClient(): interceptors', () => {
  type MemoryInterceptor = Interceptor<MemoryRequest, MemoryResponse>;

  const tag =
    (name: string, order: string[]): MemoryInterceptor =>
    async (request, next) => {
      order.push(`${name}>`);
      const response = await next({ ...request, headers: { ...request.headers, [name]: '1' } });
      order.push(`<${name}`);

      return response;
    };

  it('runs global, driver, operation and call interceptors, outermost first', async () => {
    const order: string[] = [];
    const memory = memoryDriver(() => ({ status: 200, body: [] }), { interceptors: [tag('driver', order)] });
    const server = createClient(contract, {
      drivers: [memory.driver],
      interceptors: [tag('global', order)],
      operations: {
        'households.list': { interceptors: [tag('operation', order)] },
        households: { interceptors: [tag('namespace', order)] },
        auth: { interceptors: [tag('other', order)] },
      },
    });

    await server.households.list(undefined, { interceptors: [tag('call', order)] });

    expect(order).toEqual([
      'global>',
      'driver>',
      'namespace>',
      'operation>',
      'call>',
      '<call',
      '<operation',
      '<namespace',
      '<driver',
      '<global',
    ]);
    expect(memory.sent[0]?.headers).toEqual({ global: '1', driver: '1', namespace: '1', operation: '1', call: '1' });
  });

  it('lets an interceptor replay a call, e.g. after refreshing a token', async () => {
    let token = 'expired';
    const memory = memoryDriver((request) =>
      request.headers.authorization === 'Bearer fresh' ? { status: 200, body: [] } : { status: 401, body: undefined },
    );
    const auth: MemoryInterceptor = async (request, next) => {
      const withToken = (value: string) => ({
        ...request,
        headers: { ...request.headers, authorization: `Bearer ${value}` },
      });
      const response = await next(withToken(token));

      if (response.status !== 401) {
        return response;
      }

      token = 'fresh';

      return next(withToken(token));
    };
    const server = createClient(contract, { drivers: [memory.driver], interceptors: [auth] });

    await expect(server.households.list()).resolves.toEqual([]);
    expect(memory.sent).toHaveLength(2);
  });

  it('lets an interceptor transform the response', async () => {
    const memory = memoryDriver(() => ({ status: 200, body: { data: ['h1'] } }));
    const unwrap: MemoryInterceptor = async (request, next) => {
      const response = await next(request);

      return { ...response, body: (response.body as { data: unknown }).data };
    };
    const server = createClient(contract, { drivers: [memory.driver], interceptors: [unwrap] });

    await expect(server.households.list()).resolves.toEqual(['h1']);
  });

  it('propagates errors thrown by interceptors unchanged', async () => {
    const custom = new Error('normalized');
    const server = createClient(contract, {
      drivers: [memoryDriver(() => ({ status: 200, body: [] })).driver],
      interceptors: [() => Promise.reject(custom)],
    });

    await expect(server.households.list()).rejects.toBe(custom);
  });

  it('gives interceptors the call and the driver name', async () => {
    const seen = vi.fn<MemoryInterceptor>((request, next) => next(request));
    const server = createClient(contract, {
      drivers: [memoryDriver(() => ({ status: 200, body: 2 })).driver],
      interceptors: [seen],
    });

    await server.households.analyses({ page: 2 });

    expect(seen.mock.calls[0]?.[2]).toMatchObject({ driver: 'test-rest', call: { input: { page: 2 } } });
    expect(seen.mock.calls[0]?.[2].call.operation.id).toBe('households.analyses');
  });
});

describe('createClient(): events', () => {
  it('publishes validated messages', async () => {
    const { memory, server } = events();

    await server.chat.publish({ text: 'hello' });

    expect(memory.published).toEqual([{ operation: 'chat', message: { text: 'hello' } }]);
    expect(await rejection(server.chat.publish({ text: '' }))).toMatchObject({ kind: 'input', operation: 'chat' });
    expect(memory.published).toHaveLength(1);
  });

  it('delivers validated messages and reports invalid ones', async () => {
    const { memory, server } = events();
    const listener = vi.fn();
    const onError = vi.fn();

    const unsubscribe = server.notifications.subscribe(listener, { onError });
    memory.emit('notifications', { text: 'hi', extra: 1 });
    memory.emit('notifications', { text: 42 });
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));

    expect(listener).toHaveBeenCalledWith({ text: 'hi' });
    expect(onError.mock.calls[0]?.[0]).toMatchObject({ kind: 'output', operation: 'notifications' });

    memory.fail('notifications', new Error('closed'));
    expect(onError.mock.calls[1]?.[0]).toMatchObject({
      kind: 'transport',
      message: 'notifications: subscription failed',
    });

    unsubscribe();
    memory.emit('notifications', { text: 'again' });
    await Promise.resolve();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('exposes publish and subscribe only when the schema exists', () => {
    const { server } = events();

    expect(Object.keys(server.notifications)).toEqual(['subscribe']);
    expect(Object.keys(server.chat)).toEqual(['publish']);
  });

  it('fails when no driver carries events', () => {
    const server = createClient(contract, { drivers: [] });

    expect(() => server.notifications.subscribe(() => {})).toThrow(
      'notifications: no driver "test-ws" carrying events was given to createClient()',
    );
  });
});

describe('createClient(): validator', () => {
  const upper: SchemaValidator = (schema, value) => {
    const result = schema['~standard'].validate(value) as StandardSchemaV1.Result<unknown>;

    return result.issues ? { issues: result.issues.map((issue) => ({ ...issue, message: 'INVALID' })) } : result;
  };

  it('runs input fields, responses and error bodies through the validator', async () => {
    const seen: unknown[] = [];
    const validator: SchemaValidator = (schema, value) => {
      seen.push(value);

      return schema['~standard'].validate(value);
    };
    const memory = memoryDriver(() => ({ status: 200, body: 3 }));
    const server = createClient(contract, { drivers: [memory.driver], validator });

    await server.households.analyses({ page: 2 });

    // input() runs each field through the validator, not the whole call object
    expect(seen).toEqual([2, 3]);
  });

  it('reports the issues of the validator', async () => {
    const memory = memoryDriver(() => ({ status: 200, body: { token: 't' } }));
    const server = createClient(contract, { drivers: [memory.driver], validator: upper });

    const error = await rejection(server.auth.login({ email: 'not-an-email', password: 'pw' }));

    expect(error.issues?.[0]).toMatchObject({ message: 'INVALID', path: ['email'] });
  });

  it('runs event messages through the validator', async () => {
    const memory = memoryDriver(() => ({ status: 200, body: undefined }), { name: 'test-ws' });
    const server = createClient(contract, { drivers: [memory.driver], validator: upper });

    const error = await rejection(server.chat.publish({ text: '' }));

    expect(error.issues?.[0]?.message).toBe('INVALID');
  });
});

describe('createClient(): mapError', () => {
  class AppError extends Error {
    constructor(readonly source: PolycanalError) {
      super(source.message);
    }
  }

  const mapError = (error: PolycanalError) => new AppError(error);

  it('throws what mapError returns for every kind of failure', async () => {
    const invalid = memoryDriver(() => ({ status: 200, body: { token: 't' } }));
    const server = createClient(contract, { drivers: [invalid.driver], mapError });

    const input = await server.auth.login({ email: 'x', password: 'pw' }).catch((error: unknown) => error);
    expect(input).toBeInstanceOf(AppError);
    expect((input as AppError).source.kind).toBe('input');

    const failing = memoryDriver(() => ({ status: 401, body: { reason: 'nope' } }));
    const other = createClient(contract, { drivers: [failing.driver], mapError });
    const server401 = await other.auth.login({ email: 'a@b.fr', password: 'pw' }).catch((error: unknown) => error);
    expect((server401 as AppError).source).toMatchObject({ kind: 'server', key: '401', data: { reason: 'nope' } });
  });

  it('maps the failures of event publications', async () => {
    const memory = memoryDriver(() => ({ status: 200, body: undefined }), { name: 'test-ws' });
    const server = createClient(contract, { drivers: [memory.driver], mapError });

    await expect(server.chat.publish({ text: '' })).rejects.toBeInstanceOf(AppError);
  });

  it('rethrows errors that are not PolycanalError untouched', async () => {
    const memory = memoryDriver(() => ({ status: 200, body: { token: 't' } }));
    const boom = new Error('boom');
    const server = createClient(contract, {
      drivers: [memory.driver],
      interceptors: [
        () => {
          throw boom;
        },
      ],
      mapError,
    });

    await expect(server.auth.login({ email: 'a@b.fr', password: 'pw' })).rejects.toBe(boom);
  });
});

describe('createClient(): send mode', () => {
  const sendContract = defineContract({
    users: {
      rename: action({
        transport: restLike('POST', '/users'),
        input: input({ name: z.string().trim(), page: z.number().default(1) }),
        output: z.unknown(),
      }),
      save: action({
        transport: restLike('POST', '/save'),
        input: z.object({ price: z.number().transform((euros) => euros * 100) }),
        output: z.unknown(),
      }),
      list: action({ transport: restLike('POST', '/list'), input: z.array(z.string()), output: z.unknown() }),
    },
    chat: event({ transport: wsLike('chat'), send: z.object({ text: z.string().trim() }) }),
  });

  it('sends the declared fields as given, without their defaults and transforms', async () => {
    const memory = memoryDriver(() => ({ status: 200, body: null }));
    const server = createClient(sendContract, { drivers: [memory.driver] });

    await server.users.rename({ name: '  Ada ', extra: true } as never);
    await server.users.save({ price: 12, extra: true } as never);
    await server.users.list(['a']);

    expect(memory.sent.map(({ input }) => input)).toEqual([{ name: '  Ada ' }, { price: 12 }, ['a']]);
  });

  it('sends the parsed value in parsed mode, for the client or an operation', async () => {
    const memory = memoryDriver(() => ({ status: 200, body: null }));
    const parsed = createClient(sendContract, { drivers: [memory.driver], send: 'parsed' });
    const mixed = createClient(sendContract, {
      drivers: [memory.driver],
      send: 'parsed',
      operations: { users: { send: 'raw' }, 'users.save': { send: 'parsed' } },
    });

    await parsed.users.rename({ name: '  Ada ' });
    await mixed.users.rename({ name: '  Ada ' });
    await mixed.users.save({ price: 12 });

    expect(memory.sent.map(({ input }) => input)).toEqual([
      { name: 'Ada', page: 1 },
      { name: '  Ada ' },
      { price: 1200 },
    ]);
  });

  it('publishes event messages as given', async () => {
    const memory = memoryDriver(() => ({ status: 200, body: undefined }), { name: 'test-ws' });
    const server = createClient(sendContract, { drivers: [memory.driver] });

    await server.chat.publish({ text: ' hi ' });

    expect(memory.published).toEqual([{ operation: 'chat', message: { text: ' hi ' } }]);
  });
});

describe('createClient(): synchronous sending', () => {
  it('sends the request during the call when the schemas and the driver are synchronous', () => {
    const memory = memoryDriver(() => ({ status: 200, body: { token: 't' } }));
    const server = createClient(contract, {
      drivers: [memory.driver],
      interceptors: [(request, next) => next(request)],
    });

    const pending = server.auth.login({ email: 'ada@example.com', password: 'pw' });

    expect(memory.sent).toHaveLength(1);
    return expect(pending).resolves.toEqual({ token: 't' });
  });

  it('waits for an async schema before sending', async () => {
    const asyncContract = defineContract({
      check: action({
        transport: restLike('POST', '/check'),
        input: z.object({ code: z.string().refine(async (code) => code === 'ok') }),
        output: z.unknown(),
      }),
    });
    const memory = memoryDriver(() => ({ status: 200, body: null }));
    const server = createClient(asyncContract, { drivers: [memory.driver] });

    const pending = server.check({ code: 'ok' });

    expect(memory.sent).toHaveLength(0);
    await pending;
    expect(memory.sent).toHaveLength(1);
  });

  it('rejects, without throwing, a synchronous failure before sending', async () => {
    const memory = memoryDriver(() => ({ status: 200, body: null }));
    const server = createClient(contract, { drivers: [memory.driver] });

    const pending = server.auth.login({ email: 'x', password: 'pw' });

    await expect(pending).rejects.toMatchObject({ kind: 'input' });
  });
});
