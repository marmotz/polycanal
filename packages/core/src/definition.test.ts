import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { payloadOnly, restLike, wsLike } from './__fixtures__/bindings.js';
import { action, event, isDefinition } from './definition.js';
import { ContractDefinitionError } from './errors.js';
import { input } from './input.js';

describe('action()', () => {
  it('builds a branded action definition with defaults', () => {
    const transport = restLike('GET', '/households');
    const output = z.array(z.string());
    const definition = action({ transport, output });

    expect(isDefinition(definition)).toBe(true);
    expect(definition).toMatchObject({
      kind: 'action',
      transport,
      input: undefined,
      output,
      errors: {},
      codec: undefined,
      meta: undefined,
    });
  });

  it('keeps input, errors, codec and meta', () => {
    const codec = { contentType: 'application/json', encode: JSON.stringify, decode: JSON.parse };
    const definition = action({
      transport: restLike('POST', '/auth/login'),
      input: z.object({ email: z.string() }),
      output: z.object({ token: z.string() }),
      errors: { 401: z.object({ reason: z.string() }) },
      codec,
      meta: { summary: 'Log in', tags: ['auth'] },
    });

    expect(Object.keys(definition.errors)).toEqual(['401']);
    expect(definition.codec).toBe(codec);
    expect(definition.meta).toEqual({ summary: 'Log in', tags: ['auth'] });
  });

  it('rejects an input field source the binding does not support', () => {
    const create = () =>
      action({
        transport: payloadOnly(),
        // @ts-expect-error 'body' is not a source of this binding
        input: input({ id: { source: 'body', schema: z.string() } }),
        output: z.void(),
      });

    expect(create).toThrow(ContractDefinitionError);
    expect(create).toThrow('uses source "body", not supported by driver "test-payload" (supported: payload)');
  });

  it('rejects an event binding', () => {
    // @ts-expect-error an event binding cannot carry an action
    const create = () => action({ transport: wsLike('notification'), output: z.void() });

    expect(create).toThrow('driver "test-ws" binding carries event channels, it cannot be used for an action');
  });

  it('rejects a missing transport', () => {
    // @ts-expect-error transport is required
    expect(() => action({ output: z.void() })).toThrow('action transport must be a binding produced by a driver');
  });

  it.each([
    ['an input', { input: 'id' }, 'action input must be an input() or a Standard Schema'],
    ['an output', { output: {} }, 'action output must be a Standard Schema'],
    ['an error', { errors: { 404: 'not found' } }, 'action error "404" must be a Standard Schema'],
  ])('rejects %s that is not a schema', (_, override, message) => {
    expect(() => action({ transport: restLike('GET', '/'), output: z.void(), ...override } as never)).toThrow(message);
  });
});

describe('event()', () => {
  it('builds a receive-only event', () => {
    const receive = z.object({ text: z.string() });
    const definition = event({ transport: wsLike('notification'), receive });

    expect(isDefinition(definition)).toBe(true);
    expect(definition).toMatchObject({ kind: 'event', send: undefined, receive });
  });

  it('builds a two-way event', () => {
    const message = z.object({ text: z.string() });
    const definition = event({ transport: wsLike('chat:message'), send: message, receive: message });

    expect(definition.send).toBe(message);
    expect(definition.receive).toBe(message);
  });

  it('rejects an event without send nor receive', () => {
    // @ts-expect-error at least one of send and receive is required
    const create = () => event({ transport: wsLike('noop') });

    expect(create).toThrow('event must declare at least one of send and receive');
  });

  it('rejects an action binding', () => {
    // @ts-expect-error an action binding cannot carry an event
    const create = () => event({ transport: restLike('GET', '/'), receive: z.string() });

    expect(create).toThrow('driver "test-rest" binding carries action channels, it cannot be used for an event');
  });

  it('rejects a send schema that is not a schema', () => {
    expect(() => event({ transport: wsLike('chat'), send: 'text' } as never)).toThrow(
      'event send must be a Standard Schema',
    );
  });
});
