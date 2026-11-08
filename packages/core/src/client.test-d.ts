import { describe, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { restLike, wsLike } from './__fixtures__/bindings.js';
import type { MemoryRequest, MemoryResponse } from './__fixtures__/memory-driver.js';
import type { ActionBinding } from './binding.js';
import { type CallOptions, type Client, createClient } from './client.js';
import { defineContract } from './contract.js';
import { action, event } from './definition.js';
import { input } from './input.js';

interface NativeRequest {
  readonly url: string;
}

interface NativeResponse {
  readonly status: number;
}

const typedBinding = (): ActionBinding & {
  readonly '~request'?: NativeRequest;
  readonly '~response'?: NativeResponse;
} => ({
  driver: 'native',
  family: 'action',
  sources: [],
});

const untypedBinding = (): ActionBinding => ({ driver: 'untyped', family: 'action', sources: [] });

const contract = defineContract({
  auth: {
    login: action({
      transport: restLike('POST', '/auth/login'),
      input: z.object({ email: z.string(), password: z.string() }),
      output: z.object({ token: z.string() }),
    }),
  },
  list: action({ transport: restLike('GET', '/list'), output: z.array(z.string()) }),
  search: action({
    transport: restLike('GET', '/search'),
    input: input({ page: z.number().default(1), q: z.string().optional() }),
    output: z.number(),
  }),
  typed: action({ transport: typedBinding(), output: z.void() }),
  untyped: action({ transport: untypedBinding(), output: z.void() }),
  notifications: event({ transport: wsLike('notification'), receive: z.object({ text: z.string() }) }),
  chat: event({
    transport: wsLike('chat'),
    send: z.object({ text: z.string() }),
    receive: z.object({ text: z.string() }),
  }),
});

declare const server: Client<typeof contract>;

describe('Client types', () => {
  it('mirrors the contract tree', () => {
    expectTypeOf(createClient(contract, { drivers: [] })).toEqualTypeOf<Client<typeof contract>>();
    expectTypeOf(server.auth.login).parameter(0).toEqualTypeOf<{ email: string; password: string }>();
    expectTypeOf(server.auth.login).returns.toEqualTypeOf<Promise<{ token: string }>>();
  });

  it('makes the argument optional without input or with optional fields only', () => {
    expectTypeOf(server.list).parameter(0).toEqualTypeOf<undefined>();
    expectTypeOf(server.search)
      .parameter(0)
      .toEqualTypeOf<{ page?: number | undefined; q?: string | undefined } | undefined>();

    server.list();
    server.search();
    // @ts-expect-error login needs its argument
    server.auth.login();
  });

  it('types per-call interceptors with the native request of the binding', () => {
    expectTypeOf(server.typed).parameter(1).toEqualTypeOf<CallOptions<NativeRequest, NativeResponse> | undefined>();
    expectTypeOf(server.list).parameter(1).toEqualTypeOf<CallOptions<MemoryRequest, MemoryResponse> | undefined>();
    expectTypeOf(server.untyped).parameter(1).toEqualTypeOf<CallOptions<unknown, unknown> | undefined>();
  });

  it('exposes publish and subscribe according to the event schemas', () => {
    expectTypeOf(server.notifications).toHaveProperty('subscribe');
    expectTypeOf(server.notifications).not.toHaveProperty('publish');
    expectTypeOf(server.chat.publish).parameter(0).toEqualTypeOf<{ text: string }>();
    expectTypeOf(server.chat.subscribe).parameter(0).parameter(0).toEqualTypeOf<{ text: string }>();
  });
});
