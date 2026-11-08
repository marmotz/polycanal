import { describe, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { payloadOnly, restLike, wsLike } from './__fixtures__/bindings.js';
import { defineContract } from './contract.js';
import { action, event } from './definition.js';
import type { ActionInputOf, ActionOutputOf, EventReceiveOf, EventSendOf } from './infer.js';
import { input } from './input.js';

const contract = defineContract({
  households: {
    list: action({ transport: restLike('GET', '/households'), output: z.array(z.string()) }),
    updateMemberRole: action({
      transport: restLike('PATCH', '/user/:userId'),
      input: input({
        householdId: z.string(),
        userId: { source: 'path', schema: z.string() },
        toUserId: { source: 'body', alias: 'userId', schema: z.string() },
        role: z.enum(['admin', 'member']),
      }),
      output: z.void(),
    }),
    analyses: action({
      transport: restLike('GET', '/projects/:id/analyses'),
      input: input({ id: z.string(), page: z.number().default(1), search: z.string().optional() }),
      output: z.object({ total: z.number() }),
    }),
  },
  auth: {
    login: action({
      transport: restLike('POST', '/auth/login'),
      input: z.object({ email: z.string(), password: z.string() }),
      output: z.object({ token: z.string() }),
    }),
  },
  notifications: event({ transport: wsLike('notification'), receive: z.object({ text: z.string() }) }),
  chat: event({ transport: wsLike('chat'), send: z.object({ text: z.string() }) }),
});

describe('contract types', () => {
  it('infers the call argument of an action', () => {
    expectTypeOf<ActionInputOf<typeof contract.households.updateMemberRole>>().toEqualTypeOf<{
      householdId: string;
      userId: string;
      toUserId: string;
      role: 'admin' | 'member';
    }>();
    expectTypeOf<ActionInputOf<typeof contract.auth.login>>().toEqualTypeOf<{ email: string; password: string }>();
    expectTypeOf<ActionInputOf<typeof contract.households.list>>().toEqualTypeOf<void>();
  });

  it('makes fields accepting undefined optional', () => {
    expectTypeOf<ActionInputOf<typeof contract.households.analyses>>().toEqualTypeOf<{
      id: string;
      page?: number | undefined;
      search?: string | undefined;
    }>();
  });

  it('infers the response of an action', () => {
    expectTypeOf<ActionOutputOf<typeof contract.households.list>>().toEqualTypeOf<string[]>();
    expectTypeOf<ActionOutputOf<typeof contract.households.analyses>>().toEqualTypeOf<{ total: number }>();
  });

  it('infers event messages', () => {
    expectTypeOf<EventReceiveOf<typeof contract.notifications>>().toEqualTypeOf<{ text: string }>();
    expectTypeOf<EventSendOf<typeof contract.notifications>>().toEqualTypeOf<never>();
    expectTypeOf<EventSendOf<typeof contract.chat>>().toEqualTypeOf<{ text: string }>();
    expectTypeOf<EventReceiveOf<typeof contract.chat>>().toEqualTypeOf<never>();
  });

  it('keeps the driver-specific binding type', () => {
    expectTypeOf(contract.households.list.transport.method).toEqualTypeOf<string>();
    expectTypeOf(contract.notifications.transport.name).toEqualTypeOf<string>();
  });

  it('rejects sources the binding does not support', () => {
    action({
      transport: payloadOnly(),
      // @ts-expect-error 'path' is not a source of this binding
      input: input({ id: { source: 'path', schema: z.string() } }),
      output: z.void(),
    });

    action({
      transport: payloadOnly(),
      input: input({ id: { source: 'payload', schema: z.string() } }),
      output: z.void(),
    });
  });
});
